// Large close-up of a dressed character for inspection. Usage: node lab/tools/closeup.mjs <out.png> [scale]
import fs from 'node:fs';
import { writeSheet } from './sheet.mjs';
import { drawCharacter, BUILDS } from '../puppet.ts';
import { AUTHORED, STAND } from '../poses.ts';
import { baseLook, wear, HAIR_STYLES } from '../base.ts';
import { compile } from '../items.ts';

const pick = (format, id, n) => {
  const list = JSON.parse(fs.readFileSync(`lab/generated/${format}-${id}.json`, 'utf8'));
  const result = compile(format, list[n]);
  if (!result.ok) throw new Error(result.error);
  return result.compiled.item;
};
export const outfit = () => [pick('recipe', 'shirt', 0), pick('sprite', 'shorts', 0), pick('sprite', 'hat', 2), pick('sprite', 'spear', 0)];

if (process.argv[1].endsWith('closeup.mjs')) {
  const short = baseLook();
  const long = wear(baseLook('skinC', 'hairBlack'), HAIR_STYLES[1].make('hairBlack'));
  const sturdy = { ...baseLook('skinA', 'hairRed'), build: BUILDS[1] };
  const noTool = (look) => ({ ...look, items: look.items.filter((i) => i.slot !== 'tool') });
  const four = (look, pose = STAND) => [0, 1, 2, 3].map((f) => drawCharacter(look, pose, f));
  const dressedSturdy = wear(sturdy, ...outfit());
  const dressedLong = wear(long, ...outfit().filter((i) => i.slot !== 'hat'));
  const rows = [
    [...four(short), ...four(long)],
    [...four(sturdy), ...four(dressedSturdy)],
    [...four(dressedLong), ...four(wear(short, ...outfit()))],
    [...AUTHORED.walk.frames.map((p) => drawCharacter(noTool(dressedSturdy), p, 0)), ...AUTHORED.walk.frames.slice(0, 2).map((p) => drawCharacter(dressedLong, p, 3))],
  ];
  writeSheet(process.argv[2], rows, Number(process.argv[3] ?? 6));
}
