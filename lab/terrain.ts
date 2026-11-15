// Ground for the island: a height map with one value per ground tile (one metre), drawn in the
// same 2:1 view and pixel style as the characters and plants. Heights are whole levels; level 0
// is the water line. Everything else follows from the heights by rule: what the surface is
// (sea, beach, sand, grass, rock), where the ground slopes and where it drops as a cliff, where
// one can walk, and how it is painted.

/** A ground tile on screen: one metre across. */
export const TILE_W = 32;
export const TILE_H = 16;
/** Screen pixels per height level. One level is about a third of a metre. */
export const LEVEL_PX = 8;
/** The water line. Cells below it are sea; cells at it are beach. */
export const SEA_LEVEL = 0;
export const MIN_LEVEL = -4;
export const MAX_LEVEL = 12;

export interface HeightMap {
  readonly w: number;
  readonly h: number;
  /** Level per cell, row by row: `levels[j * w + i]`. */
  readonly levels: Int8Array;
  /** Optional painted ground per cell: 0 follows the height rule, otherwise `PAINTS[n - 1]`. Under water it is ignored. */
  readonly paint?: Uint8Array;
}

export function createHeightMap(w: number, h: number, fill = MIN_LEVEL): HeightMap {
  return { w, h, levels: new Int8Array(w * h).fill(fill) };
}

const clampLevel = (n: number) => Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(n)));

export const inside = (map: HeightMap, i: number, j: number) => i >= 0 && j >= 0 && i < map.w && j < map.h;

/** The level of a cell. Outside the map is open sea. */
export function levelAt(map: HeightMap, i: number, j: number): number {
  return inside(map, i, j) ? map.levels[j * map.w + i] : MIN_LEVEL;
}

export function setLevel(map: HeightMap, i: number, j: number, level: number): void {
  if (inside(map, i, j)) map.levels[j * map.w + i] = clampLevel(level);
}

/** The height that shows: the ground, or the water surface over it. */
export const surfaceLevel = (map: HeightMap, i: number, j: number) => Math.max(SEA_LEVEL, levelAt(map, i, j));

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** The largest step to a neighbouring cell, in levels. Water counts at the water line. */
export function steepness(map: HeightMap, i: number, j: number): number {
  const here = surfaceLevel(map, i, j);
  return Math.max(...NEIGHBOURS.map(([di, dj]) => Math.abs(here - surfaceLevel(map, i + di, j + dj))));
}

export const SURFACES = ['deep', 'shallow', 'beach', 'sand', 'grass', 'rock'] as const;
export type Surface = (typeof SURFACES)[number];
/** What can be painted on land. */
export const PAINTS = ['sand', 'grass', 'rock'] as const;

const paintAt = (map: HeightMap, i: number, j: number) => (map.paint && inside(map, i, j) ? map.paint[j * map.w + i] : 0);

/** What a cell is, by rule from its height and its neighbours. */
export function surfaceAt(map: HeightMap, i: number, j: number): Surface {
  const level = levelAt(map, i, j);
  if (level < -1) return 'deep';
  if (level < SEA_LEVEL) return 'shallow';
  const painted = paintAt(map, i, j);
  if (painted) return PAINTS[painted - 1];
  if (level === SEA_LEVEL) return 'beach';
  if (level >= 6 || steepness(map, i, j) >= 3) return 'rock';
  if (level === 1) return 'sand';
  return 'grass';
}

export const isLand = (map: HeightMap, i: number, j: number) => levelAt(map, i, j) >= SEA_LEVEL;

/** The largest difference between neighbouring cells that is drawn as a slope rather than a cliff. */
export const SLOPE_LEVELS = 2;

/** Whether a person can walk from one cell to a neighbouring one: land on both, a slope, not a cliff. */
export function canStep(map: HeightMap, a: [number, number], b: [number, number]): boolean {
  if (!isLand(map, ...a) || !isLand(map, ...b)) return false;
  return Math.abs(levelAt(map, ...a) - levelAt(map, ...b)) <= SLOPE_LEVELS;
}

// ------------------------------------------------------------------ generating

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth noise from a coarse grid of random values, -1 to 1. */
function valueNoise(random: () => number, w: number, h: number, step: number): (x: number, y: number) => number {
  const gw = Math.ceil(w / step) + 2;
  const gh = Math.ceil(h / step) + 2;
  const grid = Array.from({ length: gw * gh }, () => random() * 2 - 1);
  const ease = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / step;
    const gy = y / step;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = ease(gx - x0);
    const ty = ease(gy - y0);
    const at = (i: number, j: number) => grid[Math.min(gh - 1, j) * gw + Math.min(gw - 1, i)];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
  };
}

export interface IslandOptions {
  /** The highest level, roughly. */
  peak?: number;
  /** How much of the map is land, 0 to 1. */
  land?: number;
}

/** An island: high in the middle, falling to beaches all round, with hills and coves by noise. */
export function generateIsland(seed: number, w: number, h: number, options: IslandOptions = {}): HeightMap {
  const peak = options.peak ?? 6;
  const land = options.land ?? 0.55;
  const random = rng(seed * 2654435761 + 17);
  const broad = valueNoise(random, w, h, 5);
  const fine = valueNoise(random, w, h, 2.5);
  const map = createHeightMap(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dx = (i + 0.5 - w / 2) / (w / 2);
      const dy = (j + 0.5 - h / 2) / (h / 2);
      const d = Math.hypot(dx, dy);
      const e = (1 - d / land) * 0.8 + broad(i, j) * 0.3 + fine(i, j) * 0.12;
      setLevel(map, i, j, e < 0 ? Math.floor(e * 6) : Math.floor(e * peak * 1.1));
    }
  }
  return map;
}

/** Where a point of the map appears, relative to the north corner of cell 0, 0 at the water line. */
export function toScreen(i: number, j: number, level = 0): { x: number; y: number } {
  return { x: ((i - j) * TILE_W) / 2, y: ((i + j) * TILE_H) / 2 - level * LEVEL_PX };
}

// ------------------------------------------------------------------ slopes

/**
 * The heights of a cell's four corners: north (i, j), east (i + 1, j), south (i + 1, j + 1) and
 * west (i, j + 1). A corner is the average of the four cells round it, kept within one level of
 * this cell. Neighbours share their corners, so a step of one or two levels becomes a slope, and a
 * larger step leaves the difference as a cliff. The sea floor slopes the same way, so a beach
 * runs into the water.
 */
export function cornersOf(map: HeightMap, i: number, j: number): [number, number, number, number] {
  const own = levelAt(map, i, j);
  const corner = (vi: number, vj: number) => {
    const mean = (levelAt(map, vi - 1, vj - 1) + levelAt(map, vi, vj - 1) + levelAt(map, vi - 1, vj) + levelAt(map, vi, vj)) / 4;
    return Math.max(own - 1, Math.min(own + 1, mean));
  };
  return [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
}

/** Which diagonal a cell folds along: the one whose ends are closest in height. */
const foldsNorthSouth = (c: [number, number, number, number]) => Math.abs(c[0] - c[2]) <= Math.abs(c[1] - c[3]);

/** The ground's height in levels at any point of the map, on the slopes between corners. */
export function heightAt(map: HeightMap, i: number, j: number): number {
  const ci = Math.floor(i);
  const cj = Math.floor(j);
  const [n, e, s, w] = cornersOf(map, ci, cj);
  const u = i - ci;
  const v = j - cj;
  if (foldsNorthSouth([n, e, s, w])) return u >= v ? n + u * (e - n) + v * (s - e) : n + v * (w - n) + u * (s - w);
  return u + v <= 1 ? n + u * (e - n) + v * (w - n) : s + (1 - u) * (w - s) + (1 - v) * (e - s);
}

/** Where things stand: on the ground, or on the water where the ground is under it. */
export const standingHeight = (map: HeightMap, i: number, j: number) => Math.max(SEA_LEVEL, heightAt(map, i, j));

// ------------------------------------------------------------------ drawing

export interface TerrainImage {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  /** Per pixel, the cell that painted it (`j * w + i`), or -1. Used to hide things behind higher ground. */
  cell: Int32Array;
  /** Per pixel, the height of the ground painted there, in levels. */
  height: Float32Array;
  /** Where map point 0, 0 at the water line is on the image. */
  origin: { x: number; y: number };
}

const COLORS = {
  deep: '#4faec4',
  shallow: '#7fd6d0',
  wet: '#d3bc84',
  sand: '#e9d9a0',
  grass: '#8fcf78',
  rock: '#aeaba3',
} as const;
/** Side faces: the left one in light, the right one in shade, as everything else is lit. */
const SIDES = {
  wet: ['#bfa66f', '#a99160'],
  sand: ['#c9b077', '#b39a63'],
  grass: ['#b98f63', '#9c7650'],
  rock: ['#8f8b83', '#78746d'],
} as const;
const GRASS_LIP = '#6c9f55';
const FOAM = '#e8fbf6';
const LIT = '#fff6d8';
const DIM = '#5a4060';

type Ground = keyof typeof SIDES;
/** What the ground is at a height, inside a cell of some surface: low ground is sand whatever the cell. */
function groundAt(surface: Surface, h: number, painted = false): Ground {
  if (h < 0.15) return 'wet';
  if (surface === 'rock') return 'rock';
  if (painted) return surface === 'grass' ? 'grass' : 'sand';
  if (h < 1.3 || surface !== 'grass') return 'sand';
  return 'grass';
}

/**
 * Light from the upper left of the screen, as on characters and plants, in map space: i runs
 * down to the right, j down to the left, z up (one level is about a third of a metre, a tile one).
 */
const LIGHT = (() => {
  const v = [-0.141, 0.636, 0.75];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();
const LEVEL_M = 0.354;

// Colours are worked out per pixel from a handful of strings, so both helpers remember their answers.
const rgbCache = new Map<string, number[]>();
const rgbOf = (hex: string) => {
  let rgb = rgbCache.get(hex);
  if (!rgb) rgbCache.set(hex, (rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))));
  return rgb;
};

/** Paints the whole map, back to front, over open sea, then lays the water over what lies below it. */
export function renderTerrain(map: HeightMap, size?: { w: number; h: number; origin: { x: number; y: number } }): TerrainImage {
  const w = size?.w ?? (map.w + map.h) * (TILE_W / 2) + 16;
  const h = size?.h ?? (map.w + map.h) * (TILE_H / 2) + MAX_LEVEL * LEVEL_PX + 16;
  const origin = size?.origin ?? { x: map.h * (TILE_W / 2) + 8, y: MAX_LEVEL * LEVEL_PX + 8 };
  const rgba = new Uint8ClampedArray(w * h * 4);
  const cell = new Int32Array(w * h).fill(-1);
  const height = new Float32Array(w * h).fill(MIN_LEVEL);
  const colors: string[] = new Array(w * h).fill(COLORS.deep);
  const put = (x: number, y: number, hex: string, index: number, level: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    colors[p] = hex;
    cell[p] = index;
    height[p] = level;
  };
  const hash = (x: number, y: number) => ((Math.imul(x + 31, 73856093) ^ Math.imul(y + 7, 19349663)) >>> 0) % 1000 / 1000;
  const screen = (i: number, j: number, level: number) => {
    const p = toScreen(i, j, level);
    return { x: origin.x + p.x, y: origin.y + p.y };
  };

  const order: [number, number][] = [];
  for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) order.push([i, j]);
  order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);

  for (const [i, j] of order) {
    const index = j * map.w + i;
    const surface = surfaceAt(map, i, j);
    const painted = paintAt(map, i, j) > 0;
    const c = cornersOf(map, i, j);
    const at: [number, number, number][] = [[i, j, c[0]], [i + 1, j, c[1]], [i + 1, j + 1, c[2]], [i, j + 1, c[3]]];
    const tris = foldsNorthSouth(c) ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
    for (const tri of tris) {
      const p = tri.map((k) => at[k]);
      const s = p.map(([pi, pj, pl]) => screen(pi, pj, pl));
      // The slope's light: brighter facing the light, darker facing away, flat ground unchanged.
      const a = [p[1][0] - p[0][0], p[1][1] - p[0][1], (p[1][2] - p[0][2]) * LEVEL_M];
      const b = [p[2][0] - p[0][0], p[2][1] - p[0][1], (p[2][2] - p[0][2]) * LEVEL_M];
      let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      if (n[2] < 0) n = n.map((x) => -x);
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const lit = (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / nl - LIGHT[2];
      const area = (s[1].x - s[0].x) * (s[2].y - s[0].y) - (s[2].x - s[0].x) * (s[1].y - s[0].y);
      if (Math.abs(area) < 1e-6) continue;
      const x0 = Math.floor(Math.min(s[0].x, s[1].x, s[2].x));
      const x1 = Math.ceil(Math.max(s[0].x, s[1].x, s[2].x));
      const y0 = Math.floor(Math.min(s[0].y, s[1].y, s[2].y));
      const y1 = Math.ceil(Math.max(s[0].y, s[1].y, s[2].y));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((s[1].x - px) * (s[2].y - py) - (s[2].x - px) * (s[1].y - py)) / area;
        const w1 = ((s[2].x - px) * (s[0].y - py) - (s[0].x - px) * (s[2].y - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const level = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2];
        let color: string = COLORS[groundAt(surface, level, painted)];
        if (lit > 0.06) color = mixHex(color, LIT, Math.min(0.22, lit * 0.9));
        else if (lit < -0.06) color = mixHex(color, DIM, Math.min(0.22, -lit * 0.9));
        // Tiles alternate faintly so the one-metre grid reads; the ground gets a few grains.
        if ((i + j) % 2 === 0) color = mixHex(color, '#ffffff', 0.05);
        if (hash(x, y) < 0.035) color = mixHex(color, SIDES[groundAt(surface, level, painted)][1], 0.5);
        put(x, y, color, index, level);
      }
    }
    // Side faces where this cell stands above the one in front: under the east edge (to i + 1)
    // and under the south-west edge (to j + 1). Mostly cliffs; on slopes they are a pixel or none.
    const right = cornersOf(map, i + 1, j);
    const left = cornersOf(map, i, j + 1);
    const faces = [
      { from: at[1], to: at[2], below: [right[0], right[3]], side: 1 },
      { from: at[3], to: at[2], below: [left[0], left[1]], side: 0 },
    ];
    for (const face of faces) {
      const a = screen(face.from[0], face.from[1], 0);
      const b = screen(face.to[0], face.to[1], 0);
      for (let x = Math.floor(Math.min(a.x, b.x)); x < Math.ceil(Math.max(a.x, b.x)); x++) {
        const t = (x + 0.5 - a.x) / (b.x - a.x);
        const top = face.from[2] + (face.to[2] - face.from[2]) * t;
        const bottom = face.below[0] + (face.below[1] - face.below[0]) * t;
        if ((top - bottom) * LEVEL_PX < 1) continue; // a seam, not a face
        const ground = a.y + (b.y - a.y) * t;
        const yTop = ground - top * LEVEL_PX;
        const yBottom = ground - bottom * LEVEL_PX;
        for (let y = Math.ceil(yTop - 0.5); y < yBottom; y++) {
          const level = (ground - (y + 0.5)) / LEVEL_PX;
          const kind = groundAt(surface, level, painted);
          let color: string = SIDES[kind][face.side];
          if (surface === 'grass' && kind === 'grass' && y - yTop < 2) color = GRASS_LIP;
          else if (hash(x, y) < 0.06) color = mixHex(color, '#000000', 0.08);
          put(x, y, color, index, level);
        }
      }
    }
  }

  // Water over everything below the water line, by depth: foam at the edge, sand showing through
  // the shallows, then shallow and deep water. The bands follow the slopes, so the shore is a curve.
  for (let p = 0; p < w * h; p++) {
    const depth = SEA_LEVEL - height[p];
    let color = colors[p];
    if (depth > 0) {
      if (depth < 0.12) color = FOAM;
      else if (depth < 0.55) color = mixHex(color, COLORS.shallow, 0.55);
      else if (depth < 1.4) color = COLORS.shallow;
      else if (depth < 2.4) color = mixHex(COLORS.shallow, COLORS.deep, 0.5);
      else color = COLORS.deep;
    }
    const [r, g, b] = rgbOf(color);
    rgba[p * 4] = r; rgba[p * 4 + 1] = g; rgba[p * 4 + 2] = b; rgba[p * 4 + 3] = 255;
  }
  return { w, h, rgba, cell, height, origin };
}

const mixCache = new Map<string, string>();
function mixHex(a: string, b: string, t: number): string {
  const key = `${a}${b}${t}`;
  let mixed = mixCache.get(key);
  if (mixed) return mixed;
  const x = rgbOf(a);
  const y = rgbOf(b);
  mixed = '#' + x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, '0')).join('');
  // shortcut: the light term is continuous, so the cache is capped rather than exact; raise if redraws slow down again.
  if (mixCache.size > 20000) mixCache.clear();
  mixCache.set(key, mixed);
  return mixed;
}

/**
 * Whether ground in front hides a pixel of something standing at map point `i`, `j` at height
 * `base`. Things are drawn after the ground, so a cliff or a hill nearer the viewer has to cover them.
 */
export function hiddenByGround(map: HeightMap, image: TerrainImage, x: number, y: number, i: number, j: number, base: number): boolean {
  if (x < 0 || y < 0 || x >= image.w || y >= image.h) return false;
  const p = y * image.w + x;
  const c = image.cell[p];
  if (c < 0) return false;
  const ci = c % map.w;
  const cj = Math.floor(c / map.w);
  if (ci + cj <= Math.floor(i) + Math.floor(j)) return false;
  return Math.max(SEA_LEVEL, image.height[p]) > base + 0.4;
}
