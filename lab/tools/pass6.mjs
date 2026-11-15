// Check sheet for wear levels, boots, the belly and new hair. Usage: node lab/tools/pass6.mjs <out.png> [scale] [part]
import fs from 'node:fs';
import { writeSheet } from './sheet.mjs';
import { drawCharacter, BUILDS } from '../puppet.ts';
import { AUTHORED, STAND } from '../poses.ts';
import { baseLook, wear, HAIR_STYLES, DEFAULT_FACE, facesFor, UNDERSHORTS, UNDERTOP } from '../base.ts';
import { compile } from '../items.ts';
import { weathered } from '../wear.ts';

const read = (file) => JSON.parse(fs.readFileSync(`lab/generated/${file}.json`, 'utf8'));
const item = (file, n) => {
  const result = compile(file.startsWith('sprite') ? 'sprite' : 'recipe', read(file)[n]);
  if (!result.ok) throw new Error(`${file} ${n}: ${result.error}`);
  return result.compiled.item;
};
const person = (skin, hair, build, frame, level, face, ...items) => {
  const look = wear({ ...baseLook(skin, hair), build: BUILDS[build], frame, faces: facesFor(skin, { ...DEFAULT_FACE, lashes: frame === 'f', ...face }, hair) }, ...items);
  return { ...look, items: look.items.map((i) => (i === UNDERSHORTS || i === UNDERTOP ? i : weathered(i, level))) };
};
const long = (c) => HAIR_STYLES[1].make(c);
const four = (look) => [0, 1, 2, 3].map((f) => drawCharacter(look, STAND, f));
const pair = (look) => [0, 3].map((f) => drawCharacter(look, STAND, f));
const levels = (make) => [0, 1, 2, 3].flatMap((level) => pair(make(level)));

const part = process.argv[4] ?? 'wear';
let rows = [];
if (part === 'wear') {
  rows = [
    levels((l) => person('skinB', 'hairBrown', 1, 'm', l, {}, item('recipe-everyday', 0), item('sprite-everyday-bottoms', 0), item('sprite-hat', 2), item('recipe-footwear', 1))),
    levels((l) => person('skinD', 'hairBlack', 1, 'm', l, { glasses: true, glassesColor: 'red' }, item('sprite-formal', 0), item('sprite-everyday-bottoms', 1), item('recipe-everyday', 6))),
    levels((l) => person('skinC', 'hairBlack', 1, 'f', l, {}, long('hairBlack'), item('sprite-dresses', 0), item('recipe-footwear', 5))),
    levels((l) => person('skinA', 'hairRed', 0, 'f', l, { glasses: true, glassesColor: 'straw' }, long('hairRed'), item('sprite-casual', 2), item('sprite-everyday-bottoms', 2), item('recipe-footwear', 0))),
    levels((l) => person('skinB', 'hairBlond', 2, 'm', l, {}, item('recipe-tops', 3), item('recipe-bottoms', 0), item('recipe-footwear', 3), item('sprite-cap', 0), item('sprite-beard', 0))),
    levels((l) => person('skinE', 'hairGrey', 2, 'f', l, {}, long('hairGrey'), item('recipe-everyday', 1), item('recipe-everyday', 5), item('recipe-footwear', 7))),
  ];
} else if (part === 'belly') {
  const outfits = [[], [item('recipe-tops', 0), item('recipe-bottoms', 0)], [item('sprite-formal', 0), item('sprite-everyday-bottoms', 1)], [item('recipe-tops', 1), item('sprite-leafskirt', 0)]];
  rows = [
    outfits.flatMap((o) => pair(person('skinB', 'hairBrown', 2, 'm', 0, {}, ...o))),
    outfits.flatMap((o) => pair(person('skinC', 'hairBlack', 2, 'f', 0, {}, long('hairBlack'), UNDERTOP, ...o))),
    [...AUTHORED.walk.frames.map((p) => drawCharacter(person('skinB', 'hairBrown', 2, 'm', 0, {}, item('recipe-tops', 0), item('recipe-bottoms', 0)), p, 0)), ...pair(person('skinB', 'hairBrown', 2, 'f', 0, {}, long('hairBrown'), item('sprite-dresses', 0)))],
  ];
} else if (part === 'shoes') {
  const shoes = read('recipe-footwear').map((_, n) => item('recipe-footwear', n));
  rows = [0, 2, 3].map((l) => shoes.flatMap((s) => [drawCharacter(person('skinB', 'hairBrown', 1, 'm', l, {}, s), STAND, 0)]));
  rows.push(shoes.map((s) => drawCharacter(person('skinB', 'hairBrown', 1, 'm', 0, {}, s, item('sprite-everyday-bottoms', 0)), AUTHORED.walk.frames[1], 0)));
} else if (part === 'hair') {
  for (const file of process.argv.slice(5)) {
    const styles = read(file).map((_, n) => item(file, n));
    rows.push(styles.flatMap((s) => four(person('skinB', 'hairBrown', 1, 'f', 0, {}, s))));
    rows.push(styles.flatMap((s) => [...pair(person('skinB', 'hairBrown', 1, 'f', 3, {}, s)), ...pair(person('skinB', 'hairBrown', 1, 'f', 0, {}, s, item('sprite-hat', 2)))]));
  }
}
writeSheet(process.argv[2], rows, Number(process.argv[3] ?? 4));
