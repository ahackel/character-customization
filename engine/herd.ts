// The scene's animals come alive in Play: each rests a while (standing or grazing), then ambles or,
// now and then, runs to a spot near where it was placed, and rests again. They keep to dry land and to slopes a walker
// can take. Positions are in scene (data) coordinates, so turning the view does not move them.
import type { ClipId } from '../lab/animal.ts';
import { heightAt, SEA_LEVEL } from '../lab/terrain.ts';
import { facingOf } from './actor.ts';
import type { World } from './world.ts';

/**
 * Metres per second walking, running and hopping; share of trips run, or hopped by animals that hop
 * (their run is a hop); how far from home it roams; seconds of rest.
 */
const WANDER = { walk: 0.6, run: 2, hop: 1.1, runs: 0.25, hops: 0.8, roam: 2.5, rest: [2, 7], graze: 0.3 };

export interface AnimalPose { i: number; j: number; facing: 0 | 1 | 2 | 3; clip: ClipId; started: number }

interface State extends AnimalPose { hops: boolean; home: { i: number; j: number }; until: number; target: { i: number; j: number } | null }

export class Herd {
  poses: State[];

  constructor(world: World, ms: number) {
    this.poses = world.scene.animals.map((a) => ({
      i: a.i, j: a.j, hops: a.animal.hops, facing: a.facing as 0 | 1 | 2 | 3, clip: 'idle', started: ms,
      home: { i: a.i, j: a.j }, until: ms + rest(), target: null,
    }));
  }

  update(world: World, dt: number, ms: number): void {
    for (const a of this.poses) {
      if (!a.target) {
        if (ms < a.until) continue;
        const angle = Math.random() * Math.PI * 2;
        const far = WANDER.roam * Math.sqrt(Math.random());
        a.target = { i: a.home.i + Math.cos(angle) * far, j: a.home.j + Math.sin(angle) * far };
        play(a, Math.random() < (a.hops ? WANDER.hops : WANDER.runs) ? 'run' : 'walk', ms);
      }
      const di = a.target.i - a.i;
      const dj = a.target.j - a.j;
      const length = Math.hypot(di, dj);
      const step = Math.min(length, (a.clip !== 'run' ? WANDER.walk : a.hops ? WANDER.hop : WANDER.run) * dt);
      const to = { i: a.i + (di / length) * step, j: a.j + (dj / length) * step };
      if (length < 0.05 || !dry(world, a, to)) {
        // Arrived, or the way is blocked: rest, standing or grazing.
        a.target = null;
        a.until = ms + rest();
        play(a, Math.random() < WANDER.graze ? 'eat' : 'idle', ms);
        continue;
      }
      a.facing = facingOf(di, dj, a.facing);
      a.i = to.i;
      a.j = to.j;
    }
  }
}

const rest = () => (WANDER.rest[0] + Math.random() * (WANDER.rest[1] - WANDER.rest[0])) * 1000;

function play(a: State, clip: ClipId, ms: number): void {
  if (a.clip === clip) return;
  a.clip = clip;
  a.started = ms;
}

/** Whether a step stays on land a walker could take. */
function dry(world: World, from: { i: number; j: number }, to: { i: number; j: number }): boolean {
  const a = world.toView(from);
  const b = world.toView(to);
  return world.canWalk(a, b) && heightAt(world.floor, b.i, b.j) >= SEA_LEVEL;
}
