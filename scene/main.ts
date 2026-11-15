import '../wardrobe/style.css';
import './style.css';
import { defaultState, download, loadRoster, lookOf, pickFile, type Saved } from '../lab/character.ts';
import { FRAMES } from '../lab/flora.ts';
import { FLORA, plantById } from '../lab/flora-catalog.ts';
import { castShadow, layShadow, ROOM, stamp, type Picture } from '../lab/island.ts';
import { inside, levelAt, MAX_LEVEL, MIN_LEVEL, PAINTS, SEA_LEVEL, setLevel, surfaceAt } from '../lab/terrain.ts';
import { Actor, EMOTES, type Emote } from '../engine/actor.ts';
import {
  createScene, loadLibrary, MAX_SIZE, MIN_SIZE, readSceneFile, resized, saveLibrary, sceneFile, SEEDS, type Scene,
} from '../engine/scene.ts';
import { grows, rasterOf, smooth, World, type Rect, type Thing } from '../engine/world.ts';
import { ocean, OCEAN_PRESETS, OCEAN_RANGES, saveOcean, useOcean, WATER_COLORS, type OceanColor, type OceanNumber } from '../engine/ocean.ts';
import { plantName } from '../flora/i18n.ts';
import { currentLang, LANGS, setLang, t, type Key } from './i18n.ts';

// The scene editor: build a scene's ground and plants in Edit, walk around it with a saved
// character in Play. Scenes, and the editor's own settings, are kept in this browser.

// ------------------------------------------------------------------ settings

const TOOLS = ['raise', 'lower', 'smooth', 'level', 'paint', 'plant', 'erase', 'spawn'] as const;
type Tool = (typeof TOOLS)[number];
const BRUSHED: Tool[] = ['raise', 'lower', 'smooth', 'level', 'paint', 'erase'];
const ZOOM = { min: 1, max: 8 };

interface Prefs {
  mode: 'edit' | 'play';
  tool: Tool;
  /** 0 by height, otherwise `PAINTS[n - 1]`. */
  paint: number;
  /** Brush size in tiles across: 1, 2 or 3. */
  brush: number;
  plant: string;
  /** A saved character id, or '' for the default one. */
  character: string;
  /** Which side the scene is seen from: quarter turns, 0 to 3. */
  rot: number;
}
const PREFS_KEY = 'pixel-scenes-ui';
function loadPrefs(): Prefs {
  const prefs: Prefs = { mode: 'edit', tool: 'raise', paint: 2, brush: 1, plant: FLORA.find((e) => e.category === 'palm')?.id ?? FLORA[0].id, character: '', rot: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (saved?.mode === 'edit' || saved?.mode === 'play') prefs.mode = saved.mode;
    if (TOOLS.includes(saved?.tool)) prefs.tool = saved.tool;
    if (Number.isInteger(saved?.paint) && saved.paint >= 0 && saved.paint <= PAINTS.length) prefs.paint = saved.paint;
    if ([1, 2, 3].includes(saved?.brush)) prefs.brush = saved.brush;
    if (plantById(saved?.plant)) prefs.plant = saved.plant;
    if (typeof saved?.character === 'string') prefs.character = saved.character;
    if ([0, 1, 2, 3].includes(saved?.rot)) prefs.rot = saved.rot;
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

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}
function button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'chip', ...attrs }, label);
  b.addEventListener('click', onClick);
  return b;
}
const chip = (label: string, pressed: boolean, onClick: () => void, attrs: Record<string, string> = {}) =>
  button(label, onClick, { 'aria-pressed': String(pressed), ...attrs });

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
  const start = -Math.floor((size - 1) / 2);
  const out: number[] = [];
  for (let dj = start; dj < start + size; dj++) for (let di = start; di < start + size; di++) {
    const i = at.i + di;
    const j = at.j + dj;
    if (inside(world.map, i, j)) out.push(j * world.map.w + i);
  }
  return out;
}

/** Whether the tool would do nothing on a tile, so the brush shows red there. */
function cannotEdit(at: { i: number; j: number }): boolean {
  switch (prefs.tool) {
    case 'plant':
      return !grows(world.map, prefs.plant, at.i + 0.5, at.j + 0.5);
    case 'spawn':
      return levelAt(world.map, at.i, at.j) < SEA_LEVEL;
    case 'raise':
      return brushCells(at).every((c) => world.map.levels[c] >= MAX_LEVEL);
    case 'lower':
      return brushCells(at).every((c) => world.map.levels[c] <= MIN_LEVEL);
    default:
      return false;
  }
}

function placePlant(at: { i: number; j: number }): void {
  const entry = plantById(prefs.plant)!;
  const i = at.i + 0.2 + Math.random() * 0.6;
  const j = at.j + 0.2 + Math.random() * 0.6;
  if (!grows(world.map, entry.id, i, j)) {
    say(t('plant.cannot', { plant: plantName(entry.id, entry.label), ground: t(`surface.${surfaceAt(world.map, at.i, at.j)}` as Key) }));
    return;
  }
  const crowded = world.viewPlants().some((p) => Math.hypot(p.vi - i, p.vj - j) < (ROOM[plantById(p.plant)!.category] + ROOM[entry.category]) * 0.45);
  if (crowded) return;
  world.scene.plants.push({ plant: entry.id, ...world.toData({ i, j }), seed: Math.floor(Math.random() * SEEDS), size: 0.85 + Math.random() * 0.3 });
}

/**
 * Applies the tool once to a tile. `stroke.touched` keeps a drag from raising, lowering or
 * painting a tile twice; smoothing works again on every tile the drag enters, and levelling
 * keeps to the height of the tile the drag started on.
 */
function apply(at: { i: number; j: number }, stroke: { touched: Set<number>; level?: number }): void {
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
      if (fresh.length) placePlant(at);
      break;
    case 'erase': {
      const cells = new Set(brushCells(at));
      const seen = world.viewPlants();
      world.scene.plants = world.scene.plants.filter((_, k) => !cells.has(Math.floor(seen[k].vj) * map.w + Math.floor(seen[k].vi)));
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
  | { kind: 'stroke'; touched: Set<number>; last: string; level?: number; tile?: { i: number; j: number }; at: number }
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
    // A target that cannot be reached is given up rather than walked against forever.
    if (target && before[0] === actor.i && before[1] === actor.j) target = null;
  } else if (kx || ky) {
    cam.x += (kx * 360 * dt) / zoom;
    cam.y += (ky * 360 * dt) / zoom;
  }

  const view = viewRect();
  const wind = Math.floor((ms / 1000) * 6) % FRAMES;
  const waves = Math.floor(ms / 100);
  const key = `${version}|${view.x},${view.y},${vw},${vh}|${wind}|${waves}|${hover?.i},${hover?.j}|${prefs.mode}`;
  if (prefs.mode === 'play' || key !== shown) {
    shown = key;
    const things: Thing[] = world.plantThings(wind);
    if (prefs.mode === 'play' && actor) things.push(actor.thing(world, ms), ...actor.dropThings());
    else {
      const s = world.toView(world.scene.spawn);
      things.push({ spot: { i: s.i, j: s.j, level: Math.max(SEA_LEVEL, levelAt(world.map, Math.floor(s.i), Math.floor(s.j))) }, picture: FLAG, w: 6, h: 13, foot: { x: 0, y: 12 } });
    }
    const blocked = prefs.mode === 'edit' && !!hover && cannotEdit(hover);
    const highlight = prefs.mode === 'edit' && hover ? { cells: new Set(brushCells(hover)), color: blocked ? '#e0332e99' : '#ffffff66' } : undefined;
    canvas.style.cursor = blocked ? 'not-allowed' : prefs.mode === 'edit' ? 'crosshair' : 'pointer';
    const image = world.compose(view, things, highlight, prefs.mode === 'edit', waves * 100);
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

const sceneSelect = h('select', { class: 'chip' });
const modeRow = h('div', { class: 'chips', role: 'group' });
const dock = h('div', { class: 'dock' });

function row(label: string, ...children: Child[]): HTMLElement {
  return h('div', { class: 'row' }, h('h3', {}, label), h('div', { class: 'chips' }, ...children));
}

function editPanel(): HTMLElement[] {
  const out = [row(t('tools'), ...TOOLS.map((tool) => chip(t(`tool.${tool}` as Key), tool === prefs.tool, () => set({ tool }))))];
  if (prefs.tool === 'paint') out.push(row(t('paint'), ...[0, 1, 2, 3].map((n) => chip(t(`paint.${n}` as Key), n === prefs.paint, () => set({ paint: n })))));
  if (BRUSHED.includes(prefs.tool)) out.push(row(t('brush'), ...[1, 2, 3].map((n) => chip(`${n}×${n}`, n === prefs.brush, () => set({ brush: n })))));
  if (prefs.tool === 'plant') {
    out.push(h('div', { class: 'plants', role: 'group', 'aria-label': t('plants') },
      ...FLORA.map((e) => {
        const name = plantName(e.id, e.label);
        const b = h('button', { type: 'button', class: 'plant', 'aria-pressed': String(e.id === prefs.plant), title: name, 'aria-label': name }, thumb(e.id));
        b.addEventListener('click', () => set({ plant: e.id }));
        return b;
      }),
    ));
  }
  out.push(h('p', { class: 'hint' }, t('hint.edit')));
  return out;
}

function playPanel(): HTMLElement[] {
  const select = h('select', { class: 'chip', 'aria-label': t('character') },
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
    row(t('character'), select, h('a', { class: 'chip', href: '../wardrobe/' }, t('character.edit'))),
    row('', ...EMOTES.map((e) => button(t(`emote.${e}` as Key), () => emote(e)))),
    h('p', { class: 'hint' }, t('hint.play')),
  ];
}

function set(change: Partial<Prefs>): void {
  const entering = change.mode === 'play' && prefs.mode !== 'play';
  Object.assign(prefs, change);
  savePrefs();
  if (entering) startPlay();
  if (prefs.mode === 'edit') actor = null;
  hover = null;
  version++;
  render();
}

function render(): void {
  sceneSelect.replaceChildren(...library.scenes.map((s) => h('option', { value: s.id }, s.name)));
  sceneSelect.value = library.current;
  modeRow.replaceChildren(
    chip(t('mode.edit'), prefs.mode === 'edit', () => set({ mode: 'edit' })),
    chip(t('mode.play'), prefs.mode === 'play', () => set({ mode: 'play' })),
  );
  dock.replaceChildren(...(prefs.mode === 'edit' ? editPanel() : playPanel()));
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

// ------------------------------------------------------------------ sea panel

const SEA_GROUPS: { title: Key; fields: (OceanColor | OceanNumber)[] }[] = [
  { title: 'sea.group.water', fields: ['shore', 'shallow', 'middle', 'open', 'deep', 'far', 'gradient'] },
  { title: 'sea.group.waves', fields: ['wave', 'waveReach', 'wavePeriod', 'waves'] },
  { title: 'sea.group.ripples', fields: ['rippleDark', 'ripplePale', 'rippleOpacity', 'ripples', 'rippleLength', 'drift', 'glints'] },
];
let seaOpen = false;

/** After a sea setting changed: keep it, and redraw the ground if a water colour is baked into it. */
function seaChanged(key: OceanColor | OceanNumber): void {
  saveOcean();
  if ((WATER_COLORS as string[]).includes(key)) groundDirty = true;
  viewport.style.background = ocean.deep;
  version++;
}

/** A floating panel over the scene with the sea's colours and motion, saved on this device. */
function seaPanel(): HTMLElement {
  const panel = h('details', { class: 'sea' }, h('summary', { class: 'chip' }, t('sea')));
  panel.open = seaOpen;
  panel.addEventListener('toggle', () => (seaOpen = panel.open));
  const body = h('div', { class: 'sea__body' });
  const field = (key: OceanColor | OceanNumber): HTMLElement => {
    const label = t(`sea.${key}` as Key);
    if (key in OCEAN_RANGES) {
      const k = key as OceanNumber;
      const [min, max, step] = OCEAN_RANGES[k];
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(ocean[k]), 'aria-label': label });
      const shown = h('output', {}, String(ocean[k]));
      input.addEventListener('input', () => {
        ocean[k] = Number(input.value);
        shown.textContent = input.value;
        seaChanged(k);
      });
      return h('label', { class: 'sea__field' }, h('span', {}, label), h('span', { class: 'sea__range' }, input, shown));
    }
    const k = key as OceanColor;
    const input = h('input', { type: 'color', value: ocean[k], 'aria-label': label });
    input.addEventListener('input', () => {
      ocean[k] = input.value;
      seaChanged(k);
    });
    return h('label', { class: 'sea__field' }, h('span', {}, label), input);
  };
  const fill = () => body.replaceChildren(
    h('div', { class: 'chips', role: 'group', 'aria-label': t('sea.presets') },
      ...(['blue', 'aqua'] as const).map((name) => button(t(`sea.preset.${name}`), () => {
        useOcean(OCEAN_PRESETS[name]);
        WATER_COLORS.forEach((k) => seaChanged(k));
        fill();
      })),
    ),
    ...SEA_GROUPS.flatMap((g) => [h('h3', {}, t(g.title)), ...g.fields.map(field)]),
  );
  fill();
  panel.append(body);
  return panel;
}

function mount(): void {
  document.documentElement.lang = currentLang();
  document.title = t('title');
  canvas.setAttribute('aria-label', t('view'));
  sceneSelect.setAttribute('aria-label', t('scene'));
  modeRow.setAttribute('aria-label', t('mode'));
  sceneSelect.onchange = () => switchTo(library.scenes.find((s) => s.id === sceneSelect.value)!);
  const languages = h('div', { class: 'langs', role: 'group', 'aria-label': t('language') },
    ...LANGS.map((l) => {
      const b = h('button', { type: 'button', class: 'lang', 'aria-pressed': String(l.id === currentLang()), lang: l.id, title: l.name }, l.label);
      b.addEventListener('click', () => {
        setLang(l.id);
        mount();
      });
      return b;
    }),
  );
  viewport.style.background = ocean.deep;
  viewport.replaceChildren(
    canvas,
    seaPanel(),
    h('div', { class: 'zoom' },
      button('+', () => setZoom(zoom + 1), { 'aria-label': t('zoom.in') }),
      button('−', () => setZoom(zoom - 1), { 'aria-label': t('zoom.out') }),
      button('↺', () => rotate(-1), { 'aria-label': t('rotate.left'), title: t('rotate.left') }),
      button('↻', () => rotate(1), { 'aria-label': t('rotate.right'), title: t('rotate.right') }),
    ),
    statusLine,
  );
  document.getElementById('scene')!.replaceChildren(
    h('div', { class: 'editor' },
      h('header', { class: 'bar' },
        h('a', { class: 'home-link', href: '../' }, t('home')),
        h('h1', {}, t('title')),
        h('div', { class: 'chips bar__scene', role: 'group', 'aria-label': t('scene') },
          sceneSelect,
          button(t('scene.new'), () => sceneDialog('new')),
          button(t('scene.settings'), () => sceneDialog('settings')),
          button(t('scene.delete'), deleteScene),
          button(t('scene.export'), () => download(`${sceneNow().name}.json`, sceneFile(sceneNow()))),
          button(t('scene.import'), () => void importScene()),
        ),
        modeRow,
        languages,
      ),
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
