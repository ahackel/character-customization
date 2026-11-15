// Check sheet for the waist, skirts and headbands. Usage: node lab/tools/pass5.mjs <out.png> [scale]
import fs from 'node:fs';
import { writeSheet } from './sheet.mjs';
import { drawCharacter, BUILDS } from '../puppet.ts';
import { AUTHORED, STAND } from '../poses.ts';
import { baseLook, wear, HAIR_STYLES, DEFAULT_FACE, facesFor, UNDERSHORTS, UNDERTOP } from '../base.ts';
import { compile } from '../items.ts';

const item = (file, n) => {
  const result = compile(file.startsWith('sprite') ? 'sprite' : 'recipe', JSON.parse(fs.readFileSync(`lab/generated/${file}.json`, 'utf8'))[n]);
  if (!result.ok) throw new Error(result.error);
  return result.compiled.item;
};
const person = (skin, hair, build, frame, ...items) =>
  wear({ ...baseLook(skin, hair), build: BUILDS[build], frame, faces: facesFor(skin, { ...DEFAULT_FACE, lashes: frame === 'f' }, hair) }, ...items);
const long = (c) => HAIR_STYLES[1].make(c);
const walk = (look, facing) => AUTHORED.walk.frames.map((p) => drawCharacter(look, p, facing));
const four = (look) => [0, 1, 2, 3].map((f) => drawCharacter(look, STAND, f));

const bare = (b) => person('skinB', 'hairBrown', b, 'f', long('hairBrown'), UNDERSHORTS, UNDERTOP);
const dress = (n, b = 1) => person('skinC', 'hairBlack', b, 'f', long('hairBlack'), item('sprite-dresses', n));
const rows = [
  [...four(bare(0)), ...four(bare(1)), ...four(bare(2))],
  [...four(person('skinB', 'hairBlond', 1, 'f', long('hairBlond'), item('recipe-tops', 1), item('recipe-bottoms', 3))), ...four(person('skinD', 'hairBlack', 2, 'f', item('sprite-formal', 0), item('sprite-everyday-bottoms', 0))), ...four(dress(0, 0))],
  [...walk(dress(0), 0), ...walk(dress(0), 3)],
  [...walk(dress(1), 0), ...walk(dress(2), 3)],
  [...walk(person('skinA', 'hairRed', 1, 'f', long('hairRed'), UNDERTOP, item('sprite-everyday-bottoms', 2)), 0), ...walk(person('skinB', 'hairBrown', 2, 'm', UNDERTOP, item('sprite-leafskirt', 1)), 0)],
  [0, 1, 2].flatMap((n) => four(person('skinB', 'hairBrown', 1, n === 1 ? 'f' : 'm', ...(n === 1 ? [long('hairBrown')] : []), item('sprite-bandana', n)))),
];
writeSheet(process.argv[2], rows, Number(process.argv[3] ?? 4));
