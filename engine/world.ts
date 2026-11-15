// The running world of a scene: its ground drawn once per change, its plants drawn per wind
// frame, and a camera window composed each frame with everything standing on the ground. Also
// answers where a screen pixel is on the map, and where a walker may go.
import { drawPlant, grow, recolorPlant, tryPlant, type Category, type Grown, type Plant, type Raster } from '../lab/flora.ts';
import { plantById, type PlantEntry } from '../lab/flora-catalog.ts';
import { blend, castShadow, footOf, HOMES, layShadow, stamp, type Picture, type Pixels, type Spot } from '../lab/island.ts';
import { PALETTE, type PaletteKey } from '../lab/palette.ts';
import {
  canStep, hiddenByGround, inside, levelAt, renderTerrain, SEA_LEVEL, setLevel, standingHeight, surfaceAt, type HeightMap, type TerrainImage,
} from '../lab/terrain.ts';
import { mapOf, type PlacedPlant, type Scene } from './scene.ts';

export interface Rect { x: number; y: number; w: number; h: number }
/** Something drawn standing on the ground: `foot` is the pixel of its picture that touches the spot. */
export interface Thing { spot: Spot; picture: Picture; w: number; h: number; foot: { x: number; y: number } }

const SEA = [0x4f, 0xae, 0xc4];
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

const grownCache = new Map<string, Grown>();
const rasterCache = new Map<string, Raster>();
const sizeStep = (s: number) => Math.round(s * 10) / 10;
/** One wind frame of a placed plant. Shared by every plant with the same recipe, variant and size. */
export function rasterOf(p: Pick<PlacedPlant, 'plant' | 'seed' | 'size'>, frame: number): Raster | null {
  const entry = plantById(p.plant);
  if (!entry) return null;
  const key = `${p.plant}|${p.seed}|${sizeStep(p.size)}`;
  let grown = grownCache.get(key);
  if (!grown) grownCache.set(key, (grown = grow(plantOf(entry), { seed: p.seed, size: sizeStep(p.size) })));
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

  constructor(scene: Scene, rot = 0) {
    this.scene = scene;
    this.rot = ((rot % 4) + 4) % 4;
    this.map = this.viewMap();
    this.ground = renderTerrain(this.map);
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
    this.ground = renderTerrain(this.map);
  }

  /** After the ground changed: copies it back to the scene and draws it again. */
  redraw(): void {
    for (let j = 0; j < this.map.h; j++) for (let i = 0; i < this.map.w; i++) {
      const c = this.dataCell(i, j);
      this.scene.levels[c] = this.map.levels[j * this.map.w + i];
      this.scene.paint[c] = this.map.paint[j * this.map.w + i];
    }
    this.ground = renderTerrain(this.map);
  }

  /** The scene's plants with their positions in view coordinates. */
  viewPlants(): (PlacedPlant & { vi: number; vj: number })[] {
    return this.scene.plants.map((p) => {
      const v = this.toView(p);
      return { ...p, vi: v.i, vj: v.j };
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
      const raster = rasterOf(p, frame);
      if (raster) out.push({ spot: { i: p.vi, j: p.vj, level: standingHeight(this.map, p.vi, p.vj) }, picture: raster, w: raster.w, h: raster.h, foot: raster.origin });
    }
    return out;
  }

  /**
   * Paints the camera window: the ground, every shadow at once, then things back to front with
   * higher ground in front hiding them. `highlight` lightens some tiles (the brush in the editor).
   */
  compose(view: Rect, things: Thing[], highlight?: Set<number>): Pixels {
    const { w, h } = view;
    const g = this.ground;
    const image: Pixels = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    const d = image.data;
    for (let y = 0; y < h; y++) {
      const gy = y + view.y;
      for (let x = 0; x < w; x++) {
        const gx = x + view.x;
        const o = (y * w + x) * 4;
        if (gy < 0 || gx < 0 || gy >= g.h || gx >= g.w) {
          d[o] = SEA[0]; d[o + 1] = SEA[1]; d[o + 2] = SEA[2]; d[o + 3] = 255;
          continue;
        }
        const p = gy * g.w + gx;
        d[o] = g.rgba[p * 4]; d[o + 1] = g.rgba[p * 4 + 1]; d[o + 2] = g.rgba[p * 4 + 2]; d[o + 3] = 255;
        if (highlight?.has(g.cell[p])) blend(image, x, y, '#ffffff66');
      }
    }
    const placed = things
      .map((t) => {
        const at = footOf(g, t.spot);
        return { ...t, dx: at.x - t.foot.x - view.x, dy: at.y - t.foot.y - view.y };
      })
      .filter((t) => t.dx < w && t.dy < h && t.dx + t.w > 0 && t.dy + t.h > 0);
    const mask = new Uint8Array(w * h);
    for (const t of placed) castShadow(mask, w, h, t.picture, t.w, t.h, t.dx, t.dy);
    layShadow(image, mask);
    placed.sort((a, b) => a.spot.i + a.spot.j - (b.spot.i + b.spot.j));
    for (const t of placed) {
      stamp(image, t.picture, t.w, t.h, t.dx, t.dy, (x, y) => hiddenByGround(this.map, g, x + view.x, y + view.y, t.spot.i, t.spot.j, t.spot.level));
    }
    return image;
  }

  /** Whether a walker can stand at a point: dry land, reached without a cliff, clear of big plants. */
  canWalk(from: { i: number; j: number }, to: { i: number; j: number }): boolean {
    const a: [number, number] = [Math.floor(from.i), Math.floor(from.j)];
    const b: [number, number] = [Math.floor(to.i), Math.floor(to.j)];
    if (!inside(this.map, ...b) || levelAt(this.map, ...b) < SEA_LEVEL) return false;
    if ((a[0] !== b[0] || a[1] !== b[1]) && !canStep(this.map, a, b)) return false;
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
