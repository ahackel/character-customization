import { BROWS, EYE_COLORS, EYE_SHAPES, GLASSES_COLORS, HAIR_STYLES, HEAD_SHAPES, MOODS, type FaceOptions } from '../lab/base.ts';
import { CATALOG, CLOTH_KEYS, entryById, type Entry } from '../lab/catalog.ts';
import {
  characterFile, cleanState, defaultState, download, GROUNDS, HAIR_COLORS, loadRoster, lookOf, newId, pickFile, readCharacterFile, saveRoster,
  WORN_SLOTS, type Saved, type State, type WornSlot,
} from '../lab/character.ts';
import { hexOf, PALETTE, SKIN_KEYS, type PaletteKey } from '../lab/palette.ts';
import { AUTHORED, STAND, type Clip } from '../lab/poses.ts';
import { BODY_WINDOW, BUILDS, drawCharacter, turnFacing, type Facing, type Sprite, type Stamp } from '../lab/puppet.ts';
import { WEAR_MAX, type Wear } from '../lab/wear.ts';
import { checkbox, cheer, dragToTurn, h, history, NAMES, nameTag, pick, pickStart, row, savePicture, section, segmented, snapButton, tabs, tabTools, toggle, topBar, undoKeys, word, type IconName } from '../shared/shell.ts';
import { currentLang, itemName, LANGS, missingItemNames, t, type Key } from './i18n.ts';
import { shapeEditor } from './shapes.ts';

// ------------------------------------------------------------------ state

type TabId = 'body' | 'face' | 'hair' | WornSlot;
const TABS: TabId[] = ['body', 'face', 'hair', 'beard', 'hat', 'top', 'bottom', 'shoes', 'tool'];

const STORAGE_KEY = 'castaway-wardrobe';

function loadState(): State {
  try {
    return cleanState(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    // Saved looks are a convenience. Without storage the wardrobe starts from the default.
    return defaultState();
  }
}

function saveState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore: private windows and embedded previews may refuse storage.
  }
}

let state = loadState();
let tab: TabId = 'body';
let facing: Facing = 0;
let clipKey = 'idle';
/** For trying it out: how far the preview's head is turned to its left (negative: right), in eighths, and whether the eyes look aside. */
let gaze = 0;
let eyesAside = false;
/** Clips play even with reduced motion: picking one is asking to see it move. Pause stops on the frame shown. */
let paused = false;
// Prototype: show the straight front view in the preview instead of the facing's diagonal one.
let version = 0;

// All five are written by hand as key poses.
const CLIPS: Record<string, Clip> = {
  idle: AUTHORED.idle,
  walk: AUTHORED.walk,
  run: AUTHORED.run,
  wave: AUTHORED.wave,
  use: AUTHORED.use,
  sit: AUTHORED.sit,
  lie: AUTHORED.lie,
  look: AUTHORED.look,
};
const STILL: Clip = { name: 'Stand', rate: 1, frames: [STAND] };

// ------------------------------------------------------------------ look
// ------------------------------------------------------------------ drawing

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** The preview shows the body with room around it for swung tools, wide hats and lying down. */
const HERO: Rect = { x: 4, y: 6, w: 56, h: 54 };
const FACE: Rect = { x: BODY_WINDOW.x + 7, y: BODY_WINDOW.y + 12, w: 18, h: 11 };
/** The whole head with the neck, for the head shape pictures. */
const HEAD: Rect = { x: BODY_WINDOW.x + 3, y: BODY_WINDOW.y + 1, w: 26, h: 26 };

function setPixel(image: ImageData, x: number, y: number, hex: string): void {
  const o = (y * image.width + x) * 4;
  image.data[o] = parseInt(hex.slice(1, 3), 16);
  image.data[o + 1] = parseInt(hex.slice(3, 5), 16);
  image.data[o + 2] = parseInt(hex.slice(5, 7), 16);
  image.data[o + 3] = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
}

function paint(canvas: HTMLCanvasElement, sprite: Sprite, crop: Rect): void {
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(crop.w, crop.h);
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const hex = sprite.get(x + crop.x, y + crop.y);
      if (hex) setPixel(image, x, y, hex);
    }
  }
  ctx.putImageData(image, 0, 0);
}

interface Live {
  canvas: HTMLCanvasElement;
  facing: () => Facing;
  crop: Rect;
  shown: string;
}
const live: Live[] = [];

function liveView(className: string, at: () => Facing, crop: Rect): HTMLCanvasElement {
  const canvas = h('canvas', { class: className, width: String(crop.w), height: String(crop.h) });
  live.push({ canvas, facing: at, crop, shown: '' });
  return canvas;
}

const standing = (source: State, underwear = true) => drawCharacter(lookOf(source, underwear), STILL.frames[0], 0);

/** Sizes a small picture so its art pixels are whole screen pixels and it fills the card. */
function fit(canvas: HTMLCanvasElement, box = 60): HTMLCanvasElement {
  const scale = Math.max(1, Math.min(4, Math.floor(box / Math.max(canvas.width, canvas.height))));
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
  return canvas;
}

/** A plain mannequin with the current body, used as the background items are cut out of. */
function mannequin(): State {
  return { ...structuredClone(state), hair: null, worn: { top: null, bottom: null, shoes: null, hat: null, beard: null, tool: null }, colors: {} };
}

/**
 * A picture of just one item: the pixels that change when the mannequin puts it on, cropped to
 * the item. Nothing is drawn specially for the wardrobe.
 */
function itemPicture(wear: (draft: State) => void): HTMLCanvasElement | null {
  const bare = mannequin();
  const dressed = mannequin();
  wear(dressed);
  const before = standing(bare, false);
  const after = standing(dressed, false);
  const pixels: { x: number; y: number; hex: string }[] = [];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const hex = after.get(x, y);
      if (hex && hex !== before.get(x, y)) pixels.push({ x, y, hex });
    }
  }
  return fromPixels(pixels);
}

/** A picture of a tool on its own, straight from its stamp, since holding it also moves the arm. */
function stampPicture(stamp: Stamp): HTMLCanvasElement | null {
  const pixels: { x: number; y: number; hex: string }[] = [];
  stamp.forEach((row, y) => row.forEach((cell, x) => {
    if (cell) pixels.push({ x, y, hex: hexOf(cell) });
  }));
  return fromPixels(pixels);
}

function fromPixels(pixels: { x: number; y: number; hex: string }[]): HTMLCanvasElement | null {
  if (!pixels.length) return null;
  const x0 = Math.min(...pixels.map((p) => p.x));
  const y0 = Math.min(...pixels.map((p) => p.y));
  const w = Math.max(...pixels.map((p) => p.x)) - x0 + 1;
  const height = Math.max(...pixels.map((p) => p.y)) - y0 + 1;
  const canvas = h('canvas', { class: 'thumb', width: String(w), height: String(height) });
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, height);
  for (const p of pixels) setPixel(image, p.x - x0, p.y - y0, p.hex);
  ctx.putImageData(image, 0, 0);
  return fit(canvas);
}

/** A picture of the current character with one thing changed, cropped to a region. */
function regionPicture(change: (draft: State) => void, crop: Rect, underwear = true, box = crop === BODY_WINDOW ? 96 : 60): HTMLCanvasElement {
  const draft = structuredClone(state);
  change(draft);
  const canvas = h('canvas', { class: 'thumb', width: String(crop.w), height: String(crop.h) });
  paint(canvas, standing(draft, underwear), crop);
  return fit(canvas, box);
}

// ------------------------------------------------------------------ interface

const root = document.getElementById('wardrobe')!;
const stage = h('div', { class: 'stage' });
const stageTag = h('span', { class: 'stage__tag' });
// The sliders are built once and never replaced, so a drag is not interrupted.
const wearSlider = h('input', { type: 'range', class: 'slider', min: '0', max: String(WEAR_MAX), step: '0.25' });
const wearValue = h('b');
const gazeSlider = h('input', { type: 'range', class: 'slider', min: '-1', max: '1', step: '1', value: '0' });
const gazeValue = h('b');
const gazeName = (at: number) => t(`gaze.${at}` as Key);
const wearName = (level: Wear) => t(`wear.${Math.round(level)}` as Key);
const facingName = (at: Facing) => t(`facing.${at}` as Key);
const previewRows = h('div', { class: 'sec__body' });
const tabSlot = h('div');
const panel = h('div', { class: 'library__body', role: 'tabpanel' });
// A little hop for every pick in the library.
panel.addEventListener('click', (e) => (e.target as Element).closest('button') && cheer(stage));
const barSlot = h('div', { style: 'display: contents' });
const name = nameTag();
name.onRename((value) => renameThing(value));
let message = '';

const TAB_ICONS: Record<TabId, IconName> = { body: 'body', face: 'face', hair: 'scissors', beard: 'beard', hat: 'hat', top: 'shirt', bottom: 'trousers', shoes: 'shoes', tool: 'hand' };

// My things: saved characters on this device, shared with the scene editor. The working character
// is kept on every change as before; while a saved one is picked, changes go straight into it.
const CURRENT_KEY = 'castaway-characters-current';
let roster = loadRoster();
let currentId: string | null = null;
try {
  currentId = localStorage.getItem(CURRENT_KEY);
} catch {
  // Without storage nothing is selected.
}
if (!roster.some((c) => c.id === currentId)) currentId = roster.length === 1 ? roster[0].id : null;
const current = () => roster.find((c) => c.id === currentId);
// Opening the wardrobe shows the character picked in My things, even if the draft moved on.
if (current()) state = cleanState(structuredClone(current()!.state));

function setCurrent(id: string | null): void {
  currentId = id;
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    // The selection then lasts for this visit only.
  }
}

/** Stores the list; a refusal is shown in the bar, since it is the one thing that loses work. */
function storeRoster(note = ''): void {
  message = saveRoster(roster) ? note : t('saved.fail');
}

const undo = history(() => state, (value) => {
  state = value;
  persist();
  render();
});

/** Keeps the working character and, if one is picked, its entry in My things. */
function persist(): void {
  version++;
  saveState();
  const saved = current();
  if (saved) {
    saved.state = structuredClone(state);
    storeRoster(message === t('saved.fail') ? '' : message);
  }
}

function changed(): void {
  undo.commit();
  message = '';
  persist();
  render();
}

function addThing(name: string, from: State, note: string): void {
  const saved: Saved = { id: newId(), name, state: structuredClone(from) };
  roster.push(saved);
  setCurrent(saved.id);
  storeRoster(note);
}

function nextName(): string {
  const base = t('saved.default');
  for (let n = roster.length + 1; ; n++) {
    const name = t('saved.numbered', { name: base, n });
    if (!roster.some((c) => c.name === name)) return name;
  }
}

/** New: pick one of three rolled characters, straight into My things. */
function newThing(): void {
  pickStart(() => [...NAMES].sort(() => Math.random() - 0.5).slice(0, 3).map((name) => {
    const look = roll();
    return {
      label: name,
      picture: regionPicture((d) => Object.assign(d, look), BODY_WINDOW, true, 120),
      choose: () => {
        state = look;
        addThing(name, look, '');
        undo.reset();
        persist();
        render();
        cheer(stage);
      },
    };
  }));
}

function copyThing(): void {
  const saved = current();
  addThing(saved ? t('saved.copyOf', { name: saved.name }) : nextName(), state, '');
  render();
}

/** Renames the picked character, or keeps this one in My things under that name. */
function renameThing(name: string): void {
  const saved = current();
  if (saved) {
    if (saved.name === name) return;
    saved.name = name.slice(0, 40);
    storeRoster('');
  } else addThing(name.slice(0, 40), state, '');
  render();
}

function deleteThing(): void {
  const saved = current();
  if (!saved || !confirm(t('saved.confirmDelete', { name: saved.name }))) return;
  roster = roster.filter((c) => c !== saved);
  setCurrent(null);
  storeRoster('');
  render();
}

async function importThing(): Promise<void> {
  let saved: Saved;
  try {
    saved = readCharacterFile(await pickFile());
  } catch {
    message = t('saved.badFile');
    render();
    return;
  }
  roster.push(saved);
  setCurrent(saved.id);
  state = structuredClone(saved.state);
  undo.reset();
  persist();
  storeRoster(t('saved.imported', { name: saved.name }));
  render();
}

function thingsPicker(): HTMLSelectElement {
  const select = h('select', { class: 'select bar__things', 'aria-label': t('things') },
    h('option', { value: '' }, t('saved.none')),
    ...roster.map((c) => h('option', { value: c.id }, c.name)),
  );
  select.value = currentId ?? '';
  select.addEventListener('change', () => {
    const saved = roster.find((c) => c.id === select.value);
    setCurrent(saved?.id ?? null);
    if (saved) state = structuredClone(saved.state);
    message = '';
    undo.reset();
    version++;
    saveState();
    render();
  });
  return select;
}

function renderBar(): void {
  const saved = current();
  const paintCount = CATALOG.filter((e) => e.format === 'paint').length;
  const { bar, undo: undoButton, redo: redoButton, pops } = topBar({
    tool: 'wardrobe',
    title: word('wardrobe'),
    about: [t('lede'), t('foot.items', { count: CATALOG.length, paint: paintCount, recipe: CATALOG.length - paintCount }), t('foot.rules'), t('foot.base')],
    things: thingsPicker(),
    more: [
      { label: t('saved.new'), icon: 'plus', run: newThing },
      { label: saved ? t('saved.copy') : t('saved.keep'), icon: 'copy', run: copyThing },
      { label: t('reset'), icon: 'reset', run: () => { state = defaultState(); changed(); } },
      { label: t('saved.export'), icon: 'download', run: () => download(`${saved?.name ?? t('saved.default')}.json`, characterFile({ id: '', name: saved?.name ?? t('saved.default'), state })) },
      { label: t('saved.import'), icon: 'upload', run: () => void importThing() },
      { label: t('saved.delete'), icon: 'trash', run: deleteThing, danger: true, disabled: !saved },
    ],
    status: h('span', { class: 'bar__status', 'aria-live': 'polite' }, message || (saved ? t('things.current') : '')),
    undo: undo.undo,
    redo: undo.redo,
    shuffle: () => shuffle(),
    relabel: () => {
      mount();
      render();
    },
  });
  undoButton!.disabled = !undo.canUndo();
  redoButton!.disabled = !undo.canRedo();
  barSlot.replaceChildren(bar, ...pops);
}

function swatches(title: string, keys: (PaletteKey | null)[], selected: PaletteKey | null, pick: (key: PaletteKey | null) => void, ownLabel = t('color.original')): HTMLElement {
  const row = h('div', { class: 'swatches' });
  for (const key of keys) {
    const name = key ? t(`palette.${key}` as Key) : ownLabel;
    const button = h('button', {
      type: 'button',
      class: key === null ? 'swatch swatch--own' : 'swatch',
      'aria-pressed': String(key === selected),
      'aria-label': `${title}: ${name}`,
      title: name,
      style: key ? `--swatch: ${PALETTE[key].base}; --swatch-shade: ${PALETTE[key].shade}` : '',
    }, key === null ? ownLabel : null);
    button.addEventListener('click', () => pick(key));
    row.append(button);
  }
  return section(title, row);
}

function card(label: string, selected: boolean, picture: HTMLCanvasElement | null, onClick: () => void): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'card', 'aria-pressed': String(selected) },
    h('span', { class: 'card__picture' }, picture ?? h('span', { class: 'card__none', 'aria-hidden': 'true' })),
    h('span', { class: 'card__label' }, label),
  );
  button.addEventListener('click', onClick);
  return button;
}

function slotPanel(slot: WornSlot): HTMLElement[] {
  const current = entryById(state.worn[slot]);
  const entries = CATALOG.filter((e) => e.slot === slot);
  const grid = h('div', { class: 'grid' });
  grid.append(card(slot === 'bottom' ? t('undershorts') : t('none'), !current, null, () => {
    state.worn[slot] = null;
    changed();
  }));
  for (const entry of entries) {
    const picture = slot === 'tool' ? stampPicture(entry.item.tool!.front) : itemPicture((d) => {
      d.worn[slot] = entry.id;
    });
    grid.append(card(itemName(entry.id, entry.label), entry.id === current?.id, picture, () => {
      if (state.worn[slot] !== entry.id) delete state.colors[slot];
      state.worn[slot] = entry.id;
      changed();
    }));
  }
  const out: HTMLElement[] = [grid];
  if (current && slot === 'beard') {
    out.push(swatches(t('beardColor'), [null, ...HAIR_COLORS], state.beardColor, (key) => {
      state.beardColor = key;
      changed();
    }, t('beardColor.hair')));
  } else if (current) {
    current.colors.forEach((own, i) => {
      out.push(swatches(i === 0 ? t('color.main') : t('color.second'), [null, ...CLOTH_KEYS], state.colors[slot]?.[own] ?? null, (key) => {
        const next = { ...state.colors[slot] };
        if (key) next[own] = key;
        else delete next[own];
        state.colors[slot] = next;
        changed();
      }));
    });
  }
  return out;
}

function bodyPanel(): HTMLElement[] {
  const builds = h('div', { class: 'grid grid--tall' });
  for (const build of BUILDS) {
    builds.append(card(t(`build.${build.id}` as Key), state.build === build.id, regionPicture((d) => {
      Object.assign(d, mannequin(), { build: build.id });
    }, BODY_WINDOW), () => {
      state.build = build.id;
      changed();
    }));
  }
  const gender = segmented(t('gender'), [{ id: 'm' as const, label: t('gender.m') }, { id: 'f' as const, label: t('gender.f') }], state.frame, (frame) => {
    state.frame = frame;
    state.face.lashes = frame === 'f';
    changed();
  }, 'seg seg--fit');
  return [
    section(t('gender'), gender),
    swatches(t('skin'), SKIN_KEYS, state.skin, (key) => {
      state.skin = key ?? 'skinB';
      changed();
    }),
    section(t('build'), builds),
  ];
}

function facePanel(): HTMLElement[] {
  const face = state.face;
  const bald = (d: State) => Object.assign(d, { hair: null, worn: { ...d.worn, hat: null, beard: null } });
  const options = <K extends 'eyes' | 'brows'>(title: string, key: K, values: readonly FaceOptions[K][]) => {
    const grid = h('div', { class: 'grid grid--small' });
    for (const value of values) {
      grid.append(card(t(`${key}.${value}` as Key), face[key] === value, regionPicture((d) => {
        bald(d);
        d.face = { ...d.face, [key]: value };
      }, FACE), () => {
        face[key] = value;
        changed();
      }));
    }
    return section(title, grid);
  };
  const flip = (label: string, key: 'blush' | 'freckles' | 'glasses' | 'lashes') => toggle(label, face[key], () => {
    face[key] = !face[key];
    changed();
  });
  const shapes = h('div', { class: 'grid grid--small' }, ...HEAD_SHAPES.map((shape) => card(t(`headShape.${shape}` as Key), (face.shape ?? 'round') === shape, regionPicture((d) => {
    bald(d);
    d.face = { ...d.face, shape };
  }, HEAD), () => {
    face.shape = shape;
    changed();
  })));
  return [
    section(t('headShape'), shapes),
    options(t('eyes'), 'eyes', EYE_SHAPES),
    swatches(t('eyeColor'), EYE_COLORS, face.eyeColor, (key) => {
      face.eyeColor = key;
      changed();
    }, t('eyeColor.dark')),
    options(t('brows'), 'brows', BROWS),
    section(t('details'), h('div', { class: 'toggles' }, flip(t('blush'), 'blush'), flip(t('freckles'), 'freckles'), flip(t('lashes'), 'lashes'), flip(t('glasses'), 'glasses'))),
    // The frame colour only matters while glasses are worn.
    face.glasses && swatches(t('glassesColor'), GLASSES_COLORS, face.glassesColor ?? 'black', (key) => {
      face.glassesColor = key ?? 'black';
      changed();
    }),
    section(t('shapes'), shapeEditor({
      face, skin: state.skin, hair: state.hairColor, mood: state.mood,
      live: () => version++,
      done: () => {
        version++;
        render();
      },
      show: (view) => setFacing(view === 'front' ? 4 : view === 'side' ? 7 : 0),
    })),
  ].filter((node): node is HTMLElement => !!node);
}

function hairPanel(): HTMLElement[] {
  const styles = h('div', { class: 'grid' });
  const choose = (id: string | null) => () => {
    state.hair = id;
    changed();
  };
  styles.append(card(t('hair.bald'), state.hair === null, null, choose(null)));
  const all = [
    ...HAIR_STYLES.map((s) => ({ id: s.id, label: t(`hair.${s.id}` as Key) })),
    ...CATALOG.filter((e) => e.slot === 'hair').map((e) => ({ id: e.id, label: itemName(e.id, e.label) })),
  ];
  for (const style of all) {
    styles.append(card(style.label, state.hair === style.id, itemPicture((d) => {
      d.hair = style.id;
    }), choose(style.id)));
  }
  return [
    styles,
    swatches(t('hairColor'), HAIR_COLORS, state.hairColor, (key) => {
      state.hairColor = key ?? 'hairBrown';
      changed();
    }),
    h('p', { class: 'note' }, t('hair.note')),
  ];
}

/** A whole new random look. Condition, mood and ground are kept, so one can shuffle through neat passengers or castaways. */
function roll(): State {
  const next = defaultState();
  next.skin = pick(SKIN_KEYS);
  next.build = pick(BUILDS).id;
  next.frame = pick(['m', 'f'] as const);
  next.wear = state.wear;
  next.mood = state.mood;
  next.face = {
    shape: pick(HEAD_SHAPES),
    eyes: pick(EYE_SHAPES), eyeColor: pick(EYE_COLORS), brows: pick(BROWS),
    blush: Math.random() < 0.6, freckles: Math.random() < 0.25, glasses: Math.random() < 0.15, glassesColor: pick(GLASSES_COLORS), lashes: next.frame === 'f',
  };
  const hairs = [...HAIR_STYLES.map((s) => s.id), ...CATALOG.filter((e) => e.slot === 'hair').map((e) => e.id)];
  next.hair = Math.random() < 0.08 ? null : pick(hairs);
  next.hairColor = pick(HAIR_COLORS.slice(0, 6));
  const level = Math.round(next.wear);
  const shod = [0.95, 0.8, 0.5, 0.3][level];
  const bearded = next.frame === 'm' ? [0.15, 0.3, 0.5, 0.65][level] : 0;
  const chance: Record<WornSlot, number> = { top: 0.92, bottom: 0.92, shoes: shod, hat: 0.45, beard: bearded, tool: 0.5 };
  for (const slot of WORN_SLOTS) {
    // Nobody had a leaf skirt or a spear before the wreck.
    const options = CATALOG.filter((e) => e.slot === slot && (level > 0 || !e.island));
    const entry: Entry | null = options.length && Math.random() < chance[slot] ? pick(options) : null;
    next.worn[slot] = entry?.id ?? null;
    if (entry && slot !== 'beard' && entry.colors.length && Math.random() < 0.35) next.colors[slot] = { [entry.colors[0]]: pick(CLOTH_KEYS) };
  }
  next.ground = state.ground;
  return next;
}

/** What each tab owns in the state, so a tab can be shuffled alone or kept when shuffling all. */
function takeTab(into: State, from: State, id: TabId): void {
  if (id === 'body') Object.assign(into, { frame: from.frame, skin: from.skin, build: from.build }), (into.face.lashes = from.face.lashes);
  else if (id === 'face') into.face = structuredClone(from.face);
  else if (id === 'hair') Object.assign(into, { hair: from.hair, hairColor: from.hairColor });
  else {
    into.worn[id] = from.worn[id];
    if (from.colors[id]) into.colors[id] = structuredClone(from.colors[id]);
    else delete into.colors[id];
    if (id === 'beard') into.beardColor = from.beardColor;
  }
}

const locked = new Set<TabId>();

function shuffle(only?: TabId): void {
  const next = roll();
  if (only) {
    const kept = structuredClone(state);
    takeTab(kept, next, only);
    state = kept;
  } else {
    for (const id of locked) takeTab(next, state, id);
    state = next;
  }
  changed();
  cheer(stage);
}




function setFacing(next: Facing): void {
  facing = next;
  stageTag.textContent = facingName(facing);
}

function render(): void {
  stage.style.setProperty('--ground', GROUNDS.find((g) => g.id === state.ground)!.color);
  renderBar();
  setFacing(facing);

  tabSlot.replaceChildren(tabs(t('sections'), TABS.map((id) => ({ id, label: t(`tab.${id}` as Key), icon: TAB_ICONS[id] })), tab, (id) => {
    tab = id;
    panel.scrollTop = 0;
    render();
  }, locked, tabTools(() => shuffle(tab), locked.has(tab), () => {
    if (!locked.delete(tab)) locked.add(tab);
    render();
  })));
  const saved = current();
  name.set(saved?.name ?? '', t('saved.none'));
  const scroll = panel.scrollTop;
  panel.replaceChildren(...(tab === 'body' ? bodyPanel() : tab === 'face' ? facePanel() : tab === 'hair' ? hairPanel() : slotPanel(tab)));
  panel.scrollTop = scroll;

  wearSlider.value = String(state.wear);
  wearSlider.setAttribute('aria-valuetext', wearName(state.wear));
  wearValue.textContent = wearName(state.wear);
  const actions = Object.keys(CLIPS).map((id) => ({ id, label: t(`clip.${id}` as Key) }));
  previewRows.replaceChildren(
    row(t('wear'), wearSlider, wearValue),
    row(t('mood'), segmented(t('mood'), MOODS.map((mood) => ({ id: mood, label: t(`mood.${mood}` as Key), icon: `mood.${mood}` as IconName })), state.mood, (mood) => {
      state.mood = mood;
      changed();
    }), t(`mood.${state.mood}` as Key)),
    row(t('action'), segmented(t('action'), actions, clipKey, (id) => {
      clipKey = id;
      paused = false;
      render();
    }, 'seg seg--wrap')),
    row(t('gaze'), gazeSlider, gazeValue),
    row('', checkbox(t('gaze.aside'), eyesAside, (on) => {
      eyesAside = on;
    })),
    // Unticked holds the frame shown.
    row('', checkbox(word('animate'), !paused, (on) => {
      paused = !on;
    })),
    row(t('ground'), segmented(t('ground'), GROUNDS.map((g) => ({ id: g.id, label: t(`ground.${g.id}` as Key) })), state.ground, (id) => {
      state.ground = id;
      saveState();
      render();
    })),
  );
}

/** Builds the page. Called again when the language changes, since every label is rebuilt. */
function mount(): void {
  document.documentElement.lang = currentLang();
  document.title = t('title');
  live.length = 0;
  wearSlider.setAttribute('aria-label', t('wear'));
  gazeSlider.setAttribute('aria-label', t('gaze'));
  setGaze(gaze);
  const hero = liveView('stage__sprite', () => facing, HERO);
  hero.style.cssText = `--w: ${HERO.w}; --h: ${HERO.h}`;
  stage.replaceChildren(hero, stageTag, name.el, snapButton(() => savePicture(hero, current()?.name ?? t('saved.default'))));
  const preview = h('details', { class: 'sec' }, h('summary', {}, word('preview')), previewRows);
  preview.open = true;
  root.replaceChildren(
    h('div', { class: 'shell' },
      barSlot,
      h('main', { class: 'shell__main' },
        h('section', { class: 'preview', 'aria-label': t('preview') }, stage, preview),
        h('section', { class: 'library', 'aria-label': t('wardrobe') }, tabSlot, panel),
      ),
    ),
  );
}

// Dragging sideways on the preview turns the character round, an eighth of a turn at a time.
dragToTurn(stage, (step) => setFacing(turnFacing(facing, step)));

// While dragging, only the preview follows; the item pictures are redrawn on release.
function setGaze(at: number): void {
  gaze = at;
  gazeSlider.value = String(at);
  gazeSlider.setAttribute('aria-valuetext', gazeName(at));
  gazeValue.textContent = gazeName(at);
}
gazeSlider.addEventListener('input', () => setGaze(Number(gazeSlider.value)));

wearSlider.addEventListener('input', () => {
  state.wear = Number(wearSlider.value);
  version++;
  wearSlider.setAttribute('aria-valuetext', wearName(state.wear));
  wearValue.textContent = wearName(state.wear);
});
wearSlider.addEventListener('change', changed);

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setFacing(turnFacing(facing, event.key === 'ArrowRight' ? 1 : -1));
});
undoKeys(undo.undo, undo.redo);

if (import.meta.env.DEV) {
  // A new item without a translated name still works; this only points it out while developing.
  for (const l of LANGS) {
    const missing = missingItemNames(CATALOG.map((e) => e.id), l.id);
    if (missing.length) console.error(`No ${l.name} name for: ${missing.join(', ')}`);
  }
}

mount();
render();

let ticks = 0;
let look = lookOf(state);
let lookVersion = version;
const frames = new Map<string, Sprite>();
const tick = (ms: number) => {
  if (lookVersion !== version) {
    look = lookOf(state);
    lookVersion = version;
    frames.clear();
  }
  const clip = CLIPS[clipKey];
  if (!paused) ticks = ms;
  const frame = Math.floor((ticks / 1000) * clip.rate) % clip.frames.length;
  for (const view of live) {
    const at = view.facing();
    const key = `${version}|${clipKey}|${at}|${frame}|${gaze}|${eyesAside}`;
    if (key === view.shown) continue;
    view.shown = key;
    let sprite = frames.get(key);
    if (!sprite) {
      // The gaze slider turns the head and moves the eyes over whatever the clip does; a blink still shows.
      const pose = gaze ? { ...clip.frames[frame], look: gaze } : clip.frames[frame];
      const face = clip.faces?.[frame] === 'blink' || !eyesAside ? clip.faces?.[frame] : 'aside';
      frames.set(key, (sprite = drawCharacter(look, pose, at, { face, swing: clip.swing })));
    }
    paint(view.canvas, sprite, view.crop);
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
document.body.dataset.ready = '1';
