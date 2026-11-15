import type { PaletteKey } from './palette.ts';
import { HEAD_FRAME, HEAD_STAMP, parseStamp, type Item, type Look, type Slot, type Stamp, type StampPair } from './puppet.ts';

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

// Faces. Eyes are three pixels tall with a shine in the same corner of each; the far eye sits
// close to the edge of the head. A small nose shadow, blush, and an open smile.
const FACE = {
  neutral: [
    '.........TI...TI.....',
    '.........II...II.....',
    '.........II...II.....',
    '.......B.....%..B....',
    '..........MTTTTM.....',
    '...........MMMM......',
  ],
  blink: [
    '.....................',
    '.....................',
    '.........II...II.....',
    '.......B.....%..B....',
    '..........MTTTTM.....',
    '...........MMMM......',
  ],
  happy: [
    '.....................',
    '.........II...II.....',
    '........I..I.I..I....',
    '.......B.....%..B....',
    '..........MTTTTM.....',
    '..........MTTTTM.....',
    '...........MMMM......',
  ],
};

export function headFor(skin: PaletteKey): StampPair {
  return { front: parseStamp(HEAD_FRONT, {}, skin), back: parseStamp(HEAD_BACK, {}, skin) };
}

export function facesFor(skin: PaletteKey): Record<string, Stamp> {
  const legend = { I: 'ink', M: 'mouth', T: 'tooth', B: 'blush' } as const;
  return Object.fromEntries(Object.entries(FACE).map(([name, rows]) => [name, parseStamp(pad(rows, 12), legend, skin)]));
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

const shorts = (rows: string[]) => parseStamp([...Array(10).fill('.'.repeat(15)), ...rows], { W: 'white' });

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

export function baseLook(skin: PaletteKey = 'skinB', hair: PaletteKey = 'hairBrown'): Look {
  return { skin, head: headFor(skin), faces: facesFor(skin), items: [UNDERSHORTS, shortHair(hair)] };
}

/** Puts items on a look, one per slot: a new item replaces whatever was in its slot. */
export function wear(look: Look, ...items: Item[]): Look {
  const bySlot = new Map<Slot, Item>(look.items.map((i) => [i.slot, i]));
  for (const item of items) bySlot.set(item.slot, item);
  return { ...look, items: [...bySlot.values()] };
}
