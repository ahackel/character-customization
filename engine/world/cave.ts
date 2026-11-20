// Caves: scenes of solid rock with rooms carved open (scene.ts `createCave`). What stands in them follows from the
// carved ground: rock walls on every edge of the floor the camera looks at (none on the front, so a room is seen
// into), with black caps over the rock behind, and rubble at the walls' feet. The world draws all else as nothing
// (`World.void`), dark but where lamps, glowing decorations and the daylight at the ways out light it.
import { PALETTE } from '../core/palette.ts';
import { edgeKey, emptyBuilding, type Building } from './building/building.ts';
import { rockWall } from './building/pieces/rock-wall.ts';
import type { Tint } from './daylight.ts';
import { decorById } from './decor.ts';
import type { Thing } from './island.ts';
import type { Scene } from './scene.ts';
import { inside, MIN_LEVEL, PAINTS, SEA_LEVEL, standingHeight, type HeightMap } from './terrain.ts';
import { rasterOf, type TileLamp, type World } from './world.ts';

/** The level of a cave's floor, and how tall its walls stand in levels. */
export const CAVE_FLOOR = SEA_LEVEL + 1;
export const CAVE_WALL = 5;
/** The daylight coming in at a way out: cool, and how far it reaches into the dark, in tiles. */
export const CAVE_DAY = '#c8d4e8';
const DAY_REACH = 2.6;
const CAVE_GROUND = PAINTS.indexOf('cave') + 1;
/** The rubble: the flora catalogue's cave rubble, in a cluster of up to three, big against the rock and smaller out. */
const RUBBLE_ROCK = 'plant-rocks-9';
const CLUSTER = [[0.22, 0.85], [0.5, 0.55], [0.8, 0.35]] as const;

const isOpen = (map: HeightMap, i: number, j: number) => inside(map, i, j) && map.levels[j * map.w + i] >= SEA_LEVEL;

/** Carves cells open to floor, or fills them back with rock. Says whether anything changed. */
export function carve(map: HeightMap & { paint: Uint8Array }, cells: number[], open: boolean): boolean {
  let changed = false;
  const levels = map.levels as Int8Array;
  for (const c of cells) {
    const level = open ? CAVE_FLOOR : MIN_LEVEL;
    if (levels[c] === level) continue;
    levels[c] = level;
    map.paint[c] = CAVE_GROUND;
    changed = true;
  }
  return changed;
}

/** A rock wall on every edge of the floor that faces the camera: where the cell behind it (toward -j or -i) is rock. */
export function caveWalls(map: HeightMap): Building {
  const walls = emptyBuilding(CAVE_WALL);
  const wall = (axis: 'H' | 'V', i: number, j: number) => walls.edges.set(edgeKey({ axis, i, j }), { kind: 'rock', edge: { axis, i, j } });
  for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) {
    if (!isOpen(map, i, j)) continue;
    if (!isOpen(map, i, j - 1)) wall('H', i, j);
    if (!isOpen(map, i - 1, j)) wall('V', i, j);
  }
  return walls;
}

/** A hash of integers to 0..1, so the rubble of an edge stays put while other edges are carved. */
function h01(a: number, b: number, c: number): number {
  let x = Math.imul(a | 0, 0x165667b1) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca77);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/** The rubble along the walls' feet, in view coordinates: on about `amount` of the wall edges, a cluster. */
// shortcut: seeded by view position, so it lies differently when the editor turns the view; seed by scene position if that bothers.
export function caveRubble(walls: Building, amount: number): { plant: string; i: number; j: number; seed: number; size: number; turn: number }[] {
  const out: ReturnType<typeof caveRubble> = [];
  for (const { edge } of walls.edges.values()) {
    const ax = edge.axis === 'H' ? 0 : 1;
    const r = (k: number) => h01(edge.i * 2 + ax, edge.j, k);
    if (r(0) >= amount) continue;
    const along = 0.15 + r(1) * 0.7;
    CLUSTER.forEach(([d, size], n) => {
      if (n && r(2 + n) < 0.3) return;
      const off = along + (r(5 + n) - 0.5) * 0.3;
      out.push({
        plant: RUBBLE_ROCK, i: edge.axis === 'H' ? edge.i + off : edge.i + d, j: edge.axis === 'H' ? edge.j + d : edge.j + off,
        seed: Math.floor(r(8 + n) * 4), size, turn: Math.floor(r(11 + n) * 8),
      });
    });
  }
  return out;
}

const derived = new WeakMap<World, { ground: unknown; rubble: Thing[] }>();

/**
 * Makes a world a cave: nothing beyond its rock, shadows deeper, and walls and rubble that follow its ground. Call
 * again after the ground changed (or the view turned), so they follow.
 */
export function setUpCave(world: World): void {
  const cave = world.scene.cave;
  world.void = true;
  world.trackSpots = true;
  world.shadowDepth = 2.4;
  if (!world.pieceKinds.rock) world.pieceKinds = { ...world.pieceKinds, rock: rockWall({ tones: PALETTE.cave, cap: 3 }) };
  const walls = caveWalls(world.map);
  world.buildings = [walls];
  const rubble = caveRubble(walls, cave?.rubble ?? 0).flatMap((p) => {
    const raster = rasterOf(p, 0);
    return raster ? [{ spot: { i: p.i, j: p.j, level: standingHeight(world.map, p.i, p.j) }, picture: raster, w: raster.w, h: raster.h, foot: raster.origin }] : [];
  });
  derived.set(world, { ground: world.ground, rubble });
}

/** The cave's own things: its walls and the rubble at their feet. Set up again first if the ground was redrawn. */
export function caveThings(world: World, at?: { i: number; j: number }): Thing[] {
  if (derived.get(world)?.ground !== world.ground) setUpCave(world);
  return [...world.buildingThings(at), ...derived.get(world)!.rubble];
}

/** How dark the cave is away from any light, as a tint for daylight.ts `lightByTile`. */
export function caveTint(scene: Scene): Tint {
  const tint = scene.cave?.tint ?? '#080e50';
  const [r, g, b] = [1, 3, 5].map((n) => parseInt(tint.slice(n, n + 2), 16));
  return { r, g, b, amount: scene.cave?.dark ?? 0.9 };
}

/** How much a flame's reach breathes at this moment, about 1: a few percent either way, never in a steady beat. */
export const flicker = (ms: number, phase = 0) => 1 + 0.04 * Math.sin(ms / 83 + phase) + 0.03 * Math.sin(ms / 31 + 1.7 + phase * 2.3);

/** The cave's own lights, in view coordinates: the daylight at its ways out, and its glowing decorations. */
export function caveLamps(world: World, ms: number): TileLamp[] {
  const exits = (world.scene.cave?.exits ?? []).map((e) => ({ ...world.toView(e), r: DAY_REACH, color: CAVE_DAY, amount: 0.8 }));
  const glows = world.viewDecor().flatMap((d) => {
    const glow = decorById(d.decor)?.glow;
    if (!glow) return [];
    const f = glow.flicker ? flicker(ms, d.vi * 3.1 + d.vj * 1.7) : 1;
    return [{ i: d.vi, j: d.vj, r: glow.r * f, color: glow.color, amount: Math.min(1, glow.amount * f) }];
  });
  return [...exits, ...glows];
}
