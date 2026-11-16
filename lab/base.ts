import type { Cell, PaletteKey } from './palette.ts';
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
const ROUND_FRONT = [
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
];

const ROUND_BACK = [
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
];

/**
 * Head shapes change the cheeks, jaw and chin, never the crown, so every hairstyle and hat
 * still fits. Rows are given by their index in the round head above.
 */
export const HEAD_SHAPES = ['round', 'heart', 'thin', 'square'] as const;
export type HeadShape = (typeof HEAD_SHAPES)[number];
const SHAPES: Record<HeadShape, { front: Record<number, string>; back: Record<number, string> }> = {
  round: { front: {}, back: {} },
  // Wide at the cheekbones, narrowing to a small pointed chin.
  heart: {
    front: {
      6: '..%################..',
      7: '..%%###############..',
      8: '...################..',
      10: '....#############....',
      11: '......##########%....',
      12: '........#######%.....',
      // The point of the chin sits right over the neck, so the neck runs straight up into it.
      13: '.........%%%%........',
    },
    back: {
      6: '..################%..',
      7: '..###############%%..',
      8: '..################...',
      10: '....#############....',
      11: '.....###########.....',
      12: '.......#######.......',
      13: '.........%%%%........',
    },
  },
  // A narrow face, one pixel in on both sides from the brow down.
  thin: {
    front: {
      0: '.......#######.......',
      1: '.....###########.....',
      2: '....#############....',
      3: '....#############....',
      4: '....###%%%%%%%%%#....',
      5: '....#############....',
      6: '..%%#############....',
      7: '..%%#############....',
      8: '....#############....',
      9: '....#############....',
      10: '....#############....',
      11: '.....############....',
      12: '......#########%.....',
      13: '........%%%%%%.......',
    },
    back: {
      0: '.......#######.......',
      1: '.....###########.....',
      2: '....#############....',
      3: '....#############....',
      4: '....#############....',
      5: '....#############....',
      6: '....#############%%..',
      7: '....############%%%..',
      8: '....#############....',
      9: '....#############....',
      10: '....#############....',
      11: '.....###########.....',
      12: '......#########......',
      13: '.......%%%%%%%.......',
    },
  },
  // A broad jaw that stays wide down to the chin.
  square: {
    front: {
      11: '...###############...',
      12: '....#############%...',
      13: '......%%%%%%%%%......',
    },
    back: {
      11: '...###############...',
      12: '....#############....',
      13: '......%%%%%%%%%......',
    },
  },
};
const shaped = (rows: string[], change: Record<number, string>) => pad(rows.map((row, i) => change[i] ?? row), 6);

// Faces are composed from options, pixel by pixel, on the 21-wide head grid. The near eye is at
// columns 9 and 10, the far eye at 14 and 15, rows 12 to 14; the face looks towards the right.

export const EYE_SHAPES = ['round', 'small', 'sleepy'] as const;
/**
 * Mood is a value of the character, like its condition. It decides the mouth, the slant of the
 * brows and how open the eyes are; the features above and below stay the character's own.
 */
export const MOODS = ['neutral', 'smile', 'happy', 'laughing', 'sad', 'angry', 'surprised'] as const;
export type Mood = (typeof MOODS)[number];
export const BROWS = ['none', 'thin', 'thick'] as const;
/** null keeps the eyes plain dark. */
export const EYE_COLORS: (PaletteKey | null)[] = [null, 'blue', 'green', 'teal', 'grey', 'wood', 'purple'];

export interface FaceOptions {
  /** The outline of the head. Missing in older saves, which means round. */
  shape?: HeadShape;
  eyes: (typeof EYE_SHAPES)[number];
  eyeColor: PaletteKey | null;
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
  eyes: 'round', eyeColor: null, brows: 'none', blush: true, freckles: false, glasses: false, lashes: false,
};

function faceRows(o: FaceOptions, mood: Mood, blink: boolean): string[] {
  const grid = Array.from({ length: HEAD_STAMP.h }, () => Array<string>(HEAD_STAMP.w).fill('.'));
  const put = (x: number, y: number, ch: string) => {
    if (grid[y]?.[x] !== undefined) grid[y][x] = ch;
  };
  const run = (x0: number, x1: number, y: number, ch: string) => {
    for (let x = x0; x <= x1; x++) put(x, y, ch);
  };
  // Surprise opens the eyes one row further.
  const top = mood === 'surprised' ? 11 : 12;
  // Small eyes are one dark pixel, like the animals' eyes, and keep that size in every state.
  const small = o.eyes === 'small';
  for (const [x, outer] of [[9, -1], [14, 1]] as const) {
    const left = x;
    if (small) {
      if (mood === 'laughing') {
        put(x, 13, 'I');
        put(x + 1, 12, 'I');
        put(x + 2, 13, 'I');
      } else if (blink) run(x, x + 1, 13, 'I');
      else {
        put(x + 1, 13, 'I');
        if (mood === 'surprised') put(x + 1, 12, 'I');
      }
    } else if (mood === 'laughing') {
      // Eyes squeezed shut into arcs.
      run(x, x + 1, 13, 'I');
      put(x - 1, 14, 'I');
      put(x + 2, 14, 'I');
    } else if (blink) {
      run(left, x + 1, 14, 'I');
    } else {
      // A shine in the same corner of both eyes, colour beside the pupil.
      if (o.eyes === 'sleepy') run(x - 1, x + 1, top, 'I');
      else {
        put(left, top, 'T');
        run(left + 1, x + 1, top, 'I');
      }
      for (let y = top + 1; y <= 14; y++) {
        run(left, x, y, 'C');
        put(x + 1, y, 'I');
      }
      if (o.lashes) put(outer < 0 ? left - 1 : x + 2, top, 'I');
    }
    // Brows. Anger lowers a heavy brow onto the inner corner of the eye and sadness lets the
    // outer corner droop; the lid is skin, so the eye itself changes shape. Both show even on a
    // face that otherwise has no brows drawn, because the mood depends on them.
    const outerX = outer < 0 ? x : x + 1;
    const innerX = outer < 0 ? x + 1 : x;
    if (mood === 'angry' || mood === 'sad') {
      if (!blink && !small) {
        // No shine, and one corner of the top row closed by the lid.
        run(left, x + 1, 12, 'I');
        put(mood === 'angry' ? innerX : outerX, 12, '%');
      }
      if (mood === 'angry') {
        run(Math.min(outerX, innerX - outer), Math.max(outerX, innerX - outer), 11, 'e');
        if (o.brows === 'thick') put(outerX + outer, 11, 'e');
      } else {
        put(innerX, 11, 'e');
        if (o.brows !== 'none') put(innerX - outer, 11, 'e');
      }
    } else if (mood === 'surprised') {
      run(o.brows === 'thick' ? x - 1 : x, x + 1, 10, 'e');
    } else if (o.brows !== 'none') {
      run(o.brows === 'thick' ? x - 1 : x, x + 1, 11, 'e');
    }
  }
  put(13, 15, '%');
  if (o.blush) {
    put(7, 15, 'B');
    put(16, 15, 'B');
  }
  if (o.freckles) {
    for (const [x, y] of [[6, 15], [8, 16], [8, 14], [17, 15], [16, 16]]) put(x, y, '%');
  }
  if (mood === 'laughing') {
    for (const y of [16, 17]) {
      put(10, y, 'M');
      run(11, 14, y, 'T');
      put(15, y, 'M');
    }
    run(11, 14, 18, 'M');
  } else if (mood === 'happy') {
    put(10, 16, 'M');
    run(11, 14, 16, 'T');
    put(15, 16, 'M');
    run(11, 14, 17, 'M');
  } else if (mood === 'smile') {
    put(10, 16, 'M');
    put(15, 16, 'M');
    run(11, 14, 17, 'M');
  } else if (mood === 'sad') {
    run(11, 14, 16, 'M');
    put(10, 17, 'M');
    put(15, 17, 'M');
  } else if (mood === 'angry') {
    run(12, 14, 16, 'M');
  } else if (mood === 'surprised') {
    run(12, 13, 16, 'M');
    run(12, 13, 17, 'M');
  } else {
    run(11, 14, 16, 'M');
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

export function headFor(skin: PaletteKey, shape: HeadShape = 'round'): StampPair {
  return { front: parseStamp(shaped(ROUND_FRONT, SHAPES[shape].front), {}, skin), back: parseStamp(shaped(ROUND_BACK, SHAPES[shape].back), {}, skin) };
}

/**
 * Builds the faces a character can show: 'neutral' is the mood itself, 'blink' the same with the
 * eyes shut, and 'happy' what a cheerful action such as waving puts on, which is a laugh unless
 * the mood is a dark one. Brows take the hair colour.
 */
export function facesFor(skin: PaletteKey, options: FaceOptions = DEFAULT_FACE, hair: PaletteKey = 'hairBrown', mood: Mood = 'happy'): Record<string, Stamp> {
  const legend = { I: 'ink', M: 'mouth', T: 'tooth', B: 'blush', C: options.eyeColor ?? 'ink', E: hair, G: options.glassesColor ?? 'black' } as const;
  // Features stay on the head: on a narrow head a freckle or a glasses arm off the edge is left out.
  const head = parseStamp(shaped(ROUND_FRONT, SHAPES[options.shape ?? 'round'].front), {}, skin);
  const make = (as: Mood, blink: boolean) => parseStamp(pad(faceRows(options, as, blink), 0), legend, skin).map((row, y) => row.map((cell, x) => (head[y]?.[x] ? cell : null)));
  const cheerful = mood === 'neutral' || mood === 'smile' || mood === 'happy' || mood === 'laughing';
  return { neutral: make(mood, false), blink: make(mood, true), happy: make(cheerful ? 'laughing' : mood, false) };
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
  const head = parseStamp(shaped(ROUND_BACK, {}), {}, 'skinB');
  return front.map((row, y) =>
    row.map((cell, x) => (cell && x >= HEAD_FRAME.ax && y <= HEAD_FRAME.ay && !head[y][x] ? { ...cell, shade: true, light: false } : null)),
  );
}

/**
 * Beards drawn by hand, in the face grid (rows from 12, the eyes' top row). The mouth is drawn
 * over any beard by the renderer, so these cover the lips freely. H hair, L lit, h shaded.
 */
/** How strongly stubble and shaved hair tint the skin. */
const STUBBLE = 0.4;

const BEARD_ROWS: Record<string, { label: string; rows: string[]; short?: boolean }> = {
  stubble: {
    label: 'Stubble',
    short: true,
    rows: [
      '...H.................',
      '...H.................',
      '...HH................',
      '...HHH...HHHHHH..H...',
      '...HHHHHHHHHHHHHHH...',
      '....HHHHHHHHHHHHHH...',
      '.....HHHHHHHHHHHH....',
      '.......HHHHHHHH......',
    ],
  },
  moustache: {
    label: 'Moustache',
    rows: [
      '.....................',
      '.....................',
      '.....................',
      '.........HHHHHHHH....',
      '........hHHHHHHHHh...',
      '........h........h...',
    ],
  },
  goatee: {
    label: 'Goatee',
    rows: [
      '.....................',
      '.....................',
      '.....................',
      '.........HHHHHHHH....',
      '........HHH....HHH...',
      '........HH......HH...',
      '.........HHHHHHHHh...',
      '..........HHHHHHh....',
      '..........hHHHHh.....',
      '...........hhhh......',
    ],
  },
  chinstrap: {
    label: 'Chin strap',
    rows: [
      '...HH................',
      '...HH................',
      '...HH................',
      '...HHH..........HH...',
      '...HHHH.........HH...',
      '....HHHH.......HHh...',
      '.....HHHH.....HHh....',
      '......HHHHHHHHHHh....',
      '........hhhhhhhh.....',
    ],
  },
  short: {
    label: 'Short beard',
    rows: [
      '...H.................',
      '...H.................',
      '...HH................',
      '...HHH...HHHHHH..H...',
      '...HHHHHHHHHHHHHHH...',
      '....HHHHHHHHHHHHHh...',
      '.....HHHHHHHHHHHh....',
      '......HHHHHHHHHh.....',
      '........hhhhhh.......',
    ],
  },
};

export const BEARD_STYLES = Object.entries(BEARD_ROWS).map(([id, { label, rows, short }]) => {
  const parsed = parseStamp(pad(rows, 12), { H: 'hairBrown', L: 'hairBrown+' });
  const front = short ? parsed.map((row) => row.map((c) => c && { ...c, shade: true, mix: STUBBLE })) : parsed;
  const item: Item = { name: label, slot: 'beard', head: { front, back: beardFromBehind(front) }, ...(short ? { short } : {}) };
  return { id, label, item };
});

/**
 * Hair shaved to stubble, which the model paints as a chequer of single pixels, becomes an even
 * see-through shade: each lone pixel and each gap between two of them.
 */
export function stubbled(stamp: Stamp): Stamp {
  const lone = (x: number, y: number) =>
    !!stamp[y]?.[x] && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => stamp[y + dy]?.[x + dx]);
  const shade = (c: Cell): Cell => ({ key: c.key, shade: true, mix: STUBBLE });
  return stamp.map((row, y) =>
    row.map((cell, x) => {
      if (cell) return lone(x, y) ? shade(cell) : cell;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => lone(x + dx, y + dy));
      return near.length >= 2 ? shade(stamp[y + near[0][1]][x + near[0][0]]!) : null;
    }),
  );
}

/**
 * Tidies a beard drawn by the model: pixels that hang on by one side or none are dropped and
 * gaps closed on three or four sides are filled, so a neat beard has a clean edge. Wear makes it
 * ragged again by rule.
 */
export function tidyBeard(stamp: Stamp): Stamp {
  const on = (x: number, y: number) => !!stamp[y]?.[x];
  const around = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => on(x + dx, y + dy));
  return stamp.map((row, y) =>
    row.map((cell, x) => {
      const next = around(x, y);
      if (cell) return next.length >= 2 ? cell : null;
      if (next.length < 3) return null;
      const [dx, dy] = next[0];
      return { ...stamp[y + dy][x + dx]!, light: false };
    }),
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
