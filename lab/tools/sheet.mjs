// Renders sprite sheets to PNG for inspection. Usage: node lab/tools/sheet.mjs <out.png> [scale]
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { drawCharacter, SPRITE_W, SPRITE_H } from '../puppet.ts';
import { AUTHORED } from '../poses.ts';
import { baseLook } from '../base.ts';

export function writeSheet(file, rows, scale = 6, background = [233, 217, 160]) {
  const cols = Math.max(...rows.map((r) => r.length));
  const gap = 2;
  const cw = SPRITE_W + gap;
  const ch = SPRITE_H + gap;
  const png = new PNG({ width: cols * cw * scale, height: rows.length * ch * scale });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = background[0]; png.data[i + 1] = background[1]; png.data[i + 2] = background[2]; png.data[i + 3] = 255;
  }
  rows.forEach((row, r) => row.forEach((sprite, c) => {
    if (!sprite) return;
    for (let y = 0; y < SPRITE_H; y++) for (let x = 0; x < SPRITE_W; x++) {
      const hex = sprite.get(x, y);
      if (!hex) continue;
      const rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const o = (((r * ch + y) * scale + sy) * png.width + (c * cw + x) * scale + sx) * 4;
        png.data[o] = rgb[0]; png.data[o + 1] = rgb[1]; png.data[o + 2] = rgb[2];
      }
    }
  }));
  fs.writeFileSync(file, PNG.sync.write(png));
}

if (process.argv[1].endsWith('sheet.mjs')) {
  const look = baseLook();
  const frames = [...AUTHORED.idle.frames, ...AUTHORED.walk.frames, ...AUTHORED.wave.frames];
  const rows = [0, 1, 2, 3].map((facing) => frames.map((pose) => drawCharacter(look, pose, facing)));
  writeSheet(process.argv[2], rows, Number(process.argv[3] ?? 6));
}
