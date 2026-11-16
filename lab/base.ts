import type { Cell, PaletteKey } from './palette.ts';
import shapesFile from './face-shapes.json' with { type: 'json' };
import { beardBehind, HEAD_FRAME, HEAD_STAMP, TORSO_FRAME, parseStamp, type Item, type Look, type OwnView, type Slot, type Stamp, type StampPair } from './puppet.ts';

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
// `straight` is the face-on and straight-back view, `side` the profile facing right.
const SHAPES: Record<HeadShape, Record<'front' | 'back' | 'straight' | 'side', Record<number, string>>> = {
  round: { front: {}, back: {}, straight: {}, side: {} },
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
    straight: {
      6: '..%###############%..',
      7: '..%###############%..',
      8: '..################%..',
      10: '....############%....',
      11: '.....##########%.....',
      12: '.......######%.......',
      13: '........%%%%%........',
    },
    // Side on: full cheekbones, the jaw drawn back to a small chin.
    side: {
      6: '..#####%%##########..',
      7: '..####%############..',
      8: '..####%############..',
      11: '.....##############..',
      12: '.......##########%...',
      13: '.........%%%%%%%.....',
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
      7: '....#############%%..',
      8: '....#############....',
      9: '....#############....',
      10: '....#############....',
      11: '.....###########.....',
      12: '......#########......',
      13: '.......%%%%%%%.......',
    },
    straight: {
      0: '.......#######.......',
      1: '.....###########.....',
      2: '....#############....',
      3: '....#############....',
      4: '....#############....',
      5: '....#############....',
      6: '...%#############%...',
      7: '...%#############%...',
      8: '....#############....',
      9: '....############%....',
      10: '....############%....',
      11: '.....##########%.....',
      12: '......########%......',
      13: '.......%%%%%%%.......',
    },
    // Side on: a pixel less at the back of the skull and under the jaw.
    side: {
      0: '.......########......',
      1: '.....############....',
      2: '....##############...',
      3: '....##############...',
      4: '....###############..',
      5: '....###############..',
      6: '....###%%##########..',
      7: '....##%############..',
      8: '....##%############..',
      9: '....###%%###########.',
      10: '.....##############..',
      11: '.....##############..',
      12: '......############%..',
      13: '........%%%%%%%%%....',
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
    straight: {
      11: '...##############%...',
      12: '....############%....',
      13: '......%%%%%%%%%......',
    },
    // Side on: the jaw stays deep right back to the ear.
    side: {
      10: '...################..',
      11: '...################..',
      12: '...###############%..',
      13: '.....%%%%%%%%%%%%....',
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

// Straight front and back views: the head seen face on or from behind, symmetric about stamp
// column 10, with both ears showing and the shade on the right, away from the light.
const ROUND_SOUTH = [
  '......#########......',
  '....#############....',
  '...###############...',
  '...###############...',
  '...###############...',
  '...###############...',
  '..%###############%..',
  '..%###############%..',
  '...###############...',
  '...##############%...',
  '...##############%...',
  '....############%....',
  '.....##########%.....',
  '.......%%%%%%%.......',
  '........%%%%%........',
  '........%%%%%........',
];

/**
 * Side on the head is a pixel shallower than drawn below: one column in front of the ear is left
 * out, so the face moves back a pixel and the back of the head and the neck stay. Hair drawn side
 * on loses the same column.
 */
const FRONT_IN = 13;
const shallow = (row: string) => row.slice(0, FRONT_IN) + row.slice(FRONT_IN + 1) + '.';
/** The side head of a shape, a pixel shallower. Rows 14 and on are the neck. */
const sideRows = (shape: HeadShape) => ROUND_EAST.map((row, i) => SHAPES[shape].side[i] ?? row).map((row, i) => (i < 14 ? shallow(row) : row));

// Side on, facing right: the ear in the middle, the brow and nose breaking the outline in front.
const ROUND_EAST = [
  '......#########......',
  '....#############....',
  '...###############...',
  '...###############...',
  '...################..',
  '...################..',
  '...####%%##########..',
  '...###%############..',
  '...###%############..',
  '...####%%###########.',
  '....###############..',
  '....###############..',
  '.....#############%..',
  '.......%%%%%%%%%%....',
  '........%%%%%........',
  '........%%%%%........',
];


// ------------------------------------------------------------------ eye and mouth shapes

/**
 * The eyes and mouths every character uses, drawn by hand in the wardrobe's shape editor and
 * kept in face-shapes.json. Eyes come in pairs (one eye side on), per view, eye shape and state;
 * mouths per view and mood, brows per view, brow style and mood. Letters: I ink, C eye colour,
 * T white, M mouth, % shaded skin, e brow (the hair colour's shade).
 */
export const FACE_VIEWS = ['diagonal', 'front', 'side'] as const;
export type FaceView = (typeof FACE_VIEWS)[number];
export const EYE_STATES = ['open', 'aside', 'blink', 'laughing', 'surprised', 'surprised-aside', 'angry', 'angry-aside', 'sad', 'sad-aside'] as const;
export type EyeState = (typeof EYE_STATES)[number];
export interface FaceShapes {
  eyes: Record<FaceView, Record<(typeof EYE_SHAPES)[number], Record<EyeState, string[]>>>;
  mouths: Record<FaceView, Record<Mood, string[]>>;
  brows: Record<FaceView, Record<(typeof BROWS)[number], Record<BrowState, string[]>>>;
}
/** Brows change with three moods; every other mood shows them plain. A face with no brows still frowns, grieves and lifts them in surprise. */
export const BROW_STATES = ['plain', 'surprised', 'angry', 'sad'] as const;
export type BrowState = (typeof BROW_STATES)[number];
export const browState = (mood: Mood): BrowState => (mood === 'surprised' || mood === 'angry' || mood === 'sad' ? mood : 'plain');
/** Live: the shape editor changes these in place and the faces are built again. */
export const FACE_SHAPES = structuredClone(shapesFile) as FaceShapes;
/** Where each stamp sits on the 21-wide head grid: column, row, width, height. */
export const FACE_REGIONS: Record<'eyes' | 'mouths' | 'brows', Record<FaceView, [number, number, number, number]>> = {
  eyes: { diagonal: [8, 11, 9, 4], front: [6, 11, 9, 4], side: [13, 11, 4, 4] },
  mouths: { diagonal: [10, 16, 6, 3], front: [7, 16, 7, 3], side: [15, 16, 3, 3] },
  brows: { diagonal: [8, 10, 9, 4], front: [5, 10, 11, 4], side: [13, 10, 4, 4] },
};

/** The bare head's rows in a face view, on the 21-wide head grid: the shape editor draws its faces on it. */
export function headRows(view: FaceView, shape: HeadShape = 'round'): string[] {
  const { front, straight } = SHAPES[shape];
  const rows = view === 'diagonal' ? ROUND_FRONT.map((row, i) => front[i] ?? row) : view === 'front' ? ROUND_SOUTH.map((row, i) => straight[i] ?? row) : sideRows(shape);
  return [...Array<string>(6).fill('.'.repeat(HEAD_STAMP.w)), ...rows];
}

/** Which eye stamp a mood shows. A laugh squeezes the eyes shut even mid-blink; dark moods keep their lids looking aside. */
export function eyeState(mood: Mood, blink: boolean, aside: boolean): EyeState {
  if (mood === 'laughing') return 'laughing';
  if (blink) return 'blink';
  if (mood === 'surprised' || mood === 'angry' || mood === 'sad') return aside ? `${mood}-aside` : mood;
  return aside ? 'aside' : 'open';
}

/** The face features of one view as rows on the head grid: eye, brow and mouth stamps, with nose, blush, freckles and glasses by rule. */
export function faceRows(o: FaceOptions, mood: Mood, blink: boolean, aside: boolean, view: FaceView): string[] {
  const grid = Array.from({ length: HEAD_STAMP.h }, () => Array<string>(HEAD_STAMP.w).fill('.'));
  const at = (x: number, y: number, ch: string) => {
    if (grid[y]?.[x] !== undefined) grid[y][x] = ch;
  };
  const place = (rows: string[] | undefined, [x0, y0]: [number, number, number, number]) =>
    rows?.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && at(x0 + i, y0 + j, ch)));
  const state = eyeState(mood, blink, aside);
  const small = o.eyes === 'small';
  const top = mood === 'surprised' ? 11 : 12;
  const open = !small && state !== 'laughing' && state !== 'blink';
  place(FACE_SHAPES.eyes[view][o.eyes][state], FACE_REGIONS.eyes[view]);
  // The rules below are written for the diagonal head; side on for the deeper one, a column further forward.
  const shift = view === 'side' ? -1 : view === 'front' ? -2 : 0;
  const put: Put = (x, y, ch) => at(x + shift, y, ch);
  if (view === 'side') {
    if (o.lashes && open) put(17, top, 'I');
    sideRules(o, put);
  } else {
    if (o.lashes && open) {
      put(8, top, 'I');
      put(16, top, 'I');
    }
    frontRules(o, put, view === 'front');
  }
  place(FACE_SHAPES.brows[view][o.brows][browState(mood)], FACE_REGIONS.brows[view]);
  place(FACE_SHAPES.mouths[view][mood], FACE_REGIONS.mouths[view]);
  if (o.glasses) view === 'side' ? sideGlasses(put) : frontGlasses(put, view === 'front');
  return grid.map((row) => row.join(''));
}

type Put = (x: number, y: number, ch: string) => void;

/** Nose, blush and freckles in the diagonal and face-on views. */
function frontRules(o: FaceOptions, put: Put, south: boolean): void {
  put(south ? 12 : 13, 15, '%');
  if (o.blush) {
    put(south ? 8 : 7, 15, 'B');
    put(16, 15, 'B');
  }
  if (o.freckles) for (const [x, y] of [[6, 15], [8, 16], [8, 14], [17, 15], [16, 16]]) put(x, y, '%');
}

function frontGlasses(put: Put, south: boolean): void {
  for (const x of [8, 13]) {
    for (let i = x; i <= x + 3; i++) {
      put(i, 11, 'G');
      put(i, 15, 'G');
    }
    for (const y of [12, 13, 14]) {
      put(x, y, 'G');
      put(x + 3, y, 'G');
    }
  }
  put(12, 12, 'G');
  if (!south) for (let i = 3; i <= 7; i++) put(i, 12, 'G');
}

/** Blush and freckles side on. */
function sideRules(o: FaceOptions, put: Put): void {
  if (o.blush) put(15, 15, 'B');
  if (o.freckles) for (const [x, y] of [[14, 15], [16, 15], [13, 16]]) put(x, y, '%');
}

function sideGlasses(put: Put): void {
  for (let i = 14; i <= 17; i++) {
    put(i, 11, 'G');
    put(i, 15, 'G');
  }
  for (const y of [12, 13, 14]) {
    put(14, y, 'G');
    put(17, y, 'G');
  }
  for (let i = 10; i <= 13; i++) put(i, 12, 'G');
}


/** The bare head and its faces seen from the front, from behind and side on. */
export function viewsFor(skin: PaletteKey, options: FaceOptions = DEFAULT_FACE, hair: PaletteKey = 'hairBrown', mood: Mood = 'happy'): NonNullable<Look['views']> {
  const shape = SHAPES[options.shape ?? 'round'];
  const straight = parseStamp(shaped(ROUND_SOUTH, shape.straight), {}, skin);
  const side = parseStamp(pad(sideRows(options.shape ?? 'round'), 6), {}, skin);
  return {
    S: { head: straight, faces: faceSet(straight, 'front', skin, options, hair, mood) },
    N: { head: straight, faces: {} },
    E: { head: side, faces: faceSet(side, 'side', skin, options, hair, mood) },
  };
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
  return faceSet(headFor(skin, options.shape).front, 'diagonal', skin, options, hair, mood);
}

/** The faces of one view of the head, see `facesFor`. */
function faceSet(head: Stamp, view: FaceView, skin: PaletteKey, options: FaceOptions, hair: PaletteKey, mood: Mood): Record<string, Stamp> {
  const legend = { I: 'ink', M: 'mouth', T: 'tooth', B: 'blush', C: options.eyeColor ?? 'ink', E: hair, G: options.glassesColor ?? 'black' } as const;
  // Features stay on the head: on a narrow head a freckle or a glasses arm off the edge is left out.
  const make = (as: Mood, blink: boolean, aside = false) =>
    parseStamp(pad(faceRows(options, as, blink, aside, view), 0), legend, skin).map((row, y) => row.map((cell, x) => (head[y]?.[x] ? cell : null)));
  const cheerful = mood === 'neutral' || mood === 'smile' || mood === 'happy' || mood === 'laughing';
  // 'aside' looks away from where the face points: left on screen when the face points right.
  // 'smile' and 'surprised' are passing expressions; a dark mood keeps its own mouth for a smile.
  return {
    neutral: make(mood, false), blink: make(mood, true), happy: make(cheerful ? 'laughing' : mood, false), aside: make(mood, false, true),
    smile: make(cheerful ? 'smile' : mood, false), surprised: make('surprised', false),
  };
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

/** A beard seen from behind a round head: the back stamp an item carries. The renderer works it out again for the head worn. */
export const beardFromBehind = (front: Stamp): Stamp => beardBehind(front, parseStamp(shaped(ROUND_BACK, {}), {}, 'skinB'));

/** How strongly stubble and shaved hair tint the skin. */
const STUBBLE = 0.4;

/**
 * Beards drawn by hand, in the face grid (rows from 12, the eyes' top row). The mouth is drawn
 * over any beard by the renderer, so these cover the lips freely. H hair, L lit, h shaded.
 */
const BEARD_ROWS: Record<string, { label: string; rows: string[]; side: string[]; short?: boolean }> = {
  stubble: {
    label: 'Stubble',
    short: true,
    // Side on, facing right: the side head's ear is at columns 6 to 8, the mouth at 16 and 17.
    side: [
      '.........H...........',
      '.........H...........',
      '.........HH..........',
      '.........HHHH...HH...',
      '.........HHHHHHHHH...',
      '.........HHHHHHHHH...',
      '..........HHHHHHHH...',
      '..........HHHHHH.....',
    ],
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
    side: [
      '.....................',
      '.....................',
      '.....................',
      '..............HHHH...',
      '..............hH.....',
      '..............h......',
    ],
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
    side: [
      '.....................',
      '.....................',
      '.....................',
      '..............HHHH...',
      '..............HH.....',
      '..............HHHH...',
      '..............HHHH...',
      '...............HHh...',
      '...............hh....',
    ],
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
    side: [
      '.........HH..........',
      '.........HH..........',
      '.........HH..........',
      '.........HHH.........',
      '..........HHH........',
      '...........HHH.......',
      '............HHHHHH...',
      '.............hhhhh...',
    ],
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
    side: [
      '.........H...........',
      '.........H...........',
      '.........HH..........',
      '.........HHH..HHHH...',
      '.........HHHHHHHH....',
      '.........HHHHHHHHh...',
      '..........HHHHHHHh...',
      '...........HHHHHh....',
      '.............hhh.....',
    ],
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

export const BEARD_STYLES = Object.entries(BEARD_ROWS).map(([id, { label, rows, side, short }]) => {
  const parse = (lines: string[]) => {
    const parsed = parseStamp(pad(lines, 12), { H: 'hairBrown', L: 'hairBrown+' });
    return short ? parsed.map((row) => row.map((c) => c && { ...c, shade: true, mix: STUBBLE })) : parsed;
  };
  const front = parse(rows);
  const item: Item = { name: label, slot: 'beard', head: { front, back: beardFromBehind(front) }, views: { E: { head: parse(side) } }, ...(short ? { short } : {}) };
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

// Short hair seen from the front: a fringe in clumps and both sideburns.
const SHORT_HAIR_SOUTH = pad([
  '.........HH..H.......',
  '......HHHHHHHHH......',
  '....HHHLLLLHHHHHH....',
  '...HHLLLHHHHHHHHHH...',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHhhHHHHHhhHHhh..',
  '..HHh..hHHHHh..hHh...',
  '..Hh.....hHh.....hh..',
  '..H...............h..',
  '..h...............h..',
], 2);

// From behind, down to the nape, the ears showing.
const SHORT_HAIR_NORTH = pad([
  '.........H..HH.......',
  '......HHHHHHHHH......',
  '....HHHHHLLLLHHHH....',
  '...HHHHHHLLLHHHHHH...',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..hHHHHHHHHHHHHHHHh..',
  '...hHHHHHHHHHHHHHh...',
  '...hhHHHHHHHHHHHhh...',
  '....hhHHHhHHhHHhh....',
  '......hh.hh..hh......',
], 2);

// Side on: the fringe over the forehead, the back of the head down to the nape, a sideburn in
// front of the ear.
const SHORT_HAIR_EAST = pad(([
  '.......H..HH.........',
  '......HHHHHHHH.......',
  '....HHHHLLLLHHHH.....',
  '..HHHHHLLLHHHHHHHH...',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHHH.',
  '..HHHHHHHHHHHHHHHHHh.',
  '..HHHHHHHHHHHHHHHhhh.',
  '..HHHHHHHHHHHHHh.....',
  '..hHHHHHHHHHh........',
  '..hHHH....h..........',
  '..hHHH....h..........',
  '...hHH...............',
  '...hhH...............',
  '....h................',
] as string[]).map(shallow), 2);

// Long hair from the front: parted over the brow, falling either side of the face.
const LONG_HAIR_SOUTH = pad([
  '......HHHHHHHHH......',
  '....HHHHHLLLLHHHH....',
  '...HHHHLLLHHHHHHHH...',
  '..HHHHHHHHHHHHHHHHH..',
  '.HHHHHHHHHHHHHHHHHHH.',
  '.HHHHHHHHHHHHHHHHHHh.',
  '.HHHHHHHHhhhHHHHHHHh.',
  '.HHHHhh.......hhHHHh.',
  '.HHHh..........hHHhh.',
  '.HHh............hHhh.',
  '.HHh.............Hhh.',
  '.HHh.............Hhh.',
  '.HHh.............Hhh.',
  '.HHH.............HHh.',
  '.hHH.............HHh.',
  '.hHH.............HHh.',
  '.hHHh...........hHHh.',
  '..hHh...........hHh..',
  '..hhh...........hhh..',
  '...h.............h...',
], 3);

const LONG_HAIR_BEHIND_SOUTH = pad([
  '...hhhhhhhhhhhhhhh...',
  '...hhhhhhhhhhhhhhh...',
  '...hhhhhhhhhhhhhhh...',
  '...hhhhhhhhhhhhhhh...',
  '....hhhhhhhhhhhhh....',
  '....hhhhhhhhhhhhh....',
  '.....hhhhhhhhhhh.....',
  '.....hh.hhhhh.hh.....',
], 16);

const LONG_HAIR_NORTH = pad([
  '......HHHHHHHHH......',
  '....HHHHHLLLLHHHH....',
  '...HHHHHHLLLHHHHHH...',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHHHHHHHHHHHHh..',
  '..HHHHHhHHHHHhHHHHh..',
  '..HHHHHhHHHHHhHHHHh..',
  '..HHHHHhHHHHHhHHHHh..',
  '..hHHHHhHHHHHhHHHHh..',
  '...hHHHhHHHHHhHHHh...',
  '...hHHHhHHHHHhHHHh...',
  '...hhHHhHHHHHhHHhh...',
  '....hHHhhHHHhhHHh....',
  '....hhHh.hHh.hHhh....',
  '.....hh...h...hh.....',
], 3);

// Long hair side on: the fringe in front, the mass falling down the back to the shoulders.
const LONG_HAIR_EAST = pad(([
  '......HHHHHHHHH......',
  '....HHHHLLLLHHHHH....',
  '..HHHHHLLLHHHHHHHH...',
  '..HHHHHHHHHHHHHHHHH..',
  '.HHHHHHHHHHHHHHHHHHH.',
  '.HHHHHHHHHHHHHHHHHHh.',
  '.HHHHHHHHHHHHHHHHhhh.',
  '.HHHHHHHHHHHHHHh.....',
  '.HHHHHHHHHHHhh.......',
  '.HHHHH....h..........',
  '.HHHHH....h..........',
  '.HHHHHH..............',
  '.HHHHHHh.............',
  '.hHHHHHh.............',
  '.hHHHHHh.............',
  '.hHHHHh..............',
  '..hHHHh..............',
  '..hHHh...............',
  '..hhhh...............',
  '...hh................',
] as string[]).map(shallow), 3);

type HairViews = Partial<Record<OwnView, { head: string[]; behind?: string[] }>>;

const hairItem = (name: string, color: PaletteKey, front: string[], back: string[], behind?: string[], views: HairViews = {}): Item => {
  const legend = { H: color, L: `${color}+` } as const;
  const empty = pad([], 0);
  return {
    name,
    slot: 'hair',
    head: { front: parseStamp(front, legend), back: parseStamp(back, legend) },
    ...(behind ? { headBehind: { front: parseStamp(behind, legend), back: parseStamp(empty, legend) } } : {}),
    views: Object.fromEntries(
      Object.entries(views).map(([view, v]) => [view, { head: parseStamp(v.head, legend), ...(v.behind ? { behind: parseStamp(v.behind, legend) } : {}) }]),
    ),
  };
};

export const HAIR_STYLES: HairStyle[] = [
  {
    id: 'short',
    label: 'Short and unruly',
    make: (color) => hairItem('Short hair', color, SHORT_HAIR_FRONT, SHORT_HAIR_BACK, undefined, { S: { head: SHORT_HAIR_SOUTH }, N: { head: SHORT_HAIR_NORTH }, E: { head: SHORT_HAIR_EAST } }),
  },
  {
    id: 'long',
    label: 'Long',
    make: (color) =>
      hairItem('Long hair', color, LONG_HAIR_FRONT, LONG_HAIR_BACK, LONG_HAIR_BEHIND, {
        S: { head: LONG_HAIR_SOUTH, behind: LONG_HAIR_BEHIND_SOUTH }, N: { head: LONG_HAIR_NORTH }, E: { head: LONG_HAIR_EAST },
      }),
  },
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
