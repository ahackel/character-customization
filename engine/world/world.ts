// The running world of a scene: its ground drawn once per change, its plants drawn per wind
// frame, and a camera window composed each frame with everything standing on the ground. Also
// answers where a screen pixel is on the map, and where a walker may go.
import { drawPlant, FRAMES, grow, isStill, recolorPlant, tryPlant, type Category, type Grown, type Plant, type Raster } from '../flora/flora.ts';
import { readStore } from '../../shared/files.ts';
import { cleanSwap, FLORA_STORE, plantById, type PlantEntry } from '../flora/flora-catalog.ts';
import { blend, footOf, HOMES, stamp, type Picture, type Pixels, type Spot, type Thing } from './island.ts';
import { SHADOW } from '../core/palette.ts';
import {
  GROUNDS, heightAt, hiddenByGround, inside, LEVEL_M, LEVEL_PX, levelAt, renderTerrain, SEA_LEVEL, seaFloor, setWater, setLevel, SHADE, SHADE_ALPHA, SHADOW_RUN, SLOPE_LEVELS, standingHeight, surfaceAt,
  TILE_W, type HeightMap, type TerrainImage,
} from './terrain.ts';
import { ANIMAL_H, ANIMAL_ORIGIN, ANIMAL_W, CLIPS, drawAnimal, type Animal, type AnimalSprite, type ClipId } from '../animals/animal.ts';
import { turnFacing, type Facing } from '../core/puppet.ts';
import type { Herd } from './herd.ts';
import { decorById, decorPixels } from './decor.ts';
import { fishPixels, type Fish } from './fish.ts';
import { ITEM_ROOM, itemPicture, type PlacedItem } from './props.ts';
import { ocean, rgb, WATER_COLORS } from './ocean.ts';
import { mapOf, TURNS, type PlacedAnimal, type PlacedPlant, type Scene } from './scene.ts';

export interface Rect { x: number; y: number; w: number; h: number }
export type { Thing };

const EDGE = '#e0332e';
const GRID_SHADE = 0.2; // how much darker grid lines are than the ground
const SHADE_RGB = rgb(SHADE);
/** How deep, in levels, a shadow still shows on the water; it fades out toward there. */
const SHADOW_DEPTH = 1.5;
const shadowFade = (depth: number) => Math.max(0, 1 - depth / SHADOW_DEPTH);
/** How long a footprint takes to vanish. */
const PRINT_MS = 60_000;
/** Prints are pressed sand: tinted toward the sand's shaded side colour, at most this much. */
const PRINT_RGB = rgb('#b39a63');
const PRINT_DEPTH = 0.45;
/** Wet sand where the wash has been: tinted toward this, at most this much. */
const WET_RGB = rgb('#a8905c');
const WET_DEPTH = 0.4;
/** Fish are dark shapes under the water: this colour, this much. */
const FISH_RGB = rgb('#0f3a48');
const FISH_ALPHA = 0.55;
/** The pixels of a footprint and of a paw print, round the spot stepped on. */
const FOOT = [[-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
const PAW = [[0, 0], [1, 0]] as const;
// Wavelets on the open sea sit in rows that the current carries down the screen, each row
// swaying sideways; a wavelet shows for `shown` of every `ms`. Their colours, share, length and
// drift, the glints and the waves come from `ocean`.
const MARKS = { cell: 20, sway: 1.5, ms: 3500, rows: 0.3, shown: 0.3 };

// Shore waves: a crest line with foam fading out behind it seaward, broken into pieces that differ
// from wave to wave; where a crest breaks, a thin sheet of water runs up the beach, slides back
// and leaves the sand wet for a while.
/** Levels of depth behind a crest that its foam trails over. */
const TRAIL = 0.2;
/** The share of each crest left out, in pieces. */
const GAPS = 0.3;
/** Pixels up the beach the furthest wash reaches, and the share of a wave period it takes up and back. */
export const WASH_RUN = 5;
const WASH = 0.35;
/** The share of a wave period the sand stays darker after the wash leaves it. */
const DRY = 0.45;

/** Smooth noise 0 to 1 over a grid one unit across, a different field for each seed. */
function noiseAt(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const ease = (t: number) => t * t * (3 - 2 * t);
  const u = ease(x - ix), v = ease(y - iy);
  const at = (a: number, b: number) => mix(a, b, seed);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * u;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * u;
  return top + (bottom - top) * v;
}

/** Each crest on its way in at pixel x, y: how far along (0 rising, 1 breaking) and which pass of it this is. */
function crestsAt(x: number, y: number, ms: number): { phase: number; id: number }[] {
  const bend = 0.1 * Math.sin(x * 0.07) + 0.06 * Math.sin(x * 0.019 + y * 0.041);
  const out = [];
  for (let n = 0; n < ocean.waves; n++) {
    const t = ms / (ocean.wavePeriod * 1000) + bend + n / ocean.waves;
    out.push({ phase: t - Math.floor(t), id: Math.floor(t) * ocean.waves + n });
  }
  return out;
}

/** Whether pass `id` of a crest shows at pixel x, y, or falls in one of its gaps. */
const shownAt = (x: number, y: number, id: number) => noiseAt(x / 14, y / 8, id) >= GAPS;

/**
 * How strong a wave is at ground pixel x, y, `depth` levels deep, given the depths of the pixels
 * above and to the left: the crest line is where the crest depth falls between them, so it is one
 * pixel wide whatever the slope, and foam fades out behind it. Crests rise in the
 * shallows, run in and break on the shore; the time is bent along x so crests are not rings.
 */
export function waveAt(depth: number, above: number, left: number, x: number, y: number, ms: number): number {
  const reach = ocean.waveReach;
  if (depth <= 0 || depth >= reach + TRAIL) return 0;
  let foam = 0;
  for (const { phase, id } of crestsAt(x, y, ms)) {
    if (!shownAt(x, y, id)) continue;
    const crest = reach * (1 - phase);
    // Only against water: next to land or a cliff the crest would otherwise outline the shore for good.
    const crosses = (other: number) => other > 0 && (depth - crest) * (other - crest) <= 0;
    if (crosses(above) || crosses(left)) return Math.sqrt(phase);
    const behind = (depth - crest) / TRAIL;
    if (behind > 0 && behind < 1) foam = Math.max(foam, 0.6 * Math.sqrt(phase) * (1 - behind));
  }
  return foam;
}

/**
 * The wash on beach pixel x, y, `dist` pixels from the water: how much a sheet of water covers it
 * (its front brighter) and how wet the sand is where a sheet has just left.
 */
export function washAt(dist: number, x: number, y: number, ms: number): { sheet: number; wet: number } {
  let sheet = 0, wet = 0;
  for (const { phase, id } of crestsAt(x, y, ms)) {
    // The wash comes from the pass that just broke.
    if (phase >= WASH + DRY || !shownAt(x, y, id - ocean.waves)) continue;
    const run = WASH_RUN * (0.4 + 0.6 * noiseAt(x / 9, y / 5, id + 7919));
    if (dist > run) continue;
    const s = phase / WASH;
    const front = s < 1 ? run * Math.sin(Math.PI * s) : 0;
    if (dist <= front) sheet = Math.max(sheet, dist > front - 1 ? 0.75 : 0.35);
    // Wet from when the sliding sheet uncovered it.
    const left = WASH * (1 - Math.asin(Math.min(1, dist / run)) / Math.PI);
    if (phase > left) wet = Math.max(wet, 1 - (phase - left) / DRY);
  }
  return { sheet, wet: Math.min(1, wet) };
}

const mix = (a: number, b: number, k: number) => ((Math.imul(a * 7 + k, 73856093) ^ Math.imul(b * 13 + k, 19349663)) >>> 0) % 1000 / 1000;

/**
 * How strongly the wave colour covers water `depth` levels deep at pixel x, y: 0 for nothing.
 * Glints and wavelets show on all but the thinnest water at the shore.
 */
export function markAt(x: number, y: number, depth: number, ms: number): number {
  if (depth < 0.3) return 0;
  const t = ms / 1000;
  const row = Math.floor(y - t * ocean.drift);
  const g = { x: Math.floor(x / 9), y: Math.floor(row / 7) };
  if (mix(g.x, g.y, 5) < ocean.glints && x === g.x * 9 + Math.floor(mix(g.x, g.y, 6) * 9) && row === g.y * 7 + Math.floor(mix(g.x, g.y, 7) * 7)
    && (t / 2.5 + mix(g.x, g.y, 8)) % 1 < 0.1) return 0.8;
  return waveletAt(x, row, ms);
}

/**
 * How strong the wavelet in `row` is at pixel column x: a short straight line in the wave colour.
 * Rows are swayed sideways by the current; a wavelet keeps its length and quickly fades in and out.
 */
function waveletAt(x: number, row: number, ms: number): number {
  if (mix(row, 0, 1) > MARKS.rows) return 0; // rows without wavelets leave the water calm between them
  const sx = Math.floor(x + (ms / 1000) * (mix(row, 0, 2) - 0.5) * 2 * MARKS.sway);
  const cell = Math.floor(sx / MARKS.cell);
  const r = (k: number) => mix(cell, row, k);
  if (r(1) > ocean.ripples) return 0;
  const phase = (ms / MARKS.ms + r(2)) % 1;
  if (phase > MARKS.shown) return 0;
  const longest = Math.min(ocean.rippleLength, MARKS.cell - 4);
  const len = Math.max(2, Math.round(longest * (0.5 + 0.5 * r(3))));
  const start = 2 + Math.floor(r(4) * (MARKS.cell - 4 - longest));
  const at = sx - cell * MARKS.cell;
  return at >= start && at < start + len ? Math.sin((phase / MARKS.shown) * Math.PI) * ocean.rippleOpacity : 0;
}

/** The deepest a walker wades: the shallows, one level under the water line. Deeper water blocks. */
export const WADE = SEA_LEVEL - 1;

/** Everything blocks a walker except grass. Radius in metres per unit of plant size. */
const BLOCK: Record<Category, number> = { palm: 0.3, jungle: 0.35, cactus: 0.3, rock: 0.4, driftwood: 0.35, grass: 0 };

// ------------------------------------------------------------------ plants

/**
 * Plants as the flora tool shows them: a recipe edited there, and colours swapped there, are kept
 * in that tool's storage and used here too. Read once per page load.
 */
const floraEdits = readStore<{ custom?: Record<string, unknown>; colors?: Record<string, unknown> } | null>(FLORA_STORE, null);
const plantCache = new Map<string, Plant>();
export function plantOf(entry: PlantEntry): Plant {
  let plant = plantCache.get(entry.id);
  if (plant) return plant;
  plant = entry.plant;
  const text = floraEdits?.custom?.[entry.id];
  if (typeof text === 'string') {
    try {
      const parsed = tryPlant(JSON.parse(text));
      if (parsed.ok) plant = parsed.compiled.plant;
    } catch {
      // A broken edit in the flora tool falls back to the original recipe, as it does there.
    }
  }
  plant = recolorPlant(plant, cleanSwap(floraEdits?.colors?.[entry.id]));
  plantCache.set(entry.id, plant);
  return plant;
}

/** Up to how many wind frames a plant runs behind the shared wind. */
const WIND_LAG = 3;
const grownCache = new Map<string, { grown: Grown; still: boolean }>();
const rasterCache = new Map<string, Raster>();
const sizeStep = (s: number) => Math.round(s * 10) / 10;
/** One wind frame of a placed plant. Shared by every plant with the same recipe, variant, size and turn. */
export function rasterOf(p: Pick<PlacedPlant, 'plant' | 'seed' | 'size'> & { turn?: number }, frame: number): Raster | null {
  const entry = plantById(p.plant);
  if (!entry) return null;
  const turn = ((p.turn ?? 0) % TURNS + TURNS) % TURNS;
  const key = `${p.plant}|${p.seed}|${sizeStep(p.size)}|${turn}`;
  let grown = grownCache.get(key);
  if (!grown) {
    const made = grow(plantOf(entry), { seed: p.seed, size: sizeStep(p.size), turn: (turn * 360) / TURNS });
    grownCache.set(key, (grown = { grown: made, still: isStill(made) }));
  }
  // What the wind does not move is drawn and kept once, not once per frame.
  const at = grown.still ? 0 : frame;
  const full = `${key}|${at}`;
  let raster = rasterCache.get(full);
  if (!raster) {
    // shortcut: unbounded only by the number of distinct plants a scene uses; clear if memory ever matters.
    rasterCache.set(full, (raster = drawPlant(grown.grown, { frame: at, wind: 1 })));
  }
  return raster;
}

/** Whether a plant may grow on a tile: each group keeps to its own ground, as on the generated islands. */
export const grows = (map: HeightMap, plant: string, i: number, j: number) => {
  const entry = plantById(plant);
  return !!entry && inside(map, Math.floor(i), Math.floor(j)) && HOMES[entry.category].includes(surfaceAt(map, Math.floor(i), Math.floor(j)));
};

/** Smooths tiles (`j * w + i`): each takes the rounded mean of itself and its eight neighbours, all read before any change. */
export function smooth(map: HeightMap, cells: number[]): void {
  const before = Int8Array.from(map.levels);
  for (const c of cells) {
    const i = c % map.w;
    const j = Math.floor(c / map.w);
    let sum = 0;
    let n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!inside(map, i + di, j + dj)) continue;
      sum += before[(j + dj) * map.w + i + di];
      n++;
    }
    setLevel(map, i, j, Math.round(sum / n));
  }
}

// ------------------------------------------------------------------ world

/**
 * A world is seen from one of four sides. The scene keeps its own map coordinates; the world
 * draws, picks and walks in view coordinates, on a copy of the ground turned by quarter turns.
 * Everything outside `World` that takes a tile or a point (tools, the walker) uses view
 * coordinates; `toData` and `toView` convert for what is saved.
 */
export class World {
  scene: Scene;
  /** Quarter turns, 0 to 3. */
  rot: number;
  /** The ground as seen: the scene's ground turned by `rot`. Edits go here and are copied back by `redraw`. */
  map: HeightMap & { paint: Uint8Array };
  ground!: TerrainImage;
  /** The ground as drawn: the map, with the sea floor sloping gently from every coast. Walkers wade on it. */
  floor!: HeightMap;

  /** In Play, the items where they lie now (picked up and set down again); in Edit, null, and the scene's own. */
  loose: PlacedItem[] | null = null;
  /** Fish under the water, in view coordinates on `floor`; the game moves them (see fish.ts). */
  fish: Fish[] = [];

  constructor(scene: Scene, rot = 0) {
    this.scene = scene;
    this.rot = ((rot % 4) + 4) % 4;
    this.map = this.viewMap();
    this.ground = this.draw();
  }

  /** A point of the scene in view coordinates. One quarter turn takes (i, j) on a w by h map to (h - j, i). */
  toView(p: { i: number; j: number }): { i: number; j: number } {
    let { i, j } = p;
    let [w, h] = [this.scene.w, this.scene.h];
    for (let k = 0; k < this.rot; k++) {
      [i, j] = [h - j, i];
      [w, h] = [h, w];
    }
    return { i, j };
  }

  toData(p: { i: number; j: number }): { i: number; j: number } {
    let { i, j } = p;
    let [w, h] = this.rot % 2 ? [this.scene.h, this.scene.w] : [this.scene.w, this.scene.h];
    for (let k = 0; k < this.rot; k++) {
      [i, j] = [j, w - i];
      [w, h] = [h, w];
    }
    return { i, j };
  }

  /** The scene's tile index under a view tile. */
  private dataCell(vi: number, vj: number): number {
    const d = this.toData({ i: vi + 0.5, j: vj + 0.5 });
    return Math.floor(d.j) * this.scene.w + Math.floor(d.i);
  }

  private viewMap(): HeightMap & { paint: Uint8Array } {
    const w = this.rot % 2 ? this.scene.h : this.scene.w;
    const h = this.rot % 2 ? this.scene.w : this.scene.h;
    if (!this.rot) return mapOf(this.scene);
    const levels = new Int8Array(w * h);
    const paint = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = this.dataCell(i, j);
      levels[j * w + i] = this.scene.levels[c];
      paint[j * w + i] = this.scene.paint[c];
    }
    return { w, h, levels, paint };
  }

  /** Turns the view; the scene itself does not change. */
  setRotation(rot: number): void {
    this.rot = ((rot % 4) + 4) % 4;
    this.map = this.viewMap();
    this.ground = this.draw();
    this.prints = [];
  }

  /** Footprints, in view coordinates; each fades away over `PRINT_MS`. */
  private prints: { i: number; j: number; level: number; ms: number; shape: readonly (readonly [number, number])[] }[] = [];
  /** A foot (or a paw) set down at a point: it leaves a print where the ground there is dry or wet sand. */
  footstep(i: number, j: number, ms: number, paw = false): void {
    const level = standingHeight(this.map, i, j);
    const g = this.ground;
    const at = footOf(g, { i, j, level });
    if (at.x < 0 || at.y < 0 || at.x >= g.w || at.y >= g.h) return;
    const kind = GROUNDS[g.tops[at.y * g.w + at.x] - 1];
    if ((kind !== 'sand' && kind !== 'wet') || g.depth[at.y * g.w + at.x] > 0) return;
    this.prints.push({ i, j, level, ms, shape: paw ? PAW : FOOT });
  }

  /** Draws the ground with the sea's current water colours. */
  private draw(): TerrainImage {
    this.floor = seaFloor(this.map);
    setWater(WATER_COLORS.map((k) => ocean[k]));
    return renderTerrain(this.map);
  }

  /** Copies edits of the ground back to the scene, so what is saved is up to date. */
  commit(): void {
    for (let j = 0; j < this.map.h; j++) for (let i = 0; i < this.map.w; i++) {
      const c = this.dataCell(i, j);
      this.scene.levels[c] = this.map.levels[j * this.map.w + i];
      this.scene.paint[c] = this.map.paint[j * this.map.w + i];
    }
  }

  /** After the ground changed: copies it back to the scene and draws it again. */
  redraw(): void {
    this.commit();
    this.ground = this.draw();
  }

  /** Placed things with their positions in view coordinates. */
  private seen<T extends { i: number; j: number }>(list: T[]): (T & { vi: number; vj: number })[] {
    return list.map((p) => {
      const v = this.toView(p);
      return { ...p, vi: v.i, vj: v.j };
    });
  }
  viewPlants() { return this.seen(this.scene.plants); }
  viewDecor() { return this.seen(this.scene.decor); }
  viewAnimals() { return this.seen(this.scene.animals); }
  viewItems() { return this.seen(this.loose ?? this.scene.items); }

  /** The plant whose picture covers a pixel of the ground image, the front-most one, or null. */
  plantAt(x: number, y: number): PlacedPlant | null {
    let best: PlacedPlant | null = null;
    let front = -Infinity;
    const seen = this.viewPlants();
    seen.forEach((p, k) => {
      const raster = rasterOf({ ...p, turn: (p.turn ?? 0) + this.rot * (TURNS / 4) }, 0);
      if (!raster) return;
      const at = footOf(this.ground, { i: p.vi, j: p.vj, level: standingHeight(this.map, p.vi, p.vj) });
      const px = Math.floor(x) - (at.x - raster.origin.x);
      const py = Math.floor(y) - (at.y - raster.origin.y);
      if (px < 0 || py < 0 || px >= raster.w || py >= raster.h) return;
      const c = raster.get(px, py);
      if (!c || c === SHADOW || p.vi + p.vj < front) return;
      front = p.vi + p.vj;
      best = this.scene.plants[k];
    });
    return best;
  }

  /**
   * Lays the decorations on the ground in the window: on the sea floor they show through the
   * water, and nearer ground that rises in front hides them.
   */
  private drawDecor(image: Pixels, view: Rect): void {
    const g = this.ground;
    const d = image.data;
    for (const item of this.viewDecor()) {
      const kind = decorById(item.decor);
      if (!kind) continue;
      const level = heightAt(this.floor, item.vi, item.vj);
      const at = footOf(g, { i: item.vi, j: item.vj, level });
      if (at.x < view.x - 8 || at.y < view.y - 8 || at.x > view.x + view.w + 8 || at.y > view.y + view.h + 8) continue;
      const wet = level < SEA_LEVEL ? 0.5 : 1;
      for (const px of decorPixels(kind)) {
        const gx = at.x + px.x;
        const gy = at.y + px.y;
        const x = gx - view.x;
        const y = gy - view.y;
        if (x < 0 || y < 0 || x >= view.w || y >= view.h || gx < 0 || gy < 0 || gx >= g.w || gy >= g.h) continue;
        if (Math.abs(g.height[gy * g.w + gx] - level) > 0.6) continue;
        const c = rgb(px.color);
        const o = (y * view.w + x) * 4;
        for (let k = 0; k < 3; k++) d[o + k] += (c[k] - d[o + k]) * wet;
      }
    }
  }

  /** Fish as dark shapes seen through the water, only where water shows, so never on the beach. */
  private drawFish(image: Pixels, view: Rect, ms: number): void {
    const g = this.ground;
    const d = image.data;
    this.fish.forEach((f, n) => {
      const at = footOf(g, { i: f.i, j: f.j, level: SEA_LEVEL });
      if (at.x < view.x - 4 || at.y < view.y - 4 || at.x > view.x + view.w + 4 || at.y > view.y + view.h + 4) return;
      // On screen, x grows with i and shrinks with j.
      const right = Math.cos(f.a) - Math.sin(f.a) > 0;
      for (const px of fishPixels(Math.floor(ms / 200 + n * 0.37), right)) {
        const gx = at.x + px.x, gy = at.y + px.y;
        const x = gx - view.x, y = gy - view.y;
        if (x < 0 || y < 0 || x >= view.w || y >= view.h || gx < 0 || gy < 0 || gx >= g.w || gy >= g.h) continue;
        if (g.depth[gy * g.w + gx] < 0.3) continue;
        const o = (y * view.w + x) * 4;
        for (let k = 0; k < 3; k++) d[o + k] += (FISH_RGB[k] - d[o + k]) * FISH_ALPHA;
      }
    });
  }

  /** Where a map point is on the ground image. */
  screenOf(i: number, j: number): { x: number; y: number } {
    return footOf(this.ground, { i, j, level: standingHeight(this.map, i, j) });
  }

  /** The tile drawn at a pixel of the ground image, or null off the map. */
  tileAt(x: number, y: number): { i: number; j: number } | null {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.ground.w || y >= this.ground.h) return null;
    const c = this.ground.cell[y * this.ground.w + x];
    return c < 0 ? null : { i: c % this.map.w, j: Math.floor(c / this.map.w) };
  }

  plantThings(frame: number): Thing[] {
    const out: Thing[] = [];
    for (const p of this.viewPlants()) {
      // Each plant sways a little behind or ahead of its neighbours, and turns with the view.
      const lag = ((Math.imul(Math.floor(p.i * 97), 73856093) ^ Math.imul(Math.floor(p.j * 89), 19349663)) >>> 0) % WIND_LAG;
      const raster = rasterOf({ ...p, turn: (p.turn ?? 0) + this.rot * (TURNS / 4) }, (frame + lag) % FRAMES);
      if (raster) out.push({ spot: { i: p.vi, j: p.vj, level: standingHeight(this.map, p.vi, p.vj) }, picture: raster, w: raster.w, h: raster.h, foot: raster.origin });
    }
    return out;
  }

  itemThings(): Thing[] {
    return this.viewItems().map((it) => ({ spot: { i: it.vi, j: it.vj, level: standingHeight(this.map, it.vi, it.vj) }, ...itemPicture(it.item, this.rot) }));
  }

  private animalFrames = new WeakMap<Animal, Map<string, AnimalSprite>>();
  private animalKinds = new Map<string, Map<string, AnimalSprite>>();

  /**
   * The animals as things: standing where placed and idling, each a little out of step with the
   * others, or as the herd has them in Play.
   */
  animalThings(ms: number, herd?: Herd): Thing[] {
    return this.scene.animals.flatMap((placed, k) => {
      const pose = herd?.poses[k];
      if (pose?.carried) return [];
      return [this.animalSprite(placed, k, ms, herd)];
    });
  }

  /** One animal's sprite in its current frame, as the herd has it in Play; the carried one too. */
  animalSprite(placed: PlacedAnimal, k: number, ms: number, herd?: Herd, facingNow?: Facing): Thing {
    const pose = herd?.poses[k];
    const clipId: ClipId = pose?.clip ?? 'idle';
    const clip = CLIPS[clipId];
    const lag = ((Math.imul(Math.floor(placed.i * 97), 73856093) ^ Math.imul(Math.floor(placed.j * 89), 19349663)) >>> 0) % clip.frames;
    const n = (Math.floor(((ms - (pose?.started ?? 0)) / 1000) * clip.rate) + lag) % clip.frames;
    const v = this.toView(pose ?? placed);
    const facing = facingNow ?? turnFacing((pose ?? placed).facing, this.rot * 2);
    let frames = this.animalFrames.get(placed.animal);
    if (!frames) {
      // Every placed animal is its own copy, so the same animal placed twice is found by what it is.
      const same = JSON.stringify(placed.animal);
      if (this.animalKinds.size > 60) this.animalKinds.clear();
      frames = this.animalKinds.get(same) ?? new Map();
      this.animalKinds.set(same, frames);
      this.animalFrames.set(placed.animal, frames);
    }
    const key = `${clipId}|${n}|${facing}`;
    let sprite = frames.get(key);
    if (!sprite) frames.set(key, (sprite = drawAnimal(placed.animal, clipId, n, facing).sprite));
    return { spot: { i: v.i, j: v.j, level: standingHeight(this.map, v.i, v.j) }, picture: sprite, w: ANIMAL_W, h: ANIMAL_H, foot: ANIMAL_ORIGIN };
  }

  /**
   * Paints the camera window: the ground, every shadow at once, then things back to front with
   * higher ground in front hiding them. `highlight` tints some tiles (the brush in the editor).
   */
  compose(view: Rect, things: Thing[], highlight?: { cells: Set<number>; color: string }, outline = false, ms = 0, grid = false): Pixels {
    const { w, h } = view;
    const SEA = rgb(ocean.deep);
    const FOAM = rgb(ocean.wave);
    const FAR = rgb(ocean.far);
    const g = this.ground;
    const shore = this.shoreOf(g);
    const image: Pixels = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    const d = image.data;
    const baseKey = `${view.x},${view.y},${w},${h}|${ms}|${grid}`;
    const kept = !highlight && this.base && this.base.ground === g && this.base.key === baseKey ? this.base.data : null;
    if (kept) d.set(kept);
    else for (let y = 0; y < h; y++) {
      const gy = y + view.y;
      const far = ocean.gradient * (1 - y / h);
      for (let x = 0; x < w; x++) {
        const gx = x + view.x;
        const o = (y * w + x) * 4;
        if (gy < 0 || gx < 0 || gy >= g.h || gx >= g.w) {
          d[o] = SEA[0]; d[o + 1] = SEA[1]; d[o + 2] = SEA[2]; d[o + 3] = 255;
          const mark = markAt(gx, gy, 9, ms);
          if (mark) for (let k = 0; k < 3; k++) d[o + k] += (FOAM[k] - d[o + k]) * mark;
          for (let k = 0; k < 3; k++) d[o + k] += (FAR[k] - d[o + k]) * far;
          continue;
        }
        const p = gy * g.w + gx;
        d[o] = g.rgba[p * 4]; d[o + 1] = g.rgba[p * 4 + 1]; d[o + 2] = g.rgba[p * 4 + 2]; d[o + 3] = 255;
        // Waves and ripples are on the water surface, so they go by its depth, not the floor's.
        const depth = g.depth[p];
        const foam = 0.85 * waveAt(depth, g.depth[gy > 0 ? p - g.w : p], g.depth[gx > 0 ? p - 1 : p], gx, gy, ms);
        if (foam > 0) for (let k = 0; k < 3; k++) d[o + k] += (FOAM[k] - d[o + k]) * foam;
        else if (depth > 0) {
          const mark = markAt(gx, gy, depth, ms);
          if (mark) for (let k = 0; k < 3; k++) d[o + k] += (FOAM[k] - d[o + k]) * mark;
        } else if (shore[p] <= WASH_RUN) {
          const { sheet, wet } = washAt(shore[p], gx, gy, ms);
          if (wet) for (let k = 0; k < 3; k++) d[o + k] += (WET_RGB[k] - d[o + k]) * wet * WET_DEPTH;
          if (sheet) for (let k = 0; k < 3; k++) d[o + k] += (FOAM[k] - d[o + k]) * sheet;
        }
        if (depth > 0) for (let k = 0; k < 3; k++) d[o + k] += (FAR[k] - d[o + k]) * far;
        if (grid) {
          // A faint line where one tile's pixels meet the next one's, to the right or below.
          const c = g.cell[p];
          const right = gx + 1 < g.w ? g.cell[p + 1] : c;
          const below = gy + 1 < g.h ? g.cell[p + g.w] : c;
          if (c >= 0 && ((right >= 0 && right !== c) || (below >= 0 && below !== c))) for (let k = 0; k < 3; k++) d[o + k] *= 1 - GRID_SHADE;
        }
        if (highlight?.cells.has(g.cell[p])) blend(image, x, y, highlight.color);
      }
    }
    if (!kept && !highlight) this.base = { key: baseKey, ground: g, data: d.slice() };
    const placed = things
      .map((t) => {
        const at = footOf(g, t.spot);
        return { ...t, dx: at.x - t.foot.x - view.x, dy: at.y - t.foot.y - view.y };
      })
      .filter((t) => t.dx < w && t.dy < h && t.dx + t.w > 0 && t.dy + t.h > 0);
    this.prints = this.prints.filter((f) => ms - f.ms < PRINT_MS);
    // Overlapping prints do not add up: each pixel takes the darkest print on it.
    const pressed = new Map<number, number>();
    for (const f of this.prints) {
      const at = footOf(g, f);
      const strength = PRINT_DEPTH * (1 - (ms - f.ms) / PRINT_MS);
      for (const [dx, dy] of f.shape) {
        const gx = at.x + dx, gy = at.y + dy;
        const x = gx - view.x, y = gy - view.y;
        if (x < 0 || y < 0 || x >= w || y >= h || gx < 0 || gy < 0 || gx >= g.w || gy >= g.h) continue;
        // Nearer, higher ground drawn over the spot hides the print, as with shadows.
        if (Math.abs(Math.max(SEA_LEVEL, g.height[gy * g.w + gx]) - f.level) > 0.5) continue;
        const o = (y * w + x) * 4;
        pressed.set(o, Math.max(pressed.get(o) ?? 0, strength));
      }
    }
    for (const [o, strength] of pressed) for (let k = 0; k < 3; k++) d[o + k] += (PRINT_RGB[k] - d[o + k]) * strength;
    this.drawFish(image, view, ms);
    this.drawDecor(image, view);
    // Shadows reach past a thing's picture, so things just outside the window cast into it too.
    // Each ground pixel is darkened once, and not where the ground already lies in shadow.
    const mask = new Uint8Array(w * h);
    for (const t of things) {
      const at = footOf(g, t.spot);
      if (at.x + 2 * t.w < view.x || at.x - 2 * t.w > view.x + w || at.y - t.h > view.y + h || at.y + t.h < view.y) continue;
      for (const p of this.shadowOf(t)) {
        const x = (p % g.w) - view.x;
        const y = Math.floor(p / g.w) - view.y;
        if (x >= 0 && y >= 0 && x < w && y < h && !g.shade[p] && !mask[y * w + x]) {
          mask[y * w + x] = 1;
          const o = (y * w + x) * 4;
          const a = SHADE_ALPHA * shadowFade(g.depth[p]);
          for (let k = 0; k < 3; k++) d[o + k] += (SHADE_RGB[k] - d[o + k]) * a;
        }
      }
    }
    placed.sort((a, b) => a.spot.i + a.spot.j - (b.spot.i + b.spot.j));
    for (const t of placed) {
      stamp(image, t.picture, t.w, t.h, t.dx, t.dy, (x, y) => hiddenByGround(this.map, g, x + view.x, y + view.y, t.spot.i, t.spot.j, Math.max(SEA_LEVEL, t.spot.level)));
    }
    if (outline) this.drawEdge(image, view);
    return image;
  }

  private shore: { ground: TerrainImage; dist: Uint8Array } | null = null;

  /**
   * Per ground pixel, how many pixels a beach pixel lies from the water, up to `WASH_RUN`; 255
   * elsewhere. Only ground at the water line counts, so higher ground drawn next to water is left dry.
   */
  private shoreOf(g: TerrainImage): Uint8Array {
    if (this.shore?.ground === g) return this.shore.dist;
    const dist = new Uint8Array(g.w * g.h).fill(255);
    for (let p = 0; p < dist.length; p++) if (g.depth[p] > 0) dist[p] = 0;
    for (let k = 1; k <= WASH_RUN; k++) {
      for (let p = 0; p < dist.length; p++) {
        if (dist[p] !== 255 || !g.tops[p] || g.height[p] > SEA_LEVEL + 0.5) continue;
        const x = p % g.w;
        if ((x > 0 && dist[p - 1] === k - 1) || (x < g.w - 1 && dist[p + 1] === k - 1) || (p >= g.w && dist[p - g.w] === k - 1) || (p + g.w < dist.length && dist[p + g.w] === k - 1)) dist[p] = k;
      }
    }
    this.shore = { ground: g, dist };
    return dist;
  }

  /** The ground and water of the last window composed without a highlight: in Play the water moves ten times a second, the rest every frame. */
  private base: { key: string; ground: TerrainImage; data: Uint8ClampedArray } | null = null;
  private shadows = new WeakMap<Picture, Map<string, Int32Array>>();
  private shadowsOf: TerrainImage | null = null;

  /**
   * The ground pixels a thing's shadow falls on. Each pixel of its picture stands upright over its
   * foot, as high as it is drawn above it, and is sent away from the light to where it meets the
   * ground, so shadows lie across slopes and fall down cliffs. Kept per picture and spot.
   */
  private shadowOf(t: Thing): Int32Array {
    const g = this.ground;
    if (this.shadowsOf !== g) {
      this.shadows = new WeakMap();
      this.shadowsOf = g;
    }
    let byPicture = this.shadows.get(t.picture);
    if (!byPicture) this.shadows.set(t.picture, (byPicture = new Map()));
    const key = `${t.spot.i},${t.spot.j}`;
    const known = byPicture.get(key);
    if (known) return known;
    const hit = new Set<number>();
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const hex = t.picture.get(x, y);
        if (!hex || hex === SHADOW) continue;
        const up = Math.max(0, t.foot.y - y) / LEVEL_PX * LEVEL_M;
        const side = (x - t.foot.x) / TILE_W;
        const i = t.spot.i + side + up * SHADOW_RUN[0];
        const j = t.spot.j - side + up * SHADOW_RUN[1];
        // No shadows off the map, nor on water too deep for them to show.
        if (!inside(this.map, Math.floor(i), Math.floor(j)) || SEA_LEVEL - heightAt(this.map, i, j) >= SHADOW_DEPTH) continue;
        const level = standingHeight(this.map, i, j);
        const at = footOf(g, { i, j, level });
        if (at.x < 0 || at.y < 0 || at.x >= g.w || at.y >= g.h) continue;
        const p = at.y * g.w + at.x;
        // Nearer, higher ground drawn over that point hides the shadow there.
        if (Math.abs(Math.max(SEA_LEVEL, g.height[p]) - level) > 0.5) continue;
        hit.add(p);
      }
    }
    const pixels = Int32Array.from(hit);
    // shortcut: a walker leaves one entry per spot it stood on; forget them past a few dozen.
    if (byPicture.size > 48) byPicture.clear();
    byPicture.set(key, pixels);
    return pixels;
  }

  private edge: { x: number; y: number; spot: Spot }[] = [];
  private edgeOf: TerrainImage | null = null;

  /**
   * A red line round the map, on the ground (or the water) along its four edges, hidden where
   * nearer high ground covers it. Recomputed when the ground is redrawn.
   */
  private drawEdge(image: Pixels, view: Rect): void {
    if (this.edgeOf !== this.ground) {
      this.edgeOf = this.ground;
      const { w, h } = this.map;
      const e = 1e-3;
      const corners = [[e, e], [w - e, e], [w - e, h - e], [e, h - e], [e, e]];
      this.edge = [];
      for (let k = 0; k < 4; k++) {
        const [i0, j0] = corners[k];
        const [i1, j1] = corners[k + 1];
        const steps = Math.ceil(Math.hypot(i1 - i0, j1 - j0) * 16);
        for (let s = 0; s <= steps; s++) {
          const i = i0 + ((i1 - i0) * s) / steps;
          const j = j0 + ((j1 - j0) * s) / steps;
          const spot = { i, j, level: standingHeight(this.map, i, j) };
          this.edge.push({ ...footOf(this.ground, spot), spot });
        }
      }
    }
    // Consecutive points are joined, so a cliff at the edge is a vertical line, not a gap.
    for (let k = 1; k < this.edge.length; k++) {
      const a = this.edge[k - 1];
      const b = this.edge[k];
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
      for (let s = 0; s <= n; s++) {
        const x = Math.round(a.x + ((b.x - a.x) * s) / n);
        const y = Math.round(a.y + ((b.y - a.y) * s) / n);
        if (hiddenByGround(this.map, this.ground, x, y, a.spot.i, a.spot.j, a.spot.level)) continue;
        blend(image, x - view.x, y - view.y, EDGE);
      }
    }
  }

  /** Whether a walker can stand at a point: land or the shallows, reached without a cliff, clear of big plants. */
  canWalk(from: { i: number; j: number }, to: { i: number; j: number }): boolean {
    const a: [number, number] = [Math.floor(from.i), Math.floor(from.j)];
    const b: [number, number] = [Math.floor(to.i), Math.floor(to.j)];
    if (!inside(this.floor, ...b) || levelAt(this.floor, ...b) < WADE) return false;
    // A step of more than a slope is a cliff, on land or under the water.
    if ((a[0] !== b[0] || a[1] !== b[1]) && Math.abs(levelAt(this.floor, ...a) - levelAt(this.floor, ...b)) > SLOPE_LEVELS) return false;
    for (const p of this.viewPlants()) {
      const r = BLOCK[plantById(p.plant)!.category] * p.size;
      if (!r) continue;
      const near = Math.hypot(p.vi - to.i, p.vj - to.j);
      // Moving away is always allowed, so nobody gets stuck inside a plant placed on them.
      if (near < r && near < Math.hypot(p.vi - from.i, p.vj - from.j)) return false;
    }
    for (const it of this.viewItems()) {
      const near = Math.hypot(it.vi - to.i, it.vj - to.j);
      if (near < ITEM_ROOM && near < Math.hypot(it.vi - from.i, it.vj - from.j)) return false;
    }
    return true;
  }

  /** A dry tile near a point, for a spawn that ended up in the sea. */
  nearestLand(i: number, j: number): { i: number; j: number } {
    let best = { i, j };
    let bestD = Infinity;
    for (let cj = 0; cj < this.map.h; cj++) for (let ci = 0; ci < this.map.w; ci++) {
      if (levelAt(this.map, ci, cj) < SEA_LEVEL) continue;
      const d = Math.hypot(ci + 0.5 - i, cj + 0.5 - j);
      if (d < bestD) { bestD = d; best = { i: ci + 0.5, j: cj + 0.5 }; }
    }
    return best;
  }
}
