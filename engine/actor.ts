// A character walking around a world: position in metres, facing, which clip plays, and the
// sprite for the current frame. Movement slides along whatever blocks it.
import { AUTHORED, STAND, type Clip } from '../lab/poses.ts';
import { CHARACTER_ORIGIN as FEET, drawCharacter, FACING_RING, SPRITE_H, SPRITE_W, turnFacing, type Facing, type Look, type Sprite } from '../lab/puppet.ts';
import { SHADOW } from '../lab/palette.ts';
import type { Picture } from '../lab/island.ts';
import { heightAt, LEVEL_PX, SEA_LEVEL, standingHeight } from '../lab/terrain.ts';
import { ocean, rgb } from './ocean.ts';
import type { Thing, World } from './world.ts';

export const EMOTES = ['wave', 'use'] as const;
export type Emote = (typeof EMOTES)[number];
type ClipId = 'idle' | 'walk' | 'run' | Emote;

/** Metres per second. */
const SPEED = { walk: 1.7, run: 3.6 };
/** How many times an emote plays before the character goes back to standing. */
const EMOTE_LOOPS = 2;
/** Wading is slower than walking on land. */
const WADING = 0.6;
/**
 * Splashes while wading: drops thrown up from the feet every `every` seconds of walking (half that
 * running), `per` at a time, falling back under `gravity`, in levels and tiles per second.
 */
const SPLASH = { every: 0.08, per: 2, up: [4, 8], out: 0.7, gravity: 40 };

/**
 * What a standing character does now and then so it does not look frozen: glance aside, turn its
 * head, smile, laugh or look surprised, for a moment, then rest again. Weights add up to 1.
 */
// A glance turns the whole body an eighth of a turn, into a straight view, for a moment.
// `look` turns the head an eighth, left or right at random.
const FIDGETS: { weight: number; look?: 1; glance?: boolean; face?: string; seconds: [number, number] }[] = [
  { weight: 0.18, face: 'aside', seconds: [0.8, 1.8] },
  { weight: 0.28, look: 1, seconds: [0.8, 2.4] },
  { weight: 0.06, look: 1, face: 'smile', seconds: [1, 2] },
  { weight: 0.08, glance: true, seconds: [0.8, 1.8] },
  { weight: 0.07, look: 1, face: 'aside', seconds: [0.8, 1.6] },
  { weight: 0.07, look: 1, face: 'smile', seconds: [1.2, 2.4] },
  { weight: 0.15, face: 'smile', seconds: [1.5, 3.5] },
  { weight: 0.06, face: 'happy', seconds: [0.8, 1.4] },
  { weight: 0.05, face: 'surprised', seconds: [0.5, 1] },
];
/** Seconds of plain standing between two fidgets. */
const REST: [number, number] = [1.5, 4.5];
const between = ([a, b]: [number, number]) => (a + Math.random() * (b - a)) * 1000;

interface Fidget { look?: number; glance?: 1 | -1; face?: string; until: number }

interface Drop { i: number; j: number; z: number; vi: number; vj: number; vz: number; pale: boolean }

/** A colour moved part of the way to another; a sprite colour keeps its alpha. */
function tint(hex: string, to: number[], k: number): string {
  const from = rgb(hex);
  return '#' + from.map((v, n) => Math.round(v + (to[n] - v) * k).toString(16).padStart(2, '0')).join('') + hex.slice(7);
}

/** A character picture standing `rows` pixels deep in water: the rows under the surface are tinted, the waterline lighter, the ground shadow gone. */
function wading(sprite: Picture, rows: number): Picture {
  const water = rgb(ocean.shallow);
  const foam = rgb(ocean.wave);
  const line = FEET.y - rows;
  return {
    get(x, y) {
      const c = sprite.get(x, y);
      if (!c || c === SHADOW) return null;
      if (y === line) return tint(c, foam, 0.55);
      return y > line ? tint(c, water, 0.6) : c;
    },
  };
}

/**
 * The facing for a direction on the map, in eighths of a turn. +i is front right on screen, +j
 * front left, -i back left, -j back right, and the facings between them lie between.
 */
export function facingOf(di: number, dj: number, current: Facing): Facing {
  if (Math.abs(di) < 1e-6 && Math.abs(dj) < 1e-6) return current;
  return turnFacing(0, Math.round(Math.atan2(dj, di) / (Math.PI / 4)));
}

/** Milliseconds per eighth of a turn when a character or animal changes direction. */
export const TURN_MS = 55;

/** One eighth of a turn from `from` towards `to`, the short way round. */
export function turnToward(from: Facing, to: Facing): Facing {
  const d = (((FACING_RING.indexOf(to) - FACING_RING.indexOf(from)) % 8) + 8) % 8;
  return d === 0 ? from : turnFacing(from, d <= 4 ? 1 : -1);
}

export class Actor {
  i: number;
  j: number;
  facing: Facing = 0;
  /** The last direction walked, as an angle on the map. */
  private heading = 0;
  /** Where the character is turning to, a step at a time, and when it last stepped. */
  private aim: Facing = 0;
  private turned = 0;
  private clip: ClipId = 'idle';
  private started = 0;
  private look: Look;
  private frames = new Map<string, Sprite>();
  private wet = new Map<string, Picture>();
  private drops: Drop[] = [];
  private splashClock = 0;
  /** The fidget playing while standing, and when the next one starts. */
  private fidget: Fidget | null = null;
  private nextFidget = 0;

  constructor(look: Look, at: { i: number; j: number }) {
    this.look = look;
    this.i = at.i;
    this.j = at.j;
  }

  setLook(look: Look): void {
    this.look = look;
    this.frames.clear();
    this.wet.clear();
  }

  emote(emote: Emote, ms: number): void {
    this.play(emote, ms);
  }

  private play(clip: ClipId, ms: number): void {
    if (clip === this.clip) return;
    this.clip = clip;
    this.started = ms;
    this.fidget = null;
    this.nextFidget = ms + between(REST);
  }

  /** Starts, ends or keeps the standing fidget. */
  private fidgetAt(ms: number): Fidget | null {
    if (this.clip !== 'idle') return null;
    if (!this.nextFidget) this.nextFidget = ms + between(REST);
    if (this.fidget && ms > this.fidget.until) {
      this.fidget = null;
      this.nextFidget = ms + between(REST);
    }
    if (!this.fidget && ms >= this.nextFidget) {
      let roll = Math.random();
      const pick = FIDGETS.find((f) => (roll -= f.weight) < 0) ?? FIDGETS[0];
      const side = Math.random() < 0.5 ? 1 : -1;
      this.fidget = { look: pick.look && pick.look * side, glance: pick.glance ? side : undefined, face: pick.face, until: ms + between(pick.seconds) };
    }
    return this.fidget;
  }

  /**
   * Moves by a direction on the map (any length; it is normalised) for `dt` seconds. A zero
   * direction stands still, letting an emote finish.
   */
  update(world: World, dt: number, di: number, dj: number, run: boolean, ms: number): void {
    this.fly(Math.min(dt, 0.1));
    const length = Math.hypot(di, dj);
    if (length > 1e-6) {
      this.aim = facingOf(di, dj, this.aim);
      this.heading = Math.atan2(dj, di);
    } else {
      // Standing, a character settles into the nearest of the four diagonal views, which read
      // best; the straight views are for walking and glancing.
      this.aim = turnFacing(0, 2 * Math.round(this.heading / (Math.PI / 2)));
    }
    if (this.facing !== this.aim && ms - this.turned >= TURN_MS) {
      this.facing = turnToward(this.facing, this.aim);
      this.turned = ms;
    }
    if (length < 1e-6) {
      const clip = AUTHORED[this.clip];
      const emoting = (EMOTES as readonly string[]).includes(this.clip);
      if (!emoting || ms - this.started > (clip.frames.length / clip.rate) * 1000 * EMOTE_LOOPS) this.play('idle', ms);
      return;
    }
    this.play(run ? 'run' : 'walk', ms);
    const depth = this.depth(world);
    const step = (run ? SPEED.run : SPEED.walk) * (depth > 0 ? WADING : 1) * Math.min(dt, 0.1);
    if (depth > 0) this.splash(Math.min(dt, 0.1), run);
    const mi = (di / length) * step;
    const mj = (dj / length) * step;
    const from = { i: this.i, j: this.j };
    // Try the whole move, then each axis alone, so a wall or a plant is slid along, not stuck on.
    for (const [ti, tj] of [[mi, mj], [mi, 0], [0, mj]]) {
      if (!ti && !tj) continue;
      const to = { i: this.i + ti, j: this.j + tj };
      if (world.canWalk(from, to)) {
        this.i = to.i;
        this.j = to.j;
        return;
      }
    }
  }

  /** How deep the character stands in water, in levels; 0 on land. */
  private depth(world: World): number {
    return Math.max(0, SEA_LEVEL - heightAt(world.floor, this.i, this.j));
  }

  private splash(dt: number, run: boolean): void {
    this.splashClock += dt;
    const every = run ? SPLASH.every / 2 : SPLASH.every;
    for (; this.splashClock > every; this.splashClock -= every) {
      for (let n = 0; n < SPLASH.per; n++) {
        const a = Math.random() * Math.PI * 2;
        const out = SPLASH.out * (0.3 + Math.random() * 0.7);
        this.drops.push({
          i: this.i + Math.cos(a) * 0.12, j: this.j + Math.sin(a) * 0.12, z: 0,
          vi: Math.cos(a) * out, vj: Math.sin(a) * out,
          vz: SPLASH.up[0] + Math.random() * (SPLASH.up[1] - SPLASH.up[0]), pale: Math.random() < 0.4,
        });
      }
    }
  }

  /** Moves the drops on; a drop is gone when it falls back into the water. */
  private fly(dt: number): void {
    for (const d of this.drops) {
      d.i += d.vi * dt;
      d.j += d.vj * dt;
      d.vz -= SPLASH.gravity * dt;
      d.z += d.vz * dt;
    }
    this.drops = this.drops.filter((d) => d.z > 0);
  }

  /** The splash drops in the air, each one pixel, standing on the water surface below it. */
  dropThings(): Thing[] {
    const white = ocean.wave;
    const pale = ocean.shore;
    return this.drops.map((d) => ({
      spot: { i: d.i, j: d.j, level: SEA_LEVEL + d.z },
      picture: d.pale ? dot(pale) : dot(white),
      w: 1, h: 1, foot: { x: 0, y: 0 },
    }));
  }

  thing(world: World, ms: number): Thing {
    const clip: Clip = AUTHORED[this.clip];
    const n = Math.floor(((ms - this.started) / 1000) * clip.rate) % clip.frames.length;
    const fidget = this.fidgetAt(ms);
    // Blinking goes on through a fidget.
    const face = clip.faces?.[n] === 'blink' ? 'blink' : (fidget?.face ?? clip.faces?.[n]);
    const look = fidget?.look ?? 0;
    const facing = fidget?.glance ? turnFacing(this.facing, fidget.glance) : this.facing;
    const key = `${this.clip}|${n}|${facing}|${face}|${look}`;
    let sprite = this.frames.get(key);
    if (!sprite) {
      const pose = look ? { ...STAND, look } : clip.frames[n];
      this.frames.set(key, (sprite = drawCharacter(this.look, pose, facing, { face, swing: clip.swing })));
    }
    const depth = this.depth(world);
    if (depth <= 0) return { spot: { i: this.i, j: this.j, level: standingHeight(world.map, this.i, this.j) }, picture: sprite, w: SPRITE_W, h: SPRITE_H, foot: FEET };
    // In the shallows the feet stand on the sea floor, under the surface.
    const rows = Math.round(depth * LEVEL_PX);
    const wetKey = `${key}|${rows}`;
    let picture = this.wet.get(wetKey);
    if (!picture) this.wet.set(wetKey, (picture = wading(sprite, rows)));
    return { spot: { i: this.i, j: this.j, level: SEA_LEVEL - depth }, picture, w: SPRITE_W, h: SPRITE_H, foot: FEET };
  }
}

const dots = new Map<string, Picture>();
/** A one-pixel picture of a colour, kept so its shadow and drawing caches hold. */
function dot(color: string): Picture {
  let picture = dots.get(color);
  if (!picture) dots.set(color, (picture = { get: () => color }));
  return picture;
}
