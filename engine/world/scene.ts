// A scene as it is saved: the ground (a height per tile and an optional painted surface), the
// plants and decorations placed on it and where the character starts. Scenes live in this browser's storage and
// can be written to and read from files. Everything read back is checked, since storage and
// files may hold anything.
import { newId } from '../../shared/files.ts';
import { TURNS } from '../flora/flora.ts';
import type { Facing } from '../core/puppet.ts';
import { plantById } from '../flora/flora-catalog.ts';
import { cleanAnimal, type Animal } from '../animals/animal.ts';
import { PRESETS } from '../animals/animal-presets.ts';
import { cleanState, type State } from '../character/character.ts';
import { decorById, type PlacedDecor } from './decor.ts';
import { itemById, type PlacedItem } from './props.ts';
import { createHeightMap, generateIsland, MAX_LEVEL, MIN_LEVEL, PAINTS, type HeightMap } from './terrain.ts';

export interface PlacedPlant {
  /** A flora catalogue id. */
  plant: string;
  /** Where its root stands, in metres from the north corner of the map. */
  i: number;
  j: number;
  /** Which variant of the recipe grows, 0 to 3. */
  seed: number;
  size: number;
  /** Which way it faces, in eighths of a turn, 0 to 7. */
  turn: number;
}

export interface PlacedAnimal {
  /** The name it had in the animal editor; the animal itself is copied in, so the scene keeps it. */
  name: string;
  animal: Animal;
  /** For an animal set down from a preset, its id: it then always takes the preset as it is now. */
  preset?: string;
  /** Where it stands, in metres from the north corner of the map. */
  i: number;
  j: number;
  /** Which way it faces on the map, as a character does. */
  facing: Facing;
}

/** A character from the wardrobe standing in the scene; like an animal, it is copied in. */
export interface PlacedPerson {
  name: string;
  state: State;
  /** Where it stands, in metres from the north corner of the map. */
  i: number;
  j: number;
  /** Which way it faces on the map, in quarter turns, 0 to 3. */
  turn: number;
}

export interface Scene {
  id: string;
  name: string;
  w: number;
  h: number;
  /** Level per tile, row by row. */
  levels: number[];
  /** Painted surface per tile: 0 follows the height, otherwise `PAINTS[n - 1]`. */
  paint: number[];
  plants: PlacedPlant[];
  /** Starfish, shells and the like, lying on the ground. */
  decor: PlacedDecor[];
  animals: PlacedAnimal[];
  people: PlacedPerson[];
  /** Crates and the like, standing on the ground, that can be carried in Play. */
  items: PlacedItem[];
  spawn: { i: number; j: number };
}

export const MIN_SIZE = 8;
export const MAX_SIZE = 64;
export const SEEDS = 4;
export { TURNS };
export const SIZE_RANGE = [0.6, 1.6] as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A new scene: a generated island, or open sea to build on. */
export function createScene(name: string, w: number, h: number, island: boolean, seed = Math.floor(Math.random() * 1000)): Scene {
  w = clamp(Math.round(w), MIN_SIZE, MAX_SIZE);
  h = clamp(Math.round(h), MIN_SIZE, MAX_SIZE);
  const map = island ? generateIsland(seed, w, h) : createHeightMap(w, h, -1);
  return { id: newId(), name, w, h, levels: Array.from(map.levels), paint: new Array(w * h).fill(0), plants: [], decor: [], animals: [], people: [], items: [], spawn: { i: w / 2, j: h / 2 } };
}

/** The scene's ground as the terrain code reads it. */
export const mapOf = (scene: Scene): HeightMap & { paint: Uint8Array } =>
  ({ w: scene.w, h: scene.h, levels: Int8Array.from(scene.levels), paint: Uint8Array.from(scene.paint) });

/** A scene with a new size, keeping what fits; new ground is sea. */
export function resized(scene: Scene, w: number, h: number): Scene {
  w = clamp(Math.round(w), MIN_SIZE, MAX_SIZE);
  h = clamp(Math.round(h), MIN_SIZE, MAX_SIZE);
  const levels = new Array(w * h).fill(MIN_LEVEL);
  const paint = new Array(w * h).fill(0);
  for (let j = 0; j < Math.min(h, scene.h); j++) for (let i = 0; i < Math.min(w, scene.w); i++) {
    levels[j * w + i] = scene.levels[j * scene.w + i];
    paint[j * w + i] = scene.paint[j * scene.w + i];
  }
  return {
    ...scene, w, h, levels, paint,
    plants: scene.plants.filter((p) => p.i < w && p.j < h),
    decor: scene.decor.filter((d) => d.i < w && d.j < h),
    animals: scene.animals.filter((a) => a.i < w && a.j < h),
    items: scene.items.filter((it) => it.i < w && it.j < h),
    spawn: { i: Math.min(scene.spawn.i, w - 0.5), j: Math.min(scene.spawn.j, h - 0.5) },
  };
}

/** Checks a scene read from storage or a file. Throws with a short reason when it cannot be used. */
export function cleanScene(input: unknown): Scene {
  const s = input as Partial<Scene> | null;
  if (!s || typeof s !== 'object') throw new Error('not a scene');
  const w = Number(s.w);
  const h = Number(s.h);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < MIN_SIZE || h < MIN_SIZE || w > MAX_SIZE || h > MAX_SIZE) throw new Error('bad size');
  if (!Array.isArray(s.levels) || s.levels.length !== w * h) throw new Error('bad ground');
  const levels = s.levels.map((n) => clamp(Math.round(Number(n)) || 0, MIN_LEVEL, MAX_LEVEL));
  const paint = Array.isArray(s.paint) && s.paint.length === w * h
    ? s.paint.map((n) => (Number.isInteger(n) && n >= 0 && n <= PAINTS.length ? n : 0))
    : new Array(w * h).fill(0);
  const num = (n: unknown, lo: number, hi: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : fallback);
  const plants = (Array.isArray(s.plants) ? s.plants : [])
    .filter((p): p is PlacedPlant => !!p && typeof p === 'object' && !!plantById(p.plant))
    .map((p) => ({
      plant: p.plant,
      i: num(p.i, 0, w, w / 2),
      j: num(p.j, 0, h, h / 2),
      seed: Math.round(num(p.seed, 0, SEEDS - 1, 0)),
      size: num(p.size, SIZE_RANGE[0], SIZE_RANGE[1], 1),
      turn: Math.round(num(p.turn, 0, TURNS - 1, 0)),
    }));
  const decor = (Array.isArray(s.decor) ? s.decor : [])
    .filter((d): d is PlacedDecor => !!d && typeof d === 'object' && !!decorById(d.decor))
    .map((d) => ({ decor: d.decor, i: num(d.i, 0, w, w / 2), j: num(d.j, 0, h, h / 2) }));
  const animals = (Array.isArray(s.animals) ? s.animals : [])
    .filter((a): a is PlacedAnimal => !!a && typeof a === 'object')
    .map((a) => {
      const animal = cleanAnimal(a.animal);
      const name = typeof a.name === 'string' ? a.name.slice(0, 40) : '';
      // Scenes from before presets were linked: a preset's name and colours mark one of its animals.
      const preset = PRESETS.find((p) => (typeof a.preset === 'string' ? p.id === a.preset
        : p.name === name && JSON.stringify(p.animal.colors) === JSON.stringify(animal.colors)));
      return {
        name,
        animal: preset ? structuredClone(preset.animal) : animal,
        ...(preset && { preset: preset.id }),
        i: num(a.i, 0, w, w / 2),
        j: num(a.j, 0, h, h / 2),
        facing: Math.round(num(a.facing, 0, 7, 0)) as Facing,
      };
    });
  const people = (Array.isArray(s.people) ? s.people : [])
    .filter((p): p is PlacedPerson => !!p && typeof p === 'object')
    .map((p) => ({
      name: typeof p.name === 'string' ? p.name.slice(0, 40) : '',
      state: cleanState(p.state),
      i: num(p.i, 0, w, w / 2),
      j: num(p.j, 0, h, h / 2),
      turn: Math.round(num(p.turn, 0, 3, 0)),
    }));
  const items = (Array.isArray(s.items) ? s.items : [])
    .filter((it): it is PlacedItem => !!it && typeof it === 'object' && !!itemById(it.item))
    .map((it) => ({ item: it.item, i: num(it.i, 0, w, w / 2), j: num(it.j, 0, h, h / 2) }));
  return {
    id: typeof s.id === 'string' && s.id ? s.id : newId(),
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 40) : 'Island',
    w, h, levels, paint, plants, decor, animals, people, items,
    spawn: { i: num(s.spawn?.i, 0, w, w / 2), j: num(s.spawn?.j, 0, h, h / 2) },
  };
}

// ------------------------------------------------------------------ storage

const STORAGE_KEY = 'pixel-scenes';

export interface Library { current: string; scenes: Scene[] }

/** The scenes saved here; the first visit gets one island to start with. Broken scenes are skipped. */
export function loadLibrary(firstName: string): Library {
  let scenes: Scene[] = [];
  let current = '';
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && Array.isArray(saved.scenes)) {
      for (const s of saved.scenes) {
        try {
          scenes.push(cleanScene(s));
        } catch {
          // One unreadable scene does not take the others with it.
        }
      }
      current = typeof saved.current === 'string' ? saved.current : '';
    }
  } catch {
    // Without storage the page starts with a fresh island.
  }
  if (!scenes.length) scenes = [createScene(firstName, 28, 28, true, 7)];
  if (!scenes.some((s) => s.id === current)) current = scenes[0].id;
  return { current, scenes };
}

/** False when the browser refuses, so the page can warn that changes are not kept. */
export function saveLibrary(library: Library): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

const FILE_TYPE = 'pixel-scene';
export const sceneFile = (scene: Scene) => JSON.stringify({ type: FILE_TYPE, version: 1, scene });

export function readSceneFile(text: string): Scene {
  const data = JSON.parse(text);
  if (data?.type !== FILE_TYPE) throw new Error('not a scene file');
  return { ...cleanScene(data.scene), id: newId() };
}
