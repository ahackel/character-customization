// Check sheets for moods, the hand-written run, use and wave clips, and the belly.
// Usage: node lab/tools/pass7.mjs <out.png> [scale] [moods|motion|belly]
import fs from 'node:fs';
import { writeSheet } from './sheet.mjs';
import { drawCharacter, BUILDS } from '../puppet.ts';
import { AUTHORED, STAND } from '../poses.ts';
import { baseLook, wear, HAIR_STYLES, DEFAULT_FACE, facesFor, MOODS, UNDERTOP } from '../base.ts';
import { compile } from '../items.ts';

const item = (file, n) => {
  const result = compile(file.startsWith('sprite') ? 'sprite' : 'recipe', JSON.parse(fs.readFileSync(`lab/generated/${file}.json`, 'utf8'))[n]);
  if (!result.ok) throw new Error(`${file} ${n}: ${result.error}`);
  return result.compiled.item;
};
const person = (skin, hair, build, frame, face, mood, ...items) =>
  wear({ ...baseLook(skin, hair), build: BUILDS[build], frame, faces: facesFor(skin, { ...DEFAULT_FACE, lashes: frame === 'f', ...face }, hair, mood) }, ...items);
const long = (c) => HAIR_STYLES[1].make(c);
const clip = (look, name, facing) => AUTHORED[name].frames.map((p, i) => drawCharacter(look, p, facing, { face: AUTHORED[name].faces?.[i], swing: AUTHORED[name].swing }));

const part = process.argv[4] ?? 'moods';
let rows = [];
if (part === 'moods') {
  const faces = [
    ['skinB', 'hairBrown', 'm', {}],
    ['skinD', 'hairBlack', 'f', { eyes: 'round', eyeColor: 'green' }],
    ['skinA', 'hairBlond', 'm', { eyes: 'small', brows: 'thick', glasses: true, glassesColor: 'red' }],
    ['skinC', 'hairRed', 'f', { eyes: 'sleepy', brows: 'thin', freckles: true }],
  ];
  rows = faces.map(([skin, hair, frame, face]) => MOODS.flatMap((mood) => {
    const look = person(skin, hair, 1, frame, face, mood, ...(frame === 'f' ? [long(hair), UNDERTOP] : []));
    return [drawCharacter(look, STAND, 0), drawCharacter(look, STAND, 0, { face: 'blink' })];
  }));
} else if (part === 'motion') {
  const dressed = (...extra) => person('skinB', 'hairBrown', 1, 'm', {}, 'happy', item('recipe-everyday', 0), item('sprite-everyday-bottoms', 0), ...extra);
  const axe = item('sprite-axe', 0);
  const spear = item('sprite-spear', 0);
  rows = [
    [...clip(dressed(), 'run', 0), ...clip(dressed(), 'run', 3)],
    [...clip(dressed(axe), 'use', 0), ...clip(dressed(axe), 'use', 3), ...clip(dressed(), 'use', 0).slice(1, 3)],
    [...clip(dressed(spear), 'use', 0), ...clip(dressed(item('sprite-rod', 0)), 'use', 0), ...clip(dressed(item('sprite-carried', 2)), 'use', 0).slice(1, 3)],
    [...clip(dressed(), 'wave', 0), ...clip(dressed(), 'wave', 3), ...clip(dressed(spear), 'run', 0).slice(0, 4)],
  ];
} else {
  const outfits = [[], [item('recipe-tops', 0), item('recipe-bottoms', 0)], [item('sprite-formal', 0), item('sprite-everyday-bottoms', 1)]];
  rows = [
    [...outfits.flatMap((o) => [0, 3].map((f) => drawCharacter(person('skinB', 'hairBrown', 2, 'm', {}, 'happy', ...o), STAND, f))),
      ...outfits.flatMap((o) => [0, 3].map((f) => drawCharacter(person('skinC', 'hairBlack', 2, 'f', {}, 'happy', long('hairBlack'), UNDERTOP, ...o), STAND, f)))],
  ];
}
writeSheet(process.argv[2], rows, Number(process.argv[3] ?? 4));
