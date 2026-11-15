import { hexOf, type Cell, type PaletteKey } from './palette.ts';

// ------------------------------------------------------------------ geometry

export type Vec3 = [number, number, number];
/** Sprite size. The feet stand on row ORIGIN_Y, centred on the line between columns 15 and 16. */
export const SPRITE_W = 32;
export const SPRITE_H = 48;
const ORIGIN_X = 16.5;
const ORIGIN_Y = 44;

/** 0 south-east, 1 south-west, 2 north-west, 3 north-east. 0 and 3 are drawn; 1 and 2 are their mirror images. */
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

// Forward and right in ground coordinates, for the two drawn facings.
const FORWARD: Record<0 | 3, [number, number]> = { 0: [1, 0], 3: [0, -1] };
const RIGHT: Record<0 | 3, [number, number]> = { 0: [0, 1], 3: [1, 0] };
/** How far a step forward moves a point down the screen: the 2:1 isometric ratio. */
const FORWARD_LIFT = 0.3536;
/**
 * Sideways offsets inside the body are flattened. True isometry would put one shoulder two
 * pixels above the other, which reads as a broken arm at this size; hand-drawn sprites keep the
 * body nearly level, with the nearer side one pixel lower.
 */
const SIDE_LIFT = 0.06;

interface Point {
  x: number;
  y: number;
  depth: number;
}

function project(p: Vec3, facing: 0 | 3): Point {
  const f = FORWARD[facing];
  const r = RIGHT[facing];
  const forward = { x: (f[0] - f[1]) * 0.7071, down: f[0] + f[1] };
  const right = { x: (r[0] - r[1]) * 0.7071, down: r[0] + r[1] };
  return {
    x: ORIGIN_X + forward.x * p[2] + right.x * p[0],
    y: ORIGIN_Y - p[1] + forward.down * FORWARD_LIFT * p[2] + right.down * SIDE_LIFT * p[0],
    depth: forward.down * p[2] + right.down * p[0],
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
/** A tool stamp's grip sits this many rows above its foot, which rests on the ground for poles. */
const GRIP_HEIGHT = 9;

export interface StampPair {
  front: Stamp;
  back: Stamp;
}

/** An item in its final form, whatever produced it. All fields are optional layers. */
export interface Item {
  name: string;
  slot: Slot;
  /** Hair, beard, hat: rigid on the head. */
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
  /** A carried object, held in the nearer hand. */
  tool?: StampPair;
  /**
   * How a tool is held. 'pole' stands on the ground beside the body with the fist around the
   * shaft; 'carry' moves with the hand.
   */
  hold?: 'pole' | 'carry';
  /** Columns from the tool stamp's anchor to its shaft, front and back, so the fist closes on the shaft itself. */
  gripDx?: { front: number; back: number };
}

export const SLOTS = ['bottom', 'shoes', 'top', 'beard', 'hair', 'hat', 'tool'] as const;
export type Slot = (typeof SLOTS)[number];

/** Body build: how wide the torso and limbs are drawn. Clothing is fitted to it by rule. */
export interface Build {
  id: string;
  label: string;
  /** Torso width in pixels: 9 or 11. */
  torso: 9 | 11;
  arm: number;
  leg: number;
}

export const BUILDS: Build[] = [
  { id: 'slim', label: 'Slim', torso: 9, arm: 3, leg: 4 },
  { id: 'sturdy', label: 'Sturdy', torso: 11, arm: 3, leg: 5 },
];

export interface Look {
  skin: PaletteKey;
  /** Defaults to the slim build. */
  build?: Build;
  /** The bare head, as stamps. */
  head: StampPair;
  /** Face expressions, drawn on the front of the head. 'neutral' is the default. */
  faces: Record<string, Stamp>;
  items: Item[];
}

export interface DrawOptions {
  /** Which face to show. */
  face?: string;
}

// ------------------------------------------------------------------ drawing

const SHADOW = '#2a1c3a38';

export class Sprite {
  readonly pixels: (string | null)[] = new Array(SPRITE_W * SPRITE_H).fill(null);
  set(x: number, y: number, color: string): void {
    if (x < 0 || y < 0 || x >= SPRITE_W || y >= SPRITE_H) return;
    this.pixels[y * SPRITE_W + x] = color;
  }
  get(x: number, y: number): string | null {
    return this.pixels[y * SPRITE_W + x] ?? null;
  }
  /** The same image facing the other way. */
  mirrored(): Sprite {
    const out = new Sprite();
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) out.pixels[y * SPRITE_W + (SPRITE_W - 1 - x)] = this.pixels[y * SPRITE_W + x];
    }
    return out;
  }
}

interface Layer {
  depth: number;
  draw: () => void;
}

function stampInto(sprite: Sprite, stamp: Stamp, frame: { ax: number; ay: number }, x: number, y: number): void {
  for (let row = 0; row < stamp.length; row++) {
    const cells = stamp[row];
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col];
      if (cell) sprite.set(x + col - frame.ax, y + row - frame.ay, hexOf(cell));
    }
  }
}

/**
 * Draws a limb through its joints as clean pixel runs: one run of `width` pixels per step along
 * the longer axis, never an anti-aliased or rotated shape. `colorAt` gets the position along
 * the limb from 0 to 1 and the index across it.
 */
function drawLimb(sprite: Sprite, joints: Point[], width: number, colorAt: (t: number, across: number) => string): void {
  let total = 0;
  for (let i = 1; i < joints.length; i++) {
    total += Math.max(Math.abs(Math.round(joints[i].x) - Math.round(joints[i - 1].x)), Math.abs(Math.round(joints[i].y) - Math.round(joints[i - 1].y)));
  }
  let step = 0;
  for (let i = 1; i < joints.length; i++) {
    const a = joints[i - 1];
    const b = joints[i];
    const n = Math.max(Math.abs(Math.round(b.x) - Math.round(a.x)), Math.abs(Math.round(b.y) - Math.round(a.y)));
    const tall = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const x = a.x + (n ? ((b.x - a.x) * k) / n : 0);
      const y = a.y + (n ? ((b.y - a.y) * k) / n : 0);
      const t = total ? step / total : 0;
      for (let w = 0; w < width; w++) {
        if (tall) sprite.set(Math.round(x - width / 2) + w, Math.round(y), colorAt(t, w));
        else sprite.set(Math.round(x), Math.round(y - width / 2) + w, colorAt(t, w));
      }
      step++;
    }
  }
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * Fits a torso stamp drawn for the 9-pixel torso to the 11-pixel one by repeating one column on
 * each side of the middle. Horizontal patterns are unaffected; the anchor moves one column right.
 */
function widened(stamp: Stamp): Stamp {
  const repeat = [TORSO_FRAME.ax - 2, TORSO_FRAME.ax + 2];
  return stamp.map((row) => row.flatMap((cell, col) => (repeat.includes(col) ? [cell, cell] : [cell])));
}

/** Draws one frame of a character. Every pixel is placed by a rule or comes from a stamp. */
export function drawCharacter(look: Look, pose: Pose, facing: Facing, options: DrawOptions = {}): Sprite {
  if (facing === 1) return drawCharacter(look, pose, 0, options).mirrored();
  if (facing === 2) return drawCharacter(look, pose, 3, options).mirrored();

  const sprite = new Sprite();
  const back = facing === 3;
  const side = (pair: StampPair) => (back ? pair.back : pair.front);
  const P = (v: Vec3) => project(v, facing);
  const skin: Cell = { key: look.skin, shade: false };
  const tone = (cell: Cell, shade: boolean) => hexOf({ ...cell, shade: cell.shade || shade, light: shade ? false : cell.light });
  const layers: Layer[] = [];
  // Later slots cover earlier ones.
  const ordered = SLOTS.flatMap((slot) => look.items.filter((i) => i.slot === slot));
  const tool = ordered.find((i) => i.tool);
  const build = look.build ?? BUILDS[0];
  // Poses are authored for the slim build. Wider builds move the limbs outwards so that arms
  // still sit just outside the torso and legs keep a one-pixel gap.
  const armShift = ((build.torso - 9) / 2 + (build.arm - 3) / 2) / 0.7071;
  const legShift = ((build.leg - 4) / 2) / 0.7071;
  const moved = (v: Vec3, s: 'L' | 'R', shift: number): Vec3 => [v[0] + (s === 'R' ? shift : -shift), v[1], v[2]];

  const limbPaint = (kind: 'arm' | 'leg', t: number): Cell => {
    let cell: Cell = skin;
    const index = Math.min(LIMB_CELLS - 1, Math.floor(t * LIMB_CELLS));
    for (const item of ordered) {
      const strip = item[kind];
      if (strip?.[index]) cell = strip[index]!;
    }
    return cell;
  };

  const chest = P(pose.chest);
  const hips = P(pose.hips);

  // ---- ground shadow: anchors an outline-free sprite to the floor
  layers.push({
    depth: -1000,
    draw: () => {
      const cx = P([0, 0, 0]).x;
      for (const [row, half] of [[ORIGIN_Y - 1, 5], [ORIGIN_Y, 7], [ORIGIN_Y + 1, 7], [ORIGIN_Y + 2, 5]] as const) {
        for (let x = Math.round(cx - half); x < Math.round(cx + half); x++) sprite.set(x, row, SHADOW);
      }
    },
  });

  // ---- legs and feet. The farther leg is drawn in the shade tone, with a gap between the two.
  for (const s of ['L', 'R'] as const) {
    const hip = P(moved(pose[`hip${s}`], s, legShift));
    const knee = P(moved(pose[`knee${s}`], s, legShift));
    const foot = P(moved(pose[`foot${s}`], s, legShift));
    const far = hip.depth < hips.depth;
    layers.push({
      depth: knee.depth - 20,
      draw: () => {
        drawLimb(sprite, [hip, knee, foot], build.leg, (t) => tone(limbPaint('leg', t), far));
        let shoe: Cell = skin;
        for (const item of ordered) if (item.foot) shoe = item.foot;
        // Feet are wider than the legs and point the way the character faces.
        const left = Math.round(foot.x - build.leg / 2);
        const top = Math.round(foot.y);
        for (let dx = 0; dx <= build.leg; dx++) {
          sprite.set(left + dx, top, tone(shoe, far));
          sprite.set(left + dx, top + 1, tone(shoe, far || dx === 0));
        }
      },
    });
  }

  // ---- torso: a block from shoulders to hips with a shaded far side, then rigid clothing stamps
  const farSide = Math.sign(P(pose.shoulderL).x - chest.x) || 1;
  layers.push({
    depth: chest.depth,
    draw: () => {
      const top = Math.round(chest.y);
      const bottom = Math.round(hips.y) + 1;
      const width = build.torso;
      for (let y = top; y <= bottom; y++) {
        const k = bottom === top ? 0 : (y - top) / (bottom - top);
        const left = Math.round(chest.x + (hips.x - chest.x) * k - width / 2);
        for (let i = 0; i < width; i++) {
          const edge = farSide > 0 ? i === width - 1 : i === 0;
          // A shadow under the chin, and the far side in shade.
          const under = y === top && i >= 2 && i <= width - 3;
          sprite.set(left + i, y, tone(skin, edge || under));
        }
      }
      const mid = Math.floor(chest.x);
      if (back) {
        // A hint of the spine, so the back is not an empty block.
        for (let dy = 2; dy <= 5; dy++) sprite.set(mid, top + dy, tone(skin, true));
      } else {
        sprite.set(mid + 1, top + 8, tone(skin, true));
      }
      for (const item of ordered) {
        if (!item.torso) continue;
        const stamp = side(item.torso);
        if (width === 11) stampInto(sprite, widened(stamp), { ax: TORSO_FRAME.ax + 1, ay: TORSO_FRAME.ay }, mid, top);
        else stampInto(sprite, stamp, TORSO_FRAME, mid, top);
      }
    },
  });

  // ---- arms and hands. The nearer hand holds the tool.
  for (const s of ['L', 'R'] as const) {
    const shoulder3 = moved(pose[`shoulder${s}`], s, armShift);
    const shoulder = P(shoulder3);
    const far = shoulder.depth < chest.depth;
    let elbow = P(moved(pose[`elbow${s}`], s, armShift));
    let hand = P(moved(pose[`hand${s}`], s, armShift));
    const holding = !far && tool;
    if (holding && tool.hold === 'pole') {
      // Arm held out to the side with the forearm raised, fist closed around the shaft.
      const side3 = s === 'R' ? 1 : -1;
      const elbow3 = add(shoulder3, [side3 * 3.4, -2.9, 0.4]);
      elbow = P(elbow3);
      hand = P(add(elbow3, [side3 * 3.6, -0.6, 2.6]));
    }
    const inner = Math.sign(chest.x - shoulder.x);
    layers.push({
      depth: elbow.depth + (far ? -1 : 1),
      draw: () => {
        if (holding) {
          const x = Math.round(hand.x) - (tool.gripDx?.[back ? 'back' : 'front'] ?? 0);
          const y = tool.hold === 'pole' ? ORIGIN_Y - GRIP_HEIGHT : Math.round(hand.y);
          stampInto(sprite, side(tool.tool!), TOOL_FRAME, x, y);
        }
        drawLimb(sprite, [shoulder, elbow, hand], build.arm, (t, across) => {
          // Where the nearer arm lies over the body, its inner edge is shaded so the two separate.
          const contact = !far && t < 0.7 && (inner > 0 ? across === build.arm - 1 : across === 0);
          // The outer corner of the shoulder is lit, which rounds it.
          const cap = !far && t === 0 && (inner > 0 ? across === 0 : across === build.arm - 1);
          const cell = limbPaint('arm', t);
          return cap ? hexOf({ ...cell, shade: false, light: true }) : tone(cell, far || contact);
        });
        // Hands are a visible block of skin, drawn over whatever they hold.
        const left = Math.round(hand.x - 1.5);
        const top = Math.round(hand.y) - 1;
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 3; dx++) sprite.set(left + dx, top + dy, tone(skin, far || (dy === 2 && dx !== 1)));
        }
      },
    });
  }

  // ---- head: rigid stamps
  const neck = P(pose.neck);
  const hx = Math.floor(neck.x);
  const hy = Math.round(neck.y);
  layers.push({
    depth: back ? chest.depth + 0.5 : chest.depth - 0.5,
    draw: () => {
      for (const item of ordered) if (item.headBehind) stampInto(sprite, side(item.headBehind), HEAD_FRAME, hx, hy);
    },
  });
  layers.push({
    depth: chest.depth + 3,
    draw: () => {
      stampInto(sprite, side(look.head), HEAD_FRAME, hx, hy);
      if (!back) stampInto(sprite, look.faces[options.face ?? 'neutral'] ?? look.faces.neutral, HEAD_FRAME, hx, hy);
      for (const item of ordered) {
        if (item.head) stampInto(sprite, side(item.head), HEAD_FRAME, hx, hy);
      }
    },
  });

  layers.sort((a, b) => a.depth - b.depth);
  for (const layer of layers) layer.draw();
  return sprite;
}

// ------------------------------------------------------------------ text form of stamps

/**
 * Stamps are written as rows of characters. '.' is transparent. Any other character is looked
 * up in the legend; an upper-case letter is the base colour and its lower-case form the shade.
 * A legend value ending in '+' selects the highlight tone. '#', '%' and '+' are the skin in its
 * base, shade and highlight tones.
 */
export function parseStamp(rows: string[], legend: Record<string, PaletteKey | `${PaletteKey}+`>, skin?: PaletteKey): Stamp {
  return rows.map((row) =>
    [...row].map((ch): Cell | null => {
      if (ch === '.' || ch === ' ') return null;
      if (skin && (ch === '#' || ch === '%' || ch === '+')) return { key: skin, shade: ch === '%', light: ch === '+' };
      const entry = legend[ch.toUpperCase()];
      if (!entry) throw new Error(`Unknown character "${ch}" in stamp`);
      const light = entry.endsWith('+');
      const key = (light ? entry.slice(0, -1) : entry) as PaletteKey;
      return { key, shade: ch !== ch.toUpperCase(), light: light && ch === ch.toUpperCase() };
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

export function layoutOf(pose: Pose, facing: 0 | 3): Layout {
  const P = (v: Vec3) => {
    const p = project(v, facing);
    return { x: Math.floor(p.x), y: Math.round(p.y), depth: p.depth };
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
