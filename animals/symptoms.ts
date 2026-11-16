// The symptoms of animal-hospital/src/symptoms.js, drawn at an animal's anchor points the same way
// the game draws them, so the points can be tried out here. Lop Hop colour names are mapped onto
// the master palette; the game's outlines are left out, as in the engine's look.
import { PALETTE, type PaletteKey } from '../lab/palette.ts';
import type { Anchor, AnchorName, AnimalSprite } from '../lab/animal.ts';

const COLOR: Record<string, PaletteKey> = {
  darkGreen: 'jungle', lightGreen: 'lime', red: 'red', white: 'white', blue: 'blue', charcoal: 'basalt', slate: 'grey',
  pink: 'pink', rose: 'red', brown: 'brown', sand: 'sandstone', camel: 'tan', blueGrey: 'steel', grey: 'grey', cream: 'cream', purple: 'purple',
};

type Px = (color: string, pt: Anchor, dx?: number, dy?: number, bw?: number, bh?: number) => void;
interface P extends Record<AnchorName, Anchor> { face: boolean; side: boolean }
type Every = (secs: number) => number;

const MOVING: Record<string, (px: Px, P: P, every: Every) => void> = {
  cold: (px, P, every) => {
    if (P.face && every(1.6) < 0.6) px('blue', P.nose, 0, 2);
    const k = every(4);
    if (k < 0.12) for (const dx of [-3, 0, 3]) px('white', P.mouth, dx, 2 + k * 30);
  },
  sprain: (px, P, every) => { if (every(1.2) < 0.5) { px('red', P.foot, -2, -5); px('red', P.foot, 3, -5); } },
  hiccup: (px, P, every) => { const k = every(2.6); if (k < 0.3) px('cream', P.top, 2 + k * 10, -3 - k * 25, 2, 2); },
  hairball: (px, P, every) => { const k = every(5); if (k < 0.25) px('purple', P.mouth, 2 + k * 16, k * 8, 2, 2); },
  bin: (px, P, every) => { const k = every(2.2); px('lightGreen', P.body, -1, -6 - k * 4); px('lightGreen', P.body, 2, -5 - k * 4); },
  hump: (px, P, every) => { if (every(0.8) < 0.5) { px('white', P.back, -4, -1, 1, 2); px('white', P.back, 4, -1, 1, 2); } },
};

export const SYMPTOMS: Record<string, (px: Px, P: P, every: Every) => void> = {
  thorn: (px, P) => { px('darkGreen', P.foot, 1, -3, 1, 2); px('lightGreen', P.foot, 1, -4); },
  cut: (px, P) => { px('red', P.body, -2, -1, 3, 1); px('red', P.body, -1, 1); },
  cold: (px, P, e) => { if (P.face) px('red', P.nose, 0, 0, 2, 1); MOVING.cold(px, P, e); },
  sprain: (px, P, e) => { px('white', P.foot, 0, -2, 3, 2); MOVING.sprain(px, P, e); },
  tick: (px, P) => { for (const [pt, dx, dy] of [[P.body, -2, -1], [P.back, 2, 1], [P.head, 2, -1]] as const) { px('charcoal', pt, dx, dy); px('slate', pt, dx + 1, dy); } },
  knot: (px, P) => { px('pink', P.top, -1, -2, 3, 2); px('rose', P.top, 0, -1); },
  hiccup: (px, P, e) => MOVING.hiccup(px, P, e),
  hairball: (px, P, e) => MOVING.hairball(px, P, e),
  sock: (px, P) => { if (!P.face) return; px('white', P.mouth, 0, 1, 2, 4); px('red', P.mouth, 0, 2, 2, 1); px('red', P.mouth, 0, 4, 2, 1); },
  curl: (px, P) => { px('brown', P.back, -3, -2, 1, 2); px('brown', P.back, 1, -3, 1, 2); px('brown', P.back, 4, -2, 1, 2); },
  nut: (px, P) => { if (!P.face) return; px('brown', P.mouth, 2, -1, 2, 2); },
  bin: (px, P, e) => MOVING.bin(px, P, e),
  mud: (px, P) => { px('sand', P.body, -3, -1, 3, 1); px('sand', P.body, -1, 0, 1, 2); px('sand', P.body, 1, 1, 3, 1); px('sand', P.back, 0, 1, 2, 1); px('sand', P.head, -2, -1, 2, 1); },
  sunburn: (px, P) => { px('red', P.back, -2, 0, 4, 1); px('rose', P.body, -1, -1, 3, 1); px('red', P.top, -1, 1, 2, 1); },
  tangle: (px, P) => { for (const [dx, dy, w, h] of [[-3, -2, 2, 1], [-2, -1, 1, 1], [0, -1, 1, 2], [2, -2, 2, 1], [3, -1, 1, 1], [-1, 1, 3, 1]]) px('camel', P.body, dx, dy, w, h); },
  hump: (px, P, e) => MOVING.hump(px, P, e),
  trunk: (px, P) => { px('blueGrey', P.mouth, 0, 2, 3, 2); px('grey', P.mouth, 1, 2); },
};

/**
 * Draws a symptom onto a sprite. `facing` decides which way forward is on screen and whether the
 * face is seen; `seconds` drives the moving ones.
 */
export function drawSymptom(sprite: AnimalSprite, name: string, anchors: Record<AnchorName, Anchor>, facing: number, seconds: number): void {
  const draw = SYMPTOMS[name];
  if (!draw) return;
  // Forward is to the right in facings 0, 3 and 7, to the left in their mirror images; face on
  // and from behind it is taken as right.
  const fwd = facing === 1 || facing === 2 || facing === 5 ? -1 : 1;
  const px: Px = (color, pt, dx = 0, dy = 0, bw = 1, bh = 1) => {
    const x = Math.round(pt.x + dx * fwd);
    const y = Math.round(pt.y + dy);
    const left = fwd < 0 ? x - bw + 1 : x;
    const hex = PALETTE[COLOR[color] ?? 'white'].base;
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) sprite.set(left + i, y + j, hex);
  };
  draw(px, { ...anchors, face: facing === 0 || facing === 1 || facing === 4 || facing === 5 || facing === 7, side: false }, (secs) => (seconds % secs) / secs);
}
