import { hexOf, type Cell, type PaletteKey } from './palette.ts';

// ------------------------------------------------------------------ geometry

export type Vec3 = [number, number, number];
/** Sprite size and where the feet stand in it. */
export const SPRITE_W = 32;
export const SPRITE_H = 48;
const ORIGIN_X = 16;
const ORIGIN_Y = 44;

/** 0 south-east, 1 south-west, 2 north-west, 3 north-east. 0 and 3 are drawn; 1 and 2 mirror them. */
export type Facing = 0 | 1 | 2 | 3;
export const FACING_NAMES = ['front right', 'front left', 'back left', 'back right'] as const;

/**
 * A pose: joint positions in the character's own space, in pixels.
 * x is the character's right, y is up, z is forward. Feet rest at y = 1.
 */
export interface Pose {
  hips: Vec3;
  chest: Vec3;
  neck: Vec3;
  shoulderL: Vec3; elbowL: Vec3; handL: Vec3;
  shoulderR: Vec3; elbowR: Vec3; handR: Vec3;
  hipL: Vec3; kneeL: Vec3; footL: Vec3;
  hipR: Vec3; kneeR: Vec3; footR: Vec3;
}

const FORWARD = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const RIGHT = [[0, 1], [-1, 0], [0, -1], [1, 0]];

/** Isometric projection (2:1) of a character-space point for one facing. */
function project(p: Vec3, facing: Facing): { x: number; y: number; depth: number } {
  const f = FORWARD[facing];
  const r = RIGHT[facing];
  const wx = f[0] * p[2] + r[0] * p[0];
  const wz = f[1] * p[2] + r[1] * p[0];
  return {
    x: ORIGIN_X + (wx - wz) * 0.7071,
    y: ORIGIN_Y + (wx + wz) * 0.3536 - p[1],
    depth: wx + wz,
  };
}

// ------------------------------------------------------------------ paint

/** A small pixel image. Rows of cells; null is transparent. */
export type Stamp = (Cell | null)[][];

/** Frames that rigid stamps are drawn in. The anchor is the pixel that sits on the joint. */
export const HEAD_FRAME = { w: 33, h: 36, ax: 16, ay: 24 };
export const TORSO_FRAME = { w: 15, h: 18, ax: 7, ay: 1 };
export const TOOL_FRAME = { w: 33, h: 54, ax: 16, ay: 38 };
/** Sizes the recipe format asks the model for. They sit inside the larger frames above. */
export const HEAD_STAMP = { w: 21, h: 30, ax: 10, ay: 21 };
export const TOOL_STAMP = { w: 15, h: 44, ax: 7, ay: 30 };
/** Limb paint is a strip of this many cells from shoulder to hand, or hip to ankle. */
export const LIMB_CELLS = 10;

export interface StampPair {
  front: Stamp;
  back: Stamp;
}

/** An item in its final form, whatever produced it. All fields are optional layers. */
export interface Item {
  name: string;
  slot: Slot;
  /** Hair, beard, hat, face: rigid on the head. */
  head?: StampPair;
  /** Drawn behind the body when seen from the front, for long hair. */
  headBehind?: StampPair;
  /** Shirt body, waistband, skirt: rigid on the chest. */
  torso?: StampPair;
  /** Sleeve colours from shoulder (first) to hand (last). null leaves the arm bare. */
  arm?: (Cell | null)[];
  /** Trouser colours from hip to ankle. */
  leg?: (Cell | null)[];
  foot?: Cell | null;
  /** A carried object, rigid on the right hand. */
  tool?: StampPair;
}

export const SLOTS = ['bottom', 'shoes', 'top', 'beard', 'hair', 'hat', 'tool'] as const;
export type Slot = (typeof SLOTS)[number];

export interface Look {
  skin: PaletteKey;
  /** The head with its face, as stamps. */
  head: StampPair;
  items: Item[];
}

// ------------------------------------------------------------------ drawing

export class Sprite {
  readonly pixels: (string | null)[] = new Array(SPRITE_W * SPRITE_H).fill(null);
  set(x: number, y: number, color: string): void {
    if (x < 0 || y < 0 || x >= SPRITE_W || y >= SPRITE_H) return;
    this.pixels[y * SPRITE_W + x] = color;
  }
  get(x: number, y: number): string | null {
    return this.pixels[y * SPRITE_W + x] ?? null;
  }
}

interface Layer {
  depth: number;
  draw: () => void;
}

function stampInto(sprite: Sprite, stamp: Stamp, frame: { ax: number; ay: number; w: number }, x: number, y: number, mirror: boolean): void {
  for (let row = 0; row < stamp.length; row++) {
    const cells = stamp[row];
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col];
      if (!cell) continue;
      const dx = col - frame.ax;
      sprite.set(x + (mirror ? -dx : dx), y + row - frame.ay, hexOf(cell));
    }
  }
}

/**
 * Draws a limb through its joints as clean pixel runs: one run of `width` pixels per step along
 * the longer axis, never an anti-aliased or rotated shape. `colorAt` gets the position along
 * the limb from 0 to 1.
 */
function drawLimb(sprite: Sprite, joints: { x: number; y: number }[], width: number, colorAt: (t: number) => string): void {
  const points = joints.map((j) => ({ x: Math.round(j.x), y: Math.round(j.y) }));
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.max(Math.abs(points[i].x - points[i - 1].x), Math.abs(points[i].y - points[i - 1].y));
  }
  let step = 0;
  const lo = -Math.floor((width - 1) / 2);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    const tall = Math.abs(dy) >= Math.abs(dx);
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const x = Math.round(a.x + (n ? (dx * k) / n : 0));
      const y = Math.round(a.y + (n ? (dy * k) / n : 0));
      const color = colorAt(total ? step / total : 0);
      for (let w = 0; w < width; w++) {
        if (tall) sprite.set(x + lo + w, y, color);
        else sprite.set(x, y + lo + w, color);
      }
      step++;
    }
  }
}

/** Draws one frame of a character. Everything is placed by rule from the pose; nothing is rasterised from 3D. */
export function drawCharacter(look: Look, pose: Pose, facing: Facing): Sprite {
  const sprite = new Sprite();
  const mirror = facing === 1 || facing === 2;
  const back = facing === 2 || facing === 3;
  const side = (pair: StampPair) => (back ? pair.back : pair.front);
  const P = (v: Vec3) => project(v, facing);
  const skin: Cell = { key: look.skin, shade: false };
  const layers: Layer[] = [];
  const bySlot = (slot: Slot) => look.items.filter((i) => i.slot === slot);
  // Later slots cover earlier ones.
  const ordered = SLOTS.flatMap((slot) => bySlot(slot));

  const limbPaint = (kind: 'arm' | 'leg', t: number): Cell => {
    let cell: Cell = skin;
    const index = Math.min(LIMB_CELLS - 1, Math.floor(t * LIMB_CELLS));
    for (const item of ordered) {
      const strip = item[kind];
      if (strip?.[index]) cell = strip[index]!;
    }
    return cell;
  };

  // ---- legs and feet
  for (const s of ['L', 'R'] as const) {
    const hip = P(pose[`hip${s}`]);
    const knee = P(pose[`knee${s}`]);
    const foot = P(pose[`foot${s}`]);
    const far = hip.depth < P(pose.hips).depth;
    layers.push({
      depth: knee.depth - 20,
      draw: () => {
        drawLimb(sprite, [hip, knee, foot], 4, (t) => {
          const cell = limbPaint('leg', t);
          return hexOf({ key: cell.key, shade: cell.shade || far });
        });
        let shoe: Cell = skin;
        for (const item of ordered) if (item.foot) shoe = item.foot;
        const fx = Math.round(foot.x);
        const fy = Math.round(foot.y);
        const toe = facing === 0 || facing === 3 ? 1 : -1;
        const color = hexOf({ key: shoe.key, shade: shoe.shade || far });
        for (let dx = -1; dx <= 2; dx++) {
          sprite.set(fx + dx + (toe > 0 ? 0 : -1), fy, color);
          sprite.set(fx + dx + (toe > 0 ? 0 : -1), fy + 1, color);
        }
        sprite.set(fx + (toe > 0 ? 3 : -3), fy + 1, color);
      },
    });
  }

  // ---- torso: a plain block from shoulders to hips, then rigid clothing stamps
  const chest = P(pose.chest);
  const hips = P(pose.hips);
  layers.push({
    depth: chest.depth,
    draw: () => {
      const top = Math.round(chest.y);
      const bottom = Math.round(hips.y) + 1;
      for (let y = top; y <= bottom; y++) {
        const k = bottom === top ? 0 : (y - top) / (bottom - top);
        const cx = Math.round(chest.x + (hips.x - chest.x) * k);
        for (let dx = -4; dx <= 4; dx++) sprite.set(cx + dx, y, hexOf(skin));
      }
      const x = Math.round(chest.x);
      for (const item of ordered) if (item.torso) stampInto(sprite, side(item.torso), TORSO_FRAME, x, top, mirror);
    },
  });

  // ---- arms. The right hand may carry a tool.
  for (const s of ['L', 'R'] as const) {
    const shoulder = P(pose[`shoulder${s}`]);
    const elbow = P(pose[`elbow${s}`]);
    const hand = P(pose[`hand${s}`]);
    const far = shoulder.depth < chest.depth;
    layers.push({
      depth: elbow.depth + (far ? -1 : 1),
      draw: () => {
        if (s === 'R') {
          for (const item of ordered) {
            if (item.tool) stampInto(sprite, side(item.tool), TOOL_FRAME, Math.round(hand.x), Math.round(hand.y), mirror);
          }
        }
        drawLimb(sprite, [shoulder, elbow, hand], 3, (t) => {
          const cell = limbPaint('arm', t);
          return hexOf({ key: cell.key, shade: cell.shade || far });
        });
      },
    });
  }

  // ---- head: rigid stamps
  const neck = P(pose.neck);
  const hx = Math.round(neck.x);
  const hy = Math.round(neck.y);
  layers.push({
    depth: back ? chest.depth + 0.5 : chest.depth - 0.5,
    draw: () => {
      for (const item of ordered) if (item.headBehind) stampInto(sprite, side(item.headBehind), HEAD_FRAME, hx, hy, mirror);
    },
  });
  layers.push({
    depth: chest.depth + 3,
    draw: () => {
      stampInto(sprite, side(look.head), HEAD_FRAME, hx, hy, mirror);
      for (const item of ordered) if (item.head) stampInto(sprite, side(item.head), HEAD_FRAME, hx, hy, mirror);
    },
  });

  layers.sort((a, b) => a.depth - b.depth);
  for (const layer of layers) layer.draw();
  return sprite;
}

// ------------------------------------------------------------------ text form of stamps

/**
 * Stamps are written as rows of characters. '.' is transparent. Any other character is looked
 * up in the legend; an upper-case letter is the lit colour and its lower-case form the shade.
 */
export function parseStamp(rows: string[], legend: Record<string, PaletteKey>, skin?: PaletteKey): Stamp {
  return rows.map((row) =>
    [...row].map((ch) => {
      if (ch === '.' || ch === ' ') return null;
      if (skin && (ch === '#' || ch === '%')) return { key: skin, shade: ch === '%' };
      const key = legend[ch.toUpperCase()];
      if (!key) throw new Error(`Unknown character "${ch}" in stamp`);
      return { key, shade: ch !== ch.toUpperCase() };
    }),
  );
}

// ------------------------------------------------------------------ standing layout

/** Where the body parts sit in the standing pose, for one drawn facing. Used to read paint off a whole sprite. */
export interface Layout {
  neck: { x: number; y: number };
  torso: { x: number; top: number; bottom: number };
  /** Column and row range of each limb, nearer one first. */
  arms: { x: number; y0: number; y1: number }[];
  legs: { x: number; y0: number; y1: number }[];
  handR: { x: number; y: number };
}

export function layoutOf(pose: Pose, facing: Facing): Layout {
  const P = (v: Vec3) => {
    const p = project(v, facing);
    return { x: Math.round(p.x), y: Math.round(p.y), depth: p.depth };
  };
  const limb = (a: Vec3, b: Vec3) => ({ x: P(a).x, y0: P(a).y, y1: P(b).y, depth: P(a).depth });
  const nearFirst = <T extends { depth: number }>(list: T[]) => list.sort((p, q) => q.depth - p.depth);
  return {
    neck: P(pose.neck),
    torso: { x: P(pose.chest).x, top: P(pose.chest).y, bottom: P(pose.hips).y + 1 },
    arms: nearFirst([limb(pose.shoulderL, pose.handL), limb(pose.shoulderR, pose.handR)]),
    legs: nearFirst([limb(pose.hipL, pose.footL), limb(pose.hipR, pose.footR)]),
    handR: P(pose.handR),
  };
}
