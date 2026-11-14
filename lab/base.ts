import type { PaletteKey } from './palette.ts';
import { HEAD_FRAME, HEAD_STAMP, parseStamp, type Item, type Look, type Slot, type StampPair } from './puppet.ts';

// The foundation set. These stamps were written as text by a language model and corrected by
// looking at the rendered result, the same loop the content pipeline would run.
// All head stamps use the 21 x 30 head frame, drawn facing right. Row 21 sits on the neck.

// They are written 21 wide with row 21 on the neck, then placed in the renderer's head frame.
const pad = (rows: string[], above: number): string[] => {
  const dx = HEAD_FRAME.ax - HEAD_STAMP.ax;
  const dy = HEAD_FRAME.ay - HEAD_STAMP.ay;
  const blank = '.'.repeat(HEAD_FRAME.w);
  const wide = rows.map((row) => '.'.repeat(dx) + row + '.'.repeat(HEAD_FRAME.w - dx - row.length));
  return [...Array(above + dy).fill(blank), ...wide, ...Array(Math.max(0, HEAD_FRAME.h - above - dy - rows.length)).fill(blank)];
};

const HEAD_FRONT = pad([
  '.....###########.....',
  '....#############....',
  '...###############...',
  '...###############...',
  '...###############...',
  '...###############...',
  '...#######II###II#...',
  '...%######II###II#...',
  '...%##############...',
  '...###############...',
  '...##########MM###...',
  '...###############...',
  '....#############....',
  '.....###########.....',
  '........%%%%%........',
  '........%%%%%........',
], 6);

const HEAD_BACK = pad([
  '.....###########.....',
  '....#############....',
  '...###############...',
  '...###############...',
  '...###############...',
  '...###############...',
  '...###############...',
  '...##############%...',
  '...##############%...',
  '...###############...',
  '...###############...',
  '...###############...',
  '....#############....',
  '.....###########.....',
  '........%%%%%........',
  '........%%%%%........',
], 6);

export function headFor(skin: PaletteKey): StampPair {
  const legend = { I: 'ink', M: 'mouth', T: 'tooth', B: 'blush' } as const;
  return { front: parseStamp(HEAD_FRONT, legend, skin), back: parseStamp(HEAD_BACK, legend, skin) };
}

const SHORT_HAIR_FRONT = pad([
  '.....HHHHHHHHHHH.....',
  '...HHHHHHHHHHHHHHH...',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHhhhhhHHHHHHH..',
  '..HHHHh.........hHH..',
  '..HHHh............H..',
  '..HHh................',
  '..hh.................',
], 4);

const SHORT_HAIR_BACK = pad([
  '.....HHHHHHHHHHH.....',
  '...HHHHHHHHHHHHHHH...',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHHH..',
  '..HHHHHHHHHHHHHHHh...',
  '..HHHHHHHHHHHHHHHh...',
  '..hHHHHHHHHHHHHHh....',
  '...hhHHHHHHHHHhh.....',
  '.....hhhhhhhhh.......',
], 4);

export function shortHair(color: PaletteKey): Item {
  return {
    name: 'Short hair',
    slot: 'hair',
    head: { front: parseStamp(SHORT_HAIR_FRONT, { H: color }), back: parseStamp(SHORT_HAIR_BACK, { H: color }) },
  };
}

/** What the survivor wears before any generated item: plain undershorts, so the body is never bare. */
export const UNDERSHORTS: Item = {
  name: 'Undershorts',
  slot: 'bottom',
  torso: {
    front: parseStamp([...Array(10).fill('.'.repeat(15)), '...WWWWWWWWw...', '...WWWWWWWWw...', '...WWWWWWWWw...'], { W: 'white' }),
    back: parseStamp([...Array(10).fill('.'.repeat(15)), '...WWWWWWWWw...', '...WWWWWWWWw...', '...WWWWWWWWw...'], { W: 'white' }),
  },
  leg: [{ key: 'white', shade: false }, { key: 'white', shade: true }, null, null, null, null, null, null, null, null],
};

export function baseLook(skin: PaletteKey = 'skinB', hair: PaletteKey = 'hairBrown'): Look {
  return { skin, head: headFor(skin), items: [UNDERSHORTS, shortHair(hair)] };
}

/** Puts items on a look, one per slot: a new item replaces whatever was in its slot. */
export function wear(look: Look, ...items: Item[]): Look {
  const bySlot = new Map<Slot, Item>(look.items.map((i) => [i.slot, i]));
  for (const item of items) bySlot.set(item.slot, item);
  return { ...look, items: [...bySlot.values()] };
}
