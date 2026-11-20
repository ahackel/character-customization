// The skeleton: a character like any other (the same rig, clips and wardrobe) drawn in bone, with
// a skull for a head, ribs and a pelvis for a body, and gaps at the joints (`Look.skeleton`).
import type { PaletteKey } from '../core/palette.ts';
import { parseStamp, TORSO_FRAME, type Item, type Stamp } from '../core/puppet.ts';

export const BONE: PaletteKey = 'bone';

/** A face with the features turned into a skull's: hollow eyes and a row of teeth. */
export function skullFaces(faces: Record<string, Stamp>): Record<string, Stamp> {
  const out: Record<string, Stamp> = {};
  for (const [name, stamp] of Object.entries(faces)) {
    out[name] = stamp.map((row, y) => row.map((cell, x) => {
      if (!cell) return null;
      if (cell.key === 'ink' || cell.key === 'tooth') return { key: 'ink', shade: false };
      if (cell.key === 'mouth') return { key: (x + y) % 2 ? 'tooth' : 'ink', shade: false };
      return null;
    }));
  }
  return out;
}

// Body rows are written 9 wide and placed in the torso frame as underwear is: chest from row 2, pelvis from row 10.
const body = (above: number, rows: string[]) =>
  parseStamp([...Array(above).fill('.'.repeat(TORSO_FRAME.w)), ...rows.map((row) => '...' + row + '...')], { W: BONE, K: 'black' });

/** Ribs, not a solid chest. */
export const RIBS: Item = {
  name: 'Ribs',
  slot: 'top',
  torso: {
    front: body(2, ['wWWWWWWWw', 'KKKKWKKKK', 'WWWWWWWWW', 'KKKKWKKKK', 'WWWWWWWWW', 'KKKKWKKKK', '.WWWWWWW.']),
    back: body(2, ['wWWWWWWWw', 'WWWWKWWWW', 'WKWWKWWKW', 'WWWWKWWWW', 'WKWWKWWKW', 'WWWWKWWWW', '.WWWKWWW.']),
  },
};

export const PELVIS: Item = {
  name: 'Pelvis',
  slot: 'bottom',
  torso: {
    front: body(10, ['wWWWKWWWw', 'WWKKKKKWW', '.WWW.WWW.']),
    back: body(10, ['wWWWKWWWw', 'WWWWKWWWW', '.WWW.WWW.']),
  },
};
