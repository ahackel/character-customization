import '../wardrobe/style.css';
import './style.css';
import { defaultState, download, loadRoster, lookOf, pickFile, type Saved } from '../lab/character.ts';
import { FRAMES } from '../lab/flora.ts';
import { FLORA, plantById } from '../lab/flora-catalog.ts';
import { castShadow, layShadow, ROOM, stamp, type Picture } from '../lab/island.ts';
import { inside, levelAt, MAX_LEVEL, MIN_LEVEL, PAINTS, SEA_LEVEL, setLevel, surfaceAt } from '../lab/terrain.ts';
import { Actor, EMOTES, type Emote } from '../engine/actor.ts';
import { Herd } from '../engine/herd.ts';
import {
  createScene, loadLibrary, MAX_SIZE, MIN_SIZE, readSceneFile, resized, saveLibrary, sceneFile, SEEDS, TURNS, type PlacedPlant, type Scene,
} from '../engine/scene.ts';
import { grows, rasterOf, smooth, WADE, World, type Rect, type Thing } from '../engine/world.ts';
import { DECOR, decorById, decorPixels } from '../engine/decor.ts';
import { CLIPS, drawAnimal, isShadow, savedAnimals, type Animal } from '../lab/animal.ts';
import type { Facing } from '../lab/puppet.ts';
import { PRESETS } from '../lab/animal-presets.ts';
import { ocean } from '../engine/ocean.ts';
import { plantName } from '../flora/i18n.ts';
import { roundBrush } from '../shared/brush.ts';
import { button as tap, h, icon, segmented, topBar, word, type IconName } from '../shared/shell.ts';
import { currentLang } from '../shared/lang.ts';
import { t, type Key } from './i18n.ts';

// The scene editor: build a scene's ground and plants in Edit, walk around it with a saved
// character in Play. Scenes, and the editor's own settings, are kept in this browser.

// ------------------------------------------------------------------ settings

const TOOLS = ['raise', 'lower', 'smooth', 'level', 'paint', 'plant', 'decor', 'animal', 'erase', 'spawn'] as const;
type Tool = (typeof TOOLS)[number];
const BRUSHED: Tool[] = ['raise', 'lower', 'smooth', 'level', 'paint', 'erase'];
const ZOOM = { min: 1, max: 8 };
const BRUSH_MAX = 7;
const TOOL_ICONS: Record<Tool, IconName> = {
  raise: 'raise', lower: 'lower', smooth: 'smooth', level: 'level', paint: 'brush', plant: 'palm', decor: 'shell', animal: 'paw', erase: 'eraser', spawn: 'flag',
};

interface Prefs {
  mode: 'edit' | 'play';
  tool: Tool;
  /** 0 by height, otherwise `PAINTS[n - 1]`. */
  paint: number;
  /** Brush size in tiles across, 1 to 7; the brush is round. */
  brush: number;
  plant: string;
  /** A `DECOR` id: what the Decor tool lays down. */
  decor: string;
  /** What the Animal tool sets down: a saved animal's id, or `preset:` and a preset id. */
  animal: string;
  /** A saved character id, or '' for the default one. */
  character: string;
  /** Which side the scene is seen from: quarter turns, 0 to 3. */
  rot: number;
  /** Tile lines on the ground while editing. */
  grid: boolean;
}
const PREFS_KEY = 'pixel-scenes-ui';
function loadPrefs(): Prefs {
  const prefs: Prefs = { mode: 'edit', tool: 'raise', paint: 2, brush: 1, plant: FLORA.find((e) => e.category === 'palm')?.id ?? FLORA[0].id, decor: DECOR[0].id, animal: `preset:${PRESETS[0].id}`, character: '', rot: 0, grid: false };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (saved?.mode === 'edit' || saved?.mode === 'play') prefs.mode = saved.mode;
    if (TOOLS.includes(saved?.tool)) prefs.tool = saved.tool;
    if (Number.isInteger(saved?.paint) && saved.paint >= 0 && saved.paint <= PAINTS.length) prefs.paint = saved.paint;
    if (Number.isInteger(saved?.brush) && saved.brush >= 1 && saved.brush <= BRUSH_MAX) prefs.brush = saved.brush;
    if (plantById(saved?.plant)) prefs.plant = saved.plant;
    if (decorById(saved?.decor)) prefs.decor = saved.decor;
    if (typeof saved?.animal === 'string') prefs.animal = saved.animal;
    if (typeof saved?.character === 'string') prefs.character = saved.character;
    if ([0, 1, 2, 3].includes(saved?.rot)) prefs.rot = saved.rot;
    prefs.grid = saved?.grid === true;
  } catch {
    // Settings are a convenience; without storage the defaults apply.
  }
  return prefs;
}
const prefs = loadPrefs();
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore: they then last for this visit.
  }
}

// ------------------------------------------------------------------ scenes

const library = loadLibrary(t('scene.first'));
const sceneNow = () => library.scenes.find((s) => s.id === library.current)!;
let world = new World(sceneNow(), prefs.rot);
let groundDirty = false;
let version = 0;

let saveTimer = 0;
function store(): void {
  clearTimeout(saveTimer);
  saveTimer = 0;
  // The ground is copied to the scene when it is redrawn, which may not have happened yet.
  world.commit();
  if (!saveLibrary(library)) say(t('scene.saveFailed'));
}
/** After any change to the scene: saved shortly after, so a drag is one write. */
function sceneChanged(): void {
  version++;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(store, 400);
}
// Nothing made in the last moment before closing is lost.
window.addEventListener('pagehide', () => saveTimer && store());

function switchTo(scene: Scene): void {
  if (saveTimer) store();
  if (!library.scenes.includes(scene)) library.scenes.push(scene);
  library.current = scene.id;
  world = new World(scene, prefs.rot);
  store();
  centerOn(world.toView(scene.spawn));
  if (prefs.mode === 'play') startPlay();
  version++;
  render();
}

// ------------------------------------------------------------------ page helpers

const statusLine = h('p', { class: 'status', 'aria-live': 'polite' });
let statusTimer = 0;
function say(text: string): void {
  statusLine.textContent = text;
  statusLine.hidden = !text;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (statusLine.hidden = true), 5000);
}

// ------------------------------------------------------------------ view

const viewport = h('div', { class: 'viewport' });
const canvas = h('canvas', { class: 'viewport__canvas' });
canvas.setAttribute('role', 'img');
const ctx = canvas.getContext('2d')!;
let zoom = 3;
const cam = { x: 0, y: 0 };
let vw = 1;
let vh = 1;

function fitCanvas(): void {
  const box = viewport.getBoundingClientRect();
  vw = Math.max(1, Math.ceil(box.width / zoom));
  vh = Math.max(1, Math.ceil(box.height / zoom));
  canvas.width = vw;
  canvas.height = vh;
  canvas.style.width = `${vw * zoom}px`;
  canvas.style.height = `${vh * zoom}px`;
  version++;
}
function setZoom(next: number): void {
  zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, Math.round(next)));
  fitCanvas();
}
const viewRect = (): Rect => ({ x: Math.round(cam.x - vw / 2), y: Math.round(cam.y - vh / 2), w: vw, h: vh });
function centerOn(at: { i: number; j: number }): void {
  const p = world.screenOf(at.i, at.j);
  cam.x = p.x;
  cam.y = p.y - 16;
}

/** The pixel of the ground image under a pointer. */
function groundPixel(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  const view = viewRect();
  return { x: (e.clientX - box.left) / zoom + view.x, y: (e.clientY - box.top) / zoom + view.y };
}
const tileUnder = (e: { clientX: number; clientY: number }) => {
  const p = groundPixel(e);
  return world.tileAt(p.x, p.y);
};

/** The start point, shown while editing: a small flag. */
const FLAG: Picture = {
  get: (x, y) => (x === 0 && y < 12 ? '#3a2a2a' : x >= 1 && x <= 5 && y < 4 ? '#e0533d' : null),
  shaded: (x, y) => y === 12 && x < 3,
};

// ------------------------------------------------------------------ editing

let hover: { i: number; j: number } | null = null;

function brushCells(at: { i: number; j: number }, tool = prefs.tool): number[] {
  const size = BRUSHED.includes(tool) ? prefs.brush : 1;
  return roundBrush(size).filter(([di, dj]) => inside(world.map, at.i + di, at.j + dj)).map(([di, dj]) => (at.j + dj) * world.map.w + at.i + di);
}

/** Whether the tool would do nothing on a tile, so the brush shows red there. */
function cannotEdit(at: { i: number; j: number }): boolean {
  switch (prefs.tool) {
    case 'plant':
      return !grows(world.map, prefs.plant, at.i + 0.5, at.j + 0.5);
    case 'spawn':
    case 'animal':
      return levelAt(world.map, at.i, at.j) < SEA_LEVEL;
    case 'decor':
      return levelAt(world.floor, at.i, at.j) < DECOR_DEPTH;
    case 'raise':
      return brushCells(at).every((c) => world.map.levels[c] >= MAX_LEVEL);
    case 'lower':
      return brushCells(at).every((c) => world.map.levels[c] <= MIN_LEVEL);
    default:
      return false;
  }
}

/** The ground-image pixel under the pointer when the tool last worked, for picking plants by their picture. */
let pointerPixel: { x: number; y: number } | null = null;

function placePlant(at: { i: number; j: number }, placed: Set<PlacedPlant>): void {
  const entry = plantById(prefs.plant)!;
  // Over a plant's picture, the new plant takes its place; otherwise it goes somewhere in the tile.
  const under = pointerPixel ? world.plantAt(pointerPixel.x, pointerPixel.y) : null;
  const spot = under && !placed.has(under) ? world.toView(under) : null;
  const i = spot ? spot.i : at.i + 0.2 + Math.random() * 0.6;
  const j = spot ? spot.j : at.j + 0.2 + Math.random() * 0.6;
  if (!grows(world.map, entry.id, i, j)) {
    say(t('plant.cannot', { plant: plantName(entry.id, entry.label), ground: t(`surface.${surfaceAt(world.map, Math.floor(i), Math.floor(j))}` as Key) }));
    return;
  }
  // Planting where plants already stand replaces them, except ones set down earlier in the same drag.
  const seen = world.viewPlants();
  const near = new Set(world.scene.plants.filter((p, k) => p === under || Math.hypot(seen[k].vi - i, seen[k].vj - j) < (ROOM[plantById(seen[k].plant)!.category] + ROOM[entry.category]) * 0.45));
  if ([...near].some((p) => placed.has(p))) return;
  world.scene.plants = world.scene.plants.filter((p) => !near.has(p));
  const plant = { plant: entry.id, ...world.toData({ i, j }), seed: Math.floor(Math.random() * SEEDS), size: 0.85 + Math.random() * 0.3, turn: Math.floor(Math.random() * TURNS) };
  world.scene.plants.push(plant);
  placed.add(plant);
}

/** Decorations lie on land and on the sea floor down to this level, where the water still shows them. */
const DECOR_DEPTH = WADE - 1;

function placeDecor(at: { i: number; j: number }): void {
  if (levelAt(world.floor, at.i, at.j) < DECOR_DEPTH) return;
  const i = at.i + 0.15 + Math.random() * 0.7;
  const j = at.j + 0.15 + Math.random() * 0.7;
  if (world.viewDecor().some((d) => Math.hypot(d.vi - i, d.vj - j) < 0.2)) return;
  world.scene.decor.push({ decor: prefs.decor, ...world.toData({ i, j }) });
}

/** The animals made in the animal editor, then its presets; read again each time the picker shows, since that editor may be open in another tab. */
function animalChoices(): { id: string; name: string; animal: Animal }[] {
  return [...savedAnimals(), ...PRESETS.map((p) => ({ ...p, id: `preset:${p.id}` }))];
}

function placeAnimal(at: { i: number; j: number }): void {
  if (levelAt(world.map, at.i, at.j) < SEA_LEVEL) return say(t('animal.cannot'));
  const choices = animalChoices();
  const choice = choices.find((c) => c.id === prefs.animal) ?? choices[0];
  const i = at.i + 0.5;
  const j = at.j + 0.5;
  // An animal set down on another's tile takes its place.
  const seen = world.viewAnimals();
  world.scene.animals = world.scene.animals.filter((_, k) => Math.floor(seen[k].vi) !== at.i || Math.floor(seen[k].vj) !== at.j);
  world.scene.animals.push({ name: choice.name, animal: structuredClone(choice.animal), ...world.toData({ i, j }), facing: Math.floor(Math.random() * 8) as Facing });
}

/**
 * Applies the tool once to a tile. `stroke.touched` keeps a drag from raising, lowering or
 * painting a tile twice; smoothing works again on every tile the drag enters, and levelling
 * keeps to the height of the tile the drag started on.
 */
function apply(at: { i: number; j: number }, stroke: { touched: Set<number>; level?: number; placed?: Set<PlacedPlant> }): void {
  const map = world.map;
  const fresh = brushCells(at).filter((c) => !stroke.touched.has(c));
  fresh.forEach((c) => stroke.touched.add(c));
  const tile = (c: number): [number, number] => [c % map.w, Math.floor(c / map.w)];
  switch (prefs.tool) {
    case 'smooth':
      smooth(map, brushCells(at));
      groundDirty = true;
      break;
    case 'level':
      stroke.level ??= levelAt(map, at.i, at.j);
      for (const c of brushCells(at)) setLevel(map, ...tile(c), stroke.level);
      groundDirty = true;
      break;
    case 'raise':
    case 'lower':
      for (const c of fresh) setLevel(map, c % map.w, Math.floor(c / map.w), map.levels[c] + (prefs.tool === 'raise' ? 1 : -1));
      groundDirty ||= fresh.length > 0;
      break;
    case 'paint':
      for (const c of fresh) map.paint[c] = prefs.paint;
      groundDirty ||= fresh.length > 0;
      break;
    case 'plant':
      if (fresh.length) placePlant(at, (stroke.placed ??= new Set()));
      break;
    case 'decor':
      if (fresh.length) placeDecor(at);
      break;
    case 'animal':
      if (fresh.length) placeAnimal(at);
      break;
    case 'erase': {
      const cells = new Set(brushCells(at));
      const kept = <T>(list: T[], seen: { vi: number; vj: number }[]) => list.filter((_, k) => !cells.has(Math.floor(seen[k].vj) * map.w + Math.floor(seen[k].vi)));
      world.scene.plants = kept(world.scene.plants, world.viewPlants());
      world.scene.decor = kept(world.scene.decor, world.viewDecor());
      world.scene.animals = kept(world.scene.animals, world.viewAnimals());
      break;
    }
    case 'spawn':
      world.scene.spawn = world.toData({ i: at.i + 0.5, j: at.j + 0.5 });
      break;
  }
  sceneChanged();
}

// ------------------------------------------------------------------ playing

let roster: Saved[] = [];
let actor: Actor | null = null;
let herd: Herd | null = null;
let target: { i: number; j: number; run: boolean } | null = null;

function characterLook() {
  const saved = roster.find((c) => c.id === prefs.character);
  return lookOf(saved?.state ?? defaultState());
}
function startPlay(): void {
  roster = loadRoster();
  if (prefs.character && !roster.some((c) => c.id === prefs.character)) prefs.character = '';
  let at = world.toView(world.scene.spawn);
  if (!inside(world.map, Math.floor(at.i), Math.floor(at.j)) || levelAt(world.map, Math.floor(at.i), Math.floor(at.j)) < SEA_LEVEL) {
    at = world.nearestLand(at.i, at.j);
  }
  actor = new Actor(characterLook(), at);
  herd = new Herd(world, performance.now());
  target = null;
  // The camera stays where it is, unless the character would start out of sight.
  const p = world.screenOf(at.i, at.j);
  const view = viewRect();
  if (p.x < view.x || p.y < view.y || p.x > view.x + view.w || p.y > view.y + view.h) centerOn(at);
}

/** Turns the view a quarter, keeping in the middle what was there (or the character). */
function rotate(step: number): void {
  const middle = world.tileAt(cam.x, cam.y + 16);
  const focus = world.toData(actor ?? (middle ? { i: middle.i + 0.5, j: middle.j + 0.5 } : { i: world.map.w / 2, j: world.map.h / 2 }));
  prefs.rot = (prefs.rot + step + 4) % 4;
  savePrefs();
  world.setRotation(prefs.rot);
  const v = world.toView(focus);
  if (actor) {
    actor.i = v.i;
    actor.j = v.j;
    target = null;
  }
  hover = null;
  centerOn(v);
  version++;
}
function walkTo(e: PointerEvent): void {
  const tile = tileUnder(e);
  if (!tile || !actor) return;
  const d = Math.hypot(tile.i + 0.5 - actor.i, tile.j + 0.5 - actor.j);
  target = { i: tile.i + 0.5, j: tile.j + 0.5, run: target?.run ?? d > 4 };
}
function emote(e: Emote): void {
  target = null;
  actor?.emote(e, performance.now());
}

// ------------------------------------------------------------------ input

const keys = new Set<string>();
const typing = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || !!document.querySelector('dialog[open]');
window.addEventListener('keydown', (e) => {
  if (typing(e) || e.metaKey || e.ctrlKey) return;
  if (prefs.mode === 'play' && e.code === 'KeyE') emote('wave');
  if (prefs.mode === 'play' && e.code === 'KeyF') emote('use');
  if (e.code === 'KeyQ') rotate(-1);
  if (e.code === 'KeyR') rotate(1);
  if (/^(Arrow|Key[WASD]$|Shift|Space)/.test(e.code)) {
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

/** The direction held on the keyboard, on screen: x to the right, y down. */
function keyDirection(): [number, number] {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const y = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  return [x, y];
}

type Gesture =
  | { kind: 'stroke'; touched: Set<number>; last: string; level?: number; placed?: Set<PlacedPlant>; tile?: { i: number; j: number }; at: number }
  | { kind: 'walk' }
  | { kind: 'pan'; x: number; y: number; cam: { x: number; y: number } }
  | { kind: 'pinch'; dist: number; zoom: number; mid: { x: number; y: number }; cam: { x: number; y: number } };
let gesture: Gesture | null = null;
const pointers = new Map<number, { x: number; y: number }>();
const pair = () => {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
};

/** Ground tools that keep working while the pointer is held still, and how often they repeat. */
const HELD: Tool[] = ['raise', 'lower', 'smooth', 'level'];
const REPEAT_MS = 200;

function strokeAt(e: { clientX: number; clientY: number }): void {
  if (gesture?.kind !== 'stroke') return;
  const tile = tileUnder(e);
  if (!tile) return;
  const key = `${tile.i},${tile.j}`;
  if (key === gesture.last) return;
  gesture.last = key;
  gesture.tile = tile;
  gesture.at = performance.now();
  pointerPixel = groundPixel(e);
  apply(tile, gesture);
}

/**
 * While held, the tool works again on the tile it last worked on. That tile is kept rather than
 * picked again: as the ground rises, another tile can come to lie under the same pixel.
 */
function repeatStroke(ms: number): void {
  if (gesture?.kind !== 'stroke' || !gesture.tile || !HELD.includes(prefs.tool) || ms - gesture.at < REPEAT_MS) return;
  gesture.touched.clear();
  gesture.at = ms;
  apply(gesture.tile, gesture);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const { dist, mid } = pair();
    gesture = { kind: 'pinch', dist, zoom, mid, cam: { ...cam } };
  } else if (pointers.size === 1) {
    if (e.button === 1 || e.button === 2 || keys.has('Space')) gesture = { kind: 'pan', x: e.clientX, y: e.clientY, cam: { ...cam } };
    else if (prefs.mode === 'edit') {
      gesture = { kind: 'stroke', touched: new Set(), last: '', at: 0 };
      strokeAt(e);
    } else {
      gesture = { kind: 'walk' };
      target = null;
      walkTo(e);
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture?.kind === 'pinch' && pointers.size === 2) {
    const { dist, mid } = pair();
    setZoom(gesture.zoom * (dist / gesture.dist));
    cam.x = gesture.cam.x - (mid.x - gesture.mid.x) / zoom;
    cam.y = gesture.cam.y - (mid.y - gesture.mid.y) / zoom;
  } else if (gesture?.kind === 'pan') {
    cam.x = gesture.cam.x - (e.clientX - gesture.x) / zoom;
    cam.y = gesture.cam.y - (e.clientY - gesture.y) / zoom;
  } else if (gesture?.kind === 'stroke') strokeAt(e);
  else if (gesture?.kind === 'walk') walkTo(e);
  if (prefs.mode === 'edit' && e.pointerType === 'mouse') hover = tileUnder(e);
});
const release = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  // Lifting one finger of a pinch does not start painting with the other.
  if (!pointers.size || gesture?.kind === 'pinch') gesture = pointers.size ? { kind: 'pan', x: [...pointers.values()][0].x, y: [...pointers.values()][0].y, cam: { ...cam } } : null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => (hover = null));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// A trackpad sends a two-finger move as scrolling, which pans, and a pinch as scrolling with Ctrl
// held, which zooms. A pinch sends many small steps, so they add up to whole zoom steps.
let pinched = 0;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  if (e.ctrlKey) {
    pinched -= e.deltaY * scale * 0.02;
    if (Math.abs(pinched) >= 1) {
      setZoom(zoom + Math.trunc(pinched));
      pinched = 0;
    }
    return;
  }
  cam.x += (e.deltaX * scale) / zoom;
  cam.y += (e.deltaY * scale) / zoom;
}, { passive: false });

// ------------------------------------------------------------------ the loop

let last = performance.now();
let shown = '';
let shownThings: Thing[] = [];
function frame(ms: number): void {
  const dt = Math.min(0.1, (ms - last) / 1000);
  last = ms;
  repeatStroke(ms);
  if (groundDirty) {
    // shortcut: redraws the whole ground per changed tile; fine up to 64 by 64, draw only the changed rows if it ever lags.
    world.redraw();
    groundDirty = false;
  }
  const [kx, ky] = keyDirection();
  if (prefs.mode === 'play' && actor) {
    let di = kx + ky;
    let dj = ky - kx;
    let run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (di || dj) target = null;
    else if (target) {
      di = target.i - actor.i;
      dj = target.j - actor.j;
      run = target.run;
      if (Math.hypot(di, dj) < 0.08) {
        target = null;
        di = dj = 0;
      }
    }
    const before = [actor.i, actor.j];
    actor.update(world, dt, di, dj, run, ms);
    herd?.update(world, dt, ms);
    // A target that cannot be reached is given up rather than walked against forever.
    if (target && before[0] === actor.i && before[1] === actor.j) target = null;
  } else if (kx || ky) {
    cam.x += (kx * 360 * dt) / zoom;
    cam.y += (ky * 360 * dt) / zoom;
  }

  const view = viewRect();
  const wind = Math.floor((ms / 1000) * 6) % FRAMES;
  const waves = Math.floor(ms / 100);
  const idle = Math.floor((ms / 1000) * CLIPS.idle.rate);
  const key = `${version}|${view.x},${view.y},${vw},${vh}|${wind}|${waves}|${idle}|${hover?.i},${hover?.j}|${prefs.mode}`;
  if (prefs.mode === 'play' || key !== shown) {
    const things: Thing[] = [...world.plantThings(wind), ...world.animalThings(ms, herd ?? undefined)];
    if (prefs.mode === 'play' && actor) things.push(actor.thing(world, ms), ...actor.dropThings());
    else {
      const s = world.toView(world.scene.spawn);
      things.push({ spot: { i: s.i, j: s.j, level: Math.max(SEA_LEVEL, levelAt(world.map, Math.floor(s.i), Math.floor(s.j))) }, picture: FLAG, w: 6, h: 13, foot: { x: 0, y: 12 } });
    }
    // In Play the key alone does not say whether anyone moved: the picture is the same while every thing shows the same frame in the same place.
    const still = key === shown && things.length === shownThings.length
      && things.every((t, k) => t.picture === shownThings[k].picture && t.spot.i === shownThings[k].spot.i && t.spot.j === shownThings[k].spot.j && t.spot.level === shownThings[k].spot.level);
    if (still) return void requestAnimationFrame(frame);
    shown = key;
    shownThings = things;
    const blocked = prefs.mode === 'edit' && !!hover && cannotEdit(hover);
    const highlight = prefs.mode === 'edit' && hover ? { cells: new Set(brushCells(hover)), color: blocked ? '#e0332e99' : '#ffffff66' } : undefined;
    canvas.style.cursor = blocked ? 'not-allowed' : prefs.mode === 'edit' ? 'crosshair' : 'pointer';
    const image = world.compose(view, things, highlight, prefs.mode === 'edit', waves * 100, prefs.mode === 'edit' && prefs.grid);
    ctx.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ panels

const thumbs = new Map<string, HTMLCanvasElement>();
/** A small picture of a plant, cropped to what it paints. */
function thumb(id: string): HTMLCanvasElement {
  const known = thumbs.get(id);
  if (known) return known;
  const raster = rasterOf({ plant: id, seed: 0, size: 1 }, 0)!;
  let x0 = raster.w, y0 = raster.h, x1 = 0, y1 = 0;
  for (let y = 0; y < raster.h; y++) for (let x = 0; x < raster.w; x++) {
    if (!raster.get(x, y) && !raster.shaded(x, y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const w = Math.max(1, x1 - x0 + 1);
  const hh = Math.max(1, y1 - y0 + 1);
  const c = h('canvas', { class: 'plant__picture', width: String(w), height: String(hh) });
  const g = c.getContext('2d')!;
  const image = g.createImageData(w, hh);
  const mask = new Uint8Array(w * hh);
  castShadow(mask, w, hh, raster, raster.w, raster.h, -x0, -y0);
  layShadow(image, mask);
  stamp(image, raster, raster.w, raster.h, -x0, -y0);
  g.putImageData(image, 0, 0);
  const scale = Math.min(2, 44 / Math.max(w, hh));
  c.style.width = `${Math.round(w * scale)}px`;
  c.style.height = `${Math.round(hh * scale)}px`;
  thumbs.set(id, c);
  return c;
}

const animalThumbs = new Map<string, HTMLCanvasElement>();
/** An animal standing, cropped to what it paints. */
function animalThumb(animal: Animal): HTMLCanvasElement {
  const id = JSON.stringify(animal);
  const known = animalThumbs.get(id);
  if (known) return known;
  const { sprite } = drawAnimal(animal, 'idle', 0, 0);
  let x0 = sprite.w, y0 = sprite.h, x1 = 0, y1 = 0;
  for (let y = 0; y < sprite.h; y++) for (let x = 0; x < sprite.w; x++) {
    const c = sprite.get(x, y);
    if (!c || isShadow(c)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const w = Math.max(1, x1 - x0 + 1);
  const hh = Math.max(1, y1 - y0 + 1);
  const c = h('canvas', { class: 'plant__picture', width: String(w), height: String(hh) });
  const g = c.getContext('2d')!;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const color = sprite.get(x, y);
    if (!color || isShadow(color)) continue;
    g.fillStyle = color;
    g.fillRect(x - x0, y - y0, 1, 1);
  }
  const scale = Math.min(2, 44 / Math.max(w, hh));
  c.style.width = `${Math.round(w * scale)}px`;
  c.style.height = `${Math.round(hh * scale)}px`;
  animalThumbs.set(id, c);
  return c;
}

/** A decoration drawn four times its size on sand, for the picker. */
function decorThumb(id: string): HTMLCanvasElement {
  const pixels = decorPixels(decorById(id)!);
  const c = h('canvas', { class: 'plant__picture', width: '11', height: '9' });
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6e4b4';
  g.fillRect(0, 0, 11, 9);
  for (const p of pixels) {
    g.fillStyle = p.color;
    g.fillRect(p.x + 5, p.y + 4, 1, 1);
  }
  c.style.width = '44px';
  c.style.height = '36px';
  return c;
}

const sceneSelect = h('select', { class: 'select bar__things' });
const barSlot = h('div', { style: 'display: contents' });
const gridButton = tap({ class: 'stage__button', 'aria-pressed': 'false' }, () => set({ grid: !prefs.grid }), icon('grid'));
const dock = h('nav', { class: 'toolbar' });
const options = h('section', { class: 'opts' });

/** Pictures to pick from: plants, decorations or animals. */
function picks<T extends { id: string; name: string; picture: HTMLElement }>(label: string, list: T[], current: string, choose: (id: string) => void): HTMLElement {
  return h('div', { class: 'plants', role: 'group', 'aria-label': label }, ...list.map((c) => {
    const b = h('button', { type: 'button', class: 'plant', 'aria-pressed': String(c.id === current), title: c.name, 'aria-label': c.name }, c.picture);
    b.addEventListener('click', () => choose(c.id));
    return b;
  }));
}

/** The round brush as a little picture of the tiles it covers. */
function brushPicture(size: number): HTMLElement {
  const on = new Set(roundBrush(size).map(([di, dj]) => `${di},${dj}`));
  const cells: HTMLElement[] = [];
  for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) cells.push(h('span', { class: on.has(`${di},${dj}`) ? 'brush__cell brush__cell--on' : 'brush__cell' }));
  return h('span', { class: 'brush', 'aria-hidden': 'true' }, ...cells);
}

/** The floating options of the chosen tool, over the scene. */
function editOptions(): Node[] {
  const tool = prefs.tool;
  const out: Node[] = [
    h('div', { class: 'opts__head' }, icon(TOOL_ICONS[tool]), h('b', {}, t(`tool.${tool}` as Key))),
    h('p', { class: 'opts__tip' }, t(`tip.${tool}` as Key)),
  ];
  if (tool === 'paint') {
    out.push(segmented(t('paint'), [0, 1, 2, 3].map((n) => ({ id: String(n), label: t(`paint.${n}` as Key) })), String(prefs.paint), (n) => set({ paint: Number(n) })));
  }
  if (BRUSHED.includes(tool)) {
    const slider = h('input', { type: 'range', class: 'slider', min: '1', max: String(BRUSH_MAX), step: '1', value: String(prefs.brush), 'aria-label': t('brush') });
    const size = h('b', {}, `Ø ${prefs.brush}`);
    const picture = h('span', {}, brushPicture(prefs.brush));
    // While dragging only the label and picture follow; the brush is stored on release.
    slider.addEventListener('input', () => {
      size.textContent = `Ø ${slider.value}`;
      picture.replaceChildren(brushPicture(Number(slider.value)));
      prefs.brush = Number(slider.value);
    });
    slider.addEventListener('change', () => set({ brush: Number(slider.value) }));
    out.push(h('div', { class: 'opts__brush' }, h('span', { class: 'opts__label' }, t('brush'), size), slider, picture));
  }
  if (tool === 'plant') out.push(picks(t('plants'), FLORA.map((e) => ({ id: e.id, name: plantName(e.id, e.label), picture: thumb(e.id) })), prefs.plant, (plant) => set({ plant })));
  if (tool === 'decor') out.push(picks(t('decor'), DECOR.map((d) => ({ id: d.id, name: t(`decor.${d.id}` as Key), picture: decorThumb(d.id) })), prefs.decor, (decor) => set({ decor })));
  if (tool === 'animal') {
    const choices = animalChoices();
    const current = choices.some((c) => c.id === prefs.animal) ? prefs.animal : choices[0].id;
    out.push(picks(t('animals'), choices.map((c) => ({ id: c.id, name: c.name, picture: animalThumb(c.animal) })), current, (animal) => set({ animal })));
    out.push(h('a', { class: 'opts__link', href: '../animals/' }, t('animal.edit')));
  }
  return out;
}

function playOptions(): Node[] {
  const select = h('select', { class: 'select', 'aria-label': t('character') },
    h('option', { value: '' }, t('character.default')),
    ...roster.map((c) => h('option', { value: c.id }, c.name)),
  );
  select.value = prefs.character;
  select.addEventListener('change', () => {
    prefs.character = select.value;
    savePrefs();
    actor?.setLook(characterLook());
  });
  return [
    h('div', { class: 'opts__head' }, icon('person'), h('b', {}, t('character'))),
    h('p', { class: 'opts__tip' }, t('tip.play')),
    select,
    h('a', { class: 'opts__link', href: '../wardrobe/' }, t('character.edit')),
  ];
}

/** One line of tool icons in Edit; the emotes in Play. */
function toolbar(): Node[] {
  if (prefs.mode === 'play') {
    return EMOTES.map((e) => tap({ class: 'toolbar__btn toolbar__btn--text' }, () => emote(e), t(`emote.${e}` as Key)));
  }
  return TOOLS.map((tool) => tap({ class: 'toolbar__btn', 'aria-pressed': String(tool === prefs.tool), 'aria-label': t(`tool.${tool}` as Key), title: t(`tool.${tool}` as Key) }, () => set({ tool }), icon(TOOL_ICONS[tool])));
}

function set(change: Partial<Prefs>): void {
  const entering = change.mode === 'play' && prefs.mode !== 'play';
  Object.assign(prefs, change);
  savePrefs();
  if (entering) startPlay();
  if (prefs.mode === 'edit') actor = herd = null;
  hover = null;
  version++;
  render();
}

function render(): void {
  const other = prefs.mode === 'edit' ? 'play' : 'edit';
  sceneSelect.replaceChildren(...library.scenes.map((s) => h('option', { value: s.id }, s.name)));
  sceneSelect.value = library.current;
  const { bar, pops } = topBar({
    tool: 'scene',
    title: word('scene'),
    about: [t('hint.edit'), t('hint.play')],
    things: sceneSelect,
    more: [
      { label: t('scene.new'), icon: 'plus', run: () => sceneDialog('new') },
      { label: t('scene.settings'), icon: 'sliders', run: () => sceneDialog('settings') },
      { label: t('scene.export'), icon: 'download', run: () => download(`${sceneNow().name}.json`, sceneFile(sceneNow())) },
      { label: t('scene.import'), icon: 'upload', run: () => void importScene() },
      { label: t('scene.delete'), icon: 'trash', run: deleteScene, danger: true },
    ],
    status: h('span', { class: 'bar__status' }),
    // One button: it shows where it takes you, Play while editing and Edit while playing.
    extra: tap({ class: 'ib mode', 'aria-label': t(`mode.${other}`), title: t(`mode.${other}`) }, () => set({ mode: other }), icon(other === 'play' ? 'play' : 'pencil')),
    relabel: mount,
  });
  barSlot.replaceChildren(bar, ...pops);
  dock.replaceChildren(...toolbar());
  options.replaceChildren(...(prefs.mode === 'edit' ? editOptions() : playOptions()));
  gridButton.setAttribute('aria-pressed', String(prefs.grid));
}

// ------------------------------------------------------------------ scene dialog

function sceneDialog(kind: 'new' | 'settings'): void {
  const scene = sceneNow();
  const name = h('input', { type: 'text', required: '', maxlength: '40', value: kind === 'new' ? t('scene.first') : scene.name });
  const size = (value: number) => h('input', { type: 'number', min: String(MIN_SIZE), max: String(MAX_SIZE), step: '1', required: '', value: String(value) });
  const w = size(kind === 'new' ? 28 : scene.w);
  const hh = size(kind === 'new' ? 28 : scene.h);
  const island = h('input', { type: 'checkbox' });
  island.checked = true;
  const ok = h('button', { type: 'submit', class: 'button button--primary', value: 'ok' }, t('dialog.ok'));
  const cancel = h('button', { type: 'button', class: 'button' }, t('dialog.cancel'));
  const form = h('form', { method: 'dialog', class: 'dialog__form' },
    h('h2', {}, t(kind === 'new' ? 'dialog.new' : 'dialog.settings')),
    h('label', {}, t('dialog.name'), name),
    h('div', { class: 'dialog__sizes' }, h('label', {}, t('dialog.width'), w), h('label', {}, t('dialog.height'), hh)),
    kind === 'new' ? h('label', { class: 'dialog__check' }, island, t('dialog.island')) : h('p', { class: 'hint' }, t('dialog.shrink')),
    h('div', { class: 'dialog__actions' }, cancel, ok),
  );
  const dialog = h('dialog', { class: 'dialog' }, form);
  cancel.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', () => {
    const label = name.value.trim().slice(0, 40) || t('scene.first');
    if (kind === 'new') return switchTo(createScene(label, Number(w.value), Number(hh.value), island.checked));
    const next = Number(w.value) !== scene.w || Number(hh.value) !== scene.h ? resized(scene, Number(w.value), Number(hh.value)) : scene;
    next.name = label;
    library.scenes[library.scenes.indexOf(scene)] = next;
    switchTo(next);
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function deleteScene(): void {
  const scene = sceneNow();
  if (!confirm(t('scene.confirmDelete', { name: scene.name }))) return;
  library.scenes = library.scenes.filter((s) => s !== scene);
  switchTo(library.scenes[0] ?? createScene(t('scene.first'), 28, 28, true));
}

async function importScene(): Promise<void> {
  let scene: Scene;
  try {
    scene = readSceneFile(await pickFile());
  } catch {
    say(t('scene.badFile'));
    return;
  }
  switchTo(scene);
  say(t('scene.imported', { name: scene.name }));
}

// ------------------------------------------------------------------ mount

function mount(): void {
  document.documentElement.lang = currentLang();
  document.title = t('title');
  canvas.setAttribute('aria-label', t('view'));
  gridButton.setAttribute('aria-label', t('zoom.grid'));
  gridButton.title = t('zoom.grid');
  sceneSelect.setAttribute('aria-label', t('scene'));
  sceneSelect.onchange = () => switchTo(library.scenes.find((s) => s.id === sceneSelect.value)!);
  viewport.style.background = ocean.deep;
  viewport.replaceChildren(
    canvas,
    options,
    h('div', { class: 'zoom' },
      tap({ class: 'stage__button', 'aria-label': t('zoom.in'), title: t('zoom.in') }, () => setZoom(zoom + 1), icon('zoomIn')),
      tap({ class: 'stage__button', 'aria-label': t('zoom.out'), title: t('zoom.out') }, () => setZoom(zoom - 1), icon('zoomOut')),
      tap({ class: 'stage__button', 'aria-label': t('rotate.left'), title: t('rotate.left') }, () => rotate(-1), icon('turnLeft')),
      tap({ class: 'stage__button', 'aria-label': t('rotate.right'), title: t('rotate.right') }, () => rotate(1), icon('turnRight')),
      gridButton,
    ),
    statusLine,
  );
  document.getElementById('scene')!.replaceChildren(
    h('div', { class: 'editor' },
      barSlot,
      viewport,
      dock,
    ),
  );
  render();
}

statusLine.hidden = true;
mount();
// Characters saved in the wardrobe in another tab show up when coming back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && prefs.mode === 'play') {
    roster = loadRoster();
    render();
  }
});
new ResizeObserver(fitCanvas).observe(viewport);
setZoom(Math.max(2, Math.min(5, Math.floor(window.innerWidth / 360))));
centerOn(world.toView(sceneNow().spawn));
if (prefs.mode === 'play') {
  startPlay();
  render();
}
requestAnimationFrame(frame);
document.body.dataset.ready = '1';
