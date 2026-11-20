// The skeleton: a character like any other (the same rig, clips and wardrobe) drawn in bone, with
// a skull for a head, ribs and a pelvis for a body, and gaps at the joints (`Look.skeleton`).
import type { Cell, PaletteKey } from '../core/palette.ts';
import { parseStamp, TORSO_FRAME, type Item, type Stamp } from '../core/puppet.ts';

export const BONE: PaletteKey = 'bone';

/** A face with the features turned into a skull's: hollow eyes and a row of teeth. */
export function skullFaces(faces: Record<string, Stamp>): Record<string, Stamp> {
  // The view from behind has no face.
  if (!faces.neutral) return {};
  const out: Record<string, Stamp> = {};
  for (const [name, stamp] of Object.entries(faces)) {
    const face: Stamp = stamp.map((row, y) => row.map((cell, x): Cell | null => {
      if (!cell) return null;
      if (cell.key === 'ink' || cell.key === 'tooth') return { key: 'ink', shade: false };
      if (cell.key === 'mouth') return { key: (x + y) % 2 ? 'tooth' : 'ink', shade: false };
      return null;
    }));
    // Two eyes seen face on get a pixel wider, towards the outside: big round sockets.
    const eyes = face.flatMap((row, y) => row.flatMap((c, x) => (c?.key === 'ink' ? [[x, y] as const] : [])));
    const top = Math.min(...eyes.map(([, y]) => y));
    const socket = eyes.filter(([, y]) => y <= top + 2);
    const xs = socket.map(([x]) => x);
    if (socket.length && Math.max(...xs) - Math.min(...xs) > 4) {
      const mid = (Math.max(...xs) + Math.min(...xs)) / 2;
      for (const [x, y] of socket) face[y][x < mid ? x - 1 : x + 1] ??= { key: 'ink', shade: false } as Cell;
    }
    out[name] = face;
  }
  // A skull never changes its look: every face is the neutral one, with the same grin.
  const grin = out.neutral.map((row) => [...row]);
  const mouth = faces.neutral.flatMap((row, y) => row.flatMap((c, x) => (c?.key === 'mouth' ? [[x, y] as const] : [])));
  if (mouth.length) {
    const xs = mouth.map(([x]) => x);
    const y = mouth[0][1];
    const x0 = Math.min(...xs) - 1;
    const w = Math.max(...xs) - x0 + 2;
    for (const [dy, odd] of [[0, 1], [1, 1]] as const) {
      grin[y + dy] ??= [];
      for (let p = 0; p < w; p++) {
        const edge = p === 0 || p === w - 1;
        grin[y + dy][x0 + p] = { key: edge || p % 2 === odd ? 'ink' : 'tooth', shade: false } as Cell;
      }
    }
  }
  return Object.fromEntries(Object.keys(out).map((name) => [name, grin]));
}

/** A head stamp with the blush taken out of the ears and nose. */
export const boneHead = (stamp: Stamp): Stamp => stamp.map((row) => row.map((c) => (c?.flush ? { ...c, flush: false } : c)));

// Body rows are written 9 wide and placed in the torso frame as underwear is: chest from row 2, pelvis from row 10.
const body = (above: number, rows: string[]) =>
  parseStamp([...Array(above).fill('.'.repeat(TORSO_FRAME.w)), ...rows.map((row) => '......' + row + '......')], { W: BONE });

/** Ribs: bars with nothing between them, round a spine. `open` leaves the body block out, so the gaps are see-through. */
export const RIBS: Item = {
  name: 'Ribs',
  slot: 'top',
  open: true,
  torso: {
    front: body(2, ['WWWWWWWWW', '.W..W..W.', '.WWWWWWW.', '.W..W..W.', '.WWWWWWW.', '..W.W.W..', '...WWW...', '....W....']),
    back: body(2, ['wWWWWWWWw', '.W..W..W.', '.WWWWWWW.', '.W..W..W.', '.WWWWWWW.', '..W.W.W..', '...WWW...', '....W....']),
  },
};

export const PELVIS: Item = {
  name: 'Pelvis',
  slot: 'bottom',
  open: true,
  torso: {
    front: body(10, ['.WWWWWWW.', 'WWW.W.WWW', '.WW...WW.']),
    back: body(10, ['.wWWWWWw.', 'WWWWWWWWW', '.WW...WW.']),
  },
};
