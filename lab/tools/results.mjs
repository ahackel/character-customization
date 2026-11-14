// Compiles every generated candidate and reports what was valid, repaired or rejected.
import fs from 'node:fs';
import { writeSheet } from './sheet.mjs';
import { drawCharacter } from '../puppet.ts';
import { AUTHORED, STAND } from '../poses.ts';
import { baseLook, wear } from '../base.ts';
import { compile } from '../items.ts';

const requests = JSON.parse(fs.readFileSync('lab/generated/requests.json', 'utf8'));
const look = baseLook();
const rows = [];
for (const req of requests) {
  for (const format of ['sprite', 'recipe']) {
    const file = `lab/generated/${format}-${req.id}.json`;
    if (!fs.existsSync(file)) { console.log(`${format}-${req.id}: not written yet`); continue; }
    let list;
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log(`${format}-${req.id}: not valid JSON (${e.message})`); continue; }
    const row = [];
    list.forEach((candidate, i) => {
      const result = compile(format, candidate);
      const status = !result.ok ? `REJECTED: ${result.error}` : result.compiled.repairs.length ? `repaired: ${result.compiled.repairs.join('; ')}` : 'valid';
      console.log(`${format}-${req.id} #${i + 1} "${candidate.name}" -> ${status}`);
      if (!result.ok) { row.push(null, null, null, null); return; }
      const dressed = wear(look, result.compiled.item);
      row.push(drawCharacter(dressed, STAND, 0), drawCharacter(dressed, STAND, 3), drawCharacter(dressed, AUTHORED.walk.frames[0], 0), drawCharacter(dressed, AUTHORED.wave.frames[2], 1));
    });
    rows.push(row);
  }
}
if (process.argv[2]) writeSheet(process.argv[2], rows, 4);
