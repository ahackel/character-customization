// Throwaway prototype, not part of the published site (it is not in vite.config.ts; open it on the
// dev server at /tools/walls-proto/). Plank walls stand on the EDGES of the cells of a height map:
//
//  - a wall stores only its edge (kind, i, j); its heights come from the terrain's corner heights
//    (`cornersOf`), so it follows slopes and the terrain can be edited under it;
//  - planks are drawn by rule per screen column, so a sloped edge needs no sloped sprite, and each
//    plank has its own height, lean and poke past the ends (the overhang);
//  - walls are things in the sort: scalar key `i + j` (what compose() does now) or a box test;
//  - the walker shows what the collision padding has to be for the overhang to sort correctly.
import { hashOf, rng } from '../../shared/random.ts';
import {
  createHeightMap, cornersOf, generateIsland, heightAt, hiddenByGround, levelAt, renderTerrain, seaFloor, setLevel,
  LEVEL_PX, SEA_LEVEL, SLOPE_LEVELS, standingHeight, TILE_H, TILE_W, type HeightMap, type TerrainImage,
} from '../../engine/world/terrain.ts';

const HALF_W = TILE_W / 2; // 16 screen columns along one cell edge
const HALF_H = TILE_H / 2; // 8 rows down along one cell edge

// ------------------------------------------------------------------ state

type Kind = 'H' | 'V'; // H runs along i between vertices (i, j) and (i + 1, j); V along j between (i, j) and (i, j + 1)
interface Edge { kind: Kind; i: number; j: number }
const walls = new Map<string, Edge>();
const edgeKey = (e: Edge) => `${e.kind}${e.i},${e.j}`;

const P = {
  height: 4,
  overhang: 3,
  top: 'slope' as 'slope' | 'stepped' | 'flat',
  sort: 'box' as 'box' | 'scalar',
  seed: 1,
  pad: 0.12,
  grid: true,
  terrain: 'proving' as 'proving' | 'island',
  islandSeed: 3,
  zoom: 2,
};

let shape: HeightMap; // the map the player edits
let ground: TerrainImage; // its painted picture
let sea: HeightMap; // the map as drawn: the sea floor shaped
let frame: Uint8ClampedArray<ArrayBuffer>;
let dirty = true;

// ------------------------------------------------------------------ terrain

function provingGround(): HeightMap {
  const n = 24;
  const map = createHeightMap(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const d = Math.min(i, j, n - 1 - i, n - 1 - j);
      let l = d === 0 ? -4 : d === 1 ? -2 : d === 2 ? -1 : d === 3 ? 0 : 1;
      if (d >= 4) {
        if (i >= 6 && i <= 9 && j >= 6 && j <= 9) l = i - 4; // a ramp, one level per tile
        else if (i >= 10 && i <= 13 && j >= 6 && j <= 9) l = 5; // a plateau: cliffs all round
        else if (i >= 15 && i <= 18 && j >= 6 && j <= 9) l = 3; // a two level step
        else if (i >= 4 && i <= 10 && j >= 13) l = 1 + Math.floor((j - 13) / 2); // a gentle slope
      }
      setLevel(map, i, j, l);
    }
  }
  return map;
}

function presetWalls(): void {
  walls.clear();
  const add = (kind: Kind, i: number, j: number) => walls.set(edgeKey({ kind, i, j }), { kind, i, j });
  for (let i = 14; i <= 17; i++) { add('H', i, 14); if (i !== 15) add('H', i, 18); } // a pen with a door in the south wall
  for (let j = 14; j <= 17; j++) { add('V', 14, j); add('V', 18, j); }
  for (let i = 6; i <= 9; i++) add('H', i, 7); // up the one level ramp
  for (let i = 10; i <= 13; i++) add('H', i, 6); // along the top of a cliff
  for (let i = 15; i <= 18; i++) add('H', i, 6); // at the foot of a two level step
  for (let j = 13; j <= 19; j++) add('V', 7, j); // down the gentle slope
  for (let j = 8; j <= 12; j++) add('V', 3, j); // along the waterline
  for (let j = 9; j <= 11; j++) add('V', 2, j); // out in the water
}

function loadTerrain(): void {
  shape = P.terrain === 'proving' ? provingGround() : generateIsland(P.islandSeed, 28, 28, { peak: 6 });
  sea = seaFloor(shape);
  ground = renderTerrain(shape);
  frame = new Uint8ClampedArray(ground.w * ground.h * 4);
  pics.clear();
  gridCache = null;
  if (P.terrain === 'proving') presetWalls();
  else walls.clear();
  walker.x = P.terrain === 'proving' ? 12.5 : shape.w / 2 + 0.5;
  walker.y = P.terrain === 'proving' ? 12.5 : shape.h / 2 + 0.5;
  if (P.terrain === 'island') nudgeToLand();
  const view = document.getElementById('view') as HTMLCanvasElement;
  view.width = ground.w;
  view.height = ground.h;
  applyZoom();
  dirty = true;
}

function nudgeToLand(): void {
  for (let r = 0; r < 20; r++) {
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const ci = Math.floor(shape.w / 2) + i;
        const cj = Math.floor(shape.h / 2) + j;
        if (levelAt(shape, ci, cj) >= 1) { walker.x = ci + 0.5; walker.y = cj + 0.5; return; }
      }
    }
  }
}

// ------------------------------------------------------------------ wall heights

/**
 * The ground height, in levels, at the two ends of an edge: the higher of what the two cells that
 * share the edge say, so a wall never sinks into the ground and, across a cliff, stands on top.
 */
function endHeights(e: Edge): [number, number] {
  const front = cornersOf(sea, e.i, e.j);
  let a: number, b: number;
  if (e.kind === 'H') {
    const behind = cornersOf(sea, e.i, e.j - 1);
    a = Math.max(front[0], behind[3]);
    b = Math.max(front[1], behind[2]);
  } else {
    const behind = cornersOf(sea, e.i - 1, e.j);
    a = Math.max(front[0], behind[1]);
    b = Math.max(front[3], behind[2]);
  }
  return [Math.max(SEA_LEVEL, a), Math.max(SEA_LEVEL, b)];
}

// ------------------------------------------------------------------ drawing a plank wall

interface Box { x0: number; x1: number; y0: number; y1: number }
interface Pic {
  x: number; y: number; w: number; h: number;
  rgba: Uint8ClampedArray;
  /** Per pixel, the level of the ground the pixel stands on, for hiding it behind nearer higher ground. */
  base: Float32Array | number;
  /** The cell used to decide what lies in front. */
  ci: number; cj: number;
  /** Where it stands on the plan, in map units: for sorting. */
  box: Box;
  key: number;
  edge?: Edge;
}

const WOOD = ['#b0824f', '#9e7142', '#bd9060', '#8f6439'].map(hex);
function hex(s: string): [number, number, number] {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const pics = new Map<string, Pic>();

function buildWall(e: Edge): Pic {
  const [h0, h1] = endHeights(e);
  const oh = P.overhang;
  const random = rng(hashOf(`${P.seed}|${edgeKey(e)}`));
  const o = ground.origin;
  const xmin = o.x + (e.kind === 'H' ? e.i - e.j : e.i - e.j - 1) * HALF_W;
  const sy = o.y + (e.i + e.j) * HALF_H; // the row of the first end at level 0
  const pad = oh + 3;
  const w = 16 + 2 * pad;
  const topMax = Math.max(h0, h1) + P.height;
  const y0 = Math.floor(sy - (topMax + 1) * LEVEL_PX) - 8;
  const y1 = Math.ceil(sy + HALF_H - Math.min(h0, h1) * LEVEL_PX) + 6;
  const h = y1 - y0;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const base = new Float32Array(w * h);
  const x0 = xmin - pad;
  const tOf = (c: number) => (e.kind === 'H' ? (c + 0.5) / 16 : 1 - (c + 0.5) / 16);
  const lvl = (t: number) => h0 + (h1 - h0) * t;
  const rowAt = (t: number, level: number) => Math.round(sy + HALF_H * t - level * LEVEL_PX);
  const tone = e.kind === 'H' ? 1 : 0.78; // the wall lit from the left on one side, in shade on the other
  const put = (lx: number, ly: number, rgb: number[], level: number) => {
    if (lx < 0 || ly < 0 || lx >= w || ly >= h) return;
    const p = ly * w + lx;
    rgba[p * 4] = rgb[0]; rgba[p * 4 + 1] = rgb[1]; rgba[p * 4 + 2] = rgb[2]; rgba[p * 4 + 3] = 255;
    base[p] = level;
  };
  const mul = (c: number[], k: number) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

  let c = -Math.floor(random() * (oh + 1)); // the first plank may poke out past the end
  const end = 16 + Math.floor(random() * (oh + 1));
  while (c < end) {
    const wd = 2 + Math.floor(random() * 3);
    const cs = c;
    const ce = Math.min(c + wd, end);
    c += wd;
    if (random() < 0.06 && cs > 0 && ce < 16) continue; // a missing plank
    const col = mul(WOOD[Math.floor(random() * WOOD.length)], tone);
    const jag = Math.floor(random() * 4) + (random() < 0.15 ? 5 : 0); // some planks are shorter, a few taller
    const slant = random() < 0.4 ? (random() < 0.5 ? -1 : 1) : 0;
    const lean = oh > 0 ? Math.round((random() - 0.5) * oh) : 0; // how far the top of the plank leans sideways
    const sink = random() < 0.3 ? 1 : 0;
    const knot = random() < 0.35 ? [cs + Math.floor(random() * (ce - cs)), Math.floor(random() * 12) + 4] : null;
    const mid = (cs + ce - 1) / 2;
    const steppedTop = Math.round(lvl(tOf(mid))) + P.height;
    const flatTop = Math.max(h0, h1) + P.height;
    for (let cc = cs; cc < ce; cc++) {
      const t = tOf(cc);
      const level = lvl(t);
      const bottom = rowAt(t, level) + sink;
      const topLevel = P.top === 'slope' ? level + P.height : P.top === 'stepped' ? steppedTop : flatTop;
      const slantPx = slant && ce - cs > 1 ? Math.round((slant * (cc - cs)) / (ce - cs - 1)) : 0;
      const top = Math.min(bottom - 3, rowAt(t, topLevel) - jag + slantPx);
      const span = Math.max(1, bottom - top);
      for (let y = top; y <= bottom; y++) {
        const shift = Math.round((lean * (bottom - y)) / span);
        let k = 1;
        if (y === top) k = 1.28; // the cut end of the plank
        else if (cc === cs) k = 1.12; // its lit edge
        else if (cc === ce - 1 && ce - cs > 1) k = 0.72; // the seam to the next one
        let px = mul(col, k);
        if (knot && cc === knot[0] && y === bottom - knot[1]) px = mul(col, 0.62);
        const nail = [bottom - Math.round(span * 0.28), bottom - Math.round(span * 0.74)];
        if (cc === Math.floor(mid) && nail.includes(y) && ce - cs > 2) px = [74, 58, 48];
        put(cc + shift + pad, y - y0, px, level);
      }
    }
  }

  const t = 0.06; // wall thickness on the plan
  const box: Box = e.kind === 'H' ? { x0: e.i, x1: e.i + 1, y0: e.j - t, y1: e.j + t } : { x0: e.i - t, x1: e.i + t, y0: e.j, y1: e.j + 1 };
  return { x: x0, y: y0, w, h, rgba, base, ci: e.i, cj: e.j, box, key: e.i + e.j + 0.5, edge: e };
}

function wallPic(e: Edge): Pic {
  const k = edgeKey(e);
  let pic = pics.get(k);
  if (!pic) pics.set(k, (pic = buildWall(e)));
  return pic;
}

// ------------------------------------------------------------------ the walker

const walker = { x: 12.5, y: 12.5 };
const FIG_W = 9;
const FIG_H = 26;
const FIG = (() => {
  const rgba = new Uint8ClampedArray(FIG_W * FIG_H * 4);
  const px = (x: number, y: number, c: string) => {
    const [r, g, b] = hex(c);
    const o = (y * FIG_W + x) * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  };
  const rect = (x0: number, y0: number, w: number, h: number, c: string) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, c); };
  rect(2, 0, 5, 6, '#e8b890'); // head
  rect(2, 0, 5, 2, '#4a2f20'); // hair
  rect(1, 6, 7, 10, '#3d78c4'); // shirt
  rect(0, 7, 1, 7, '#e8b890'); rect(8, 7, 1, 7, '#e8b890'); // arms
  rect(2, 16, 2, 10, '#3b3552'); rect(5, 16, 2, 10, '#3b3552'); // legs
  return rgba;
})();
const FIG_BOX_R = 0.04; // small, so that it stays clear of a wall's box whenever the padding is at least a little

function figurePic(): Pic {
  const o = ground.origin;
  const h = standingHeight(sea, walker.x, walker.y);
  const fx = Math.round(o.x + (walker.x - walker.y) * HALF_W);
  const fy = Math.round(o.y + (walker.x + walker.y) * HALF_H - h * LEVEL_PX);
  return {
    x: fx - 4, y: fy - (FIG_H - 1), w: FIG_W, h: FIG_H, rgba: FIG, base: Math.max(SEA_LEVEL, h),
    ci: Math.floor(walker.x), cj: Math.floor(walker.y),
    box: { x0: walker.x - FIG_BOX_R, x1: walker.x + FIG_BOX_R, y0: walker.y - FIG_BOX_R, y1: walker.y + FIG_BOX_R },
    key: walker.x + walker.y,
  };
}

// ------------------------------------------------------------------ collision

/** Walls block moves across an edge; the padding keeps the walker clear of them and of their overhang. */
function blockedByWall(x: number, y: number): boolean {
  const p = Math.max(0.03, P.pad);
  for (const e of walls.values()) {
    const inside = e.kind === 'H'
      ? x >= e.i - p && x <= e.i + 1 + p && y >= e.j - p && y <= e.j + p
      : x >= e.i - p && x <= e.i + p && y >= e.j - p && y <= e.j + 1 + p;
    if (inside) return true;
  }
  return false;
}

function tryMove(nx: number, ny: number): boolean {
  const from = levelAt(shape, Math.floor(walker.x), Math.floor(walker.y));
  const to = levelAt(shape, Math.floor(nx), Math.floor(ny));
  if (to < SEA_LEVEL || Math.abs(to - from) > SLOPE_LEVELS) return false;
  if (blockedByWall(nx, ny) && !blockedByWall(walker.x, walker.y)) return false;
  walker.x = nx; walker.y = ny;
  return true;
}

// ------------------------------------------------------------------ sorting

interface Item { pic: Pic }

/** Back to front. 'scalar' is the engine's i + j key; 'box' compares footprints on the plan, as Ultima 8 did. */
function paintOrder(items: Item[]): Item[] {
  const sorted = [...items].sort((a, b) => a.pic.key - b.pic.key);
  if (P.sort === 'scalar') return sorted;
  const overlaps = (a: Pic, b: Pic) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const before = (a: Pic, b: Pic) => {
    const ax = a.box.x1 <= b.box.x0, ay = a.box.y1 <= b.box.y0;
    const bx = b.box.x1 <= a.box.x0, by = b.box.y1 <= a.box.y0;
    if ((ax || ay) && !(bx || by)) return true;
    if ((bx || by) && !(ax || ay)) return false;
    return a.key < b.key;
  };
  const out: Item[] = [];
  const seen = new Set<Item>();
  const visit = (it: Item) => {
    if (seen.has(it)) return;
    seen.add(it);
    for (const o of sorted) if (o !== it && !seen.has(o) && overlaps(o.pic, it.pic) && before(o.pic, it.pic)) visit(o);
    out.push(it);
  };
  for (const it of sorted) visit(it);
  return out;
}

// ------------------------------------------------------------------ frame

let order: Item[] = [];
let gridCache: { x: number; y: number }[] | null = null;

function gridPixels(): { x: number; y: number }[] {
  if (gridCache) return gridCache;
  const out: { x: number; y: number }[] = [];
  const o = ground.origin;
  const line = (e: Edge) => {
    const [h0, h1] = endHeights(e);
    const xmin = o.x + (e.kind === 'H' ? e.i - e.j : e.i - e.j - 1) * HALF_W;
    const sy = o.y + (e.i + e.j) * HALF_H;
    for (let c = 0; c < 16; c++) {
      const t = e.kind === 'H' ? (c + 0.5) / 16 : 1 - (c + 0.5) / 16;
      out.push({ x: xmin + c, y: Math.round(sy + HALF_H * t - (h0 + (h1 - h0) * t) * LEVEL_PX) });
    }
  };
  for (let j = 0; j <= shape.h; j++) {
    for (let i = 0; i <= shape.w; i++) {
      const land = (ci: number, cj: number) => levelAt(shape, ci, cj) >= SEA_LEVEL;
      if (i < shape.w && (land(i, j) || land(i, j - 1))) line({ kind: 'H', i, j });
      if (j < shape.h && (land(i, j) || land(i - 1, j))) line({ kind: 'V', i, j });
    }
  }
  return (gridCache = out);
}

function stamp(pic: Pic): void {
  const { w: gw, h: gh } = ground;
  for (let y = 0; y < pic.h; y++) {
    const gy = pic.y + y;
    if (gy < 0 || gy >= gh) continue;
    for (let x = 0; x < pic.w; x++) {
      const s = (y * pic.w + x) * 4;
      if (!pic.rgba[s + 3]) continue;
      const gx = pic.x + x;
      if (gx < 0 || gx >= gw) continue;
      const base = typeof pic.base === 'number' ? pic.base : pic.base[y * pic.w + x];
      if (hiddenByGround(shape, ground, gx, gy, pic.ci, pic.cj, base)) continue;
      const d = (gy * gw + gx) * 4;
      frame[d] = pic.rgba[s]; frame[d + 1] = pic.rgba[s + 1]; frame[d + 2] = pic.rgba[s + 2]; frame[d + 3] = 255;
    }
  }
}

function render(): void {
  frame.set(ground.rgba);
  if (P.grid) {
    for (const { x, y } of gridPixels()) {
      if (x < 0 || y < 0 || x >= ground.w || y >= ground.h) continue;
      const d = (y * ground.w + x) * 4;
      for (let k = 0; k < 3; k++) frame[d + k] += (255 - frame[d + k]) * 0.22;
    }
  }
  const items: Item[] = [...walls.values()].map((e) => ({ pic: wallPic(e) }));
  items.push({ pic: figurePic() });
  order = paintOrder(items);
  for (const it of order) stamp(it.pic);
  const view = document.getElementById('view') as HTMLCanvasElement;
  view.getContext('2d')!.putImageData(new ImageData(frame, ground.w, ground.h), 0, 0);
}

// ------------------------------------------------------------------ picking and editing

/** The wall under a screen pixel, else the edge of the ground cell there that the pixel is nearest to. */
function pickEdge(px: number, py: number): { edge: Edge; wall: boolean } | null {
  for (let k = order.length - 1; k >= 0; k--) {
    const pic = order[k].pic;
    if (!pic.edge) continue;
    const x = px - pic.x, y = py - pic.y;
    if (x >= 0 && y >= 0 && x < pic.w && y < pic.h && pic.rgba[(y * pic.w + x) * 4 + 3]) return { edge: pic.edge, wall: true };
  }
  if (px < 0 || py < 0 || px >= ground.w || py >= ground.h) return null;
  const cell = ground.cell[py * ground.w + px];
  if (cell < 0) return null;
  const ci = cell % shape.w, cj = Math.floor(cell / shape.w);
  const o = ground.origin;
  const cx = o.x + (ci - cj) * HALF_W;
  const cy = o.y + (ci + cj + 1) * HALF_H - heightAt(sea, ci + 0.5, cj + 0.5) * LEVEL_PX;
  const right = px + 0.5 >= cx, below = py + 0.5 >= cy;
  const edge: Edge = !below ? (right ? { kind: 'H', i: ci, j: cj } : { kind: 'V', i: ci, j: cj }) : right ? { kind: 'V', i: ci + 1, j: cj } : { kind: 'H', i: ci, j: cj + 1 };
  return { edge, wall: false };
}

let painting: boolean | null = null;

function paint(e: Edge, on: boolean): void {
  const k = edgeKey(e);
  if (on === walls.has(k)) return;
  if (on) walls.set(k, e);
  else { walls.delete(k); pics.delete(k); }
  dirty = true;
}

function atPointer(ev: PointerEvent): { px: number; py: number } {
  const r = (ev.currentTarget as HTMLCanvasElement).getBoundingClientRect();
  return { px: Math.floor(((ev.clientX - r.left) / r.width) * ground.w), py: Math.floor(((ev.clientY - r.top) / r.height) * ground.h) };
}

// ------------------------------------------------------------------ page

const view = document.getElementById('view') as HTMLCanvasElement;

function applyZoom(): void {
  view.style.width = `${ground.w * P.zoom}px`;
  view.style.height = `${ground.h * P.zoom}px`;
}

view.addEventListener('pointerdown', (ev) => {
  const { px, py } = atPointer(ev);
  const hit = pickEdge(px, py);
  if (!hit) return;
  painting = !walls.has(edgeKey(hit.edge));
  paint(hit.edge, painting);
  view.setPointerCapture(ev.pointerId);
});
view.addEventListener('pointermove', (ev) => {
  if (painting === null) return;
  const { px, py } = atPointer(ev);
  const hit = pickEdge(px, py);
  if (hit) paint(hit.edge, painting);
});
view.addEventListener('pointerup', () => (painting = null));

const keys = new Set<string>();
addEventListener('keydown', (ev) => {
  if ((ev.target as HTMLElement).tagName === 'INPUT' || (ev.target as HTMLElement).tagName === 'SELECT') return;
  const k = ev.key.toLowerCase();
  if (k === 'r') return resetWalker();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'shift'].includes(k)) {
    keys.add(k);
    if (k.startsWith('arrow')) ev.preventDefault();
  }
});
addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function resetWalker(): void {
  walker.x = P.terrain === 'proving' ? 12.5 : shape.w / 2 + 0.5;
  walker.y = P.terrain === 'proving' ? 12.5 : shape.h / 2 + 0.5;
  if (P.terrain === 'island') nudgeToLand();
  dirty = true;
}

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const sy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  if (sx || sy) {
    const speed = keys.has('shift') ? 80 : 44; // screen pixels per second
    const norm = sx && sy ? Math.SQRT1_2 : 1;
    const vx = ((sx * speed) / HALF_W + (sy * speed) / HALF_H) / 2 * norm;
    const vy = ((sy * speed) / HALF_H - (sx * speed) / HALF_W) / 2 * norm;
    const steps = Math.max(1, Math.ceil((Math.hypot(vx, vy) * dt) / 0.02));
    for (let s = 0; s < steps; s++) {
      tryMove(walker.x + (vx * dt) / steps, walker.y);
      tryMove(walker.x, walker.y + (vy * dt) / steps);
    }
    dirty = true;
  }
  if (dirty) {
    dirty = false;
    render();
  }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ controls

const panel = document.getElementById('panel')!;
panel.innerHTML = '<h1>Plank walls prototype</h1><p class="note">Walls on cell edges, over slopes, cliffs and the shore.</p>';

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt = (v: number) => String(v)): void {
  const row = document.createElement('label');
  row.className = 'row';
  const val = document.createElement('span');
  val.className = 'v';
  val.textContent = fmt(value);
  const input = document.createElement('input');
  input.type = 'range';
  Object.assign(input, { min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => { val.textContent = fmt(+input.value); onInput(+input.value); });
  row.append(Object.assign(document.createElement('span'), { textContent: label }), val, input);
  panel.append(row);
}

function select<T extends string>(label: string, options: [T, string][], value: T, onChange: (v: T) => void): void {
  const row = document.createElement('label');
  row.className = 'row';
  const sel = document.createElement('select');
  for (const [v, text] of options) sel.append(Object.assign(document.createElement('option'), { value: v, textContent: text }));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value as T));
  row.append(Object.assign(document.createElement('span'), { textContent: label }), sel);
  panel.append(row);
}

function button(label: string, onClick: () => void, into: HTMLElement): void {
  const b = Object.assign(document.createElement('button'), { textContent: label });
  b.addEventListener('click', onClick);
  into.append(b);
}

const rebuild = () => { pics.clear(); dirty = true; };

select('Terrain', [['proving', 'Proving ground'], ['island', 'Generated island']], P.terrain, (v) => { P.terrain = v; loadTerrain(); });
slider('Island seed', 1, 30, 1, P.islandSeed, (v) => { P.islandSeed = v; if (P.terrain === 'island') loadTerrain(); });
slider('Wall height (levels)', 1, 8, 1, P.height, (v) => { P.height = v; rebuild(); });
select('Top', [['slope', 'follows the slope'], ['stepped', 'steps by whole levels'], ['flat', 'flat']], P.top, (v) => { P.top = v; rebuild(); });
slider('Overhang (px)', 0, 8, 1, P.overhang, (v) => { P.overhang = v; rebuild(); });
slider('Plank seed', 1, 40, 1, P.seed, (v) => { P.seed = v; rebuild(); });
select('Sort', [['box', 'boxes on the plan'], ['scalar', 'scalar i + j']], P.sort, (v) => { P.sort = v; dirty = true; });
slider('Collision padding (tiles)', 0, 0.5, 0.02, P.pad, (v) => (P.pad = v), (v) => v.toFixed(2));
slider('Zoom', 1, 4, 1, P.zoom, (v) => { P.zoom = v; applyZoom(); }, (v) => `${v}×`);
const check = document.createElement('label');
check.className = 'check';
const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: P.grid });
box.addEventListener('change', () => { P.grid = box.checked; dirty = true; });
check.append(box, 'Show cell edges');
panel.append(check);
const buttons = document.createElement('div');
buttons.className = 'buttons';
button('Clear walls', () => { walls.clear(); pics.clear(); dirty = true; }, buttons);
button('Preset walls', () => { if (P.terrain === 'proving') { presetWalls(); pics.clear(); dirty = true; } }, buttons);
button('Reset walker', resetWalker, buttons);
panel.append(buttons);
const help = document.createElement('div');
help.className = 'help';
help.innerHTML =
  'Click or drag on a cell edge to add planks, on a wall to remove it.<br><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows walk, <kbd>Shift</kbd> runs, <kbd>R</kbd> resets.<br><br>' +
  'Things to try: walk along the pen and its door in the "scalar" sort and look at the corners; set padding to 0 and push the walker into a wall; raise overhang while padding stays small.';
panel.append(help);

P.zoom = 2;
loadTerrain();
// For poking at it from the console or a test script.
Object.assign(window, { proto: { walker, P, walls, redraw: () => (dirty = true), rebuild } });
requestAnimationFrame(loop);
