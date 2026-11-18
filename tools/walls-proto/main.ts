// Throwaway prototype, not part of the published site (it is not in vite.config.ts; open it on the
// dev server at /tools/walls-proto/). Plank walls stand on the EDGES of the cells of a height map:
//
//  - a wall stores only its edge (kind, i, j); its heights come from the terrain's corner heights
//    (`cornersOf`), so it follows slopes and the terrain can be edited under it;
//  - planks are drawn by rule per screen column, so a sloped edge needs no sloped sprite; every edge
//    shows the same wall tile (the plank seed picks it), each plank with its own height, lean and
//    poke past the ends (the overhang);
//  - roofs are painted on cells: each connected patch gets a hipped palm-thatch roof over its bounding
//    rectangle, resting on the wall tops and reaching past them by the eaves;
//  - walls are things in the sort: scalar key `i + j` (what compose() does now) or a box test;
//  - the walker shows what the collision padding has to be for the overhang to sort correctly.
import { hashOf, rng } from '../../shared/random.ts';
import { Viewport } from '../../shared/viewport.ts';
import { AUTHORED } from '../../engine/core/poses.ts';
import { CHARACTER_ORIGIN as FEET, drawCharacter, SPRITE_H, SPRITE_W, type Facing, type Look } from '../../engine/core/puppet.ts';
import { defaultState, loadRoster, lookOf, pickedCharacter, type Saved } from '../../engine/character/character.ts';
import { facingOf } from '../../engine/world/actor.ts';
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
/** Cells under a roof, as `i,j`. */
const roofs = new Set<string>();

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
  paint: 'walls' as 'walls' | 'roof',
  /** How far the ridge stands above the wall tops, in levels. */
  rise: 3,
  /** How far the roof reaches past the walls, in tiles. */
  eaves: 0.3,
  character: '',
};

let shape: HeightMap; // the map the player edits
let ground: TerrainImage; // its painted picture
let sea: HeightMap; // the map as drawn: the sea floor shaped
let frame: Uint8ClampedArray<ArrayBuffer>;
let shade: Uint8Array; // per frame pixel, 1 where a shadow falls

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
  for (let i = 14; i <= 16; i++) { add('H', i, 14); if (i !== 15) add('H', i, 17); } // a 3 by 3 hut with a door in the south wall
  for (let j = 14; j <= 16; j++) { add('V', 14, j); add('V', 17, j); }
  for (let i = 6; i <= 9; i++) add('H', i, 7); // up the one level ramp
  for (let i = 10; i <= 13; i++) add('H', i, 6); // along the top of a cliff
  for (let i = 15; i <= 18; i++) add('H', i, 6); // at the foot of a two level step
  for (let j = 13; j <= 19; j++) add('V', 7, j); // down the gentle slope
  for (let j = 8; j <= 12; j++) add('V', 3, j); // along the waterline
  for (let j = 9; j <= 11; j++) add('V', 2, j); // out in the water
}

function presetRoofs(): void {
  roofs.clear();
  for (let j = 14; j <= 16; j++) for (let i = 14; i <= 16; i++) roofs.add(`${i},${j}`); // over the hut
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
  full.width = ground.w;
  full.height = ground.h;
  shade = new Uint8Array(ground.w * ground.h);
  roofPics.clear();
  if (P.terrain === 'proving') presetRoofs();
  else roofs.clear();
  lookAtWalker();

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
  roof?: Roof;
  /** Frame pixels of the ground in its shadow. */
  shadow?: number[];
}

/** Where the shadow of a point one level up lands on the ground, in map units: the sun is on the -i side, so shadows fall toward +i. */
const SUN = { i: 0.22, j: 0.06 };
/** Collects the frame pixels of the ground shadow cast by a point `up` levels above ground level `g` at map point (x, y). */
function shadowAt(out: number[], x: number, y: number, g: number, up: number): void {
  const o = ground.origin;
  x += up * SUN.i;
  y += up * SUN.j;
  const sx = Math.round(o.x + (x - y) * HALF_W), sy = Math.round(o.y + (x + y) * HALF_H - g * LEVEL_PX);
  if (sx >= 0 && sy >= 0 && sx < ground.w && sy < ground.h) out.push(sy * ground.w + sx);
}

const WOOD = ['#b0824f', '#9e7142', '#bd9060', '#8f6439'].map(hex);
function hex(s: string): [number, number, number] {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const pics = new Map<string, Pic>();

/**
 * `cut`: sawn off flat at half the wall's height, as the front walls of a hut the walker is in.
 * `cap`: the eaves level of a roof over the wall: no plank reaches above it and the top lies in its shade.
 */
function buildWall(e: Edge, cut = false, cap?: number): Pic {
  const [h0, h1] = endHeights(e);
  const oh = P.overhang;
  // One tile for every edge; painting a different one per edge would put its id in this seed.
  const random = rng(hashOf(`plank|${P.seed}`));
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
      let top = cut ? bottom - Math.round((P.height * LEVEL_PX) / 2) : Math.min(bottom - 3, rowAt(t, topLevel) - jag + slantPx);
      if (cap !== undefined) top = Math.max(top, rowAt(t, cap) + 1);
      const shadeTo = cap === undefined ? -Infinity : rowAt(t, cap) + Math.round(1.5 * LEVEL_PX); // the eaves' shadow on the wall
      const span = Math.max(1, bottom - top);
      for (let y = top; y <= bottom; y++) {
        const shift = Math.round((lean * (bottom - y)) / span);
        let k = y < shadeTo ? 0.7 : 1;
        if (y === top) k *= 1.28; // the cut end of the plank
        else if (cc === cs) k *= 1.12; // its lit edge
        else if (cc === ce - 1 && ce - cs > 1) k *= 0.72; // the seam to the next one
        let px = mul(col, k);
        if (knot && cc === knot[0] && y === bottom - knot[1]) px = mul(col, 0.62);
        const nail = [bottom - Math.round(span * 0.28), bottom - Math.round(span * 0.74)];
        if (cc === Math.floor(mid) && nail.includes(y) && ce - cs > 2) px = [74, 58, 48];
        put(cc + shift + pad, y - y0, px, level);
      }
    }
  }

  // Its shadow on the ground: the wall as a sheet from its foot to its top, sampled finer than a pixel.
  const shadow: number[] = [];
  for (let s = 0; s <= 1; s += 1 / 48) {
    const g = h0 + (h1 - h0) * s;
    const tall = cut ? P.height / 2 : cap !== undefined ? Math.min(P.height, cap - g) : P.height;
    const [x, y] = e.kind === 'H' ? [e.i + s, e.j] : [e.i, e.j + s];
    for (let up = 0; up <= tall; up += 1 / 10) shadowAt(shadow, x, y, g, up);
  }
  const t = 0.06; // wall thickness on the plan
  const box: Box = e.kind === 'H' ? { x0: e.i, x1: e.i + 1, y0: e.j - t, y1: e.j + t } : { x0: e.i - t, x1: e.i + t, y0: e.j, y1: e.j + 1 };
  return { x: x0, y: y0, w, h, rgba, base, ci: e.i, cj: e.j, box, key: e.i + e.j + 0.5, edge: e, shadow };
}

function wallPic(e: Edge, cut = false, cap?: number): Pic {
  const k = `${edgeKey(e)}|${cut}|${cap}`;
  let pic = pics.get(k);
  if (!pic) pics.set(k, (pic = buildWall(e, cut, cap)));
  return pic;
}

// ------------------------------------------------------------------ the walker

const walker = { x: 12.5, y: 12.5, facing: 0 as Facing, moving: false, run: false, since: 0 };
const FIG_BOX_R = 0.04; // small, so that it stays clear of a wall's box whenever the padding is at least a little

/** The default character and the ones saved in the wardrobe on this device. */
const people = (): Saved[] => [{ id: '', name: 'Default', state: defaultState() }, ...loadRoster()];
let look: Look = lookOf(defaultState());
const frames = new Map<string, Uint8ClampedArray>();
function setCharacter(id: string): void {
  const c = people().find((p) => p.id === id) ?? people()[0];
  P.character = c.id;
  look = lookOf(c.state);
  frames.clear();

}

/** The character's frame now, as RGBA, drawn once per pose, facing and face. */
function figureFrame(ms: number): Uint8ClampedArray {
  const id = walker.moving ? (walker.run ? 'run' : 'walk') : 'idle';
  const clip = AUTHORED[id];
  const n = Math.floor(((ms - walker.since) / 1000) * clip.rate) % clip.frames.length;
  const face = clip.faces?.[n];
  const key = `${id}|${n}|${walker.facing}|${face}`;
  let rgba = frames.get(key);
  if (rgba) return rgba;
  const sprite = drawCharacter(look, clip.frames[n], walker.facing, { face, swing: clip.swing });
  rgba = new Uint8ClampedArray(SPRITE_W * SPRITE_H * 4);
  for (let p = 0; p < SPRITE_W * SPRITE_H; p++) {
    const c = sprite.pixels[p];
    if (!c) continue;
    const [r, g, b] = hex(c);
    rgba.set([r, g, b, c.length > 7 ? parseInt(c.slice(7, 9), 16) : 255], p * 4);
  }
  frames.set(key, rgba);
  return rgba;
}

function figurePic(ms: number): Pic {
  const o = ground.origin;
  const h = standingHeight(sea, walker.x, walker.y);
  const fx = Math.round(o.x + (walker.x - walker.y) * HALF_W);
  const fy = Math.round(o.y + (walker.x + walker.y) * HALF_H - h * LEVEL_PX);
  return {
    x: fx - FEET.x, y: fy - FEET.y, w: SPRITE_W, h: SPRITE_H, rgba: figureFrame(ms), base: Math.max(SEA_LEVEL, h),
    ci: Math.floor(walker.x), cj: Math.floor(walker.y),
    box: { x0: walker.x - FIG_BOX_R, x1: walker.x + FIG_BOX_R, y0: walker.y - FIG_BOX_R, y1: walker.y + FIG_BOX_R },
    key: walker.x + walker.y,
  };
}

// ------------------------------------------------------------------ roofs

/** A roof over a patch of cells: its plan rectangle, cells i0..i1 by j0..j1. */
interface Roof { i0: number; i1: number; j0: number; j1: number; cells: string[] }

/** The connected patches of roof cells; each roofs its bounding rectangle. */
// shortcut: an L-shaped patch gets one roof over its bounding box; split it into rectangles when roofs need corners.
function roofPatches(): Roof[] {
  const seen = new Set<string>();
  const out: Roof[] = [];
  for (const start of roofs) {
    if (seen.has(start)) continue;
    const cells: string[] = [];
    const todo = [start];
    seen.add(start);
    while (todo.length) {
      const k = todo.pop()!;
      cells.push(k);
      const [i, j] = k.split(',').map(Number);
      for (const n of [`${i + 1},${j}`, `${i - 1},${j}`, `${i},${j + 1}`, `${i},${j - 1}`]) if (roofs.has(n) && !seen.has(n)) { seen.add(n); todo.push(n); }
    }
    const is = cells.map((k) => +k.split(',')[0]), js = cells.map((k) => +k.split(',')[1]);
    out.push({ i0: Math.min(...is), i1: Math.max(...is), j0: Math.min(...js), j1: Math.max(...js), cells });
  }
  return out;
}

const THATCH = ['#d6a443', '#e3b65a', '#c3913a'].map(hex);

/**
 * A hipped roof of palm thatch: four slopes rising `rise` levels over the highest wall top, the
 * ridge along the longer side (a point over a square), each slope going on down past the walls by
 * `eaves`. Drawn as a height field sampled finer than a pixel, the nearest sample (largest i + j)
 * winning each pixel.
 */
/** The level a roof's eaves rest on: the wall tops over its highest ground. */
function eavesOf(r: Roof): number {
  let floor = SEA_LEVEL;
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) floor = Math.max(floor, ...cornersOf(sea, i, j));
  return floor + P.height;
}

function buildRoof(r: Roof): Pic {
  const o = ground.origin;
  const eave = eavesOf(r);
  const floor = eave - P.height;
  const shadow: number[] = [];
  const alongI = r.i1 - r.i0 >= r.j1 - r.j0; // the ridge runs along i
  // u across the ridge, v along it, in map units.
  const [a0, a1] = alongI ? [r.j0, r.j1 + 1] : [r.i0, r.i1 + 1];
  const [b0, b1] = alongI ? [r.i0, r.i1 + 1] : [r.j0, r.j1 + 1];
  const midU = (a0 + a1) / 2, midV = (b0 + b1) / 2, half = (a1 - a0) / 2, halfV = (b1 - b0) / 2;
  const ov = P.eaves;
  const toXY = (u: number, v: number) => (alongI ? [v, u] : [u, v]);
  const random = rng(hashOf(`roof|${P.seed}`));
  const strandHash = Array.from({ length: 4096 }, () => random());
  const strand = (k: number) => strandHash[((k % 4096) + 4096) % 4096];

  const samples: { x: number; y: number; d: number; rgb: number[]; z: number }[] = [];
  const add = (u: number, v: number, z: number, rgb: number[]) => {
    const [x, y] = toXY(u, v);
    samples.push({ x: Math.round(o.x + (x - y) * HALF_W), y: Math.round(o.y + (x + y) * HALF_H - z * LEVEL_PX), d: x + y, rgb, z });
  };
  const mul = (c: number[], k: number) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  const step = 1 / 40;
  // Light by which way a slope faces on the map, like the walls: +j lit, +i in shade.
  const TONE = { '+j': 1, '-j': 1.08, '+i': 0.78, '-i': 0.88 };
  // Golden thatch laid in courses along the eaves, each a row of fine strands in three tones whose
  // ragged tips hang over the top of the course below, which lies in their shadow.
  // Strands run down each slope, so across them is v on the long slopes and u on the hip ends.
  const COURSE = 0.3; // depth of one course, in tiles of slope
  const hang = (k: number, c: number) => 0.1 + strand(k * 7 + c * 13) * 0.3; // how far a strand's tip hangs below its course
  for (let v = b0 - ov; v <= b1 + ov; v += step) {
    for (let u = a0 - ov; u <= a1 + ov; u += step) {
      const eSide = half + ov - Math.abs(u - midU); // up the long slope from its eaves
      const eEnd = halfV + ov - Math.abs(v - midV); // up the hip end from its eaves
      const side = eSide <= eEnd;
      const e = Math.min(eSide, eEnd);
      const k = side ? Math.floor((v - b0 + 4) * 14) : 900 + Math.floor((u - a0 + 4) * 14); // a strand, about a pixel wide
      // The eaves edge is ragged: clumps of a few strands hang lower or end short, each strand a little on its own.
      const clump = Math.floor(k / 3) + Math.floor(strand(k) * 2);
      if (e < (strand(clump * 5 + 3) ** 2 * 0.8 + strand(k * 7) * 0.3) * COURSE) continue;
      const pos = e / COURSE + 0.4;
      let c = Math.floor(pos);
      const f = pos - c; // 0 at the bottom of course c, 1 at its top
      let k2 = 1;
      if (f > 1 - hang(k, c + 1)) { c++; k2 = 1.08; } // a tip of the course above, hanging over
      else if (f > 0.62) k2 = 0.8; // in the shadow of those tips
      if (Math.abs(eSide - eEnd) < 0.05 || (side && Math.abs(u - midU) < 0.06)) k2 = 0.86; // the hips and the ridge, capped
      const facesA = side ? (u > midU ? '+' : '-') : v > midV ? '+' : '-';
      const axis = side === alongI ? 'j' : 'i';
      const tone = TONE[`${facesA}${axis}` as keyof typeof TONE];
      const col = THATCH[Math.floor(strand(k * 31 + c * 17) * THATCH.length)];
      const z = eave + (P.rise * (e - ov)) / half;
      add(u, v, z, mul(col, tone * k2));
      const [x, y] = toXY(u, v);
      shadowAt(shadow, x, y, floor, z - floor);
      shadowAt(shadow, x, y, floor, 0); // and the ground right under it
    }
  }

  const xs = samples.map((p) => p.x), ys = samples.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const base = new Float32Array(w * h);
  const depth = new Float32Array(w * h).fill(-Infinity);
  for (const p of samples) {
    const q = (p.y - y0) * w + (p.x - x0);
    if (p.d <= depth[q]) continue;
    depth[q] = p.d;
    rgba.set([p.rgb[0], p.rgb[1], p.rgb[2], 255], q * 4);
    base[q] = eave;
  }
  const [x1, y1] = alongI ? [b1 + ov, a1 + ov] : [a1 + ov, b1 + ov];
  const [xa, ya] = alongI ? [b0 - ov, a0 - ov] : [a0 - ov, b0 - ov];
  return { x: x0, y: y0, w, h, rgba, base, ci: r.i1, cj: r.j1, box: { x0: xa, x1, y0: ya, y1 }, key: x1 + y1, roof: r, shadow };
}

const roofPics = new Map<string, Pic>();
function roofPic(r: Roof): Pic {
  const k = `${r.i0},${r.i1},${r.j0},${r.j1}`;
  let pic = roofPics.get(k);
  if (!pic) roofPics.set(k, (pic = buildRoof(r)));
  return { ...pic, roof: r };
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
      const a = pic.rgba[s + 3] / 255;
      if (!a) continue;
      const gx = pic.x + x;
      if (gx < 0 || gx >= gw) continue;
      const base = typeof pic.base === 'number' ? pic.base : pic.base[y * pic.w + x];
      if (hiddenByGround(shape, ground, gx, gy, pic.ci, pic.cj, base)) continue;
      const d = (gy * gw + gx) * 4;
      for (let k = 0; k < 3; k++) frame[d + k] += (pic.rgba[s + k] - frame[d + k]) * a;
      frame[d + 3] = 255;
    }
  }
}

function render(ms: number): void {
  frame.set(ground.rgba);
  if (P.grid) {
    for (const { x, y } of gridPixels()) {
      if (x < 0 || y < 0 || x >= ground.w || y >= ground.h) continue;
      const d = (y * ground.w + x) * 4;
      for (let k = 0; k < 3; k++) frame[d + k] += (255 - frame[d + k]) * 0.22;
    }
  }
  // Inside a hut its roof is gone and its front walls (the far-j and far-i sides, facing the viewer) are cut to half height.
  const here = `${Math.floor(walker.x)},${Math.floor(walker.y)}`;
  const patches = roofPatches();
  const home = patches.find((r) => r.cells.includes(here));
  const front = (e: Edge) => !!home && (e.kind === 'H'
    ? e.j === home.j1 + 1 && e.i >= home.i0 && e.i <= home.i1
    : e.i === home.i1 + 1 && e.j >= home.j0 && e.j <= home.j1);
  // A wall on or inside a roofed patch stops under its eaves.
  const capOf = (e: Edge) => {
    const r = patches.find((r) => e.i >= r.i0 && e.j >= r.j0 && (e.kind === 'H' ? e.i <= r.i1 && e.j <= r.j1 + 1 : e.i <= r.i1 + 1 && e.j <= r.j1));
    return r && r !== home ? eavesOf(r) : undefined;
  };
  const items: Item[] = [...walls.values()].map((e) => ({ pic: wallPic(e, front(e), capOf(e)) }));
  for (const r of patches) if (r !== home) items.push({ pic: roofPic(r) });
  // Shadows darken the ground once wherever any of them fall, before anything stands on it.
  shade.fill(0);
  for (const it of items) for (const p of it.pic.shadow ?? []) shade[p] = 1;
  for (const p of home ? roofPic(home).shadow ?? [] : []) shade[p] = 1; // a hidden roof still shades the ground
  for (let p = 0; p < shade.length; p++) {
    if (!shade[p]) continue;
    frame[p * 4] *= 0.64; frame[p * 4 + 1] *= 0.68; frame[p * 4 + 2] *= 0.8;
  }
  items.push({ pic: figurePic(ms) });
  order = paintOrder(items);
  for (const it of order) stamp(it.pic);
  full.getContext('2d')!.putImageData(new ImageData(frame, ground.w, ground.h), 0, 0);
}

// ------------------------------------------------------------------ picking and editing

/** The wall under a screen pixel, else the edge of the ground cell there that the pixel is nearest to. */
/** The topmost picture with ink at a screen pixel that passes `which`. */
function picAt(px: number, py: number, which: (p: Pic) => boolean): Pic | null {
  for (let k = order.length - 1; k >= 0; k--) {
    const pic = order[k].pic;
    if (!which(pic)) continue;
    const x = px - pic.x, y = py - pic.y;
    if (x >= 0 && y >= 0 && x < pic.w && y < pic.h && pic.rgba[(y * pic.w + x) * 4 + 3]) return pic;
  }
  return null;
}

/** The ground cell drawn at a screen pixel. */
function cellAt(px: number, py: number): { ci: number; cj: number } | null {
  if (px < 0 || py < 0 || px >= ground.w || py >= ground.h) return null;
  const cell = ground.cell[py * ground.w + px];
  return cell < 0 ? null : { ci: cell % shape.w, cj: Math.floor(cell / shape.w) };
}

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

function paintRoof(px: number, py: number, start: boolean): void {
  // A press on a roof takes it away, patch by patch as the drag passes over them; elsewhere it roofs the cells dragged over.
  const hit = picAt(px, py, (p) => !!p.roof);
  if (start) painting = !hit;
  if (!painting && hit) for (const k of hit.roof!.cells) roofs.delete(k);
  const c = cellAt(px, py);
  if (painting && c && !hit) roofs.add(`${c.ci},${c.cj}`);
  roofPics.clear();

}

function paint(e: Edge, on: boolean): void {
  const k = edgeKey(e);
  if (on === walls.has(k)) return;
  if (on) walls.set(k, e);
  else { walls.delete(k); pics.delete(k); }

}

// ------------------------------------------------------------------ page

/** The whole frame, from which the viewport shows its part. */
const full = document.createElement('canvas');
const vp = new Viewport({
  zoom: 3,
  press: ({ x, y }, start) => {
    const px = Math.floor(x), py = Math.floor(y);
    if (P.paint === 'roof') return paintRoof(px, py, start);
    const hit = pickEdge(px, py);
    if (start) painting = hit ? !walls.has(edgeKey(hit.edge)) : null;
    if (hit && painting !== null) paint(hit.edge, painting);
  },
});
vp.canvas.style.cursor = 'crosshair';
document.querySelector('main')!.append(vp.el);

/** Puts the camera on the walker. */
function lookAtWalker(): void {
  const o = ground.origin;
  vp.cam.x = o.x + (walker.x - walker.y) * HALF_W;
  vp.cam.y = o.y + (walker.x + walker.y) * HALF_H - standingHeight(sea, walker.x, walker.y) * LEVEL_PX - 20;
}

function show(): void {
  const r = vp.rect();
  vp.ctx.fillStyle = '#0d3b66';
  vp.ctx.fillRect(0, 0, r.w, r.h);
  vp.ctx.drawImage(full, -r.x, -r.y);
}

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

}

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const sy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  vp.update(dt);
  const moving = !!(sx || sy), run = keys.has('shift');
  if (moving !== walker.moving || run !== walker.run) { walker.moving = moving; walker.run = run; walker.since = now; }
  if (sx || sy) {
    const speed = run ? 80 : 44; // screen pixels per second
    const norm = sx && sy ? Math.SQRT1_2 : 1;
    const vx = ((sx * speed) / HALF_W + (sy * speed) / HALF_H) / 2 * norm;
    const vy = ((sy * speed) / HALF_H - (sx * speed) / HALF_W) / 2 * norm;
    const steps = Math.max(1, Math.ceil((Math.hypot(vx, vy) * dt) / 0.02));
    for (let s = 0; s < steps; s++) {
      tryMove(walker.x + (vx * dt) / steps, walker.y);
      tryMove(walker.x, walker.y + (vy * dt) / steps);
    }
    walker.facing = facingOf(vx, vy, walker.facing);
  }
  // The character blinks and breathes, so the frame is drawn every time.
  render(now);
  show();
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

const rebuild = () => { pics.clear(); roofPics.clear(); };

select('Terrain', [['proving', 'Proving ground'], ['island', 'Generated island']], P.terrain, (v) => { P.terrain = v; loadTerrain(); });
slider('Island seed', 1, 30, 1, P.islandSeed, (v) => { P.islandSeed = v; if (P.terrain === 'island') loadTerrain(); });
slider('Wall height (levels)', 1, 8, 1, P.height, (v) => { P.height = v; rebuild(); });
select('Top', [['slope', 'follows the slope'], ['stepped', 'steps by whole levels'], ['flat', 'flat']], P.top, (v) => { P.top = v; rebuild(); });
slider('Overhang (px)', 0, 8, 1, P.overhang, (v) => { P.overhang = v; rebuild(); });
slider('Plank seed', 1, 40, 1, P.seed, (v) => { P.seed = v; rebuild(); });
select('Sort', [['box', 'boxes on the plan'], ['scalar', 'scalar i + j']], P.sort, (v) => { P.sort = v; });
slider('Collision padding (tiles)', 0, 0.5, 0.02, P.pad, (v) => (P.pad = v), (v) => v.toFixed(2));
select('Paint', [['walls', 'walls on edges'], ['roof', 'roof on cells']], P.paint, (v) => (P.paint = v));
slider('Roof rise (levels)', 0, 6, 1, P.rise, (v) => { P.rise = v; roofPics.clear(); });
slider('Roof eaves (tiles)', 0, 0.6, 0.05, P.eaves, (v) => { P.eaves = v; roofPics.clear(); }, (v) => v.toFixed(2));
setCharacter(pickedCharacter() ?? '');
select('Character', people().map((c) => [c.id, c.name] as [string, string]), P.character, setCharacter);
const check = document.createElement('label');
check.className = 'check';
const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: P.grid });
box.addEventListener('change', () => { P.grid = box.checked; });
check.append(box, 'Show cell edges');
panel.append(check);
const buttons = document.createElement('div');
buttons.className = 'buttons';
button('Clear', () => { walls.clear(); roofs.clear(); rebuild(); }, buttons);
button('Preset', () => { if (P.terrain === 'proving') { presetWalls(); presetRoofs(); rebuild(); } }, buttons);
button('Reset walker', () => { resetWalker(); lookAtWalker(); }, buttons);
panel.append(buttons);
const help = document.createElement('div');
help.className = 'help';
help.innerHTML =
  'Walls: click or drag on a cell edge to add planks, on a wall to remove it. Roof: drag over cells to roof them, press a roof to take it off.<br>Pinch or Ctrl+scroll zooms, two fingers or scrolling pans.<br><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows walk, <kbd>Shift</kbd> runs, <kbd>R</kbd> resets.<br><br>' +
  'Things to try: walk along the pen and its door in the "scalar" sort and look at the corners; set padding to 0 and push the walker into a wall; raise overhang while padding stays small.';
panel.append(help);

loadTerrain();
// For poking at it from the console or a test script.
Object.assign(window, { proto: { walker, P, walls, roofs, vp, rebuild } });
requestAnimationFrame(loop);
