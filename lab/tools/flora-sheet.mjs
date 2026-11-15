// Renders plants to a PNG sheet for inspection.
// Usage: node lab/tools/flora-sheet.mjs <out.png> <scale> <plants.json|test> [variants|wind|dry|size] [character]
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { tryPlant, grow, drawPlant, canvasFor, FLORA_ORIGIN, FRAMES, Raster } from '../flora.ts';
import { drawCharacter, BUILDS } from '../puppet.ts';
import { STAND } from '../poses.ts';
import { baseLook } from '../base.ts';

export function writeRasters(file, rows, scale = 3, background = [233, 217, 160]) {
  const cols = Math.max(...rows.map((r) => r.length));
  const cells = rows.flat().filter(Boolean);
  const gap = 2;
  const cw = Math.max(...cells.map((r) => r.w)) + gap;
  const ch = Math.max(...cells.map((r) => r.h)) + gap;
  const png = new PNG({ width: cols * cw * scale, height: rows.length * ch * scale });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = background[0]; png.data[i + 1] = background[1]; png.data[i + 2] = background[2]; png.data[i + 3] = 255;
  }
  rows.forEach((row, r) => row.forEach((raster, c) => {
    if (!raster) return;
    for (let y = 0; y < raster.h; y++) for (let x = 0; x < raster.w; x++) {
      const hex = raster.get(x, y);
      if (!hex) continue;
      const rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
      const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const o = (((r * ch + y) * scale + sy) * png.width + (c * cw + x) * scale + sx) * 4;
        for (let k = 0; k < 3; k++) png.data[o + k] = Math.round(rgb[k] * alpha + png.data[o + k] * (1 - alpha));
      }
    }
  }));
  fs.writeFileSync(file, PNG.sync.write(png));
}

/** Draws the default character beside the plant, for scale. */
function withPerson(raster, origin = FLORA_ORIGIN) {
  const sprite = drawCharacter({ ...baseLook('skinB', 'hairBrown'), build: BUILDS[1] }, STAND, 0);
  const dx = origin.x - 34 - 32;
  const dy = origin.y - 52;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const hex = sprite.get(x, y);
    if (hex && !raster.get(x + dx, y + dy)) raster.set(x + dx, y + dy, hex);
  }
  return raster;
}

if (process.argv[1].endsWith('flora-sheet.mjs')) {
  const [out, scale = '3', source, mode = 'variants', person] = process.argv.slice(2);
  const list = JSON.parse(fs.readFileSync(source, 'utf8'));
  const rows = [];
  for (const raw of list) {
    const result = tryPlant(raw);
    if (!result.ok) { console.log('REJECTED', raw.name, '-', result.error); continue; }
    const { plant, repairs } = result.compiled;
    if (repairs.length) console.log('repaired', plant.name, '-', repairs.join('; '));
    const row = [];
    if (mode === 'variants') for (let seed = 0; seed < 4; seed++) row.push(drawPlant(grow(plant, { seed })));
    if (mode === 'wind') for (let f = 0; f < FRAMES; f += 2) row.push(drawPlant(grow(plant, { seed: 0 }), { frame: f, wind: 2.5 }));
    if (mode === 'dry') for (const d of [0, 0.35, 0.7, 1]) row.push(drawPlant(grow(plant, { seed: 0, dryness: d })));
    const big = canvasFor(1.5);
    if (mode === 'size') for (const size of [0.5, 0.75, 1, 1.5]) row.push(drawPlant(grow(plant, { seed: 0, size }), { origin: big.origin }, new Raster(big.w, big.h)));
    if (person) row[0] = mode === 'size' ? withPerson(row[0], big.origin) : withPerson(row[0]);
    const lost = row.reduce((n, r) => n + r.lost, 0);
    if (lost) console.log('clipped', plant.name, lost, 'pixels');
    rows.push(row);
  }
  writeRasters(out, rows, Number(scale));
}
