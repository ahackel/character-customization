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
  '...###############...',
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

export function shortHair(color: PaletteKey): Item {
  const legend = { H: color, L: `${color}+` } as const;
  return {
    name: 'Short hair',
    slot: 'hair',
    head: { front: parseStamp(SHORT_HAIR_FRONT, legend), back: parseStamp(SHORT_HAIR_BACK, legend) },
  };
}

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
