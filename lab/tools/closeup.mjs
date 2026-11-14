// Large close-up of a dressed character for inspection. Usage: node lab/tools/closeup.mjs <out.png> [scale]
import fs from 'node:fs';
import { writeSheet } from './sheet.mjs';
import { drawCharacter } from '../puppet.ts';
import { AUTHORED, STAND } from '../poses.ts';
import { baseLook, wear } from '../base.ts';
import { compile } from '../items.ts';

const pick = (format, id, n) => {
  const list = JSON.parse(fs.readFileSync(`lab/generated/${format}-${id}.json`, 'utf8'));
  const result = compile(format, list[n]);
  if (!result.ok) throw new Error(result.error);
  return result.compiled.item;
};
export const outfit = () => [pick('recipe', 'shirt', 0), pick('sprite', 'shorts', 0), pick('sprite', 'hat', 2), pick('sprite', 'spear', 0)];

if (process.argv[1].endsWith('closeup.mjs')) {
  const bare = baseLook();
  const dressed = wear(bare, ...outfit());
  const noTool = { ...dressed, items: dressed.items.filter((i) => i.slot !== 'tool') };
  const rows = [
    [0, 1, 2, 3].map((f) => drawCharacter(bare, STAND, f)).concat([0, 3].map((f) => drawCharacter(dressed, STAND, f))),
    AUTHORED.walk.frames.map((p) => drawCharacter(dressed, p, 0)),
    AUTHORED.walk.frames.map((p, i) => drawCharacter(i < 3 ? dressed : noTool, p, 3)),
    [...AUTHORED.idle.frames.slice(3, 6).map((p, i) => drawCharacter(bare, p, 0, { face: AUTHORED.idle.faces?.[i + 3] })),
      ...AUTHORED.wave.frames.slice(0, 3).map((p) => drawCharacter(noTool, p, 0, { face: 'happy' }))],
  ];
  writeSheet(process.argv[2], rows, Number(process.argv[3] ?? 8));
}
