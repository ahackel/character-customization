// Compiles every generated file and reports what is valid, repaired or rejected.
// With an output path, also renders each candidate standing, front and back.
import fs from 'node:fs';
import { writeSheet } from './sheet.mjs';
import { drawCharacter } from '../puppet.ts';
import { STAND } from '../poses.ts';
import { baseLook, wear } from '../base.ts';
import { compile } from '../items.ts';

const only = process.argv[3]?.split(',');
const look = baseLook();
const rows = [];
let valid = 0, repaired = 0, rejected = 0;
for (const file of fs.readdirSync('lab/generated').filter((f) => /^(sprite|recipe)-.*\.json$/.test(f)).sort()) {
  const [, format, set] = file.match(/^(sprite|recipe)-(.*)\.json$/);
  if (only && !only.includes(set)) continue;
  let list;
  try { list = JSON.parse(fs.readFileSync(`lab/generated/${file}`, 'utf8')); } catch (e) { console.log(`${file}: not valid JSON (${e.message})`); rejected++; continue; }
  const row = [];
  list.forEach((candidate, i) => {
    const result = compile(format, candidate);
    if (!result.ok) { rejected++; console.log(`${file} #${i + 1} "${candidate.name}" REJECTED: ${result.error}`); return; }
    for (const w of result.compiled.warnings ?? []) console.log(`${file} #${i + 1} "${candidate.name}" views disagree: ${w}`);
    if (result.compiled.repairs.length) { repaired++; console.log(`${file} #${i + 1} "${candidate.name}" repaired: ${result.compiled.repairs.join('; ')}`); } else valid++;
    const dressed = wear(look, result.compiled.item);
    row.push(drawCharacter(dressed, STAND, 0), drawCharacter(dressed, STAND, 3));
  });
  rows.push(row);
}
console.log(`valid ${valid}, repaired ${repaired}, rejected ${rejected}`);
if (process.argv[2] && process.argv[2] !== '-') writeSheet(process.argv[2], rows, 5);
