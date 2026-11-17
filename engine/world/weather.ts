// Weather as a few amounts, 0 to 1, that any game can blend: cloud, rain, wind, fog and storm.
// They turn knobs the world already has (the sea's waves and wavelets, how hard plants sway, how
// dark shadows are) and add overlays: drifting cloud shadows, wet ground, rain, rings on the
// water, gusts, haze over the far sea and lightning. Which weather comes when is the game's.
import type { Tint } from './daylight.ts';
import { ocean, rgb } from './ocean.ts';

export interface Weather {
  cloud: number;
  rain: number;
  wind: number;
  fog: number;
  /** Lightning now and then. */
  storm: number;
}

export const CLEAR: Weather = { cloud: 0, rain: 0, wind: 0, fog: 0, storm: 0 };

/** A weather between two, `k` from 0 (a) to 1 (b). */
export function mixWeather(a: Weather, b: Weather, k: number): Weather {
  const m = (x: number, y: number) => x + (y - x) * k;
  return { cloud: m(a.cloud, b.cloud), rain: m(a.rain, b.rain), wind: m(a.wind, b.wind), fog: m(a.fog, b.fog), storm: m(a.storm, b.storm) };
}

/** The sea as tuned, for calm weather; wind scales it from here. */
const CALM = { ...ocean };

/** Sets the sea's waves and wavelets for a weather: wind brings more wavelets, faster drift and bigger, quicker waves. */
export function weatherSea(w: Weather): void {
  ocean.ripples = Math.min(0.8, CALM.ripples + 0.4 * w.wind);
  ocean.rippleOpacity = Math.min(0.9, CALM.rippleOpacity + 0.25 * w.wind);
  ocean.drift = CALM.drift * (1 + 2 * w.wind);
  ocean.wavePeriod = CALM.wavePeriod / (1 + 0.7 * w.wind);
  ocean.waveReach = CALM.waveReach * (1 + 0.3 * w.wind);
  ocean.glints = CALM.glints * (1 - w.cloud);
}

/** How hard plants sway: a breeze on a calm day, up to a storm's. */
export const plantWind = (w: Weather) => Math.round((1 + 1.5 * w.wind) * 4) / 4;

const GREY = rgb('#9aa3b0');
/** The light under cloud and rain: greyer and dimmer. Lay it with `light` as well as the time of day's tint. */
export function overcast(w: Weather): Tint {
  return { r: GREY[0], g: GREY[1], b: GREY[2], amount: Math.min(0.75, 0.3 * w.cloud + 0.15 * w.rain + 0.25 * w.storm) };
}

/** How much a shadow shows under the clouds, 1 in sunshine. */
export const shadowLight = (w: Weather) => 1 - 0.75 * w.cloud;

const hash = (a: number, b: number) => ((Math.imul(a, 73856093) ^ Math.imul(b + 0x9e37, 19349663)) >>> 0) / 4294967296;

/**
 * How bright a lightning flash is now, 0 to 1. Each second may hold one, more often the stormier:
 * a bright flash, a flicker, a second flash, then fading.
 */
export function flashAt(ms: number, w: Weather): number {
  if (w.storm <= 0) return 0;
  const slot = Math.floor(ms / 1000);
  if (hash(slot, 1) > 0.1 * w.storm) return 0;
  const t = (ms % 1000) / 1000 - hash(slot, 2) * 0.5;
  if (t < 0) return 0;
  if (t < 0.05) return 1;
  if (t < 0.1) return 0.3;
  if (t < 0.15) return 0.8;
  return Math.max(0, 0.8 * (1 - (t - 0.15) / 0.3));
}

/** What the overlays need to know of the ground under a view pixel: water depth there (Infinity off the map), or 0 on land. */
export type DepthAt = (gx: number, gy: number) => number;

const FOG = rgb('#e6edf2');
const RAIN = rgb('#dbe8ff');
const RING = rgb('#e8f6ff');
const WET = rgb('#8a7a5a');
const CLOUD = rgb('#1e2840');

/** Smooth noise 0 to 1 on a grid one unit across. */
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const ease = (t: number) => t * t * (3 - 2 * t);
  const u = ease(x - ix), v = ease(y - iy);
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * u;
  const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * u;
  return top + (bottom - top) * v;
}

const toward = (d: Uint8ClampedArray, o: number, c: number[], k: number) => {
  d[o] += (c[0] - d[o]) * k;
  d[o + 1] += (c[1] - d[o + 1]) * k;
  d[o + 2] += (c[2] - d[o + 2]) * k;
};

/**
 * Lays the weather over a composed view, `view` its place on the ground image: ground first
 * (cloud shadows, wet ground, rings on the water, haze), then what is in the air (rain, gusts).
 */
export function drawWeather(image: { data: Uint8ClampedArray; width: number; height: number }, view: { x: number; y: number }, depthAt: DepthAt, ms: number, w: Weather): void {
  const { width: vw, height: vh, data: d } = image;
  const t = ms / 1000;
  // Patchy cloud throws shadows; under a closed sky the light is simply grey.
  const patches = 0.22 * Math.sin(Math.PI * Math.min(1, w.cloud));
  const drift = { x: t * (6 + 24 * w.wind), y: t * (2 + 6 * w.wind) };
  const wet = 0.3 * w.rain;
  if (patches > 0.01 || wet > 0 || w.fog > 0) {
    for (let y = 0; y < vh; y++) {
      for (let x = 0; x < vw; x++) {
        const gx = x + view.x, gy = y + view.y;
        const o = (y * vw + x) * 4;
        const depth = depthAt(gx, gy);
        if (patches > 0.01) {
          const n = noise((gx - drift.x) / 48, (gy - drift.y) / 28) * 0.65 + noise((gx - drift.x) / 17, (gy - drift.y) / 11) * 0.35;
          const k = Math.min(1, Math.max(0, (0.42 - n) / 0.06));
          if (k > 0) toward(d, o, CLOUD, patches * k);
        }
        if (wet > 0 && depth === 0) toward(d, o, WET, wet);
        if (w.fog > 0) toward(d, o, FOG, w.fog * (0.12 + 0.6 * Math.min(1, depth / 3.5)));
      }
    }
  }
  if (w.rain > 0) {
    // Rings where drops hit the water: each grows for a moment and is gone.
    const rings = Math.floor((w.rain * vw * vh) / 500);
    const slot = Math.floor(ms / 400);
    for (let k = 0; k < rings; k++) {
      const s = slot + (k % 4);
      const age = (ms / 400 + (k % 4) / 4) % 1;
      const cx = Math.floor(hash(k, s) * vw), cy = Math.floor(hash(k, s + 7) * vh);
      if (depthAt(cx + view.x, cy + view.y) < 0.2) continue;
      const r = age < 0.5 ? 1 : 2;
      for (const [dx, dy] of [[-r, 0], [r, 0], [0, -1], [0, 1]]) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < vw && y < vh) toward(d, (y * vw + x) * 4, RING, 0.5 * (1 - age));
      }
    }
    // Streaks falling, slanted by the wind.
    const streaks = Math.floor((w.rain * vw * vh) / 70);
    const len = 3 + Math.round(2 * w.rain);
    const slant = 0.25 + 0.8 * w.wind;
    for (let k = 0; k < streaks; k++) {
      const speed = 160 + 80 * hash(k, 3);
      const span = vh + len + 8;
      const y0 = ((t * speed + hash(k, 4) * span) % span) - len;
      const x0 = hash(k, 5) * (vw + vh * slant) - y0 * slant;
      for (let n = 0; n < len; n++) {
        const x = Math.floor(x0 - n * slant), y = Math.floor(y0 - n);
        if (x >= 0 && y >= 0 && x < vw && y < vh) toward(d, (y * vw + x) * 4, RAIN, 0.45);
      }
    }
  }
  if (w.wind > 0.4) {
    // Gusts: thin pale lines blown across.
    const gusts = Math.floor(((w.wind - 0.4) * vw * vh) / 2500);
    for (let k = 0; k < gusts; k++) {
      const speed = 120 + 80 * hash(k, 6);
      const span = vw + 40;
      const x0 = ((t * speed + hash(k, 7) * span) % span) - 20;
      const y = Math.floor(hash(k, 8) * vh + Math.sin(t * 3 + k) * 2);
      const len = 3 + Math.floor(hash(k, 9) * 5);
      for (let n = 0; n < len; n++) {
        const x = Math.floor(x0) - n;
        if (x >= 0 && y >= 0 && x < vw && y < vh) toward(d, (y * vw + x) * 4, RING, 0.3 * (1 - n / len));
      }
    }
  }
}
