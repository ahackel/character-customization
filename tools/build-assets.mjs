// Asset pipeline: turns the KayKit source characters into the runtime format.
//
//   assets-src/kaykit/*.glb  ->  public/assets/rig.glb        skeleton + animations, no meshes
//                                public/assets/items/*.glb    one file per item, geometry only
//                                public/assets/atlas.png      all source textures in one atlas
//                                public/assets/catalog.json   item metadata, slots, rig data
//
// Every item is expressed against the same compact joint list, so any item can be bound to
// any character at runtime. This is the step a real content pipeline would run on generated
// or hand-made items after fitting them to the base body.
import { NodeIO, Document } from '@gltf-transform/core';
import { prune, resample } from '@gltf-transform/functions';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'assets-src/kaykit';
const OUT = 'public/assets';
const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Rogue_Hooded'];
// Atlas tile (column, row) per source texture. Rogue and Rogue_Hooded share one texture.
const TILES = { Knight: [0, 0], Barbarian: [1, 0], Mage: [0, 1], Rogue: [1, 1], Rogue_Hooded: [1, 1] };
const TILE_PX = 512;
const ATLAS_TILES = 2;
const SWATCH_COLS = 8; // each source texture is an 8 x 4 grid of gradient swatches
const SWATCH_ROWS = 4;

// Hand-written metadata the geometry cannot tell us.
const LABELS = {
  Knight_Head: 'Blond crop', Barbarian_Head: 'Grey beard', Mage_Head: 'Long dark hair',
  Rogue_Head: 'Auburn bob', Rogue_Head_Hooded: 'Hooded',
  Knight_Helmet: 'Knight helmet', Barbarian_Hat: 'Bear cap', Mage_Hat: 'Wizard hat',
  Knight_Body: 'Plate armour', Barbarian_Body: 'Fur harness', Mage_Body: 'Robe', Rogue_Body: 'Leather vest',
  Knight_Arms: 'Plate gauntlets', Barbarian_Arms: 'Bracers', Mage_Arms: 'Robe sleeves', Rogue_Arms: 'Leather gloves',
  Knight_Legs: 'Plate greaves', Barbarian_Legs: 'Fur boots', Mage_Legs: 'Robe boots', Rogue_Legs: 'Leather boots',
  Knight_Cape: 'Short cape', Barbarian_Cape: 'Fur cape', Mage_Cape: 'Silk cape', Rogue_Cape: 'Scout cape',
  '1H_Sword': 'Sword', '2H_Sword': 'Great sword', '1H_Axe': 'Axe', '2H_Axe': 'Battle axe',
  '1H_Wand': 'Wand', '2H_Staff': 'Staff', Knife: 'Knife', '1H_Crossbow': 'Hand crossbow',
  '2H_Crossbow': 'Crossbow', Throwable: 'Bomb', Mug: 'Mug',
  '1H_Sword_Offhand': 'Off-hand sword', '1H_Axe_Offhand': 'Off-hand axe', Knife_Offhand: 'Off-hand knife',
  Badge_Shield: 'Badge shield', Rectangle_Shield: 'Tower shield', Round_Shield: 'Round shield',
  Spike_Shield: 'Spiked shield', Barbarian_Round_Shield: 'Wooden shield',
  Spellbook: 'Spellbook', Spellbook_open: 'Open spellbook',
};
// How a hand item is held. The runtime picks idle and attack animations from this.
const GRIPS = {
  '1H_Sword': 'melee1h', '1H_Axe': 'melee1h', Knife: 'melee1h', Mug: 'prop',
  '2H_Sword': 'melee2h', '2H_Axe': 'melee2h',
  '1H_Wand': 'magic', '2H_Staff': 'magic',
  '1H_Crossbow': 'ranged1h', '2H_Crossbow': 'ranged2h', Throwable: 'throw',
  '1H_Sword_Offhand': 'offhandWeapon', '1H_Axe_Offhand': 'offhandWeapon', Knife_Offhand: 'offhandWeapon',
  Badge_Shield: 'shield', Rectangle_Shield: 'shield', Round_Shield: 'shield', Spike_Shield: 'shield',
  Barbarian_Round_Shield: 'shield', Spellbook: 'book', Spellbook_open: 'book',
};
// Items that cannot be combined with another slot.
const BLOCKS = {
  Rogue_Head_Hooded: ['headwear'],
  '2H_Sword': ['handL'], '2H_Axe': ['handL'], '2H_Staff': ['handL'], '2H_Crossbow': ['handL'],
};

// How much a hat wobbles on its spring, in radians. Close-fitting helmets stay rigid.
const SWAY = { Knight_Helmet: 0, Barbarian_Hat: 0.07, Mage_Hat: 0.2 };
// Clips the prototype plays. The source pack has 76; shipping only these halves the rig file.
const CLIPS = [
  'Idle', '2H_Melee_Idle', 'Walking_A', 'Running_A',
  'Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B', 'Unarmed_Melee_Attack_Kick',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab',
  '2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin',
  'Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab',
  'Spellcast_Shoot', 'Spellcast_Raise', '1H_Ranged_Shoot', '2H_Ranged_Shoot', 'Throw', 'Use_Item',
  'Block', 'Dodge_Backward', 'Jump_Full_Short', 'Cheer', 'Hit_A',
  'Sit_Floor_Down', 'Sit_Floor_Idle', 'Sit_Floor_StandUp',
];

const SLOTS = [
  { id: 'head', label: 'Head', optional: false },
  { id: 'headwear', label: 'Hat', optional: true },
  { id: 'top', label: 'Top', optional: false },
  { id: 'arms', label: 'Arms', optional: false },
  { id: 'legs', label: 'Legs', optional: false },
  { id: 'back', label: 'Back', optional: true },
  { id: 'handR', label: 'Right hand', optional: true },
  { id: 'handL', label: 'Left hand', optional: true },
];

const io = new NodeIO();
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hex = (lin) =>
  '#' + lin.map((v) => Math.round(linearToSrgb(v) * 255).toString(16).padStart(2, '0')).join('');
const round = (v, d = 5) => Number(v.toFixed(d));
const kebab = (s) => s.replace(/_/g, '-').toLowerCase();

// ---------------------------------------------------------------- matrices (column-major)
function transformPoint(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}
function transformDirection(m, [x, y, z]) {
  const v = [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
  const l = Math.hypot(...v) || 1;
  return v.map((c) => c / l);
}

// ---------------------------------------------------------------- load sources
const sources = {};
for (const name of CHARACTERS) {
  const doc = await io.read(path.join(SRC, `${name}.glb`));
  const root = doc.getRoot();
  const png = PNG.sync.read(Buffer.from(root.listTextures()[0].getImage()));
  sources[name] = { doc, root, png, skin: root.listSkins()[0] };
}

// All characters must share one skeleton, otherwise parts could not be mixed.
const refSkin = sources.Knight.skin;
const refJoints = refSkin.listJoints().map((j) => j.getName());
const refIbm = refSkin.getInverseBindMatrices().getArray();
for (const name of CHARACTERS) {
  const skin = sources[name].skin;
  const names = skin.listJoints().map((j) => j.getName());
  if (names.join() !== refJoints.join()) throw new Error(`${name}: joint list differs from Knight`);
  const ibm = skin.getInverseBindMatrices().getArray();
  let maxDiff = 0;
  for (let i = 0; i < ibm.length; i++) maxDiff = Math.max(maxDiff, Math.abs(ibm[i] - refIbm[i]));
  if (maxDiff > 1e-4) throw new Error(`${name}: inverse bind matrices differ by ${maxDiff}`);
}

// ---------------------------------------------------------------- find deforming joints
// The source rig carries IK and control bones. Only joints that move vertices, carry an
// attached item, or sit above such a joint are kept.
const keep = new Set();
const jointNodes = refSkin.listJoints();
const parentJoint = (node) => {
  const p = node.getParentNode();
  return p && refJoints.includes(p.getName()) ? p : null;
};
const keepWithAncestors = (jointName) => {
  let node = jointNodes[refJoints.indexOf(jointName)];
  while (node) {
    keep.add(node.getName());
    node = parentJoint(node);
  }
};
for (const name of CHARACTERS) {
  for (const node of sources[name].root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (node.getSkin()) {
      for (const prim of mesh.listPrimitives()) {
        const joints = prim.getAttribute('JOINTS_0');
        const weights = prim.getAttribute('WEIGHTS_0');
        for (let i = 0; i < joints.getCount(); i++) {
          const j = joints.getElement(i, []);
          const w = weights.getElement(i, []);
          for (let k = 0; k < 4; k++) if (w[k] > 0) keepWithAncestors(refJoints[j[k]]);
        }
      }
    } else {
      keepWithAncestors(node.getParentNode().getName());
    }
  }
}
const joints = refJoints.filter((n) => keep.has(n));
const jointRemap = refJoints.map((n) => joints.indexOf(n));
const inverseBind = joints.map((n) => {
  const i = refJoints.indexOf(n);
  return Array.from(refIbm.slice(i * 16, i * 16 + 16)).map((v) => round(v, 6));
});
console.log(`rig: ${refJoints.length} source joints -> ${joints.length} kept`);

// ---------------------------------------------------------------- atlas
const atlas = new PNG({ width: TILE_PX * ATLAS_TILES, height: TILE_PX * ATLAS_TILES });
for (const [name, [tx, ty]] of Object.entries(TILES)) {
  const src = sources[name].png;
  const f = src.width / TILE_PX;
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const o = ((y * f + dy) * src.width + x * f + dx) * 4;
          for (let k = 0; k < 4; k++) sum[k] += src.data[o + k];
        }
      const o = ((ty * TILE_PX + y) * atlas.width + tx * TILE_PX + x) * 4;
      for (let k = 0; k < 4; k++) atlas.data[o + k] = Math.round(sum[k] / (f * f));
    }
  }
}

function sampleLinear(png, u, v) {
  const x = Math.min(png.width - 1, Math.max(0, Math.floor(u * png.width)));
  const y = Math.min(png.height - 1, Math.max(0, Math.floor(v * png.height)));
  const o = (y * png.width + x) * 4;
  return [0, 1, 2].map((k) => srgbToLinear(png.data[o + k] / 255));
}

// ---------------------------------------------------------------- item extraction
function classify(nodeName, parentName) {
  let m;
  if ((m = nodeName.match(/^(\w+?)_Head(_Hooded)?$/))) return { slot: 'head', key: nodeName };
  if ((m = nodeName.match(/^(\w+?)_Body$/))) return { slot: 'top', key: nodeName };
  if ((m = nodeName.match(/^(\w+?)_Arm(Left|Right)$/))) return { slot: 'arms', key: `${m[1]}_Arms` };
  if ((m = nodeName.match(/^(\w+?)_Leg(Left|Right)$/))) return { slot: 'legs', key: `${m[1]}_Legs` };
  if (/_(Helmet|Hat)$/.test(nodeName)) return { slot: 'headwear', key: nodeName };
  if (/_Cape$/.test(nodeName)) return { slot: 'back', key: nodeName };
  if (parentName === 'handslot.r') return { slot: 'handR', key: nodeName };
  if (parentName === 'handslot.l') return { slot: 'handL', key: nodeName };
  throw new Error(`cannot classify ${nodeName} (parent ${parentName})`);
}

// Collect raw triangle soup per item key. Several source meshes can feed one item (arm pairs).
const rawItems = new Map();
for (const name of CHARACTERS) {
  const { root, png } = sources[name];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skinned = !!node.getSkin();
    const parentName = node.getParentNode()?.getName();
    const { slot, key } = classify(node.getName(), parentName);
    const sourceKey = `${name}/${node.getName()}`;
    let item = rawItems.get(key);
    if (item && item.sources.some((s) => s.split('/')[1] === node.getName())) continue; // duplicate across files
    if (!item) {
      item = { key, slot, skinned, attach: skinned ? null : parentName, character: name, png, sources: [], tris: [] };
      rawItems.set(key, item);
    }
    item.sources.push(sourceKey);
    const local = skinned ? null : node.getMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      const jnt = prim.getAttribute('JOINTS_0');
      const wgt = prim.getAttribute('WEIGHTS_0');
      const idx = prim.getIndices();
      const vertex = (i) => {
        let p = pos.getElement(i, []);
        let n = nor.getElement(i, []);
        if (local) {
          p = transformPoint(local, p);
          n = transformDirection(local, n);
        }
        const v = { p, n, uv: uv.getElement(i, []) };
        if (skinned) {
          const j = jnt.getElement(i, []);
          const w = wgt.getElement(i, []);
          v.j = [0, 0, 0, 0];
          v.w = [0, 0, 0, 0];
          let total = 0;
          for (let k = 0; k < 4; k++) {
            if (w[k] <= 0) continue;
            v.j[k] = jointRemap[j[k]];
            v.w[k] = w[k];
            total += w[k];
          }
          v.w = v.w.map((x) => x / total);
        }
        return v;
      };
      for (let t = 0; t < idx.getCount(); t += 3) {
        item.tris.push([vertex(idx.getScalar(t)), vertex(idx.getScalar(t + 1)), vertex(idx.getScalar(t + 2))]);
      }
    }
  }
}

const skinReference = {}; // linear mean of the skin swatch per character texture
for (const name of CHARACTERS) {
  const head = rawItems.get(name === 'Rogue_Hooded' ? 'Rogue_Head' : `${name}_Head`);
  const sum = [0, 0, 0];
  let n = 0;
  for (const tri of head.tris) {
    const u = (tri[0].uv[0] + tri[1].uv[0] + tri[2].uv[0]) / 3;
    const v = (tri[0].uv[1] + tri[1].uv[1] + tri[2].uv[1]) / 3;
    if (Math.floor(u * SWATCH_COLS) !== 0 || Math.floor(v * SWATCH_ROWS) !== 0) continue;
    const c = sampleLinear(head.png, u, v);
    for (let k = 0; k < 3; k++) sum[k] += c[k];
    n++;
  }
  skinReference[name] = sum.map((s) => s / n);
}

fs.rmSync(path.join(OUT, 'items'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'items'), { recursive: true });

const triArea = (a, b, c) => {
  const e1 = b.map((v, k) => v - a[k]);
  const e2 = c.map((v, k) => v - a[k]);
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return { area: Math.hypot(...cr) / 2, normal: cr };
};

const items = [];
for (const item of rawItems.values()) {
  // --- colour channels: one per atlas swatch the item uses
  const cells = new Map();
  for (const tri of item.tris) {
    const u = (tri[0].uv[0] + tri[1].uv[0] + tri[2].uv[0]) / 3;
    const v = (tri[0].uv[1] + tri[1].uv[1] + tri[2].uv[1]) / 3;
    const cell = `${Math.floor(u * SWATCH_COLS)},${Math.floor(v * SWATCH_ROWS)}`;
    const { area } = triArea(tri[0].p, tri[1].p, tri[2].p);
    const entry = cells.get(cell) ?? { cell, area: 0, lin: [0, 0, 0] };
    const c = sampleLinear(item.png, u, v);
    entry.area += area;
    for (let k = 0; k < 3; k++) entry.lin[k] += c[k] * area;
    cells.set(cell, entry);
    tri.cell = cell;
  }
  const totalArea = [...cells.values()].reduce((s, e) => s + e.area, 0);
  const channels = [...cells.values()].sort((a, b) => b.area - a.area);
  const isBodyPart = ['head', 'top', 'arms', 'legs'].includes(item.slot);
  const skinRef = skinReference[item.character];
  let freeRoles = ['primary', 'secondary'];
  for (const ch of channels) {
    ch.lin = ch.lin.map((v) => v / ch.area);
    ch.share = ch.area / totalArea;
    const skinDistance = Math.hypot(...ch.lin.map((v, k) => linearToSrgb(v) - linearToSrgb(skinRef[k]))) * 255;
    if (isBodyPart && (ch.cell === '0,0' || skinDistance < 12)) ch.role = 'skin';
    else if (item.slot === 'head' && ch.cell === '1,0') ch.role = 'hair';
    else if (item.slot === 'head' && ch.cell === '2,0') ch.role = 'eyes';
    else if (freeRoles.length && (freeRoles.length === 2 || ch.share >= 0.08)) ch.role = freeRoles.shift();
    else ch.role = 'fixed';
  }

  // --- face anchor: the source heads model the eyes as dark triangles. Record where they are
  // so the runtime can place the face layer, then drop them.
  let face = null;
  if (item.slot === 'head') {
    const eyeTris = item.tris.filter((t) => channels.find((c) => c.cell === t.cell).role === 'eyes');
    const sides = { l: [], r: [] };
    for (const tri of eyeTris) for (const v of tri) (v.p[0] > 0 ? sides.l : sides.r).push(v.p);
    const centre = (pts) => [0, 1, 2].map((k) => round(pts.reduce((s, p) => s + p[k], 0) / pts.length));
    const extent = (pts, k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
    face = {
      eyeL: centre(sides.l),
      eyeR: centre(sides.r),
      eyeWidth: round(extent(sides.l, 0)),
      eyeHeight: round(extent(sides.l, 1)),
    };
    item.tris = item.tris.filter((t) => !eyeTris.includes(t));
  }
  const usedChannels = channels.filter((c) => c.role !== 'eyes');

  // --- build indexed geometry
  const [tx, ty] = TILES[item.character];
  const inset = 0.5 / TILE_PX;
  const remapUv = ([u, v]) => [
    (Math.min(1 - inset, Math.max(inset, u)) + tx) / ATLAS_TILES,
    (Math.min(1 - inset, Math.max(inset, v)) + ty) / ATLAS_TILES,
  ];
  const lookup = new Map();
  const out = { position: [], normal: [], uv: [], joints: [], weights: [], channel: [], index: [] };
  const smooth = new Map(); // welded position -> accumulated face normal, for outline extrusion
  const weldKey = (p) => p.map((v) => Math.round(v * 2000)).join(',');
  for (const tri of item.tris) {
    const channel = usedChannels.findIndex((c) => c.cell === tri.cell);
    const { normal } = triArea(tri[0].p, tri[1].p, tri[2].p);
    for (const v of tri) {
      const sk = weldKey(v.p);
      const acc = smooth.get(sk) ?? [0, 0, 0];
      for (let k = 0; k < 3; k++) acc[k] += normal[k];
      smooth.set(sk, acc);
      const key = [v.p, v.n, v.uv, v.j ?? [], v.w ?? [], channel].flat().map((x) => x.toFixed(5)).join(',');
      let index = lookup.get(key);
      if (index === undefined) {
        index = out.position.length / 3;
        lookup.set(key, index);
        out.position.push(...v.p);
        out.normal.push(...v.n);
        out.uv.push(...remapUv(v.uv));
        if (item.skinned) {
          out.joints.push(...v.j);
          out.weights.push(...v.w);
        }
        out.channel.push(channel);
      }
      out.index.push(index);
    }
  }
  const outline = [];
  for (let i = 0; i < out.position.length; i += 3) {
    const acc = smooth.get(weldKey(out.position.slice(i, i + 3)));
    const l = Math.hypot(...acc) || 1;
    outline.push(acc[0] / l, acc[1] / l, acc[2] / l);
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < out.position.length; i++) {
    min[i % 3] = Math.min(min[i % 3], out.position[i]);
    max[i % 3] = Math.max(max[i % 3], out.position[i]);
  }

  // --- write the item file
  const id = kebab(item.key);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setIndices(accessor('SCALAR', new Uint16Array(out.index)))
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(out.position)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(out.normal)))
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(out.uv)))
    .setAttribute('_CHANNEL', accessor('SCALAR', new Uint8Array(out.channel)))
    .setAttribute('_OUTLINE', accessor('VEC3', new Float32Array(outline)));
  if (item.skinned) {
    prim
      .setAttribute('JOINTS_0', accessor('VEC4', new Uint8Array(out.joints)))
      .setAttribute('WEIGHTS_0', accessor('VEC4', new Float32Array(out.weights)));
  }
  doc.createScene(id).addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  const file = `items/${id}.glb`;
  await io.write(path.join(OUT, file), doc);

  if (!LABELS[item.key]) throw new Error(`no label for ${item.key}`);
  items.push({
    id,
    slot: item.slot,
    label: LABELS[item.key],
    set: kebab(item.character === 'Rogue_Hooded' ? 'Rogue' : item.character),
    file,
    kind: item.skinned ? 'skinned' : 'rigid',
    ...(item.attach ? { attach: item.attach } : {}),
    ...(GRIPS[item.key] ? { grip: GRIPS[item.key] } : {}),
    ...(BLOCKS[item.key] ? { blocks: BLOCKS[item.key] } : {}),
    ...(item.slot === 'headwear' ? { sway: SWAY[item.key] ?? 0 } : {}),
    triangles: out.index.length / 3,
    vertices: out.position.length / 3,
    bounds: { min: min.map((v) => round(v, 4)), max: max.map((v) => round(v, 4)) },
    channels: usedChannels.map((c) => ({
      role: c.role,
      color: hex(c.lin),
      linear: c.lin.map((v) => round(v)),
      share: round(c.share, 3),
    })),
    ...(face ? { face } : {}),
  });
}
const slotOrder = SLOTS.map((s) => s.id);
items.sort((a, b) => slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot) || a.id.localeCompare(b.id));

// ---------------------------------------------------------------- rig + animations
const rigDoc = sources.Knight.doc;
const rigRoot = rigDoc.getRoot();
for (const node of rigRoot.listNodes()) if (node.getMesh()) node.dispose();
for (const mesh of rigRoot.listMeshes()) mesh.dispose();
for (const skin of rigRoot.listSkins()) skin.dispose();
for (const material of rigRoot.listMaterials()) material.dispose();
for (const texture of rigRoot.listTextures()) texture.dispose();
for (const name of CLIPS) {
  if (!rigRoot.listAnimations().some((a) => a.getName() === name)) throw new Error(`source has no clip "${name}"`);
}
for (const animation of rigRoot.listAnimations()) {
  if (!CLIPS.includes(animation.getName())) {
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
    continue;
  }
  for (const channel of animation.listChannels()) {
    const target = channel.getTargetNode();
    if (!target || !keep.has(target.getName())) channel.dispose();
  }
}
for (const node of rigRoot.listNodes()) {
  if (refJoints.includes(node.getName()) && !keep.has(node.getName())) node.dispose();
}
await rigDoc.transform(prune({ keepLeaves: true }), resample());
await io.write(path.join(OUT, 'rig.glb'), rigDoc);

const animations = rigRoot.listAnimations().map((a) => {
  let duration = 0;
  for (const s of a.listSamplers()) duration = Math.max(duration, s.getInput().getMax([])[0]);
  return { name: a.getName(), duration: round(duration, 3) };
});

// ---------------------------------------------------------------- catalogue
fs.writeFileSync(path.join(OUT, 'atlas.png'), PNG.sync.write(atlas));
fs.copyFileSync(path.join(SRC, 'LICENSE.txt'), path.join(OUT, 'KAYKIT-LICENSE.txt'));
const catalog = {
  source: 'KayKit Adventurers 1.0 by Kay Lousberg, CC0',
  atlas: 'atlas.png',
  rig: { file: 'rig.glb', joints, inverseBind },
  slots: SLOTS,
  animations,
  items,
};
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog));

// ---------------------------------------------------------------- report
const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0).padStart(5) + ' KB';
console.log(`rig.glb     ${size('rig.glb')}  (${animations.length} animations)`);
console.log(`atlas.png   ${size('atlas.png')}`);
console.log(`catalog.json${size('catalog.json')}`);
let total = 0;
for (const slot of SLOTS) {
  const list = items.filter((i) => i.slot === slot.id);
  console.log(`\n${slot.label}`);
  for (const i of list) {
    const bytes = fs.statSync(path.join(OUT, i.file)).size;
    total += bytes;
    console.log(
      `  ${i.id.padEnd(24)} ${String(i.triangles).padStart(5)} tris ${(bytes / 1024).toFixed(0).padStart(4)} KB  ` +
        i.channels.map((c) => `${c.role}:${c.color}`).join(' ') +
        (i.attach ? `  @${i.attach}` : ''),
    );
  }
}
console.log(`\n${items.length} items, ${(total / 1024).toFixed(0)} KB of geometry`);
