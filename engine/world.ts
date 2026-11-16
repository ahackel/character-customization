// The running world of a scene: its ground drawn once per change, its plants drawn per wind
// frame, and a camera window composed each frame with everything standing on the ground. Also
// answers where a screen pixel is on the map, and where a walker may go.
import { drawPlant, FRAMES, grow, recolorPlant, tryPlant, type Category, type Grown, type Plant, type Raster } from '../lab/flora.ts';
import { plantById, type PlantEntry } from '../lab/flora-catalog.ts';
import { SHADOW } from '../lab/flora.ts';
import { blend, footOf, HOMES, stamp, type Picture, type Pixels, type Spot } from '../lab/island.ts';
import { PALETTE, type PaletteKey } from '../lab/palette.ts';
import {
  heightAt, hiddenByGround, inside, LEVEL_PX, levelAt, renderTerrain, SEA_LEVEL, seaFloor, setWater, setLevel, SHADE, SHADE_ALPHA, SHADOW_RUN, SLOPE_LEVELS, standingHeight, surfaceAt,
  TILE_W, type HeightMap, type TerrainImage,
} from '../lab/terrain.ts';
import { ANIMAL_H, ANIMAL_ORIGIN, ANIMAL_W, CLIPS, drawAnimal, type Animal, type AnimalSprite, type ClipId } from '../lab/animal.ts';
import type { Facing } from '../lab/puppet.ts';
import type { Herd } from './herd.ts';
import { decorById, decorPixels, type PlacedDecor } from './decor.ts';
import { ocean, rgb, WATER_COLORS } from './ocean.ts';
import { mapOf, TURNS, type PlacedAnimal, type PlacedPlant, type Scene } from './scene.ts';

export interface Rect { x: number; y: number; w: number; h: number }
/** Something drawn standing on the ground: `foot` is the pixel of its picture that touches the spot. */
export interface Thing { spot: Spot; picture: Picture; w: number; h: number; foot: { x: number; y: number } }

const EDGE = '#e0332e';
const GRID_SHADE = 0.2; // how much darker grid lines are than the ground
const SHADE_RGB = [1, 3, 5].map((k) => parseInt(SHADE.slice(k, k + 2), 16));
const LEVEL_M = 0.354; // metres per level, as in the terrain's light
// Ripples on the open sea are long level lines in rows that the current carries down the screen,
// each row swaying sideways; a line grows and shrinks over `ms`. Their colours, share, length and
// drift, the glints and the waves come from `ocean`.
const MARKS = { cell: 48, sway: 1.5, ms: 10000, rows: 0.4 };

/**
 * How strong a wave's crest line is at ground pixel x, y, `depth` levels deep, given the depths of
 * the pixels above and to the left: the line is where the crest depth falls between them, so it is
 * one pixel wide whatever the slope. Crests rise in the shallows, run in and break on the shore;
 * the time is bent along x so crests are not rings.
 */
export function waveAt(depth: number, above: number, left: number, x: number, y: number, ms: number): number {
  const reach = ocean.waveReach;
  if (depth <= 0 || depth >= reach) return 0;
  const bend = 0.1 * Math.sin(x * 0.07) + 0.06 * Math.sin(x * 0.019 + y * 0.041);
  for (let n = 0; n < ocean.waves; n++) {
    const phase = (((ms / (ocean.wavePeriod * 1000) + bend + n / ocean.waves) % 1) + 1) % 1;
    const crest = reach * (1 - phase);
    // Only against water: next to land or a cliff the crest would otherwise outline the shore for good.
    const crosses = (other: number) => other > 0 && (depth - crest) * (other - crest) <= 0;
    if (crosses(above) || crosses(left)) return Math.sqrt(phase);
  }
  return 0;
}
const mix = (a: number, b: number, k: number) => ((Math.imul(a * 7 + k, 73856093) ^ Math.imul(b * 13 + k, 19349663)) >>> 0) % 1000 / 1000;

/**
 * The mark on water `depth` levels deep at pixel x, y: 0 for none, else 1 + its index in
 * `MARK_COLORS`. Glints blink anywhere; ripples only out past the waves.
 */
export function markAt(x: number, y: number, depth: number, ms: number): number {
  if (depth < 0.3) return 0;
  const t = ms / 1000;
  const row = Math.floor(y - t * ocean.drift);
  const g = { x: Math.floor(x / 9), y: Math.floor(row / 7) };
  if (mix(g.x, g.y, 5) < ocean.glints && x === g.x * 9 + Math.floor(mix(g.x, g.y, 6) * 9) && row === g.y * 7 + Math.floor(mix(g.x, g.y, 7) * 7)
    && (t / 2.5 + mix(g.x, g.y, 8)) % 1 < 0.1) return 3;
  if (depth < ocean.waveReach + 0.6 || mix(row, 0, 1) > MARKS.rows) return 0; // rows without ripples leave the water calm between them
  const sx = Math.floor(x + t * (mix(row, 0, 2) - 0.5) * 2 * MARKS.sway);
  const cell = Math.floor(sx / MARKS.cell);
  const r = (k: number) => mix(cell, row, k);
  if (r(1) > ocean.ripples) return 0;
  const phase = (ms / MARKS.ms + r(2)) % 1;
  if (phase > 0.75) return 0;
  const longest = Math.min(ocean.rippleLength, MARKS.cell - 2);
  const len = Math.round(longest * (0.36 + 0.64 * r(3)) * Math.sin((phase / 0.75) * Math.PI));
  const start = Math.floor(r(4) * (MARKS.cell - longest));
  const at = sx - cell * MARKS.cell;
  if (at < start || at >= start + len) return 0;
  return r(5) < 0.7 ? 1 : 2;
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
const floraEdits = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('island-flora') ?? 'null');
    return { custom: saved?.custom ?? {}, colors: saved?.colors ?? {} } as { custom: Record<string, unknown>; colors: Record<string, Record<string, string>> };
  } catch {
    return { custom: {}, colors: {} };
  }
})();
const plantCache = new Map<string, Plant>();
export function plantOf(entry: PlantEntry): Plant {
  let plant = plantCache.get(entry.id);
  if (plant) return plant;
  plant = entry.plant;
  const text = floraEdits.custom[entry.id];
  if (typeof text === 'string') {
    try {
      const parsed = tryPlant(JSON.parse(text));
      if (parsed.ok) plant = parsed.compiled.plant;
    } catch {
      // A broken edit in the flora tool falls back to the original recipe, as it does there.
    }
  }
  const swap = Object.fromEntries(Object.entries(floraEdits.colors[entry.id] ?? {}).filter(([a, b]) => a in PALETTE && b in PALETTE)) as Partial<Record<PaletteKey, PaletteKey>>;
  plant = recolorPlant(plant, swap);
  plantCache.set(entry.id, plant);
  return plant;
}

/** Up to how many wind frames a plant runs behind the shared wind. */
const WIND_LAG = 3;
const grownCache = new Map<string, Grown>();
const rasterCache = new Map<string, Raster>();
const sizeStep = (s: number) => Math.round(s * 10) / 10;
/** One wind frame of a placed plant. Shared by every plant with the same recipe, variant, size and turn. */
export function rasterOf(p: Pick<PlacedPlant, 'plant' | 'seed' | 'size'> & { turn?: number }, frame: number): Raster | null {
  const entry = plantById(p.plant);
  if (!entry) return null;
  const turn = ((p.turn ?? 0) % TURNS + TURNS) % TURNS;
  const key = `${p.plant}|${p.seed}|${sizeStep(p.size)}|${turn}`;
  let grown = grownCache.get(key);
  if (!grown) grownCache.set(key, (grown = grow(plantOf(entry), { seed: p.seed, size: sizeStep(p.size), turn: (turn * 360) / TURNS })));
  const full = `${key}|${frame}`;
  let raster = rasterCache.get(full);
  if (!raster) {
    // shortcut: unbounded only by the number of distinct plants a scene uses; clear if memory ever matters.
    rasterCache.set(full, (raster = drawPlant(grown, { frame, wind: 1 })));
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

  /** The scene's plants with their positions in view coordinates. */
  viewPlants(): (PlacedPlant & { vi: number; vj: number })[] {
    return this.scene.plants.map((p) => {
      const v = this.toView(p);
      return { ...p, vi: v.i, vj: v.j };
    });
  }

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

  /** The decorations with their places in view coordinates. */
  viewDecor(): (PlacedDecor & { vi: number; vj: number })[] {
    return this.scene.decor.map((d) => {
      const v = this.toView(d);
      return { ...d, vi: v.i, vj: v.j };
    });
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

  /** The animals with their places and facings in view coordinates. */
  viewAnimals(): (PlacedAnimal & { vi: number; vj: number; vf: 0 | 1 | 2 | 3 })[] {
    return this.scene.animals.map((a) => {
      const v = this.toView(a);
      return { ...a, vi: v.i, vj: v.j, vf: ((a.facing + this.rot) % 4) as 0 | 1 | 2 | 3 };
    });
  }

  private animalFrames = new WeakMap<Animal, Map<string, AnimalSprite>>();

  /**
   * The animals as things: standing where placed and idling, each a little out of step with the
   * others, or as the herd has them in Play.
   */
  animalThings(ms: number, herd?: Herd): Thing[] {
    return this.scene.animals.map((placed, k) => {
      const pose = herd?.poses[k];
      const clipId: ClipId = pose?.clip ?? 'idle';
      const clip = CLIPS[clipId];
      const lag = ((Math.imul(Math.floor(placed.i * 97), 73856093) ^ Math.imul(Math.floor(placed.j * 89), 19349663)) >>> 0) % clip.frames;
      const n = (Math.floor(((ms - (pose?.started ?? 0)) / 1000) * clip.rate) + lag) % clip.frames;
      const v = this.toView(pose ?? placed);
      const facing = (((pose ?? placed).facing + this.rot) % 4) as Facing;
      let frames = this.animalFrames.get(placed.animal);
      if (!frames) this.animalFrames.set(placed.animal, (frames = new Map()));
      const key = `${clipId}|${n}|${facing}`;
      let sprite = frames.get(key);
      if (!sprite) frames.set(key, (sprite = drawAnimal(placed.animal, clipId, n, facing).sprite));
      return { spot: { i: v.i, j: v.j, level: standingHeight(this.map, v.i, v.j) }, picture: sprite, w: ANIMAL_W, h: ANIMAL_H, foot: ANIMAL_ORIGIN };
    });
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
    const MARK_COLORS: [number[], number][] = [[rgb(ocean.rippleDark), ocean.rippleOpacity], [rgb(ocean.ripplePale), ocean.rippleOpacity], [[0xff, 0xff, 0xff], 0.8]];
    const g = this.ground;
    const image: Pixels = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    const d = image.data;
    for (let y = 0; y < h; y++) {
      const gy = y + view.y;
      const far = ocean.gradient * (1 - y / h);
      for (let x = 0; x < w; x++) {
        const gx = x + view.x;
        const o = (y * w + x) * 4;
        if (gy < 0 || gx < 0 || gy >= g.h || gx >= g.w) {
          d[o] = SEA[0]; d[o + 1] = SEA[1]; d[o + 2] = SEA[2]; d[o + 3] = 255;
          const mark = markAt(gx, gy, 9, ms);
          if (mark) for (let k = 0; k < 3; k++) d[o + k] += (MARK_COLORS[mark - 1][0][k] - d[o + k]) * MARK_COLORS[mark - 1][1];
          for (let k = 0; k < 3; k++) d[o + k] += (FAR[k] - d[o + k]) * far;
          continue;
        }
        const p = gy * g.w + gx;
        d[o] = g.rgba[p * 4]; d[o + 1] = g.rgba[p * 4 + 1]; d[o + 2] = g.rgba[p * 4 + 2]; d[o + 3] = 255;
        const depth = SEA_LEVEL - g.height[p];
        const foam = 0.85 * waveAt(depth, SEA_LEVEL - g.height[gy > 0 ? p - g.w : p], SEA_LEVEL - g.height[gx > 0 ? p - 1 : p], gx, gy, ms);
        if (foam > 0) for (let k = 0; k < 3; k++) d[o + k] += (FOAM[k] - d[o + k]) * foam;
        else if (depth > 0) {
          const mark = markAt(gx, gy, depth, ms);
          if (mark) for (let k = 0; k < 3; k++) d[o + k] += (MARK_COLORS[mark - 1][0][k] - d[o + k]) * MARK_COLORS[mark - 1][1];
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
    const placed = things
      .map((t) => {
        const at = footOf(g, t.spot);
        return { ...t, dx: at.x - t.foot.x - view.x, dy: at.y - t.foot.y - view.y };
      })
      .filter((t) => t.dx < w && t.dy < h && t.dx + t.w > 0 && t.dy + t.h > 0);
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
          for (let k = 0; k < 3; k++) d[o + k] += (SHADE_RGB[k] - d[o + k]) * SHADE_ALPHA;
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
        // No shadows on the water: off the map, or where the ground lies under the water line.
        if (!inside(this.map, Math.floor(i), Math.floor(j)) || heightAt(this.map, i, j) < SEA_LEVEL) continue;
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
