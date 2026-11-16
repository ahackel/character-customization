import { darker, hexOf, SHADOW, type Cell, type PaletteKey } from './palette.ts';

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
/** The pixel on the ground under the character, as the animals, objects and plants give theirs. */
export const CHARACTER_ORIGIN = { x: Math.floor(ORIGIN_X), y: ORIGIN_Y };

/**
 * Eight facings. The diagonals keep their old numbers: 0 front right, 1 front left, 2 back left,
 * 3 back right; then 4 front, 5 left, 6 back, 7 right. Drawn are 0, 3, 4, 6 and 7; 1, 2 and 5 are
 * mirror images of 0, 3 and 7.
 */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const FACING_NAMES = ['front right', 'front left', 'back left', 'back right', 'front', 'left', 'back', 'right'] as const;
/** The facings in order round the clock, from front right towards front left. */
export const FACING_RING: Facing[] = [0, 4, 1, 5, 2, 6, 3, 7];
/** The facing `steps` eighths of a turn round from `facing`. */
export const turnFacing = (facing: Facing, steps: number): Facing => FACING_RING[(((FACING_RING.indexOf(facing) + steps) % 8) + 8) % 8];
/**
 * What each facing shows: the facing it is drawn as (1, 2 and 5 are the mirror images of 0, 3 and
 * 7), whether it is seen from behind, and which view of the face it shows, if any.
 */
export const FACING_VIEWS: Record<Facing, { drawn: 0 | 3 | 4 | 6 | 7; mirror: boolean; back: boolean; face: 'diagonal' | 'front' | 'side' | null }> = {
  0: { drawn: 0, mirror: false, back: false, face: 'diagonal' },
  1: { drawn: 0, mirror: true, back: false, face: 'diagonal' },
  2: { drawn: 3, mirror: true, back: true, face: null },
  3: { drawn: 3, mirror: false, back: true, face: null },
  4: { drawn: 4, mirror: false, back: false, face: 'front' },
  5: { drawn: 7, mirror: true, back: false, face: 'side' },
  6: { drawn: 6, mirror: false, back: true, face: null },
  7: { drawn: 7, mirror: false, back: false, face: 'side' },
};
/** The views that are drawn, not mirrored: the two diagonals and front, back and right. */
export type View = 0 | 3 | 'S' | 'N' | 'E';
/** Views drawn from their own stamps where an item has them; otherwise the nearest diagonal's are used. */
export type OwnView = 'S' | 'N' | 'E';

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
  /** Lying on the floor: the pose is drawn as if standing, then laid down a quarter turn. */
  lie?: boolean;
  /** The head turned this many eighths of a turn to the character's left (negative: right), at most one. */
  look?: number;
}

// Forward and right in ground coordinates, for each drawn view. Front, back and side views keep
// the diagonal views' sideways scale so the limbs keep their spacing.
const FORWARD: Record<View, [number, number]> = { 0: [1, 0], 3: [0, -1], S: [0.7071, 0.7071], N: [-0.7071, -0.7071], E: [0.7071, -0.7071] };
const RIGHT: Record<View, [number, number]> = { 0: [0, 1], 3: [1, 0], S: [-0.5, 0.5], N: [0.5, -0.5], E: [0.5, 0.5] };
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

function project(p: Vec3, facing: View): Point {
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
  /** A beard kept short, such as stubble: wear does not let it grow. */
  short?: boolean;
  /** A head item seen from the front, back or side, and what of it hangs behind the body there. */
  views?: Partial<Record<OwnView, { head: Stamp; behind?: Stamp }>>;
  /** Shirt body, waistband, skirt: rigid on the chest. */
  torso?: StampPair;
  /** Sleeve colours from shoulder (first) to hand (last). null leaves the arm bare. */
  arm?: (Cell | null)[];
  /** Trouser colours from hip to ankle. */
  leg?: (Cell | null)[];
  /** The upper of a shoe. A boot's shaft is paint on the lower end of `leg`. */
  foot?: Cell | null;
  /** The sole, where it differs from the upper. */
  sole?: Cell | null;
  /** 'strap' is a sandal: the foot is bare apart from one strap. 'toe' is a shoe worn through at the toes. */
  footOpen?: 'strap' | 'toe';
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
  /** Extra pixels of width for the head and neck, with everything worn on the head. */
  head?: number;
  /** No waist: the feminine hourglass is left out, the torso stays straight. */
  straight?: boolean;
  /** One more row of jaw under the face, like a double chin. */
  chin?: boolean;
}

export const BUILDS: Build[] = [
  { id: 'thin', label: 'Very slim', torso: 7, arm: 2, leg: 3 },
  { id: 'slim', label: 'Slim', torso: 9, arm: 3, leg: 4 },
  { id: 'sturdy', label: 'Sturdy', torso: 11, arm: 4, leg: 5, head: 2, straight: true, chin: true },
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
  /** The bare head and its faces seen from the front, back and side. */
  views?: Partial<Record<OwnView, { head: Stamp; faces: Record<string, Stamp> }>>;
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

/**
 * A standing figure laid on the floor: turned a quarter so the head points left and the front
 * faces up, centred on the character's spot, with a long shadow under it.
 */
function laidDown(standing: Sprite): Sprite {
  const out = new Sprite();
  let top = SPRITE_H;
  let bottom = 0;
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const c = standing.get(x, y);
      if (c && c !== SHADOW) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (top > bottom) return out;
  const middle = Math.round((top + bottom) / 2);
  const cx = SPRITE_W / 2;
  // The far side of the body (the back, seen from the front) rests on the floor.
  const placed: [number, number, string][] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const c = standing.get(x, y);
      if (c && c !== SHADOW) placed.push([cx + (y - middle), ORIGIN_Y - 3 - (x - cx), c]);
    }
  }
  const xs = placed.map((p) => p[0]);
  const low = Math.max(...placed.map((p) => p[1]));
  const left = Math.min(...xs) + 2;
  const right = Math.max(...xs) - 2;
  for (const [row, inset] of [[low - 1, 1], [low, 0], [low + 1, 0], [low + 2, 2]] as const) {
    for (let x = left + inset; x <= right - inset; x++) out.set(x, row, SHADOW);
  }
  for (const [x, y, c] of placed) out.set(x, y, c);
  return out;
}

/**
 * A beard seen from behind: what of the front view stands out past this head's jaw on the side
 * the face points to, above the shoulders, in shade. Worked out against the head actually worn,
 * so a narrow head shows the beard right up to its edge.
 */
export function beardBehind(front: Stamp, head: Stamp): Stamp {
  return front.map((row, y) =>
    row.map((cell, x) => (cell && x >= HEAD_FRAME.ax && y <= HEAD_FRAME.ay && !head[y]?.[x] ? { ...cell, shade: true, light: false } : null)),
  );
}

interface Layer {
  depth: number;
  draw: () => void;
}

/** A stamp made wider by repeating one column `times` times. */
export function widened(stamp: Stamp, col: number, times: number): Stamp {
  return stamp.map((row) => [...row.slice(0, col + 1), ...Array<Cell | null>(times).fill(row[col] ?? null), ...row.slice(col + 1)]);
}

function stampInto(sprite: Sprite, stamp: Stamp, frame: { ax: number; ay: number }, x: number, y: number): void {
  for (let row = 0; row < stamp.length; row++) {
    const cells = stamp[row];
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col];
      if (!cell) continue;
      const px = x + col - frame.ax;
      const py = y + row - frame.ay;
      if (!cell.mix) sprite.set(px, py, hexOf(cell));
      else {
        // See-through cells only tint what is under them, and nothing where nothing is.
        const under = sprite.get(px, py);
        if (under) sprite.set(px, py, mixed(under, hexOf(cell), cell.mix));
      }
    }
  }
}

/** `over` laid on `under` at strength `k`, as #rrggbb. */
export function mixed(under: string, over: string, k: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(channel(under, i) * (1 - k) + channel(over, i) * k).toString(16).padStart(2, '0')).join('');
}

/**
 * Draws a limb through its joints as clean pixel runs: one run per step along the longer axis,
 * never an anti-aliased or rotated shape. A slanted segment gets longer runs so the limb keeps
 * its width across, and each bend is filled with a rounded block so it does not notch. `colorAt`
 * gets the position along the limb from 0 to 1, the index across it, and whether that part runs
 * up and down (across is then left to right) or sideways (across is then top to bottom).
 */
function drawLimb(sprite: Sprite, joints: Point[], width: number, colorAt: (t: number, across: number, tall: boolean) => string): void {
  const steps = joints.slice(1).map((b, i) => Math.max(Math.abs(Math.round(b.x) - Math.round(joints[i].x)), Math.abs(Math.round(b.y) - Math.round(joints[i].y))));
  const total = steps.reduce((a, b) => a + b, 0);
  // The bends first, so the runs drawn after keep their shading across.
  let done = 0;
  for (let i = 1; i < joints.length - 1; i++) {
    done += steps[i - 1];
    const t = total ? done / total : 0;
    const x0 = Math.round(joints[i].x - width / 2);
    const y0 = Math.round(joints[i].y - width / 2);
    for (let dy = 0; dy < width; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const corner = width >= 3 && (dx === 0 || dx === width - 1) && (dy === 0 || dy === width - 1);
        if (!corner) sprite.set(x0 + dx, y0 + dy, colorAt(t, dx, true));
      }
    }
  }
  let step = 0;
  for (let i = 1; i < joints.length; i++) {
    const a = joints[i - 1];
    const b = joints[i];
    const n = steps[i - 1];
    const tall = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
    const major = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    const run = major ? Math.round((width * Math.hypot(b.x - a.x, b.y - a.y)) / major) : width;
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const x = a.x + (n ? ((b.x - a.x) * k) / n : 0);
      const y = a.y + (n ? ((b.y - a.y) * k) / n : 0);
      const t = total ? step / total : 0;
      for (let w = 0; w < run; w++) {
        const across = Math.min(width - 1, Math.floor((w * width) / run));
        if (tall) sprite.set(Math.round(x - run / 2) + w, Math.round(y), colorAt(t, across, true));
        else sprite.set(Math.round(x), Math.round(y - run / 2) + w, colorAt(t, across, false));
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
function fitted(stamp: Stamp, width: number): { stamp: Stamp; ax: number } {
  if (width === 9) return { stamp, ax: TORSO_FRAME.ax };
  // Each side gains or loses this many columns: gained by repeating the column two from the
  // middle, lost from two and three out.
  const more = (width - 9) / 2;
  const ax = TORSO_FRAME.ax;
  const dropped = more < 0 ? Array.from({ length: -more }, (_, k) => [ax - 2 - k, ax + 2 + k]).flat() : [];
  return {
    stamp: stamp.map((row) => row.flatMap((cell, col) => {
      if (more > 0 && (col === ax - 2 || col === ax + 2)) return Array(more + 1).fill(cell);
      return dropped.includes(col) ? [] : [cell];
    })),
    ax: ax + more,
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

const faceOnCache = new WeakMap<Stamp, Stamp[]>();

/**
 * A head item drawn only in 3/4 seen face on (`front`) or from straight behind, worked out from
 * its 3/4 stamp. In the 3/4 stamps the face sits a column and a half to the right of the head's
 * middle, and the middle of the back of the head as far to the left. Face on, each row's half
 * from that point to its right end is stretched to half the row's width and mirrored; from
 * behind, the half to its left end. A row with nothing on that side is only mirrored. So a
 * fringe's opening lands over the face, a cap's peak becomes a band across the brow, and a
 * ponytail hangs down the middle of the back. With `keepColors` (hats) only the outline is
 * mirrored and the other half keeps its own colours, so a badge on one side is not doubled.
 */
export function faceOn(stamp: Stamp, front: boolean, keepColors = false): Stamp {
  let cached = faceOnCache.get(stamp);
  if (!cached) faceOnCache.set(stamp, (cached = []));
  const slot = (front ? 1 : 0) + (keepColors ? 2 : 0);
  const hit = cached[slot];
  if (hit) return hit;
  const middle = HEAD_FRAME.ax + 1;
  const turn = middle + (front ? 1.5 : -1.5);
  const out = stamp.map((row) => {
    const l = row.findIndex(Boolean);
    if (l < 0) return row.map(() => null);
    const r = row.length - 1 - [...row].reverse().findIndex(Boolean);
    const reach = { left: Math.max(0, turn - l), right: Math.max(0, r + 1 - turn) };
    const half = (reach.left + reach.right) / 2;
    const own = front ? 'right' : 'left';
    const sign = own === 'right' ? 1 : -1;
    // A row with nothing on that side, such as hair hanging behind the far shoulder, keeps its
    // place and is mirrored as it is.
    if (!reach[own] || !row.some((cell, x) => cell && sign * (x + 0.5 - turn) > 0)) return row.map((cell, x) => cell ?? row[2 * middle - 1 - x] ?? null);
    return row.map((_, x) => {
      // Distance from the middle, the same for a column and its mirror image.
      const d = Math.abs(x + 0.5 - middle);
      const cell = row[Math.floor(turn + (sign * d * reach[own]) / half)] ?? null;
      // A hat takes its colours on the other half from that half, so a badge is not doubled.
      if (!cell || !keepColors || sign * (x + 0.5 - middle) > 0) return cell;
      return row[Math.floor(turn - (sign * d * reach[own === 'right' ? 'left' : 'right']) / half)] ?? cell;
    });
  });
  cached[slot] = out;
  return out;
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

/**
 * A rim of shade on the edge of the figure turned away from the light: every pixel of the
 * outline that has empty space to its right or below goes one tone down its own ramp. The
 * hand-drawn way to keep an outline-free sprite apart from the ground without a black line,
 * and it adds no colours. Done after mirroring, so the light stays at the upper left.
 */
function rimmed(sprite: Sprite): Sprite {
  const empty = (x: number, y: number) => {
    const c = x < SPRITE_W && y < SPRITE_H ? sprite.get(x, y) : null;
    return !c || c === SHADOW;
  };
  const out = new Sprite();
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const c = sprite.get(x, y);
      if (!c) continue;
      out.pixels[y * SPRITE_W + x] = c !== SHADOW && (empty(x + 1, y) || empty(x, y + 1)) ? darker(c) : c;
    }
  }
  return out;
}

/** Draws one frame of a character. Every pixel is placed by a rule or comes from a stamp. */
export function drawCharacter(look: Look, pose: Pose, facing: Facing, options: DrawOptions = {}): Sprite {
  return rimmed(drawFigure(look, pose, facing, options));
}

function drawFigure(look: Look, pose: Pose, facing: Facing, options: DrawOptions): Sprite {
  // A mirrored view turns the head the other way round too.
  const across1 = (): Pose => (pose.look ? { ...pose, look: -pose.look } : pose);
  if (FACING_VIEWS[facing].mirror) return drawFigure(look, across1(), FACING_VIEWS[facing].drawn, options).mirrored();
  if (pose.lie) return laidDown(drawFigure(look, { ...pose, lie: false }, facing, options));
  const view: View = facing === 4 ? 'S' : facing === 6 ? 'N' : facing === 7 ? 'E' : (facing as 0 | 3);
  const own: OwnView | null = typeof view === 'string' ? view : null;
  const diagonal = own === null;

  const sprite = new Sprite();
  const back = view === 3 || view === 'N';
  const side = (pair: StampPair) => (back ? pair.back : pair.front);
  const P = (v: Vec3) => project(v, view);
  const skin: Cell = { key: look.skin, shade: false };
  const tone = (cell: Cell, shade: boolean) => hexOf({ ...cell, shade: cell.shade || shade, light: shade ? false : cell.light });
  const layers: Layer[] = [];
  // Later slots cover earlier ones.
  const ordered = SLOTS.flatMap((slot) => look.items.filter((i) => i.slot === slot));
  const tool = ordered.find((i) => i.tool);
  const build = look.build ?? BUILDS.find((b) => b.id === 'slim')!;
  // Poses are authored for the slim build. Wider builds move the limbs outwards so that arms
  // still sit just outside the torso and legs keep a one-pixel gap.
  // Face on and from behind the torso is two pixels wider and the arms move out with it; side on
  // it is two narrower, its depth.
  const torsoWidth = build.torso + (own === 'S' || own === 'N' ? 2 : own === 'E' ? -2 : 0);
  const armShift = ((torsoWidth - 9) / 2 + (build.arm - 3) / 2) / 0.7071;
  const hat = ordered.find((i) => i.slot === 'hat' && i.head);
  // Under a hat that covers the crown, hair is drawn in its tucked form.
  const hairStamp = (item: Item, stamp: Stamp): Stamp =>
    item.slot === 'hair' && hat && coversCrown(rawHead(hat)) ? tucked(stamp, rawHead(hat)) : stamp;
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
        // One edge stays in shade along the whole leg, the far side or the underside, so it reads as round.
        drawLimb(sprite, [hip, knee, foot], build.leg, (t, across, tall) =>
          tone(limbPaint('leg', t), far || (build.leg >= 3 && across === (tall && farSide < 0 ? 0 : build.leg - 1))));
        const shoes = [...ordered].reverse().find((item) => item.foot);
        const upper = shoes?.foot ?? skin;
        const sole = shoes?.sole ?? upper;
        // Feet are wider than the legs and point the way the character faces.
        // Seen from the front or back they point at or away from the viewer, so they stay as wide
        // as the leg; side on they reach a pixel further forward.
        const left = Math.round(foot.x - build.leg / 2);
        const top = Math.round(foot.y);
        const toe = own === 'S' || own === 'N' ? build.leg - 1 : own === 'E' ? build.leg + 1 : build.leg;
        for (let dx = 0; dx <= toe; dx++) {
          // A sandal leaves the foot bare apart from one strap; a worn-out shoe shows the toes.
          const bare = shoes?.footOpen === 'strap' ? dx !== Math.floor(build.leg / 2) : shoes?.footOpen === 'toe' && dx === toe;
          sprite.set(left + dx, top, tone(bare ? skin : upper, far));
          sprite.set(left + dx, top + 1, tone(sole, far || dx === 0));
        }
      },
    });
  }

  // ---- torso: a block from shoulders to hips with a shaded far side, then rigid clothing stamps
  const farSide = Math.sign(P(pose.shoulderL).x - chest.x) || 1;
  // Which way on screen the character faces.
  const ahead = Math.sign(P([0, 0, 1]).x - P([0, 0, 0]).x) || 1;
  layers.push({
    depth: chest.depth,
    draw: () => {
      const top = Math.round(chest.y);
      const bottom = Math.round(hips.y) + 1;
      const width = torsoWidth;
      const feminine = look.frame === 'f';
      // The feminine shape is an hourglass. The waist is drawn in on both sides, far enough
      // that a gap shows between it and the hanging arm. A sturdy build stays straight.
      const inset = (row: number): number => {
        if (!feminine || build.straight) return 0;
        const deep = width >= 9 ? 2 : 1;
        if (row >= 5 && row <= 7) return deep;
        return row === 4 || row === 8 ? deep - 1 : 0;
      };
      /** First and last body column drawn in a torso row. Column 0 is the left edge of the block. */
      const span = (row: number): [number, number] => [inset(row), width - 1 - inset(row)];
      for (let y = top; y <= bottom; y++) {
        const k = bottom === top ? 0 : (y - top) / (bottom - top);
        const left = Math.round(chest.x + (hips.x - chest.x) * k - width / 2);
        const [lo, hi] = span(y - top);
        for (let i = lo; i <= hi; i++) {
          // The far side is in shade, and there is a shadow under the chin.
          const edge = farSide > 0 ? i === hi : i === lo;
          const under = y === top && i >= 2 && i <= width - 3;
          sprite.set(left + i, y, tone(skin, edge || under));
        }
      }
      const mid = Math.floor(chest.x);
      if (back) {
        // A hint of the spine, so the back is not an empty block.
        for (let dy = 2; dy <= 5; dy++) sprite.set(mid, top + dy, tone(skin, true));
      } else {
        if (own !== 'E') sprite.set(own === 'S' ? mid : mid + 1, top + 8, tone(skin, true));
      }
      const half = (width - 1) / 2;
      const hipRow = TORSO_FRAME.ay + 11;
      for (const item of ordered) {
        if (!item.torso) continue;
        const fit = fitted(side(item.torso), width);
        let stamp = fit.stamp;
        if (feminine) {
          // Clothing follows the waist, and gets a soft shadow under the chest.
          const first = fit.ax - half;
          stamp = stamp.map((row, r) => {
            const bodyRow = r - TORSO_FRAME.ay;
            if (bodyRow < 0 || bodyRow > 11) return row;
            const [lo, hi] = span(bodyRow);
            const out = row.map((cell, c) => {
              const i = c - first;
              if (!cell) return cell;
              if (inset(bodyRow) && (i < lo || i > hi)) return null;
              if (!back && feminine && bodyRow === 3 && Math.abs(c - fit.ax - farSide) <= 2) return { ...cell, shade: true, light: false };
              return cell;
            });
            if (inset(bodyRow)) {
              const c = first + (farSide > 0 ? hi : lo);
              if (out[c]) out[c] = { ...out[c]!, shade: true, light: false };
            }
            return out;
          });
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
    const holding = !far && tool && (diagonal || own === 'E' || s === 'R');
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
            // A long tool does not turn with the arm: it stays tilted the way the character
            // faces and is thrust with the hand, which also keeps it on the canvas.
            steps = tool.hold === 'pole' ? ahead : Math.max(-3, Math.min(3, steps));
          } else if (tool.hold === 'pole' && own === 'E') {
            // Side on, an upright shaft would run straight through the face: it leans forward,
            // past the face, as a spear is carried on the march.
            steps = ahead;
          }
          const pivotX = TOOL_FRAME.ax + (tool.gripDx?.[back ? 'back' : 'front'] ?? 0);
          for (const { dx, dy, cell } of turned(side(tool.tool!), pivotX, TOOL_FRAME.ay, steps)) {
            sprite.set(Math.round(hand.x) + dx, Math.round(hand.y) + dy, hexOf(cell));
          }
        }
        drawLimb(sprite, [shoulder, elbow, hand], build.arm, (t, across, tall) => {
          // The nearer arm's inner edge is shaded all along, or its underside where it is held out,
          // so it separates from the body and reads as round.
          const contact = !far && (tall ? (inner > 0 ? across === build.arm - 1 : across === 0) : across === build.arm - 1);
          // The outer corner of the shoulder is lit, which rounds it.
          const cap = !far && t === 0 && (inner > 0 ? across === 0 : across === build.arm - 1);
          const cell = limbPaint('arm', t);
          return cap ? hexOf({ ...cell, shade: false, light: true }) : tone(cell, far || contact);
        });
        // Hands are a visible block of skin, drawn over whatever they hold.
        // As wide as the arm, at least three pixels; the knuckle row is shaded apart from its middle.
        const handW = Math.max(3, build.arm);
        const left = Math.round(hand.x - handW / 2);
        const top = Math.round(hand.y) - 1;
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < handW; dx++) sprite.set(left + dx, top + dy, tone(skin, far || (dy === 2 && dx !== 1 && dx !== handW - 2)));
        }
      },
    });
  }

  // ---- head: rigid stamps. A wider build repeats the middle column of the head, hair and hat
  // stamps so they widen together and stay centred; the face keeps its size in the middle.
  const neck = P(pose.neck);
  // The head turns up to an eighth either way of the body and is drawn in the view it then
  // faces: that view's own stamps, mirrored for the left-hand views.
  const headFacing = turnFacing(facing, -Math.max(-1, Math.min(1, pose.look ?? 0)));
  const { mirror: flip, drawn: headView, back: headBack } = FACING_VIEWS[headFacing];
  const hv: OwnView | null = headView === 4 ? 'S' : headView === 6 ? 'N' : headView === 7 ? 'E' : null;
  const hside = (pair: StampPair) => (headBack ? pair.back : pair.front);
  const extra = build.head ?? 0;
  // Mirroring the head moves it two pixels towards the body's front; a turned head is moved back
  // one less, so it leans a pixel the way it now looks instead of seeming to pull back.
  const nudge = flip ? -1 : 0;
  const hx = Math.floor(neck.x) - Math.floor(extra / 2) + nudge;
  // The neck is one row shorter than the head stamps draw it: the head sits a row lower and the
  // neck's lowest row is left out, so it still ends on the shoulders. A double chin already
  // takes up that row.
  const lift = build.chin ? 0 : 1;
  const hy = Math.round(neck.y) + lift;
  // The jaw row, in the head frame; a double chin repeats it, which moves the chin and neck down.
  const JAW = 21;
  const headStamp = (stamp: Stamp): Stamp => {
    const wide = across(extra ? widened(stamp, HEAD_FRAME.ax, extra) : stamp, extra);
    return build.chin ? [...wide.slice(0, JAW + 1), wide[JAW], ...wide.slice(JAW + 1)] : wide;
  };
  // A head facing a left-hand view: the same stamps mirrored about the head's middle, between two columns.
  const across = (stamp: Stamp, wider: number): Stamp =>
    flip ? stamp.map((row) => row.map((_, x) => row[2 * HEAD_FRAME.ax + wider + 1 - x] ?? null)) : stamp;
  // Front, back and side views use the head's and the items' hv stamps for that view; an item
  // without them falls back to its diagonal stamp on the same side.
  const ownHead = hv ? look.views?.[hv] : undefined;
  const faces = ownHead?.faces ?? look.faces;
  const face = headBack ? [] : across(faces[options.face ?? 'neutral'] ?? faces.neutral, 0);
  const headOf = () => ownHead?.head ?? hside(look.head);
  // An item without its own stamp for the view falls back to its 3/4 stamp on the same side.
  const fallback = (item: Item): Stamp => {
    const stamp = hside(item.head!);
    if ((item.slot === 'hat' || item.slot === 'hair') && (hv === 'S' || hv === 'N')) return faceOn(stamp, hv === 'S', item.slot === 'hat');
    if (item.slot !== 'beard' || !hv) return stamp;
    // Side on the beard moves forward with the face. Face on it is the half of the 3/4 beard
    // towards the face, mirrored about the middle of the face; from behind only what stands out
    // past the head shows, in shade.
    if (hv === 'E') return stamp.map((row) => row.map((_, x) => row[x - 1] ?? null));
    const front = item.head!.front;
    const straight = front.map((row) => row.map((_, x) => row[Math.max(x, 2 * HEAD_FRAME.ax + 1 - x) + 2] ?? null));
    if (hv === 'S') return straight;
    const head = headOf();
    return straight.map((row, y) => row.map((cell, x) => (cell && y <= HEAD_FRAME.ay && !head[y]?.[x] ? { ...cell, shade: true, light: false } : null)));
  };
  function rawHead(item: Item): Stamp {
    return hv && item.views?.[hv] ? item.views[hv]!.head : fallback(item);
  }
  const itemHead = (item: Item) => hairStamp(item, rawHead(item));
  const itemBehind = (item: Item): Stamp | undefined => {
    if (hv && item.views?.[hv]) return item.views[hv]!.behind && hairStamp(item, item.views[hv]!.behind!);
    if (!item.headBehind || hv === 'N') return undefined;
    return hairStamp(item, hv === 'S' ? faceOn(hside(item.headBehind), true) : hside(item.headBehind));
  };
  // The face keeps its size on a wider head; side on it stays at the front of the head.
  const fx = Math.floor(neck.x) + nudge + (hv === 'E' ? (flip ? -1 : 1) * (extra - Math.floor(extra / 2)) : 0);
  const bearded = ordered.some((item) => item.slot === 'beard' && item.head);
  layers.push({
    depth: back ? chest.depth + 0.5 : chest.depth - 0.5,
    draw: () => {
      for (const item of ordered) {
        const behind = itemBehind(item);
        if (behind) stampInto(sprite, headStamp(behind), HEAD_FRAME, hx, hy);
      }
    },
  });
  layers.push({
    depth: chest.depth + 3,
    draw: () => {
      stampInto(sprite, headStamp(headOf()).map((row, y) => (y > HEAD_FRAME.ay - lift ? row.map(() => null) : row)), HEAD_FRAME, hx, hy);
      if (!headBack) stampInto(sprite, face, HEAD_FRAME, fx, hy);
      for (const item of ordered) {
        // From straight behind a beard does not show.
        if (!item.head) continue;
        stampInto(sprite, headStamp(headView === 3 && item.slot === 'beard' ? beardBehind(item.head.front, look.head.back) : itemHead(item)), HEAD_FRAME, hx, hy);
      }
      // The mouth shows through any beard, in whatever shape the mood gives it.
      if (bearded && !headBack) {
        const mouth = face.map((row) => row.map((cell) => (cell && (cell.key === 'mouth' || cell.key === 'tooth') ? cell : null)));
        stampInto(sprite, mouth, HEAD_FRAME, fx, hy);
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
