import type { PaletteKey } from './palette.ts';
import { HEAD_FRAME, HEAD_STAMP, TORSO_FRAME, parseStamp, type Item, type Look, type Slot, type Stamp, type StampPair } from './puppet.ts';

// The foundation set: the bare head, its faces, a first hairstyle and the undershorts.
// These stamps were written as text by a language model and corrected over several rounds by
// looking at the rendered result, the same loop the content pipeline would run.
//
// All head stamps are drawn facing right, 21 wide, with row 21 on the neck. The skull occupies
// rows 6 to 19 and columns 3 to 17. Characters: # skin, % shaded skin, + lit skin, . empty.

/** Places rows written at stamp size into the renderer's larger head frame. */
const pad = (rows: string[], above: number): string[] => {
  const dx = HEAD_FRAME.ax - HEAD_STAMP.ax;
  const dy = HEAD_FRAME.ay - HEAD_STAMP.ay;
  const blank = '.'.repeat(HEAD_FRAME.w);
  const wide = rows.map((row) => '.'.repeat(dx) + row + '.'.repeat(HEAD_FRAME.w - dx - row.length));
  return [...Array(above + dy).fill(blank), ...wide, ...Array(Math.max(0, HEAD_FRAME.h - above - dy - rows.length)).fill(blank)];
};

// Three-quarter view: the skull is round on top, the jaw sits towards the facing side, and the
// near ear shows on the left edge. A lit pixel on the brow side and shade under the jaw.
const HEAD_FRONT = pad([
  '......#########......',
  '....#############....',
  '...###############...',
  '...###############...',
  '...####%%%%%%%%%%#...',
  '...###############...',
  '..%###############...',
  '..%%##############...',
  '...###############...',
  '...###############...',
  '...###############...',
  '....##############...',
  '.....###########%....',
  '.......%%%%%%%%......',
  '.........%%%%........',
  '.........%%%%........',
], 6);

const HEAD_BACK = pad([
  '......#########......',
  '....#############....',
  '...###############...',
  '...###############...',
  '...###############...',
  '...###############...',
  '...###############%..',
  '...##############%%..',
  '...###############...',
  '...###############...',
  '...###############...',
  '....#############....',
  '.....###########.....',
  '.......%%%%%%%.......',
  '.........%%%%........',
  '.........%%%%........',
], 6);

// Faces are composed from options, pixel by pixel, on the 21-wide head grid. The near eye is at
// columns 9 and 10, the far eye at 14 and 15, rows 12 to 14; the face looks towards the right.

export const EYE_SHAPES = ['round', 'small', 'wide', 'sleepy'] as const;
export const MOUTHS = ['grin', 'smile', 'small'] as const;
export const BROWS = ['none', 'thin', 'thick'] as const;
/** null keeps the eyes plain dark. */
export const EYE_COLORS: (PaletteKey | null)[] = [null, 'blue', 'green', 'teal', 'grey', 'wood', 'purple'];

export interface FaceOptions {
  eyes: (typeof EYE_SHAPES)[number];
  eyeColor: PaletteKey | null;
  mouth: (typeof MOUTHS)[number];
  brows: (typeof BROWS)[number];
  blush: boolean;
  freckles: boolean;
  glasses: boolean;
  /** Frame colour. Defaults to black. */
  glassesColor?: PaletteKey;
  lashes: boolean;
}

export const GLASSES_COLORS: PaletteKey[] = ['black', 'brown', 'steel', 'straw', 'red', 'blue', 'green', 'pink', 'white'];

export const DEFAULT_FACE: FaceOptions = {
  eyes: 'round', eyeColor: null, mouth: 'grin', brows: 'none', blush: true, freckles: false, glasses: false, lashes: false,
};

type Expression = 'neutral' | 'blink' | 'happy';

function faceRows(o: FaceOptions, expression: Expression): string[] {
  const grid = Array.from({ length: HEAD_STAMP.h }, () => Array<string>(HEAD_STAMP.w).fill('.'));
  const put = (x: number, y: number, ch: string) => {
    if (grid[y]?.[x] !== undefined) grid[y][x] = ch;
  };
  const run = (x0: number, x1: number, y: number, ch: string) => {
    for (let x = x0; x <= x1; x++) put(x, y, ch);
  };
  const wide = o.eyes === 'wide';
  for (const [x, outer] of [[9, -1], [14, 1]] as const) {
    const left = wide ? x - 1 : x;
    if (expression === 'happy') {
      run(x, x + 1, 13, 'I');
      put(x - 1, 14, 'I');
      put(x + 2, 14, 'I');
    } else if (expression === 'blink') {
      run(left, x + 1, 14, 'I');
    } else {
      // A shine in the same corner of both eyes, colour beside the pupil.
      if (o.eyes === 'sleepy') {
        run(x - 1, x + 1, 12, 'I');
      } else if (o.eyes !== 'small') {
        put(left, 12, 'T');
        run(left + 1, x + 1, 12, 'I');
      }
      for (const y of [13, 14]) {
        run(left, x, y, o.eyes === 'small' && y === 13 ? 'T' : 'C');
        put(x + 1, y, 'I');
      }
      if (o.lashes) put(outer < 0 ? left - 1 : x + 2, 12, 'I');
    }
    if (o.brows !== 'none') run(o.brows === 'thick' ? x - 1 : x, x + 1, 11, 'e');
  }
  put(13, 15, '%');
  if (o.blush) {
    put(7, 15, 'B');
    put(16, 15, 'B');
  }
  if (o.freckles) {
    for (const [x, y] of [[6, 15], [8, 16], [8, 14], [17, 15], [16, 16]]) put(x, y, '%');
  }
  if (expression === 'happy') {
    for (const y of [16, 17]) {
      put(10, y, 'M');
      run(11, 14, y, 'T');
      put(15, y, 'M');
    }
    run(11, 14, 18, 'M');
  } else if (o.mouth === 'grin') {
    put(10, 16, 'M');
    run(11, 14, 16, 'T');
    put(15, 16, 'M');
    run(11, 14, 17, 'M');
  } else if (o.mouth === 'smile') {
    put(10, 16, 'M');
    put(15, 16, 'M');
    run(11, 14, 17, 'M');
  } else {
    run(12, 13, 16, 'M');
  }
  if (o.glasses) {
    for (const x of [8, 13]) {
      run(x, x + 3, 11, 'G');
      run(x, x + 3, 15, 'G');
      for (const y of [12, 13, 14]) {
        put(x, y, 'G');
        put(x + 3, y, 'G');
      }
    }
    put(12, 12, 'G');
    run(3, 7, 12, 'G');
  }
  return grid.map((row) => row.join(''));
}

export function headFor(skin: PaletteKey): StampPair {
  return { front: parseStamp(HEAD_FRONT, {}, skin), back: parseStamp(HEAD_BACK, {}, skin) };
}

/** Builds the neutral, blinking and laughing faces for one set of options. Brows take the hair colour. */
export function facesFor(skin: PaletteKey, options: FaceOptions = DEFAULT_FACE, hair: PaletteKey = 'hairBrown'): Record<string, Stamp> {
  const legend = { I: 'ink', M: 'mouth', T: 'tooth', B: 'blush', C: options.eyeColor ?? 'ink', E: hair, G: options.glassesColor ?? 'black' } as const;
  const make = (expression: Expression) => parseStamp(pad(faceRows(options, expression), 0), legend, skin);
  return { neutral: make('neutral'), blink: make('blink'), happy: make('happy') };
}

// Short, slightly unruly hair: one tuft breaking the outline on top, a lit band across the
// crown, a fringe cut in clumps, and a sideburn in front of the ear.
const SHORT_HAIR_FRONT = pad([
  '........HH...H.......',
  '......HHHHHHHHH......',
  '....HHHLLLLHHHHHH....',
  '..HHHHLLLHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHhhHHHhhHHHHhh..',
  '..HHHh..hHh..hhHhh...',
  '.hHHh.............h..',
  '.hHh.................',
  '..h..................',
], 2);

const SHORT_HAIR_BACK = pad([
  '.......H...HH........',
  '......HHHHHHHHH......',
  '....HHHHHHLLLLHHH....',
  '..HHHHHHHHHHLLLHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHH...',
  '..hhHHHHHHHHHHHHHH...',
  '...hhHHHHHHHHHHHH....',
  '....hhhHHHhHHhHh.....',
  '......hh.hh..h.......',
], 2);

// Long hair to the shoulders: a smooth crown with a parting, a lock in front of the near ear,
// and a mass that falls behind the neck in front views and over the upper back from behind.
const LONG_HAIR_FRONT = pad([
  '......HHHHHHHHH......',
  '....HHHHLLLLHHHHH....',
  '..HHHHHLLLHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '.HHHHHHHHHHHHHHHHHH..',
  '.HHHHHHHHHHHHHHHHHh..',
  '.HHHHHHHHhHHHHHHHHh..',
  '.HHHHHhh..hhhhHHHHhh.',
  '.HHHh.............hh.',
  '.HHh..............hh.',
  '.HHh..............hh.',
  '.HHh..............hh.',
  '.HHh...............h.',
  '.HHH.................',
  '.hHH.................',
  '.hHH.................',
  '.hHHh................',
  '..hHh................',
  '..hhh................',
  '...h.................',
], 3);

const LONG_HAIR_BEHIND = pad([
  '....hhhhhhhhhhhhhh...',
  '....hhhhhhhhhhhhhh...',
  '....hhhhhhhhhhhhhh...',
  '....hhhhhhhhhhhhhh...',
  '.....hhhhhhhhhhhh....',
  '.....hhhhhhhhhhhh....',
  '......hhhhhhhhhh.....',
  '.......hh.hhh.hh.....',
], 16);

const LONG_HAIR_BACK = pad([
  '......HHHHHHHHH......',
  '....HHHHHHLLLLHHH....',
  '..HHHHHHHHHHLLLHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHHHHHHHHHHHH..',
  '..hHHHHHhHHHHHHHHHH..',
  '..hHHHHHhHHHHHhHHHH..',
  '..hHHHHHhHHHHHhHHHH..',
  '..hhHHHHhHHHHHhHHHH..',
  '...hHHHHhHHHHHhHHH...',
  '...hHHHHhHHHHHhHHH...',
  '...hhHHHhHHHHHhHHh...',
  '....hHHhhHHHHhhHH....',
  '....hhHh.hHHh.hHh....',
  '.....hh...hh...h.....',
], 3);

/**
 * A beard seen from behind. Only what is wider than the head shows: the part that stands out
 * past the jaw on the side the face points to, above the shoulders. A small beard shows nothing.
 */
export function beardFromBehind(front: Stamp): Stamp {
  const head = parseStamp(HEAD_BACK, {}, 'skinB');
  return front.map((row, y) =>
    row.map((cell, x) => (cell && x >= HEAD_FRAME.ax && y <= HEAD_FRAME.ay && !head[y][x] ? { ...cell, shade: true, light: false } : null)),
  );
}

export interface HairStyle {
  id: string;
  label: string;
  make: (color: PaletteKey) => Item;
}

const hairItem = (name: string, color: PaletteKey, front: string[], back: string[], behind?: string[]): Item => {
  const legend = { H: color, L: `${color}+` } as const;
  const empty = pad([], 0);
  return {
    name,
    slot: 'hair',
    head: { front: parseStamp(front, legend), back: parseStamp(back, legend) },
    ...(behind ? { headBehind: { front: parseStamp(behind, legend), back: parseStamp(empty, legend) } } : {}),
  };
};

export const HAIR_STYLES: HairStyle[] = [
  { id: 'short', label: 'Short and unruly', make: (color) => hairItem('Short hair', color, SHORT_HAIR_FRONT, SHORT_HAIR_BACK) },
  { id: 'long', label: 'Long', make: (color) => hairItem('Long hair', color, LONG_HAIR_FRONT, LONG_HAIR_BACK, LONG_HAIR_BEHIND) },
];

export const shortHair = (color: PaletteKey): Item => HAIR_STYLES[0].make(color);

/** Underwear rows are written 15 wide around the body and placed in the wider torso frame. */
const underwear = (above: number, rows: string[]) =>
  parseStamp([...Array(above).fill('.'.repeat(TORSO_FRAME.w)), ...rows.map((row) => '...' + row + '...')], { W: 'white' });
const shorts = (rows: string[]) => underwear(10, rows);

/** What the survivor wears before any generated item: plain undershorts, so the body is never bare. */
export const UNDERSHORTS: Item = {
  name: 'Undershorts',
  slot: 'bottom',
  torso: {
    front: shorts(['...WWWWWWWWw...', '...WWWWWWWWw...', '...WWWWWWWWw...']),
    back: shorts(['...wWWWWWWWW...', '...wWWWWWWWW...', '...wWWWWWWWW...']),
  },
  leg: [{ key: 'white', shade: false }, { key: 'white', shade: false }, { key: 'white', shade: true }, null, null, null, null, null, null, null],
};

/** With the feminine body shape and no top, a plain band is worn so the body is never bare. */
export const UNDERTOP: Item = {
  name: 'Undertop',
  slot: 'top',
  torso: {
    front: underwear(3, ['...WWWWWWWWw...', '...WWWWWWWWw...', '...WWWWWWWWw...']),
    back: underwear(3, ['...wWWWWWWWW...', '...wWWWWWWWW...', '...wWWWWWWWW...']),
  },
};

export function baseLook(skin: PaletteKey = 'skinB', hair: PaletteKey = 'hairBrown'): Look {
  return { skin, head: headFor(skin), faces: facesFor(skin), items: [UNDERSHORTS, shortHair(hair)] };
}

/** Puts items on a look, one per slot: a new item replaces whatever was in its slot. */
export function wear(look: Look, ...items: Item[]): Look {
  const bySlot = new Map<Slot, Item>(look.items.map((i) => [i.slot, i]));
  for (const item of items) bySlot.set(item.slot, item);
  return { ...look, items: [...bySlot.values()] };
}
