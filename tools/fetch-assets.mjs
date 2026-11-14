// Downloads the CC0 KayKit Adventurers source characters into assets-src/.
// Run once before `npm run assets:build`. The built output in public/assets is committed,
// so this is only needed when changing the asset pipeline.
import fs from 'node:fs';
import path from 'node:path';

const BASE =
  'https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main';
const FILES = [
  ['LICENSE.txt', 'LICENSE.txt'],
  ...['Knight', 'Barbarian', 'Mage', 'Rogue', 'Rogue_Hooded'].map((n) => [
    `addons/kaykit_character_pack_adventures/Characters/gltf/${n}.glb`,
    `${n}.glb`,
  ]),
];
const OUT = 'assets-src/kaykit';
fs.mkdirSync(OUT, { recursive: true });

for (const [remote, local] of FILES) {
  const target = path.join(OUT, local);
  if (fs.existsSync(target)) {
    console.log('have   ', local);
    continue;
  }
  const res = await fetch(`${BASE}/${remote}`);
  if (!res.ok) throw new Error(`${remote}: HTTP ${res.status}`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log('fetched', local);
}
