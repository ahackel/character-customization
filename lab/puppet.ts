import { hexOf, type Cell, type PaletteKey } from './palette.ts';

// ------------------------------------------------------------------ geometry

export type Vec3 = [number, number, number];
/**
 * The drawing canvas. The character itself fits the 32 x 48 body window in its middle; the
 * margin around it is room for tools that swing out and for wide hats.
 */
export const SPRITE_W = 64;
export const SPRITE_H = 64;
export const BODY_WINDOW = { x: 16, y: 8, w: 32, h: 48 };
/** Size of the grid the model paints on in the whole-sprite format: the body window. */
export const PAINT_W = BODY_WINDOW.w;
export const PAINT_H = BODY_WINDOW.h;
/** The feet stand on row ORIGIN_Y, centred on the line between two pixel columns. */
const ORIGIN_X = BODY_WINDOW.x + 16.5;
const ORIGIN_Y = BODY_WINDOW.y + 44;

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
export const TORSO_FRAME = { w: 21, h: 24, ax: 10, ay: 1 };
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
  /** A carried object. Its grip is pinned to the nearer hand in every frame. */
  tool?: StampPair;
  /**
   * How a tool is carried when it is not being swung. 'pole' is long: the arm is held out so the
   * shaft clears the head. 'carry' is short: the arm hangs and swings as usual.
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
  /** Torso width in pixels. */
  torso: 7 | 9 | 11;
  arm: number;
  leg: number;
}

export const BUILDS: Build[] = [
  { id: 'thin', label: 'Very slim', torso: 7, arm: 2, leg: 3 },
  { id: 'slim', label: 'Slim', torso: 9, arm: 3, leg: 4 },
  { id: 'sturdy', label: 'Sturdy', torso: 11, arm: 3, leg: 5 },
];

export interface Look {
  skin: PaletteKey;
  /** Defaults to the slim build. */
  build?: Build;
  /** Body shape. 'f' narrows the waist and adds a chest shadow; clothing follows by rule. */
  frame?: 'm' | 'f';
  /** The bare head, as stamps. */
  head: StampPair;
  /** Face expressions, drawn on the front of the head. 'neutral' is the default. */
  faces: Record<string, Stamp>;
  items: Item[];
}

export interface DrawOptions {
  /** Which face to show. */
  face?: string;
  /**
   * True while the tool is being swung: the holding arm follows the pose instead of the carry
   * position, and the tool turns with the forearm.
   */
  swing?: boolean;
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
      // Mirror about the character's centre line, which lies between two columns.
      for (let x = 1; x < SPRITE_W; x++) out.pixels[y * SPRITE_W + (SPRITE_W - x)] = this.pixels[y * SPRITE_W + x];
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
 * Fits a torso stamp drawn for the 9-pixel torso to another build by repeating or dropping one
 * column on each side of the middle. Horizontal patterns are unaffected. Returns the stamp and
 * where its anchor column now is.
 */
function fitted(stamp: Stamp, width: 7 | 9 | 11): { stamp: Stamp; ax: number } {
  if (width === 9) return { stamp, ax: TORSO_FRAME.ax };
  const columns = [TORSO_FRAME.ax - 2, TORSO_FRAME.ax + 2];
  const wide = width === 11;
  return {
    stamp: stamp.map((row) => row.flatMap((cell, col) => (columns.includes(col) ? (wide ? [cell, cell] : []) : [cell]))),
    ax: TORSO_FRAME.ax + (wide ? 1 : -1),
  };
}

/** A stamp turned about a pivot, as loose pixels. */
type Turned = { dx: number; dy: number; cell: Cell }[];
const turnedCache = new WeakMap<Stamp, Map<string, Turned>>();

/**
 * Turns a tool stamp about its grip in steps of 45 degrees, clockwise. Each target pixel looks
 * up its source, so shafts stay unbroken lines and nothing is blended.
 */
function turned(stamp: Stamp, pivotX: number, pivotY: number, steps: number): Turned {
  const key = `${pivotX},${pivotY},${steps}`;
  let cache = turnedCache.get(stamp);
  if (!cache) turnedCache.set(stamp, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const angle = (steps * Math.PI) / 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out: Turned = [];
  const reach = Math.max(stamp.length, stamp[0]?.length ?? 0);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const cell = stamp[Math.round(pivotY - dx * sin + dy * cos)]?.[Math.round(pivotX + dx * cos + dy * sin)];
      if (cell) out.push({ dx, dy, cell });
    }
  }
  cache.set(key, out);
  return out;
}

/**
 * True if a hat covers the top of the skull, as opposed to a band around the forehead.
 * Measured where the top of the hair sits: a headband paints nothing there, so the hair above
 * it is kept.
 */
function coversCrown(hat: Stamp): boolean {
  let painted = 0;
  let total = 0;
  for (let row = HEAD_FRAME.ay - 18; row <= HEAD_FRAME.ay - 15; row++) {
    for (let col = HEAD_FRAME.ax - 4; col <= HEAD_FRAME.ax + 4; col++) {
      total++;
      if (hat[row]?.[col]) painted++;
    }
  }
  return painted / total >= 0.4;
}

const tuckedCache = new WeakMap<Stamp, WeakMap<Stamp, Stamp>>();

/**
 * Hair as worn under a hat: everything above the hat's lower edge is removed, so no tuft pokes
 * through the crown or bulges beside it. Hair below the brim stays. Worked out from the two
 * stamps, so no hairstyle needs a second drawing.
 */
function tucked(hair: Stamp, hat: Stamp): Stamp {
  let byHat = tuckedCache.get(hair);
  if (!byHat) tuckedCache.set(hair, (byHat = new WeakMap()));
  const hit = byHat.get(hat);
  if (hit) return hit;
  const width = hat[0]?.length ?? 0;
  const edge: number[] = Array(width).fill(-1);
  hat.forEach((row, y) => row.forEach((cell, x) => {
    if (cell) edge[x] = Math.max(edge[x], y);
  }));
  // Columns the hat does not reach take the edge of the nearest column it does.
  const first = edge.findIndex((v) => v >= 0);
  const last = edge.length - 1 - [...edge].reverse().findIndex((v) => v >= 0);
  const edgeAt = (x: number) => (first < 0 ? -1 : edge[Math.min(last, Math.max(first, x))]);
  const out = hair.map((row, y) => row.map((cell, x) => (cell && y <= edgeAt(x) ? null : cell)));
  byHat.set(hat, out);
  return out;
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
  const build = look.build ?? BUILDS.find((b) => b.id === 'slim')!;
  // Poses are authored for the slim build. Wider builds move the limbs outwards so that arms
  // still sit just outside the torso and legs keep a one-pixel gap.
  const armShift = ((build.torso - 9) / 2 + (build.arm - 3) / 2) / 0.7071;
  const hat = ordered.find((i) => i.slot === 'hat' && i.head);
  // Under a hat that covers the crown, hair is drawn in its tucked form.
  const hairStamp = (item: Item, stamp: Stamp): Stamp =>
    item.slot === 'hair' && hat && coversCrown(side(hat.head!)) ? tucked(stamp, side(hat.head!)) : stamp;
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

  // How far the knees have swung out to either side of where the legs hang, for skirts.
  const legPoints = (['L', 'R'] as const).map((s) => ({
    hip: P(moved(pose[`hip${s}`], s, legShift)).x,
    knee: P(moved(pose[`knee${s}`], s, legShift)).x,
  }));
  const stride = {
    left: Math.min(0, Math.min(...legPoints.map((l) => l.knee)) - Math.min(...legPoints.map((l) => l.hip))),
    right: Math.max(0, Math.max(...legPoints.map((l) => l.knee)) - Math.max(...legPoints.map((l) => l.hip))),
  };

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
      const feminine = look.frame === 'f';
      // The feminine shape is an hourglass. The waist is drawn in on both sides, far enough
      // that a gap shows between it and the hanging arm.
      const inset = (row: number): number => {
        if (!feminine) return 0;
        const deep = width >= 9 ? 2 : 1;
        if (row >= 5 && row <= 7) return deep;
        return row === 4 || row === 8 ? deep - 1 : 0;
      };
      for (let y = top; y <= bottom; y++) {
        const k = bottom === top ? 0 : (y - top) / (bottom - top);
        const left = Math.round(chest.x + (hips.x - chest.x) * k - width / 2);
        const cut = inset(y - top);
        for (let i = cut; i < width - cut; i++) {
          const edge = farSide > 0 ? i === width - 1 - cut : i === cut;
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
      const half = (width - 1) / 2;
      const hipRow = TORSO_FRAME.ay + 11;
      for (const item of ordered) {
        if (!item.torso) continue;
        const fit = fitted(side(item.torso), width);
        let stamp = fit.stamp;
        if (feminine) {
          // Clothing follows the waist, and gets a soft shadow under the chest.
          stamp = stamp.map((row, r) => row.map((cell, c) => {
            const bodyRow = r - TORSO_FRAME.ay;
            const cut = bodyRow <= 11 ? inset(bodyRow) : 0;
            const i = c - (fit.ax - half);
            if (!cell) return cell;
            if (cut && (i < cut || i > width - 1 - cut)) return null;
            if (cut && i === (farSide > 0 ? width - 1 - cut : cut)) return { ...cell, shade: true, light: false };
            if (!back && bodyRow === 3 && Math.abs(c - fit.ax - farSide) <= 2) return { ...cell, shade: true, light: false };
            return cell;
          }));
        }
        stampInto(sprite, stamp.slice(0, hipRow + 1), { ax: fit.ax, ay: TORSO_FRAME.ay }, mid, top);
        // Anything below the hips is a skirt. Each of its rows is stretched towards whichever
        // knee has swung out, more so further down, so the hem follows the stride.
        for (let r = hipRow + 1; r < stamp.length; r++) {
          const cells = stamp[r];
          const first = cells.findIndex(Boolean);
          if (first < 0) continue;
          const last = cells.length - 1 - [...cells].reverse().findIndex(Boolean);
          const t = Math.min(1, (r - hipRow) / 5);
          const from = first + Math.round(stride.left * t);
          const to = last + Math.round(stride.right * t);
          for (let x = from; x <= to; x++) {
            const cell = cells[first + Math.round(((x - from) * (last - first)) / Math.max(1, to - from))];
            if (cell) sprite.set(mid + x - fit.ax, top + r - TORSO_FRAME.ay, hexOf(cell));
          }
        }
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
    if (holding && tool.hold === 'pole' && !options.swing) {
      // A long tool is carried with the arm held out to the side, so the shaft clears the head.
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
          // The grip is pinned to the hand in every frame. While swinging, the tool turns with
          // the forearm as if held like a hammer: upright when the forearm points forward.
          let steps = 0;
          if (options.swing) {
            const fromDown = (Math.atan2(hand.x - elbow.x, hand.y - elbow.y) * 180) / Math.PI;
            steps = Math.round((90 - fromDown) / 45);
            // Long tools only tilt, so they stay on the canvas.
            const limit = tool.hold === 'pole' ? 1 : 3;
            steps = Math.max(-limit, Math.min(limit, steps));
          }
          const pivotX = TOOL_FRAME.ax + (tool.gripDx?.[back ? 'back' : 'front'] ?? 0);
          for (const { dx, dy, cell } of turned(side(tool.tool!), pivotX, TOOL_FRAME.ay, steps)) {
            sprite.set(Math.round(hand.x) + dx, Math.round(hand.y) + dy, hexOf(cell));
          }
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
      for (const item of ordered) if (item.headBehind) stampInto(sprite, hairStamp(item, side(item.headBehind)), HEAD_FRAME, hx, hy);
    },
  });
  layers.push({
    depth: chest.depth + 3,
    draw: () => {
      stampInto(sprite, side(look.head), HEAD_FRAME, hx, hy);
      if (!back) stampInto(sprite, look.faces[options.face ?? 'neutral'] ?? look.faces.neutral, HEAD_FRAME, hx, hy);
      for (const item of ordered) {
        if (item.head) stampInto(sprite, hairStamp(item, side(item.head)), HEAD_FRAME, hx, hy);
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
    // Reported in body-window coordinates, the space the whole-sprite format is painted in.
    const p = project(v, facing);
    return { x: Math.floor(p.x) - BODY_WINDOW.x, y: Math.round(p.y) - BODY_WINDOW.y, depth: p.depth };
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
