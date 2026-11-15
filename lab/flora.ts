import { hexOf, PALETTE, type Cell, type PaletteKey } from './palette.ts';

// Plants for the island, drawn the way the characters are: a language model writes a small
// description of parts (stems, leaves, rounded masses, tiny stamps), and fixed rules grow them
// in 3D, project them in the same 2:1 view and paint them with the same palette and shading.
// Nothing is drawn per frame or per variant: wind, variation and drying out are rules too.

// ------------------------------------------------------------------ format

export const CATEGORIES = ['palm', 'grass', 'cactus', 'jungle'] as const;
export type Category = (typeof CATEGORIES)[number];

export const STEM_TEXTURES = ['plain', 'rings', 'ribs', 'spines', 'bark'] as const;
export const LEAF_SHAPES = ['frond', 'blade', 'broad', 'needle'] as const;
export const LEAF_TEXTURES = ['plain', 'holes', 'split', 'striped'] as const;
export const BLOB_TEXTURES = ['smooth', 'clumps', 'ribs', 'spines', 'dots'] as const;

interface Common {
  count: number;
  /** Degrees the copies are spread over around the vertical axis. 360 is all round; less is a fan. */
  around: number;
  /** Direction in degrees: 0 to the right of the screen, 90 towards the viewer, 180 left, 270 away. */
  turn: number;
  /** Where on the parent: 0 the bottom, 1 the top. A range spreads the copies between. */
  at: [number, number];
  /** Distance from the parent's centre line, in pixels. */
  out: number;
  /** Random variation between copies and between variants, 0 to 1. */
  jitter: number;
  /** How much the wind moves it, 0 to 2. */
  sway: number;
  color: PaletteKey;
  accent: PaletteKey | null;
}

export interface Stem extends Common {
  type: 'stem';
  length: number;
  width: [number, number];
  /** Degrees from vertical, towards `turn`. */
  lean: number;
  /** Degrees added to the lean over the length: positive bends further over, negative back up. */
  curve: number;
  texture: (typeof STEM_TEXTURES)[number];
  cap: 'flat' | 'round' | 'point';
  children: Part[];
}

export interface Leaf extends Common {
  type: 'leaf';
  shape: (typeof LEAF_SHAPES)[number];
  length: number;
  width: number;
  /** Degrees above horizontal where the leaf starts. */
  rise: number;
  /** Degrees the leaf bends down by its tip. */
  droop: number;
  texture: (typeof LEAF_TEXTURES)[number];
}

export interface Blob extends Common {
  type: 'blob';
  /** Width and height on screen, in pixels. */
  size: [number, number];
  texture: (typeof BLOB_TEXTURES)[number];
  children: Part[];
}

export interface StampPart extends Common {
  type: 'stamp';
  cells: (Cell | null)[][];
  /** Column and row of the pixel that sits on the attachment point. */
  anchor: [number, number];
}

export type Part = Stem | Leaf | Blob | StampPart;

export interface Plant {
  name: string;
  category: Category;
  parts: Part[];
}

export interface CompiledPlant {
  plant: Plant;
  /** What was out of range and clamped. */
  repairs: string[];
}

const DEFAULT_SWAY = { stem: 0.3, leaf: 1, blob: 0.2, stamp: 0.6 } as const;
const MAX_DEPTH = 4;
const MAX_ELEMENTS = 600;

/**
 * Checks a plant written by the model and fills in defaults. Unknown names and colours are
 * errors; numbers outside their range are clamped and reported.
 */
export function compilePlant(input: any): CompiledPlant {
  const repairs: string[] = [];
  if (!input || typeof input !== 'object') throw new Error('a plant must be an object');
  const name = String(input.name ?? 'Unnamed plant');
  if (!(CATEGORIES as readonly string[]).includes(input.category)) throw new Error(`unknown category "${input.category}"`);
  if (!Array.isArray(input.parts) || !input.parts.length) throw new Error('parts must be a non-empty list');
  let elements = 0;

  const num = (v: unknown, lo: number, hi: number, fallback: number, what: string): number => {
    if (v === undefined || v === null) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${what} must be a number`);
    if (n < lo || n > hi) repairs.push(`${what} ${n} was clamped to ${lo}–${hi}`);
    return Math.max(lo, Math.min(hi, n));
  };
  const key = (v: unknown, what: string): PaletteKey => {
    if (typeof v !== 'string' || !(v in PALETTE) || ['ink', 'mouth', 'tooth', 'blush'].includes(v)) throw new Error(`${what}: "${String(v)}" is not a palette colour`);
    return v as PaletteKey;
  };
  const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T, what: string): T => {
    if (v === undefined || v === null) return fallback;
    if (!(list as readonly unknown[]).includes(v)) throw new Error(`${what}: "${String(v)}" is not one of ${list.join(', ')}`);
    return v as T;
  };

  const part = (raw: any, path: string, depth: number, copies: number): Part => {
    if (!raw || typeof raw !== 'object') throw new Error(`${path} must be an object`);
    const type = raw.type;
    if (!['stem', 'leaf', 'blob', 'stamp'].includes(type)) throw new Error(`${path}: unknown type "${type}"`);
    const count = Math.round(num(raw.count, 1, 40, 1, `${path}.count`));
    const total = copies * count;
    elements += total;
    if (elements > MAX_ELEMENTS) throw new Error(`too many parts: more than ${MAX_ELEMENTS} once copies are counted`);
    const atRaw = raw.at;
    const at: [number, number] = Array.isArray(atRaw)
      ? [num(atRaw[0], 0, 1, 1, `${path}.at`), num(atRaw[1], 0, 1, 1, `${path}.at`)]
      : [num(atRaw, 0, 1, 1, `${path}.at`), num(atRaw, 0, 1, 1, `${path}.at`)];
    const common = {
      count,
      around: num(raw.around, 0, 360, count > 1 ? 360 : 0, `${path}.around`),
      turn: num(raw.turn, -360, 720, 0, `${path}.turn`),
      at,
      out: num(raw.out, 0, 30, 0, `${path}.out`),
      jitter: num(raw.jitter, 0, 1, 0.3, `${path}.jitter`),
      sway: num(raw.sway, 0, 2, DEFAULT_SWAY[type as keyof typeof DEFAULT_SWAY], `${path}.sway`),
      color: type === 'stamp' ? ('white' as PaletteKey) : key(raw.color, `${path}.color`),
      accent: raw.accent == null ? null : key(raw.accent, `${path}.accent`),
    };
    const children = (list: unknown): Part[] => {
      if (list == null) return [];
      if (!Array.isArray(list)) throw new Error(`${path}.children must be a list`);
      if (depth >= MAX_DEPTH) throw new Error(`${path}: parts may be nested at most ${MAX_DEPTH} deep`);
      return list.map((c, i) => part(c, `${path}.children[${i}]`, depth + 1, total));
    };
    if (type === 'stem') {
      const w = raw.width;
      const width: [number, number] = Array.isArray(w)
        ? [num(w[0], 1, 12, 3, `${path}.width`), num(w[1], 1, 12, 2, `${path}.width`)]
        : [num(w, 1, 12, 3, `${path}.width`), num(w, 1, 12, 3, `${path}.width`)];
      return {
        ...common, type, width,
        length: num(raw.length, 2, 95, 10, `${path}.length`),
        lean: num(raw.lean, 0, 110, 0, `${path}.lean`),
        curve: num(raw.curve, -150, 150, 0, `${path}.curve`),
        texture: oneOf(raw.texture, STEM_TEXTURES, 'plain', `${path}.texture`),
        cap: oneOf(raw.cap, ['flat', 'round', 'point'] as const, 'flat', `${path}.cap`),
        children: children(raw.children),
      };
    }
    if (raw.children != null && (type === 'leaf' || type === 'stamp')) throw new Error(`${path}: a ${type} cannot have children`);
    if (type === 'leaf') {
      return {
        ...common, type,
        shape: oneOf(raw.shape, LEAF_SHAPES, 'blade', `${path}.shape`),
        length: num(raw.length, 2, 45, 8, `${path}.length`),
        width: num(raw.width, 1, 10, 2, `${path}.width`),
        rise: num(raw.rise, -60, 90, 30, `${path}.rise`),
        droop: num(raw.droop, 0, 200, 30, `${path}.droop`),
        texture: oneOf(raw.texture, LEAF_TEXTURES, 'plain', `${path}.texture`),
      };
    }
    if (type === 'blob') {
      const s = raw.size;
      const size: [number, number] = Array.isArray(s)
        ? [num(s[0], 2, 48, 8, `${path}.size`), num(s[1], 2, 48, 8, `${path}.size`)]
        : [num(s, 2, 48, 8, `${path}.size`), num(s, 2, 48, 8, `${path}.size`)];
      return { ...common, type, size, texture: oneOf(raw.texture, BLOB_TEXTURES, 'smooth', `${path}.texture`), children: children(raw.children) };
    }
    // A stamp: a small grid written as text, like the head and tool stamps of the characters.
    const legend: Record<string, PaletteKey> = {};
    for (const [ch, k] of Object.entries(raw.legend ?? {})) {
      if (ch.length !== 1 || !/[A-Za-z]/.test(ch)) throw new Error(`${path}.legend: "${ch}" must be one letter`);
      legend[ch.toUpperCase()] = key(k, `${path}.legend.${ch}`);
    }
    if (!Array.isArray(raw.rows) || !raw.rows.length || raw.rows.some((r: unknown) => typeof r !== 'string')) throw new Error(`${path}.rows must be a list of text rows`);
    if (raw.rows.length > 16 || raw.rows.some((r: string) => r.length > 16)) throw new Error(`${path}: a stamp is at most 16 by 16`);
    const cells = (raw.rows as string[]).map((row) => [...row].map((ch): Cell | null => {
      if (ch === '.' || ch === ' ') return null;
      const k = legend[ch.toUpperCase()];
      if (!k) throw new Error(`${path}: "${ch}" is not in the legend`);
      return { key: k, shade: ch !== ch.toUpperCase() };
    }));
    const width = Math.max(...cells.map((r) => r.length));
    const anchor: [number, number] = Array.isArray(raw.anchor)
      ? [Math.round(num(raw.anchor[0], 0, 15, 0, `${path}.anchor`)), Math.round(num(raw.anchor[1], 0, 15, 0, `${path}.anchor`))]
      : [Math.floor(width / 2), cells.length - 1];
    return { ...common, type: 'stamp', cells, anchor };
  };

  const parts = input.parts.map((p: unknown, i: number) => part(p, `parts[${i}]`, 1, 1));
  return { plant: { name, category: input.category, parts }, repairs };
}

/** Compiles one candidate, turning any failure into a message instead of throwing. */
export function tryPlant(input: unknown): { ok: true; compiled: CompiledPlant } | { ok: false; error: string } {
  try {
    return { ok: true, compiled: compilePlant(input) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

// ------------------------------------------------------------------ growing

/** Plant space: u to the right of the screen, y up, v towards the viewer. Pixels. */
type V3 = [number, number, number];

interface Base {
  /**
   * How much the element bends with the whole plant. It is the value of the part that grows from
   * the ground, shared by everything attached to it, so leaves stay on their trunk.
   */
  bend: number;
  /** Painting order: larger is nearer the viewer. */
  depth: number;
  flex: number;
  /** Wind phase, so neighbouring leaves do not move in step. */
  phase: number;
}
interface StemEl extends Base { kind: 'stem'; points: V3[]; widths: number[]; color: PaletteKey; accent: PaletteKey | null; texture: Stem['texture']; cap: Stem['cap'] }
interface LeafEl extends Base { kind: 'leaf'; points: V3[]; shape: Leaf['shape']; width: number; color: PaletteKey; accent: PaletteKey | null; texture: Leaf['texture']; back: boolean; hang: number; tears: Set<number> }
interface BlobEl extends Base { kind: 'blob'; center: V3; size: [number, number]; color: PaletteKey; accent: PaletteKey | null; texture: Blob['texture']; clumps: { dx: number; dy: number; r: number; color: PaletteKey }[]; seed: number }
interface StampEl extends Base { kind: 'stamp'; at: V3; cells: (Cell | null)[][]; anchor: [number, number] }
type El = StemEl | LeafEl | BlobEl | StampEl;

export interface Grown {
  /** The size it was grown at; see `canvasFor`. */
  size: number;
  elements: El[];
  /** Footprint for the ground shadow: stems cast their own, leaves and masses one canopy shadow. */
  shadow: { u: number; v: number; r: number; canopy: boolean }[];
}

function hashOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rad = (d: number) => (d * Math.PI) / 180;

/** How greens turn as a plant dries: first towards olive, then towards straw or brown. */
const DRYING: Partial<Record<PaletteKey, [PaletteKey, PaletteKey]>> = {
  leaf: ['moss', 'straw'],
  green: ['moss', 'tan'],
  jungle: ['moss', 'tan'],
  lime: ['straw', 'tan'],
  sage: ['moss', 'tan'],
  teal: ['sage', 'moss'],
  moss: ['tan', 'brown'],
};

export interface GrowOptions {
  /** Which variant: each seed places and sizes the copies a little differently. Odd seeds are mirrored. */
  seed?: number;
  /** 0 lush to 1 dried out. Leaves droop, brown and drop; flowers go first. */
  dryness?: number;
  /**
   * 0.5 to 2, scales the plant. Lengths, widths and spacing grow by rule, so pixels stay one
   * pixel and textures keep their spacing; hand-drawn stamps keep their size. The same seed keeps
   * the same shape at every size.
   */
  size?: number;
}

export const SIZE_MIN = 0.5;
export const SIZE_MAX = 2;

/** Turns the description into concrete geometry. Wind is applied later, when drawing. */
export function grow(plant: Plant, options: GrowOptions = {}): Grown {
  const seed = options.seed ?? 0;
  const dry = Math.max(0, Math.min(1, options.dryness ?? 0));
  const k = Math.max(SIZE_MIN, Math.min(SIZE_MAX, options.size ?? 1));
  const random = rng(hashOf(plant.name) ^ Math.imul(seed + 1, 2654435761));
  const mirror = seed % 2 === 1;
  const elements: El[] = [];
  const shadow: Grown['shadow'] = [];
  const azimuth = (a: number) => (mirror ? 180 - a : a);
  const dried = (k: PaletteKey): PaletteKey => {
    const chain = DRYING[k];
    if (!chain || !dry) return k;
    const r = random();
    return r < dry * 0.5 ? chain[1] : r < dry ? chain[0] : k;
  };
  const vary = (value: number, part: Common, spread: number) => value * (1 + (random() - 0.5) * part.jitter * spread);

  type Anchor = { at: (t: number) => V3; heading: number };
  /** What a part inherits from the parts it grows on. */
  type Chain = { bend: number | null; rigid: boolean };
  // Hard plants do not move in the wind at all, whatever the description says: cacti, and any
  // ribbed or spiny part together with everything that grows on it.
  const hard = (part: Part) => (part.type === 'stem' || part.type === 'blob') && (part.texture === 'ribs' || part.texture === 'spines');
  const motion = (part: Part, chain: Chain) => {
    const rigid = chain.rigid || hard(part);
    return { rigid, bend: rigid ? 0 : chain.bend ?? part.sway, flex: rigid ? 0 : part.sway };
  };

  const place = (part: Part, anchor: Anchor, chain: Chain) => {
    for (let i = 0; i < part.count; i++) {
      const spread = part.around >= 360 ? 360 / part.count : part.count > 1 ? part.around / (part.count - 1) : 0;
      let az = part.around >= 360 ? part.turn + (360 * i) / part.count : part.count > 1 ? part.turn - part.around / 2 + spread * i : part.turn;
      az += (random() - 0.5) * part.jitter * Math.max(spread, 30);
      az = azimuth(az);
      const t = part.count > 1 ? part.at[0] + ((part.at[1] - part.at[0]) * i) / (part.count - 1) : (part.at[0] + part.at[1]) / 2;
      const base = anchor.at(Math.max(0, Math.min(1, t + (part.at[0] !== part.at[1] ? (random() - 0.5) * part.jitter * 0.1 : 0))));
      const out = vary(part.out, part, 0.6) * k;
      const origin: V3 = [base[0] + Math.cos(rad(az)) * out, base[1], base[2] + Math.sin(rad(az)) * out];
      const phase = random() * Math.PI * 2;
      const m = motion(part, chain);
      if (part.type === 'stem') growStem(part, origin, az, phase, m);
      else if (part.type === 'leaf') growLeaf(part, origin, az, phase, m);
      else if (part.type === 'blob') growBlob(part, origin, az, phase, m);
      else growStamp(part, origin, phase, m);
    }
  };

  const growStem = (part: Stem, origin: V3, az: number, phase: number, m: { rigid: boolean; bend: number; flex: number }) => {
    const length = Math.max(2, Math.round(vary(part.length, part, 0.4) * k));
    const lean = part.lean + (random() - 0.5) * part.jitter * 16;
    const curve = part.curve * (1 + (random() - 0.5) * part.jitter * 0.6);
    const points: V3[] = [origin];
    for (let i = 1; i <= length; i++) {
      const theta = rad(lean + (curve * i) / length);
      const p = points[i - 1];
      points.push([p[0] + Math.sin(theta) * Math.cos(rad(az)), p[1] + Math.cos(theta), p[2] + Math.sin(theta) * Math.sin(rad(az))]);
    }
    const widths = points.map((_, i) => Math.max(1, (part.width[0] + ((part.width[1] - part.width[0]) * i) / length) * k));
    elements.push({
      kind: 'stem', points, widths, color: dried(part.color), accent: part.accent, texture: part.texture, cap: part.cap,
      depth: points[points.length - 1][2], bend: m.bend, flex: m.flex, phase,
    });
    if (origin[1] < 1) shadow.push({ u: origin[0], v: origin[2], r: Math.max(2, widths[0] * 0.8), canopy: false });
    const at = (t: number): V3 => points[Math.round(t * length)];
    for (const child of part.children) place(child, { at, heading: az }, { bend: m.bend, rigid: m.rigid });
  };

  const growLeaf = (part: Leaf, origin: V3, az: number, phase: number, m: { rigid: boolean; bend: number; flex: number }) => {
    // A dry plant sheds leaves, but never all of them.
    if (part.count > 2 && random() < dry * 0.3) return;
    const length = Math.max(2, vary(part.length, part, 0.4) * k);
    const rise = part.rise + (random() - 0.5) * part.jitter * 24 - dry * 12;
    const droop = Math.max(0, part.droop + (random() - 0.5) * part.jitter * 36 + dry * 30);
    const steps = Math.ceil(length);
    const points: V3[] = [origin];
    for (let s = 1; s <= steps; s++) {
      // The bend increases towards the tip, the way a leaf arches under its own weight.
      const e = rad(rise - droop * Math.pow(s / steps, 1.4));
      const p = points[s - 1];
      const d = length / steps;
      points.push([p[0] + Math.cos(e) * Math.cos(rad(az)) * d, p[1] + Math.sin(e) * d, p[2] + Math.cos(e) * Math.sin(rad(az)) * d]);
    }
    const tears = new Set<number>();
    if (part.texture === 'split' || dry > 0.4) {
      for (let s = 3; s < steps - 1; s++) if (random() < (part.texture === 'split' ? 0.22 : 0) + dry * 0.12) tears.add(s);
    }
    const mid = points[Math.floor(points.length / 2)];
    elements.push({
      kind: 'leaf', points, shape: part.shape, width: Math.max(1, vary(part.width, part, 0.3) * k), color: dried(part.color), accent: part.accent,
      texture: part.texture, back: Math.sin(rad(az)) < -0.3, hang: 30 + dry * 30, tears,
      depth: mid[2] + (Math.sin(rad(az)) < -0.3 ? -0.5 : 0.5), bend: m.bend, flex: m.flex, phase,
    });
    shadow.push({ u: mid[0], v: mid[2], r: length * 0.3, canopy: true });
  };

  const growBlob = (part: Blob, origin: V3, az: number, phase: number, m: { rigid: boolean; bend: number; flex: number }) => {
    const size: [number, number] = [Math.max(2, vary(part.size[0], part, 0.3) * k), Math.max(2, vary(part.size[1], part, 0.3) * k)];
    // A blob sits on its attachment point, so a bush rests on the ground and a fruit hangs from its stalk.
    const center: V3 = [origin[0], origin[1] + size[1] / 2, origin[2]];
    const clumps: BlobEl['clumps'] = [];
    if (part.texture === 'clumps') {
      const rx = size[0] / 2;
      const ry = size[1] / 2;
      const n = Math.max(3, Math.min(16, Math.round((rx * ry) / 10)));
      for (let i = 0; i < n; i++) {
        const a = random() * Math.PI * 2;
        const d = Math.sqrt(random()) * 0.62;
        clumps.push({ dx: Math.cos(a) * d * rx, dy: Math.sin(a) * d * ry, r: Math.max(1.6, Math.min(rx, ry) * (0.42 + random() * 0.18)), color: dried(part.color) });
      }
      clumps.sort((a, b) => a.dy - b.dy);
    }
    const isGreen = !!DRYING[part.color];
    if (!isGreen && part.texture !== 'clumps' && random() < dry * 0.5 && part.size[0] < 8) return; // fruit and flowers drop
    elements.push({
      kind: 'blob', center, size, color: dried(part.color), accent: part.accent, texture: part.texture, clumps, seed: Math.floor(random() * 1e9),
      depth: center[2] + 0.2, bend: m.bend, flex: m.flex, phase,
    });
    shadow.push({ u: center[0], v: center[2], r: size[0] * 0.55, canopy: true });
    const at = (t: number): V3 => [center[0], center[1] + (t - 0.5) * size[1], center[2]];
    for (const child of part.children) place(child, { at, heading: az }, { bend: m.bend, rigid: m.rigid });
  };

  const growStamp = (part: StampPart, origin: V3, phase: number, m: { rigid: boolean; bend: number; flex: number }) => {
    if (random() < dry * 0.5) return; // flowers go first
    const cells = mirror ? part.cells.map((row) => [...row].reverse()) : part.cells;
    const width = Math.max(...part.cells.map((r) => r.length));
    const anchor: [number, number] = mirror ? [width - 1 - part.anchor[0], part.anchor[1]] : part.anchor;
    elements.push({ kind: 'stamp', at: origin, cells, anchor, depth: origin[2] + 0.6, bend: m.bend, flex: m.flex, phase });
  };

  const ground: Anchor = { at: () => [0, 0, 0], heading: 0 };
  const root: Chain = { bend: null, rigid: plant.category === 'cactus' };
  for (const part of plant.parts) place(part, ground, root);
  return { size: k, elements, shadow };
}

// ------------------------------------------------------------------ drawing

export const FLORA_W = 128;
export const FLORA_H = 144;
/** Where the plant's root sits on the canvas. */
export const FLORA_ORIGIN = { x: 64, y: 126 };
/** Frames in one wind loop. */
export const FRAMES = 8;
const SHADOW = '#2a1c3a38';

/** The canvas a plant of this size needs, and where its root sits on it. Size 1 and below fit the standard one. */
export function canvasFor(size = 1): { w: number; h: number; origin: { x: number; y: number } } {
  const k = Math.max(1, size);
  const w = Math.ceil((FLORA_W * k) / 2) * 2;
  const h = Math.ceil(FLORA_H * k);
  return { w, h, origin: { x: w / 2, y: h - Math.ceil((FLORA_H - FLORA_ORIGIN.y) * k) } };
}

export class Raster {
  readonly pixels: (string | null)[];
  /** Pixels that fell outside the canvas. */
  lost = 0;
  lastLost: [number, number] | null = null;
  readonly w: number;
  readonly h: number;
  constructor(w = FLORA_W, h = FLORA_H) {
    this.w = w;
    this.h = h;
    this.pixels = new Array(w * h).fill(null);
  }
  set(x: number, y: number, color: string): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
      if (!color.endsWith('38')) {
        this.lost++;
        this.lastLost = [x, y];
      }
      return;
    }
    this.pixels[y * this.w + x] = color;
  }
  clear(x: number, y: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.pixels[y * this.w + x] = null;
  }
  get(x: number, y: number): string | null {
    return this.pixels[y * this.w + x] ?? null;
  }
}

export interface DrawPlantOptions {
  frame?: number;
  /** 0 calm, 1 a breeze, 2.5 a storm. */
  wind?: number;
  origin?: { x: number; y: number };
}

const tone = (key: PaletteKey, t: 'base' | 'shade' | 'light') => PALETTE[key][t];

/** Paints a grown plant for one frame of the wind loop. */
export function drawPlant(grown: Grown, options: DrawPlantOptions = {}, raster = new Raster(canvasFor(grown.size).w, canvasFor(grown.size).h)): Raster {
  const frame = options.frame ?? 0;
  const wind = options.wind ?? 0;
  const ox = options.origin?.x ?? canvasFor(grown.size).origin.x;
  const oy = options.origin?.y ?? canvasFor(grown.size).origin.y;
  const phi = (2 * Math.PI * frame) / FRAMES;

  // The whole plant bends with height, by the amount of the part it grows from, so everything
  // attached moves together. Leaves, fruit and flowers also flutter on their own; stems do not,
  // or their tips would leave what grows on them behind. A storm adds a steady lean.
  const sway = (p: V3, t: number, el: El): number => {
    if (!el.bend && !el.flex) return 0;
    const h = Math.max(0, p[1]) / 60;
    const bend = wind * Math.pow(h, 1.3) * (1.3 * Math.sin(phi) + 0.35 * wind) * Math.min(1, el.bend * 1.6);
    const flutter = el.kind === 'stem' ? 0 : wind * el.flex * 1.3 * t * t * Math.sin(phi + el.phase);
    return bend + flutter;
  };
  const project = (p: V3, du = 0) => ({ x: ox + p[0] + du, y: oy - p[1] + p[2] * 0.5 });

  // Ground shadow under the stems and one under the canopy, flattened 2:1 like the ground.
  // Leaves round a crown would each leave a ring of shadows with a hole in the middle, so they
  // are merged into one ellipse that covers them.
  const canopy = grown.shadow.filter((s) => s.canopy);
  const shadows = grown.shadow.filter((s) => !s.canopy);
  if (canopy.length) {
    const u = canopy.reduce((a, s) => a + s.u, 0) / canopy.length;
    const v = canopy.reduce((a, s) => a + s.v, 0) / canopy.length;
    const r = Math.max(...canopy.map((s) => Math.hypot(s.u - u, s.v - v) * 0.85 + s.r));
    shadows.push({ u, v, r, canopy: true });
  }
  for (const s of shadows) {
    const cx = ox + s.u;
    const cy = oy + s.v * 0.5;
    const r = Math.min(40, Math.max(2, s.r));
    for (let y = Math.floor(cy - r / 2); y <= Math.ceil(cy + r / 2); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (((x - cx) / r) ** 2 + ((y - cy) / (r / 2)) ** 2 <= 1) raster.set(x, y, SHADOW);
      }
    }
  }

  const sorted = [...grown.elements].sort((a, b) => a.depth - b.depth);
  for (const el of sorted) {
    if (el.kind === 'stem') drawStem(raster, el, (p, t) => project(p, sway(p, t, el)));
    else if (el.kind === 'leaf') drawLeaf(raster, el, (p, t) => project(p, sway(p, t, el)));
    else if (el.kind === 'blob') drawBlob(raster, el, project(el.center, sway(el.center, 0.3, el)));
    else drawStampEl(raster, el, project(el.at, sway(el.at, 0.5, el)));
  }
  return raster;
}

type Projector = (p: V3, t: number) => { x: number; y: number };

/** Walks the pixels between two points, inclusive of the second. */
function line(a: { x: number; y: number }, b: { x: number; y: number }, visit: (x: number, y: number, k: number) => void): void {
  let x0 = Math.round(a.x);
  let y0 = Math.round(a.y);
  const x1 = Math.round(b.x);
  const y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const n = Math.max(dx, -dy) || 1;
  let i = 0;
  for (;;) {
    visit(x0, y0, i / n);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    i++;
  }
}

/** A stem is drawn as runs of pixels across it, one per step, lit on the left and shaded on the right. */
function drawStem(r: Raster, el: StemEl, at: Projector): void {
  const n = el.points.length - 1;
  const screen = el.points.map((p, i) => at(p, i / n));
  const accent = el.accent ?? (el.texture === 'spines' ? 'cream' : el.color);
  const hash = (a: number, b: number) => ((Math.imul(a + 17, 73856093) ^ Math.imul(b + 5, 19349663)) >>> 0) % 100 / 100;
  for (let i = 0; i < n; i++) {
    const a = screen[i];
    const b = screen[i + 1];
    const tall = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
    line(a, b, (x, y, f) => {
      const step = i + f;
      let w = Math.max(1, Math.round(el.widths[Math.min(n, Math.round(step))]));
      const fromTip = n - step;
      if (el.cap === 'round' && fromTip < w / 2) w = Math.max(1, Math.round(w * Math.sqrt(Math.max(0, 1 - ((w / 2 - fromTip) / (w / 2)) ** 2)) + 0.4));
      if (el.cap === 'point' && fromTip < w) w = Math.max(1, Math.round(fromTip));
      const ring = el.texture === 'rings' && Math.round(step) % 3 === 0 && step > 0.5;
      for (let k = 0; k < w; k++) {
        const px = tall ? Math.floor(x - (w - 1) / 2) + k : x;
        const py = tall ? y : Math.floor(y - (w - 1) / 2) + k;
        const far = k === w - 1 && w > 1;
        const near = k === 0 && w >= 3;
        let t: 'base' | 'shade' | 'light' = far ? 'shade' : near ? 'light' : 'base';
        let key = el.color;
        if (ring && !near) { t = 'shade'; if (el.accent) key = el.accent; }
        if (el.texture === 'ribs' && w >= 4 && k > 0 && k < w - 1 && k % 2 === 0) t = 'shade';
        if (el.texture === 'bark' && hash(k, Math.round(step)) < 0.18) t = 'shade';
        r.set(px, py, tone(key, t));
        if (el.texture === 'spines' && (k === 0 || k === w - 1) && Math.round(step) % 3 === 1 && w >= 3) {
          const ox = tall ? (k === 0 ? -1 : 1) : 0;
          const oy = tall ? 0 : k === 0 ? -1 : 1;
          r.set(px + ox, py + oy, tone(accent, 'light'));
        }
      }
    });
  }
}

/** Leaves: fronds are a rib with leaflets hanging from both sides; the other shapes are filled strips. */
function drawLeaf(r: Raster, el: LeafEl, at: Projector): void {
  const n = el.points.length - 1;
  const screen = el.points.map((p, i) => at(p, i / n));
  const color = el.color;
  if (el.shape === 'frond') {
    const hang = rad(el.hang);
    for (let s = 2; s < n; s++) {
      if (s % 2 === 1 || el.tears.has(s)) continue; // gaps between leaflets
      const t = s / n;
      const p = el.points[s];
      const tan = sub(el.points[Math.min(n, s + 1)], el.points[s - 1]);
      const side = norm([-tan[2], 0, tan[0]]);
      const len = el.width * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.55);
      if (len < 0.6) continue;
      const ft = norm(tan);
      for (const sign of [1, -1]) {
        // Leaflets lean out to the side, sweep towards the tip and hang a little.
        const d = norm([side[0] * sign * Math.cos(hang) + ft[0] * 0.55, -Math.sin(hang) + ft[1] * 0.55, side[2] * sign * Math.cos(hang) + ft[2] * 0.55]);
        const tip: V3 = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
        const from = at(p, t);
        const to = at(tip, Math.min(1, t + 0.08));
        // The half of the frond below its rib is the shaded underside; a frond pointing away is all shade.
        const c = tone(color, el.back || to.y > from.y + 0.5 ? 'shade' : 'base');
        line(from, to, (x, y) => r.set(x, y, c));
      }
    }
    // The rib on top, lit where the frond faces the light.
    for (let s = 0; s < n; s++) {
      line(screen[s], screen[s + 1], (x, y) => r.set(x, y, tone(el.accent ?? color, el.back ? 'shade' : 'light')));
    }
    return;
  }
  for (let s = 0; s < n; s++) {
    const a = screen[s];
    const b = screen[s + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Across the leaf, pointing down the screen: that half is the shaded underside.
    let nx = -dy / len;
    let ny = dx / len;
    if (ny < 0 || (Math.abs(ny) < 0.2 && nx < 0)) { nx = -nx; ny = -ny; }
    const samples = Math.max(1, Math.ceil(len * 2));
    for (let q = 0; q < samples; q++) {
      const f = q / samples;
      const t = (s + f) / n;
      const cx = a.x + dx * f;
      const cy = a.y + dy * f;
      let w: number;
      if (el.shape === 'broad') w = el.width * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02)), 0.6);
      else if (el.shape === 'needle') w = Math.min(2, el.width) * (1 - t * 0.5);
      else w = el.width * Math.pow(1 - t, 0.75);
      w = Math.max(1, Math.round(w));
      const half = (w - 1) / 2;
      for (let k = -half; k <= half + 0.01; k++) {
        const lower = k > 0.25;
        const rib = Math.abs(k) <= 0.25;
        if (el.texture === 'holes' && w >= 4 && s % 4 === 2 && Math.abs(k) >= 1 && Math.abs(k) < half) continue;
        if (el.tears.has(s) && lower && w >= 3) continue;
        let t2: 'base' | 'shade' | 'light' = el.back || lower ? 'shade' : 'base';
        let key = color;
        if (rib && w >= 3) { t2 = el.back ? 'shade' : el.shape === 'broad' ? 'shade' : 'base'; if (el.accent) key = el.accent; }
        if (rib && el.texture === 'striped' && el.accent) { key = el.accent; t2 = 'base'; }
        if (!el.back && k <= -half + 0.01 && w >= 3 && t > 0.15 && t < 0.85) t2 = 'light';
        if (!el.back && w === 1 && t > 0.8) t2 = 'light';
        r.set(cx + nx * k, cy + ny * k, tone(key, t2));
      }
    }
  }
}

/** Rounded masses: lit at the top left, shaded at the bottom right. A bush is built from clumps. */
function drawBlob(r: Raster, el: BlobEl, c: { x: number; y: number }): void {
  const rx = el.size[0] / 2;
  const ry = el.size[1] / 2;
  const accent = el.accent ?? (el.texture === 'spines' ? 'cream' : 'yellow');
  const hash = (x: number, y: number) => ((Math.imul(x + 31, 73856093) ^ Math.imul(y + 7, 19349663) ^ el.seed) >>> 0) % 1000 / 1000;
  const ellipse = (cx: number, cy: number, ax: number, ay: number, key: PaletteKey, shadeOnly = false) => {
    for (let y = Math.floor(cy - ay); y <= Math.ceil(cy + ay); y++) {
      for (let x = Math.floor(cx - ax); x <= Math.ceil(cx + ax); x++) {
        const nx = (x + 0.5 - cx) / ax;
        const ny = (y + 0.5 - cy) / ay;
        if (nx * nx + ny * ny > 1) continue;
        let t: 'base' | 'shade' | 'light' = 'base';
        if (shadeOnly || 0.55 * nx + 0.8 * ny > 0.45) t = 'shade';
        else if (0.6 * nx + 0.8 * ny < -0.55) t = 'light';
        r.set(x, y, tone(key, t));
      }
    }
  };
  if (el.texture === 'clumps') {
    // The gaps between clumps read as shade, so the inside is filled dark first.
    ellipse(c.x, c.y, rx * 0.85, ry * 0.85, el.color, true);
    for (const k of el.clumps) ellipse(c.x + k.dx, c.y + k.dy, k.r, k.r * 0.9, k.color);
    return;
  }
  ellipse(c.x, c.y, rx, ry, el.color);
  for (let y = Math.floor(c.y - ry); y <= Math.ceil(c.y + ry); y++) {
    for (let x = Math.floor(c.x - rx); x <= Math.ceil(c.x + rx); x++) {
      const nx = (x + 0.5 - c.x) / rx;
      const ny = (y + 0.5 - c.y) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const col = Math.round(x - c.x + rx);
      if (el.texture === 'ribs' && rx >= 3 && col % 3 === 1 && Math.abs(nx) < 0.85 && 0.6 * nx + 0.8 * ny > -0.55) r.set(x, y, tone(el.color, 'shade'));
      if (el.texture === 'dots' && d < 0.75 && hash(x, y) < 0.09) r.set(x, y, tone(accent, 'base'));
      if (el.texture === 'spines' && d > 0.6 && hash(x, y) < 0.16) {
        r.set(x + Math.sign(nx), y + Math.sign(ny), tone(accent, 'light'));
      }
    }
  }
}

function drawStampEl(r: Raster, el: StampEl, c: { x: number; y: number }): void {
  const x0 = Math.round(c.x) - el.anchor[0];
  const y0 = Math.round(c.y) - el.anchor[1];
  el.cells.forEach((row, y) => row.forEach((cell, x) => {
    if (cell) r.set(x0 + x, y0 + y, hexOf(cell));
  }));
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ------------------------------------------------------------------ colours

/** The plant's own colours, most used first, for colour swaps. */
export function plantColors(plant: Plant): PaletteKey[] {
  const tally = new Map<PaletteKey, number>();
  const visit = (parts: Part[], weight: number) => {
    for (const p of parts) {
      const w = weight * p.count;
      if (p.type !== 'stamp') {
        const area = p.type === 'stem' ? p.length * (p.width[0] + p.width[1]) / 2 : p.type === 'leaf' ? p.length * p.width : p.size[0] * p.size[1];
        tally.set(p.color, (tally.get(p.color) ?? 0) + area * w);
        if (p.type !== 'leaf') visit(p.children, w);
      }
    }
  };
  visit(plant.parts, 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
}

/** A copy with some palette entries replaced. Stamps are recoloured too. */
export function recolorPlant(plant: Plant, swap: Partial<Record<PaletteKey, PaletteKey>>): Plant {
  if (!Object.keys(swap).length) return plant;
  const k = (key: PaletteKey) => swap[key] ?? key;
  const part = (p: Part): Part => {
    const base = { ...p, color: k(p.color), accent: p.accent && k(p.accent) };
    if (p.type === 'stamp') return { ...base, cells: p.cells.map((row) => row.map((c) => c && { ...c, key: k(c.key) })) } as StampPart;
    if (p.type === 'leaf') return base as Leaf;
    return { ...base, children: p.children.map(part) } as Stem | Blob;
  };
  return { ...plant, parts: plant.parts.map(part) };
}
