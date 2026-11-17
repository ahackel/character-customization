// Fish under the water: small dark shapes that wander where it is deep enough, turning back before
// the shallows. They are drawn on the ground image with the water over them, like decor, so they
// never cover the beach, waves or anything standing.
import { heightAt, inside, SEA_LEVEL, type HeightMap } from './terrain.ts';

export interface Fish {
  /** Where it is, in metres from the north corner of the map. */
  i: number;
  j: number;
  /** Heading in radians on the map. */
  a: number;
  /** How fast it turns now, radians a second; it drifts so the path wanders. */
  turn: number;
  /** Metres a second. */
  speed: number;
}

/** Fish keep to water at least this many levels deep. */
export const FISH_DEPTH = 0.4;
const SPEED = [0.35, 0.7] as const;

/** Whether a fish may be at a map point. */
export const swimmable = (map: HeightMap, i: number, j: number) =>
  inside(map, Math.floor(i), Math.floor(j)) && SEA_LEVEL - heightAt(map, i, j) >= FISH_DEPTH;

/** Up to `count` fish at random spots deep enough for them. */
export function spawnFish(map: HeightMap, count: number, random: () => number): Fish[] {
  const out: Fish[] = [];
  for (let tries = 0; out.length < count && tries < count * 200; tries++) {
    const i = random() * map.w;
    const j = random() * map.h;
    if (!swimmable(map, i, j)) continue;
    out.push({ i, j, a: random() * Math.PI * 2, turn: 0, speed: SPEED[0] + random() * (SPEED[1] - SPEED[0]) });
  }
  return out;
}

/** Moves every fish on by `dt` seconds: wandering, and turning away where the water ends. */
export function swim(fish: Fish[], map: HeightMap, dt: number, random: () => number): void {
  for (const f of fish) {
    f.turn += (random() - 0.5) * 6 * dt;
    f.turn *= Math.exp(-dt);
    f.a += f.turn * dt;
    const ahead = 0.6;
    if (!swimmable(map, f.i + Math.cos(f.a) * ahead, f.j + Math.sin(f.a) * ahead)) {
      // Turn the way that is open, or around.
      const left = swimmable(map, f.i + Math.cos(f.a - 1) * ahead, f.j + Math.sin(f.a - 1) * ahead);
      f.a += left ? -3 * dt : 3 * dt;
      if (!swimmable(map, f.i + Math.cos(f.a) * 0.1, f.j + Math.sin(f.a) * 0.1)) continue;
    }
    f.i += Math.cos(f.a) * f.speed * dt;
    f.j += Math.sin(f.a) * f.speed * dt;
  }
}

/** A fish facing right on screen, two tail frames; 'a' body, 'b' tail. Mirrored to face left. */
const FRAMES = [
  ['b.aa.', '.aaaa', 'b.aa.'],
  ['..aa.', 'bbaaa', '..aa.'],
] as const;

/** The pixels of a fish relative to its middle, `right` when it heads right on screen. */
export function fishPixels(frame: number, right: boolean): { x: number; y: number; tail: boolean }[] {
  const rows = FRAMES[frame % FRAMES.length];
  const out: { x: number; y: number; tail: boolean }[] = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    out.push({ x: (right ? x : row.length - 1 - x) - 2, y: y - 1, tail: c === 'b' });
  }));
  return out;
}
