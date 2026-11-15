// Bakes everything the game needs to draw into texture atlases: every plant, rock and driftwood
// in its variants and wind frames, and a character in every facing and clip. This is the export
// step described in docs/export.md: the game itself never runs the rules, it draws quads.
//
// Usage: node lab/tools/bake.mjs [outDir=dist-bake] [pageSize=1024]
//
// Writes atlas-<n>.png pages and atlas.json:
//   frames:     name -> { page, x, y, w, h, pivot: [x, y] }   pivot = the pixel on the ground
//   animations: name -> { fps, frames: [frame names] }
// Each frame is trimmed to what it paints. Identical frames are stored once (hard plants have no
// wind frames to speak of, mirrored character facings are not mirrored here: flip the quad).
// Ground shadows are separate frames ending in "/shadow": draw them all into one shadow layer
// first, so overlapping shadows do not darken the ground twice.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { tryPlant, grow, drawPlant, FRAMES, SHADOW } from '../flora.ts';
import { drawCharacter, BUILDS } from '../puppet.ts';
import { AUTHORED } from '../poses.ts';
import { baseLook } from '../base.ts';

const [outDir = 'dist-bake', pageArg = '1024'] = process.argv.slice(2);
const PAGE = Number(pageArg);
const VARIANTS = 4;
const BREEZE = 1;

/** A trimmed picture: RGBA bytes plus where the ground pivot is. */
function trim(w, h, pixel, pivot) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!pixel(x, y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return null;
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;
  const rgba = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const hex = pixel(x + x0, y + y0);
    if (!hex) continue;
    const o = (y * tw + x) * 4;
    for (let k = 0; k < 3; k++) rgba[o + k] = parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
    rgba[o + 3] = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
  }
  return { w: tw, h: th, rgba, pivot: [pivot.x - x0, pivot.y - y0] };
}

const frames = new Map(); // name -> picture or alias
const byContent = new Map(); // content key -> name
const animations = {};
function add(name, picture) {
  if (!picture) return null;
  const key = `${picture.w}x${picture.h}|${picture.pivot}|${Buffer.from(picture.rgba).toString('base64')}`;
  const same = byContent.get(key);
  if (same) {
    frames.set(name, { alias: same });
    return name;
  }
  byContent.set(key, name);
  frames.set(name, picture);
  return name;
}

// ---- plants, rocks, driftwood
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'generated');
for (const file of fs.readdirSync(dir).filter((f) => /^plant-[\w-]+\.json$/.test(f)).sort()) {
  const set = file.slice(6, -5);
  JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).forEach((raw, index) => {
    const result = tryPlant(raw);
    if (!result.ok) return console.log('skipped', file, index, result.error);
    const id = `plant-${set}-${index}`;
    for (let seed = 0; seed < VARIANTS; seed++) {
      const grown = grow(result.compiled.plant, { seed });
      const list = [];
      for (let f = 0; f < FRAMES; f++) {
        const r = drawPlant(grown, { frame: f, wind: BREEZE });
        list.push(add(`${id}/${seed}/${f}`, trim(r.w, r.h, (x, y) => r.get(x, y), r.origin)));
        if (f === 0) add(`${id}/${seed}/shadow`, trim(r.w, r.h, (x, y) => (r.shaded(x, y) ? '#000000' : null), r.origin));
      }
      animations[`${id}/${seed}/wind`] = { fps: 6, frames: list };
    }
  });
}

// ---- a character: four facings, every clip
const look = { ...baseLook('skinB', 'hairBrown'), build: BUILDS[1] };
for (const [clipId, clip] of Object.entries(AUTHORED)) {
  for (const facing of [0, 1, 2, 3]) {
    const list = clip.frames.map((pose, i) => {
      const sprite = drawCharacter(look, pose, facing, { face: clip.faces?.[i], swing: clip.swing });
      const name = `character/${clipId}/${facing}/${i}`;
      return add(name, trim(64, 64, (x, y) => { const c = sprite.get(x, y); return c === SHADOW ? null : c; }, { x: 32, y: 52 }));
    });
    animations[`character/${clipId}/${facing}`] = { fps: clip.rate, frames: list };
  }
}
{
  const sprite = drawCharacter(look, AUTHORED.idle.frames[0], 0);
  add('character/shadow', trim(64, 64, (x, y) => (sprite.get(x, y) === SHADOW ? '#000000' : null), { x: 32, y: 52 }));
}

// ---- pack: tallest first onto shelves, 1 pixel apart
const unique = [...frames.entries()].filter(([, f]) => !f.alias).sort((a, b) => b[1].h - a[1].h || b[1].w - a[1].w);
const pages = [];
let page = null;
let shelf = { x: 0, y: 0, h: 0 };
const placed = {};
for (const [name, f] of unique) {
  if (f.w > PAGE || f.h > PAGE) throw new Error(`${name} does not fit a ${PAGE} page`);
  if (!page || shelf.x + f.w > PAGE) shelf = { x: 0, y: shelf.y + shelf.h + 1, h: 0 };
  if (!page || shelf.y + f.h > PAGE) {
    page = new PNG({ width: PAGE, height: PAGE });
    pages.push(page);
    shelf = { x: 0, y: 0, h: 0 };
  }
  for (let y = 0; y < f.h; y++) {
    const o = ((shelf.y + y) * PAGE + shelf.x) * 4;
    page.data.set(f.rgba.subarray(y * f.w * 4, (y + 1) * f.w * 4), o);
  }
  placed[name] = { page: pages.length - 1, x: shelf.x, y: shelf.y, w: f.w, h: f.h, pivot: f.pivot };
  shelf.x += f.w + 1;
  shelf.h = Math.max(shelf.h, f.h);
}
const out = {};
for (const [name, f] of frames) out[name] = f.alias ? placed[f.alias] : placed[name];

fs.mkdirSync(outDir, { recursive: true });
pages.forEach((p, i) => fs.writeFileSync(path.join(outDir, `atlas-${i}.png`), PNG.sync.write(p)));
fs.writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify({ pageSize: PAGE, pages: pages.length, frames: out, animations }));
const pixels = unique.reduce((n, [, f]) => n + f.w * f.h, 0);
console.log(`${frames.size} frames, ${unique.length} unique, ${pages.length} page(s) of ${PAGE}², ${Math.round((100 * pixels) / (pages.length * PAGE * PAGE))}% filled`);
