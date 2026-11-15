// Ground for the island: a height map with one value per ground tile (one metre), drawn in the
// same 2:1 view and pixel style as the characters and plants. Heights are whole levels; level 0
// is the water line. Everything else follows from the heights by rule: what the surface is
// (sea, beach, sand, grass, rock), where cliffs are, where one can walk, and how it is painted.

/** A ground tile on screen: one metre across. */
export const TILE_W = 32;
export const TILE_H = 16;
/** Screen pixels per height level. One level (about a third of a metre) is a step a person can climb. */
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

/** What a cell is, by rule from its height and its neighbours. */
export function surfaceAt(map: HeightMap, i: number, j: number): Surface {
  const level = levelAt(map, i, j);
  if (level < -1) return 'deep';
  if (level < SEA_LEVEL) return 'shallow';
  if (level === SEA_LEVEL) return 'beach';
  if (level >= 6 || steepness(map, i, j) >= 3) return 'rock';
  if (level === 1) return 'sand';
  return 'grass';
}

export const isLand = (map: HeightMap, i: number, j: number) => levelAt(map, i, j) >= SEA_LEVEL;

/** Whether a person can step from one cell to a neighbouring one: land on both, one level at most. */
export function canStep(map: HeightMap, a: [number, number], b: [number, number]): boolean {
  if (!isLand(map, ...a) || !isLand(map, ...b)) return false;
  return Math.abs(levelAt(map, ...a) - levelAt(map, ...b)) <= 1;
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

// ------------------------------------------------------------------ drawing

/** Where a point of the map appears, relative to the north corner of cell 0, 0 at the water line. */
export function toScreen(i: number, j: number, level = 0): { x: number; y: number } {
  return { x: ((i - j) * TILE_W) / 2, y: ((i + j) * TILE_H) / 2 - level * LEVEL_PX };
}

export interface TerrainImage {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  /** Per pixel, the cell that painted it (`j * w + i`), or -1. Used to hide things behind higher ground. */
  cell: Int32Array;
  /** Where map point 0, 0 at the water line is on the image. */
  origin: { x: number; y: number };
}

const TOPS: Record<Surface, string> = {
  deep: '#4faec4',
  shallow: '#7fd6d0',
  beach: '#dcc690',
  sand: '#e9d9a0',
  grass: '#8fcf78',
  rock: '#aeaba3',
};
/** Side faces: the left one in light, the right one in shade, as everything else is lit. */
const SIDES: Record<Surface, [string, string]> = {
  deep: ['#4faec4', '#4faec4'],
  shallow: ['#7fd6d0', '#7fd6d0'],
  beach: ['#c9b077', '#b39a63'],
  sand: ['#c9b077', '#b39a63'],
  grass: ['#b98f63', '#9c7650'],
  rock: ['#8f8b83', '#78746d'],
};
const GRASS_LIP = '#6c9f55';
const FOAM = '#e8fbf6';
const SURF = '#a6e6df';

const rgbOf = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));

/** Paints the whole map, back to front, over open sea. */
export function renderTerrain(map: HeightMap, size?: { w: number; h: number; origin: { x: number; y: number } }): TerrainImage {
  const w = size?.w ?? (map.w + map.h) * (TILE_W / 2) + 16;
  const h = size?.h ?? (map.w + map.h) * (TILE_H / 2) + MAX_LEVEL * LEVEL_PX + 16;
  const origin = size?.origin ?? { x: map.h * (TILE_W / 2) + 8, y: MAX_LEVEL * LEVEL_PX + 8 };
  const rgba = new Uint8ClampedArray(w * h * 4);
  const cell = new Int32Array(w * h).fill(-1);
  const put = (x: number, y: number, hex: string, index: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const [r, g, b] = rgbOf(hex);
    const o = (y * w + x) * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    cell[y * w + x] = index;
  };
  const deep = TOPS.deep;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, deep, -1);
  const hash = (x: number, y: number) => ((Math.imul(x + 31, 73856093) ^ Math.imul(y + 7, 19349663)) >>> 0) % 1000 / 1000;

  const order: [number, number][] = [];
  for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) order.push([i, j]);
  order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);

  for (const [i, j] of order) {
    const index = j * map.w + i;
    const surface = surfaceAt(map, i, j);
    const level = surfaceLevel(map, i, j);
    const water = levelAt(map, i, j) < SEA_LEVEL;
    const north = toScreen(i, j, level);
    const x0 = Math.floor(origin.x + north.x - TILE_W / 2);
    const y0 = Math.floor(origin.y + north.y);
    // The top: every pixel whose centre falls in this cell when traced back onto its level.
    for (let y = y0; y < y0 + TILE_H + 1; y++) {
      for (let x = x0; x < x0 + TILE_W + 1; x++) {
        const a = (x + 0.5 - origin.x) / (TILE_W / 2);
        const b = (y + 0.5 - origin.y + level * LEVEL_PX) / (TILE_H / 2);
        if (Math.floor((a + b) / 2) !== i || Math.floor((b - a) / 2) !== j) continue;
        let color = TOPS[surface];
        // Tiles alternate faintly so the one-metre grid reads; sand and grass get a few grains.
        if (!water && (i + j) % 2 === 0) color = mixHex(color, '#ffffff', 0.06);
        if (!water && hash(x, y) < 0.035) color = mixHex(color, SIDES[surface][1], 0.5);
        put(x, y, color, index);
      }
    }
    if (water) continue;
    // Side faces down to the ground in front, or to the water.
    const faces: { to: number; from: { x: number; y: number }; dir: 1 | -1; side: 0 | 1 }[] = [
      { to: surfaceLevel(map, i + 1, j), from: toScreen(i + 1, j, level), dir: -1, side: 1 }, // right face, under the east edge
      { to: surfaceLevel(map, i, j + 1), from: toScreen(i, j + 1, level), dir: 1, side: 0 }, // left face, under the west edge
    ];
    for (const face of faces) {
      const drop = (level - face.to) * LEVEL_PX;
      if (drop <= 0) continue;
      // The face spans from the outer corner (east or west) to the south corner.
      const south = toScreen(i + 1, j + 1, level);
      const ax = origin.x + face.from.x;
      const sx = origin.x + south.x;
      const left = Math.min(ax, sx);
      const right = Math.max(ax, sx);
      for (let x = Math.floor(left); x < Math.ceil(right); x++) {
        const t = (x + 0.5 - ax) / (sx - ax);
        const top = origin.y + face.from.y + (south.y - face.from.y) * t;
        for (let y = Math.ceil(top - 0.5); y < top + drop; y++) {
          const depth = y - top;
          let color = SIDES[surface][face.side];
          if (surface === 'grass' && depth < 2) color = GRASS_LIP;
          else if (hash(x, y) < 0.06) color = mixHex(color, '#000000', 0.08);
          // Wet sand just above the water.
          if (face.to === SEA_LEVEL && top + drop - y <= 2) color = mixHex(color, '#3a6b80', 0.25);
          put(x, y, color, index);
        }
      }
    }
  }

  // Foam where the sea touches land, and a lighter band of surf beyond it.
  const landAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const c = cell[y * w + x];
    return c >= 0 && map.levels[c] >= SEA_LEVEL;
  };
  const sea = (x: number, y: number) => !landAt(x, y);
  const foam: number[] = [];
  const surf: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!sea(x, y)) continue;
      if (landAt(x - 1, y) || landAt(x + 1, y) || landAt(x, y - 1) || landAt(x, y + 1)) foam.push(y * w + x);
      else if (landAt(x - 2, y) || landAt(x + 2, y) || landAt(x, y - 2) || landAt(x - 1, y - 1) || landAt(x + 1, y - 1)) surf.push(y * w + x);
    }
  }
  for (const p of surf) put(p % w, Math.floor(p / w), SURF, cell[p]);
  for (const p of foam) put(p % w, Math.floor(p / w), FOAM, cell[p]);
  return { w, h, rgba, cell, origin };
}

function mixHex(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return '#' + x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, '0')).join('');
}

/**
 * Whether higher ground in front hides a pixel of something standing at map point `i`, `j`.
 * Things are drawn after the ground, so a cliff or a hill nearer the viewer has to cover them.
 */
export function hiddenByGround(map: HeightMap, image: TerrainImage, x: number, y: number, i: number, j: number): boolean {
  if (x < 0 || y < 0 || x >= image.w || y >= image.h) return false;
  const c = image.cell[y * image.w + x];
  if (c < 0) return false;
  const ci = c % map.w;
  const cj = Math.floor(c / map.w);
  if (ci + cj <= Math.floor(i) + Math.floor(j)) return false;
  return surfaceLevel(map, ci, cj) > surfaceLevel(map, Math.floor(i), Math.floor(j));
}
