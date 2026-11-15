// Large close-up of a dressed character for inspection. Usage: node lab/tools/closeup.mjs <out.png> [scale]
import fs from 'node:fs';
import { writeSheet } from './sheet.mjs';
import { drawCharacter, BUILDS } from '../puppet.ts';
import { AUTHORED, STAND, clipsFromSamples } from '../poses.ts';
import { baseLook, wear, HAIR_STYLES, DEFAULT_FACE, facesFor } from '../base.ts';
import { compile } from '../items.ts';

const pick = (format, id, n) => {
  const list = JSON.parse(fs.readFileSync(`lab/generated/${format}-${id}.json`, 'utf8'));
  const result = compile(format, list[n]);
  if (!result.ok) throw new Error(result.error);
  return result.compiled.item;
};
export const outfit = () => [pick('recipe', 'shirt', 0), pick('sprite', 'shorts', 0), pick('sprite', 'hat', 2), pick('sprite', 'spear', 0)];

if (process.argv[1].endsWith('closeup.mjs')) {
  const sampled = clipsFromSamples(JSON.parse(fs.readFileSync('lab/generated/poses3d.json', 'utf8')));
  const pickAny = (file, n) => compile(file.startsWith('sprite') ? 'sprite' : 'recipe', JSON.parse(fs.readFileSync(`lab/generated/${file}.json`, 'utf8'))[n]).compiled.item;
  const face = (o) => ({ ...DEFAULT_FACE, ...o });
  const person = (skin, hair, build, frame, faceOptions, ...items) => wear({ ...baseLook(skin, hair), build: BUILDS[build], frame, faces: facesFor(skin, face(faceOptions), hair) }, ...items);
  const axe = pickAny('sprite-axe', 0);
  const spear = pickAny('sprite-spear', 0);
  const a = person('skinB', 'hairBrown', 1, 'm', {}, ...outfit().filter((i) => i.slot !== 'tool'), axe);
  const b = person('skinC', 'hairBlack', 0, 'f', { lashes: true, eyeColor: 'green', freckles: true }, HAIR_STYLES[1].make('hairBlack'), pickAny('recipe-tops', 1), pickAny('recipe-bottoms', 3), pickAny('sprite-cap', 0));
  const c = person('skinA', 'hairRed', 2, 'm', { glasses: true, brows: 'thick', mouth: 'smile', eyes: 'small' }, pickAny('recipe-tops', 3), pickAny('recipe-bottoms', 0), spear);
  const d = person('skinD', 'hairBlack', 1, 'f', { eyes: 'wide', lashes: true, eyeColor: 'blue', mouth: 'small' }, HAIR_STYLES[1].make('hairBlack'), pickAny('sprite-hat', 0));
  const four = (look, pose = STAND, o = {}) => [0, 1, 2, 3].map((f) => drawCharacter(look, pose, f, o));
  const rows = [
    [...four(a), ...four(b)],
    [...four(c), ...four(d)],
    [...sampled.chop.frames.map((p) => drawCharacter(a, p, 0, { swing: true })), ...sampled.chop.frames.map((p) => drawCharacter(c, p, 0, { swing: true }))],
    [...AUTHORED.walk.frames.slice(0, 4).map((p) => drawCharacter(a, p, 0)), ...AUTHORED.walk.frames.slice(0, 4).map((p) => drawCharacter(c, p, 3))],
  ];
  writeSheet(process.argv[2], rows, Number(process.argv[3] ?? 4));
}
