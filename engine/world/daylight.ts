// Time of day as a colour laid over a composed picture: the light's colour multiplies every pixel,
// and a fade darkens it toward black for screen transitions. Which tint shows when is the game's.
// Glowing colours, such as a flame's, give their own light and keep their colour through it all.
// shortcut: a glow does not light what is around it yet; add a lit radius here when wanted.
import { FIRE_KEYS, PALETTE } from '../core/palette.ts';
import { rgb } from './ocean.ts';

/**
 * Colours that give their own light: the palette's fire tones. The time of day, the weather and
 * lightning leave them as drawn, and they cast no shadow. A game may add its own before it draws them.
 */
export const GLOWING = new Set<string>(FIRE_KEYS.flatMap((key) => Object.values(PALETTE[key])));
/** The alpha a composed pixel of a glowing colour has, so the passes that light a picture can leave it be. */
export const GLOW_ALPHA = 254;

/** A light colour and how strongly it tints, 0 (none) to 1 (full multiply). */
export interface Tint { r: number; g: number; b: number; amount: number }

const tint = (hex: string, amount: number): Tint => {
  const [r, g, b] = rgb(hex);
  return { r, g, b, amount };
};

export const TINTS = {
  day: tint('#ffffff', 0),
  /** Low sun: warm, a little dimmer. */
  sunset: tint('#ff9a5c', 0.45),
  /** Just after the sun is gone. */
  dusk: tint('#7a5c9c', 0.6),
  /** Moonlight: dark and blue. */
  night: tint('#3a4a8c', 0.72),
};

/** A tint between two, `k` from 0 (a) to 1 (b). */
export function mixTint(a: Tint, b: Tint, k: number): Tint {
  const m = (x: number, y: number) => x + (y - x) * k;
  return { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b), amount: m(a.amount, b.amount) };
}

/** Tints a tint along a list of stops, `k` from 0 (the first) to 1 (the last). */
export function along(stops: Tint[], k: number): Tint {
  const at = Math.max(0, Math.min(1, k)) * (stops.length - 1);
  const n = Math.min(stops.length - 2, Math.floor(at));
  return mixTint(stops[n], stops[n + 1], at - n);
}

/** Lights a picture in place with a tint, then fades it toward black by `fade` (0 to 1). */
export function light(image: { data: Uint8ClampedArray }, t: Tint, fade = 0): void {
  if (t.amount <= 0 && fade <= 0) return;
  const keep = 1 - fade;
  const fr = (1 - t.amount + (t.amount * t.r) / 255) * keep;
  const fg = (1 - t.amount + (t.amount * t.g) / 255) * keep;
  const fb = (1 - t.amount + (t.amount * t.b) / 255) * keep;
  const d = image.data;
  for (let k = 0; k < d.length; k += 4) {
    if (d[k + 3] === GLOW_ALPHA) continue;
    d[k] *= fr;
    d[k + 1] *= fg;
    d[k + 2] *= fb;
  }
}
