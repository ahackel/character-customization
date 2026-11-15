// A character walking around a world: position in metres, facing, which clip plays, and the
// sprite for the current frame. Movement slides along whatever blocks it.
import { AUTHORED, type Clip } from '../lab/poses.ts';
import { drawCharacter, type Facing, type Look, type Sprite } from '../lab/puppet.ts';
import { standingHeight } from '../lab/terrain.ts';
import type { Thing, World } from './world.ts';

export const EMOTES = ['wave', 'use'] as const;
export type Emote = (typeof EMOTES)[number];
type ClipId = 'idle' | 'walk' | 'run' | Emote;

/** Metres per second. */
const SPEED = { walk: 1.7, run: 3.6 };
/** How many times an emote plays before the character goes back to standing. */
const EMOTE_LOOPS = 2;
/** The pixel in a character sprite that stands on the ground. */
const FEET = { x: 32, y: 52 };

/**
 * The facing for a direction on the map. The four facings are the map axes: +i is front right
 * on screen, +j front left, -i back left, -j back right.
 */
export function facingOf(di: number, dj: number, current: Facing): Facing {
  if (Math.abs(di) < 1e-6 && Math.abs(dj) < 1e-6) return current;
  if (Math.abs(di) >= Math.abs(dj)) return di > 0 ? 0 : 2;
  return dj > 0 ? 1 : 3;
}

export class Actor {
  i: number;
  j: number;
  facing: Facing = 0;
  private clip: ClipId = 'idle';
  private started = 0;
  private look: Look;
  private frames = new Map<string, Sprite>();

  constructor(look: Look, at: { i: number; j: number }) {
    this.look = look;
    this.i = at.i;
    this.j = at.j;
  }

  setLook(look: Look): void {
    this.look = look;
    this.frames.clear();
  }

  emote(emote: Emote, ms: number): void {
    this.play(emote, ms);
  }

  private play(clip: ClipId, ms: number): void {
    if (clip === this.clip) return;
    this.clip = clip;
    this.started = ms;
  }

  /**
   * Moves by a direction on the map (any length; it is normalised) for `dt` seconds. A zero
   * direction stands still, letting an emote finish.
   */
  update(world: World, dt: number, di: number, dj: number, run: boolean, ms: number): void {
    const length = Math.hypot(di, dj);
    if (length < 1e-6) {
      const clip = AUTHORED[this.clip];
      const emoting = (EMOTES as readonly string[]).includes(this.clip);
      if (!emoting || ms - this.started > (clip.frames.length / clip.rate) * 1000 * EMOTE_LOOPS) this.play('idle', ms);
      return;
    }
    this.facing = facingOf(di, dj, this.facing);
    this.play(run ? 'run' : 'walk', ms);
    const step = (run ? SPEED.run : SPEED.walk) * Math.min(dt, 0.1);
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

  thing(world: World, ms: number): Thing {
    const clip: Clip = AUTHORED[this.clip];
    const n = Math.floor(((ms - this.started) / 1000) * clip.rate) % clip.frames.length;
    const key = `${this.clip}|${n}|${this.facing}`;
    let sprite = this.frames.get(key);
    if (!sprite) this.frames.set(key, (sprite = drawCharacter(this.look, clip.frames[n], this.facing, { face: clip.faces?.[n], swing: clip.swing })));
    return { spot: { i: this.i, j: this.j, level: standingHeight(world.map, this.i, this.j) }, picture: sprite, w: 64, h: 64, foot: FEET };
  }
}
