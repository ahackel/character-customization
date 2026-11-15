import { PALETTE, type Cell, type PaletteKey } from './palette.ts';
import {
  HEAD_FRAME, HEAD_STAMP, LIMB_CELLS, PAINT_H, PAINT_W, TOOL_FRAME, TOOL_STAMP, TORSO_FRAME,
  SLOTS, type Item, type Layout, type Slot, type Stamp, type StampPair,
} from './puppet.ts';

/**
 * Body-part positions in the reference the whole-sprite format shows the model. Paint is read
 * off the sprite at these positions. This is the first base body, which the items in
 * lab/generated were drawn against; regenerating the format description needs new values here.
 */
const REFERENCE: Record<'front' | 'back', Layout> = {
  front: {
    neck: { x: 16, y: 22 }, torso: { x: 16, top: 23, bottom: 34 },
    arms: [{ x: 11, y0: 26, y1: 35 }, { x: 21, y0: 22, y1: 31 }],
    legs: [{ x: 14, y0: 34, y1: 44 }, { x: 18, y0: 32, y1: 42 }],
    handR: { x: 11, y: 35 },
  },
  back: {
    neck: { x: 16, y: 22 }, torso: { x: 16, top: 23, bottom: 34 },
    arms: [{ x: 21, y0: 26, y1: 35 }, { x: 11, y0: 22, y1: 31 }],
    legs: [{ x: 18, y0: 34, y1: 44 }, { x: 14, y0: 32, y1: 42 }],
    handR: { x: 21, y: 35 },
  },
};

/** Tall tools stand on the ground beside the body; short ones are carried in the hand. */
function holdOf(pair: StampPair): 'pole' | 'carry' {
  const rows = pair.front.map((row) => row.some(Boolean));
  return rows.lastIndexOf(true) - rows.indexOf(true) >= 26 ? 'pole' : 'carry';
}

/** Finds the shaft: the middle painted column in the rows around the grip. */
function gripOf(pair: StampPair): { front: number; back: number } {
  const offset = (stamp: Stamp): number => {
    const columns: number[] = [];
    for (let row = TOOL_FRAME.ay - 4; row <= TOOL_FRAME.ay + 2; row++) {
      stamp[row]?.forEach((cell, col) => {
        if (cell) columns.push(col);
      });
    }
    if (!columns.length) return 0;
    columns.sort((a, b) => a - b);
    return columns[Math.floor(columns.length / 2)] - TOOL_FRAME.ax;
  };
  return { front: offset(pair.front), back: offset(pair.back) };
}

/** Result of turning model output into an item. `repairs` lists what had to be fixed automatically. */
export interface Compiled {
  item: Item;
  repairs: string[];
}

const isKey = (k: unknown): k is PaletteKey => typeof k === 'string' && k in PALETTE;
const isSlot = (s: unknown): s is Slot => (SLOTS as readonly string[]).includes(s as string);
const cell = (key: PaletteKey, shade = false): Cell => ({ key, shade });
const blank = (w: number, h: number): Stamp => Array.from({ length: h }, () => Array<Cell | null>(w).fill(null));

function legendOf(input: unknown): Record<string, PaletteKey> {
  const out: Record<string, PaletteKey> = {};
  if (!input || typeof input !== 'object') throw new Error('legend is missing');
  for (const [ch, key] of Object.entries(input as Record<string, unknown>)) {
    if (ch.length !== 1 || !/[A-Za-z]/.test(ch)) throw new Error(`legend character "${ch}" must be one letter`);
    if (!isKey(key)) throw new Error(`"${String(key)}" is not a palette colour`);
    out[ch.toUpperCase()] = key;
  }
  return out;
}

/** Reads a text grid. Rows that are too short or long are padded or cut, and that is reported. */
function grid(rows: unknown, w: number, h: number, legend: Record<string, PaletteKey>, what: string, repairs: string[], align: 'top' | 'bottom' = 'top'): Stamp {
  if (!Array.isArray(rows) || rows.some((r) => typeof r !== 'string')) throw new Error(`${what} must be a list of text rows`);
  let list = rows as string[];
  if (list.some((r) => r.length !== w)) repairs.push(`${what}: ${list.filter((r) => r.length !== w).length} rows were not ${w} wide`);
  if (list.length !== h) {
    repairs.push(`${what}: ${list.length} rows instead of ${h}`);
    const empty = '.'.repeat(w);
    list = align === 'top'
      ? [...list, ...Array(Math.max(0, h - list.length)).fill(empty)].slice(0, h)
      : [...Array(Math.max(0, h - list.length)).fill(empty), ...list].slice(-h);
  }
  return list.map((row) =>
    [...row.padEnd(w, '.').slice(0, w)].map((ch) => {
      if (ch === '.' || ch === ' ') return null;
      const key = legend[ch.toUpperCase()];
      if (!key) throw new Error(`${what}: character "${ch}" is not in the legend`);
      return cell(key, ch !== ch.toUpperCase());
    }),
  );
}

type Frame = { w: number; h: number; ax: number; ay: number };
/** Places a stamp written at one frame size into a larger frame, keeping the anchor in place. */
function embed(stamp: Stamp, from: Frame, to: Frame): Stamp {
  const out = blank(to.w, to.h);
  stamp.forEach((row, y) => row.forEach((c, x) => {
    if (c) out[y - from.ay + to.ay][x - from.ax + to.ax] = c;
  }));
  return out;
}

const count = (stamp: Stamp) => stamp.reduce((n, row) => n + row.filter(Boolean).length, 0);

// ------------------------------------------------------------------ format 1: whole-sprite grids

/**
 * Format 1. The model paints the item over the standing character, front and back, as two
 * 32 x 48 grids. The paint is then split by body part so it can follow the pose:
 * head items become head stamps, tops become a torso stamp plus a sleeve strip, and so on.
 */
export function compileSprite(input: any): Compiled {
  const repairs: string[] = [];
  if (!isSlot(input?.slot)) throw new Error(`unknown slot "${input?.slot}"`);
  const slot: Slot = input.slot;
  const legend = legendOf(input.legend);
  const sheets = {
    front: grid(input.front, PAINT_W, PAINT_H, legend, 'front', repairs),
    back: grid(input.back, PAINT_W, PAINT_H, legend, 'back', repairs),
  };
  if (count(sheets.front) === 0) throw new Error('front grid is empty');
  if (count(sheets.back) === 0) repairs.push('back grid is empty');
  const item: Item = { name: String(input.name ?? 'Unnamed'), slot };

  const cut = (frame: { w: number; h: number; ax: number; ay: number }, at: (l: Layout) => { x: number; y: number }, keep: (x: number, y: number, l: Layout) => boolean): StampPair => {
    const pair = {} as StampPair;
    let lost = 0;
    for (const side of ['front', 'back'] as const) {
      const layout = REFERENCE[side];
      const origin = at(layout);
      const stamp = blank(frame.w, frame.h);
      sheets[side].forEach((row, y) => row.forEach((c, x) => {
        if (!c || !keep(x, y, layout)) return;
        const fx = x - origin.x + frame.ax;
        const fy = y - origin.y + frame.ay;
        if (fx < 0 || fy < 0 || fx >= frame.w || fy >= frame.h) lost++;
        else stamp[fy][fx] = c;
      }));
      pair[side] = stamp;
    }
    if (lost) repairs.push(`${lost} pixels were too far from the body part and were dropped`);
    return pair;
  };
  /** Reads a limb strip: the colour at the limb's middle column, row by row, nearer limb first. */
  const strip = (kind: 'arms' | 'legs'): (Cell | null)[] => {
    const out: (Cell | null)[] = Array(LIMB_CELLS).fill(null);
    for (const side of ['front', 'back'] as const) {
      const layout = REFERENCE[side];
      for (const limb of layout[kind]) {
        for (let i = 0; i < LIMB_CELLS; i++) {
          if (out[i]) continue;
          const y = Math.round(limb.y0 + ((limb.y1 - limb.y0) * i) / (LIMB_CELLS - 1));
          out[i] = sheets[side][y]?.[limb.x] ?? null;
        }
      }
    }
    return out;
  };
  const onLimb = (x: number, y: number, limbs: { x: number; y0: number; y1: number }[], half: number) =>
    limbs.some((l) => Math.abs(x - l.x) <= half && y >= l.y0 && y <= l.y1 + 1);

  if (slot === 'hair' || slot === 'beard' || slot === 'hat') {
    item.head = cut(HEAD_FRAME, (l) => l.neck, () => true);
  } else if (slot === 'tool') {
    item.tool = cut(TOOL_FRAME, (l) => l.handR, () => true);
    item.hold = holdOf(item.tool);
    item.gripDx = gripOf(item.tool);
  } else if (slot === 'top') {
    item.torso = cut(TORSO_FRAME, (l) => ({ x: l.torso.x, y: l.torso.top }), (x, y, l) => !onLimb(x, y, l.arms, 1) || Math.abs(x - l.torso.x) <= 3);
    extendUnderArms(item.torso);
    item.arm = strip('arms');
  } else if (slot === 'bottom') {
    // A skirt flares past the legs; trousers stay on them. A skirt is kept whole so it can swing
    // as one piece, while trousers become a waist plus a strip that follows each leg.
    const layout = REFERENCE.front;
    const outer = [Math.min(...layout.legs.map((l) => l.x)) - 2, Math.max(...layout.legs.map((l) => l.x)) + 3];
    let flared = 0;
    for (let y = layout.torso.bottom + 2; y <= layout.torso.bottom + 8; y++) {
      if (sheets.front[y]?.some((c, x) => c && (x <= outer[0] || x >= outer[1]))) flared++;
    }
    if (flared >= 2) {
      item.torso = cut(TORSO_FRAME, (l) => ({ x: l.torso.x, y: l.torso.top }), () => true);
    } else {
      item.torso = cut(TORSO_FRAME, (l) => ({ x: l.torso.x, y: l.torso.top }), (_x, y, l) => y <= l.torso.bottom + 1);
      item.leg = strip('legs');
      // Paint above the hips on the leg columns belongs to the waist, not the leg.
      item.leg[0] = item.leg[0] ?? item.leg[1];
    }
  } else if (slot === 'shoes') {
    const leg = REFERENCE.front.legs[0];
    item.foot = sheets.front[leg.y1]?.[leg.x] ?? sheets.front[leg.y1 + 1]?.[leg.x] ?? null;
    if (!item.foot) throw new Error('no paint found on the feet');
  }
  return { item, repairs };
}

/** A torso stamp also has to cover the edge columns the hanging arms normally hide. */
function extendUnderArms(pair: StampPair): void {
  for (const stamp of [pair.front, pair.back]) {
    for (const row of stamp) {
      const left = TORSO_FRAME.ax - 4;
      const right = TORSO_FRAME.ax + 4;
      if (!row[left] && row[left + 1]) row[left] = row[left + 1];
      if (!row[right] && row[right - 1]) row[right] = { ...row[right - 1]!, shade: true };
    }
  }
}

// ------------------------------------------------------------------ format 2: recipes

function seeded(text: string): () => number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

interface Pattern {
  kind: 'hstripes' | 'vstripes' | 'checks';
  color: PaletteKey;
  every: number;
}

function patternOf(input: any, what: string): Pattern | null {
  if (input == null) return null;
  if (!['hstripes', 'vstripes', 'checks'].includes(input.kind)) throw new Error(`${what}: unknown pattern "${input.kind}"`);
  if (!isKey(input.color)) throw new Error(`${what}: "${input.color}" is not a palette colour`);
  return { kind: input.kind, color: input.color, every: Math.max(2, Math.min(6, Math.round(Number(input.every) || 3))) };
}

const patterned = (base: PaletteKey, pattern: Pattern | null, col: number, row: number): PaletteKey => {
  if (!pattern) return base;
  const { kind, every } = pattern;
  const on = kind === 'hstripes' ? row % every === 0 : kind === 'vstripes' ? col % every === 0 : (Math.floor(col / every) + Math.floor(row / every)) % 2 === 0;
  return on ? pattern.color : base;
};

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number.isFinite(Number(v)) ? Number(v) : fallback)));

/** Rows of the torso frame that the body occupies. */
const TORSO = { top: TORSO_FRAME.ay, waist: TORSO_FRAME.ay + 9, bottom: TORSO_FRAME.ay + 11, left: TORSO_FRAME.ax - 4, right: TORSO_FRAME.ax + 4 };

/**
 * Format 2. Clothing is described by a few parameters and drawn by fixed rules, so its shape
 * can never be wrong. Head items and tools, whose shape is the whole point, are small stamps.
 */
export function compileRecipe(input: any): Compiled {
  const repairs: string[] = [];
  if (!isSlot(input?.slot)) throw new Error(`unknown slot "${input?.slot}"`);
  const slot: Slot = input.slot;
  const item: Item = { name: String(input.name ?? 'Unnamed'), slot };
  const random = seeded(item.name + slot);
  const need = (k: unknown, what: string): PaletteKey => {
    if (!isKey(k)) throw new Error(`${what}: "${String(k)}" is not a palette colour`);
    return k;
  };

  if (slot === 'hair' || slot === 'beard' || slot === 'hat') {
    const legend = legendOf(input.legend);
    item.head = {
      front: embed(grid(input.front, HEAD_STAMP.w, HEAD_STAMP.h, legend, 'front', repairs), HEAD_STAMP, HEAD_FRAME),
      back: embed(grid(input.back, HEAD_STAMP.w, HEAD_STAMP.h, legend, 'back', repairs), HEAD_STAMP, HEAD_FRAME),
    };
    if (count(item.head.front) === 0) throw new Error('front stamp is empty');
  } else if (slot === 'tool') {
    const legend = legendOf(input.legend);
    item.tool = {
      front: embed(grid(input.front, TOOL_STAMP.w, TOOL_STAMP.h, legend, 'front', repairs), TOOL_STAMP, TOOL_FRAME),
      back: embed(grid(input.back ?? input.front, TOOL_STAMP.w, TOOL_STAMP.h, legend, 'back', repairs), TOOL_STAMP, TOOL_FRAME),
    };
    if (count(item.tool.front) === 0) throw new Error('front stamp is empty');
    item.hold = holdOf(item.tool);
    item.gripDx = gripOf(item.tool);
  } else if (slot === 'shoes') {
    item.foot = cell(need(input.color, 'color'));
  } else {
    const color = need(input.color, 'color');
    const pattern = patternOf(input.pattern, 'pattern');
    const ragged = num(input.ragged, 0, 3, 0);
    const holes = num(input.holes, 0, 4, 0);
    const pair: StampPair = { front: blank(TORSO_FRAME.w, TORSO_FRAME.h), back: blank(TORSO_FRAME.w, TORSO_FRAME.h) };
    const first = slot === 'top' ? TORSO.top : TORSO.waist;
    const extra = slot === 'top' ? num(input.length, -6, 5, 0) : 0;
    const skirt = slot === 'bottom' && input.skirt === true;
    const skirtLength = skirt ? num(input.length, 1, 5, 3) : 0;
    const last = (slot === 'top' ? TORSO.bottom + extra : TORSO.bottom + skirtLength);
    // One hem depth per column, shared by front and back so they agree at the sides.
    const hem = Array.from({ length: TORSO_FRAME.w }, () => Math.floor(random() * (ragged + 1)));
    for (const side of ['front', 'back'] as const) {
      const stamp = pair[side];
      for (let row = first; row <= last; row++) {
        const flare = skirt && row > TORSO.bottom ? 1 : 0;
        for (let col = TORSO.left - flare; col <= TORSO.right + flare; col++) {
          if (row > last - hem[col]) continue;
          const key = patterned(color, pattern, col, row);
          stamp[row][col] = cell(key, col === TORSO.right + flare || row === last);
        }
      }
      if (slot === 'top' && side === 'front') {
        const mid = TORSO_FRAME.ax + 1; // the chest faces slightly right in the drawn facing
        if (input.neck === 'v') {
          stamp[first][mid] = stamp[first][mid - 1] = stamp[first][mid + 1] = null;
          stamp[first + 1][mid] = null;
        } else if (input.neck === 'open') {
          for (let row = first; row <= last; row++) stamp[row][mid] = null;
        } else {
          stamp[first][mid] = stamp[first][mid - 1] = null;
        }
      }
      if (input.belt != null && slot === 'bottom') {
        const belt = need(input.belt, 'belt');
        for (let col = TORSO.left; col <= TORSO.right; col++) stamp[first][col] = cell(belt, col === TORSO.right);
      }
      for (let i = 0; i < holes; i++) {
        const row = first + 2 + Math.floor(random() * Math.max(1, last - first - 3));
        const col = TORSO.left + 1 + Math.floor(random() * 7);
        stamp[row][col] = null;
        if (random() > 0.5) stamp[row][col + 1] = null;
      }
    }
    item.torso = pair;

    const cells = slot === 'top' ? num(input.sleeves, 0, LIMB_CELLS, 3) : skirt ? 0 : num(input.length, 1, LIMB_CELLS, 4);
    const stripColor = (i: number): Cell => {
      const key = pattern?.kind === 'hstripes' ? patterned(color, pattern, 0, i + 1) : color;
      return cell(key, ragged > 0 && i === cells - 1);
    };
    const strip: (Cell | null)[] = Array.from({ length: LIMB_CELLS }, (_, i) => (i < cells ? stripColor(i) : null));
    if (slot === 'top') item.arm = strip;
    else item.leg = strip;
  }
  return { item, repairs };
}

/** Compiles one candidate in either format, turning any failure into a message instead of throwing. */
export function compile(format: 'sprite' | 'recipe', input: unknown): { ok: true; compiled: Compiled } | { ok: false; error: string } {
  try {
    return { ok: true, compiled: format === 'sprite' ? compileSprite(input) : compileRecipe(input) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
