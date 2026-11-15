import './style.css';
import { BROWS, EYE_COLORS, EYE_SHAPES, GLASSES_COLORS, HAIR_STYLES, MOODS, type FaceOptions } from '../lab/base.ts';
import { CATALOG, CLOTH_KEYS, entryById, type Entry } from '../lab/catalog.ts';
import {
  characterFile, cleanState, defaultState, download, GROUNDS, HAIR_COLORS, loadRoster, lookOf, newId, pickFile, readCharacterFile, saveRoster,
  WORN_SLOTS, type Saved, type State, type WornSlot,
} from '../lab/character.ts';
import { hexOf, PALETTE, SKIN_KEYS, type PaletteKey } from '../lab/palette.ts';
import { AUTHORED, STAND, type Clip } from '../lab/poses.ts';
import { BODY_WINDOW, BUILDS, drawCharacter, FACING_NAMES, type Facing, type Sprite, type Stamp } from '../lab/puppet.ts';
import { WEAR_MAX, type Wear } from '../lab/wear.ts';
import { currentLang, itemName, LANGS, missingItemNames, setLang, t, type Key } from './i18n.ts';

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
let version = 0;

// All five are written by hand as key poses.
const CLIPS: Record<string, Clip> = {
  idle: AUTHORED.idle,
  walk: AUTHORED.walk,
  run: AUTHORED.run,
  wave: AUTHORED.wave,
  use: AUTHORED.use,
};
const STILL: Clip = { name: 'Stand', rate: 1, frames: [STAND] };

// ------------------------------------------------------------------ look
// ------------------------------------------------------------------ drawing

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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** The preview shows the body with room around it for swung tools and wide hats. */
const HERO: Rect = { x: 10, y: 6, w: 44, h: 54 };
const FACE: Rect = { x: BODY_WINDOW.x + 7, y: BODY_WINDOW.y + 12, w: 18, h: 11 };

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
function regionPicture(change: (draft: State) => void, crop: Rect, underwear = true): HTMLCanvasElement {
  const draft = structuredClone(state);
  change(draft);
  const canvas = h('canvas', { class: 'thumb', width: String(crop.w), height: String(crop.h) });
  paint(canvas, standing(draft, underwear), crop);
  return fit(canvas, crop === BODY_WINDOW ? 96 : 60);
}

// ------------------------------------------------------------------ interface

const root = document.getElementById('wardrobe')!;
const stage = h('div', { class: 'stage__ground' });
const facingRow = h('div', { class: 'facings', role: 'group' });
const actionRow = h('div', { class: 'chips', role: 'group' });
const groundRow = h('div', { class: 'chips', role: 'group' });
// The condition is a slider. It is built once and never replaced, so a drag is not interrupted.
const wearSlider = h('input', { type: 'range', class: 'slider', min: '0', max: String(WEAR_MAX), step: '0.25' });
const wearValue = h('output', { class: 'slider__value' });
const wearName = (level: Wear) => t(`wear.${Math.round(level)}` as Key);
const moodRow = h('div', { class: 'chips', role: 'group' });
const tabRow = h('nav', { class: 'tabs', role: 'tablist' });
const panel = h('div', { class: 'panel__body', role: 'tabpanel' });

// Saved characters: a list on this device, shared with the scene editor. The working character
// above is saved on every change as before; the list keeps named copies of it.
const rosterRow = h('div', { class: 'chips', role: 'group' });
const rosterStatus = h('p', { class: 'note', 'aria-live': 'polite' });
const CURRENT_KEY = 'castaway-characters-current';
let roster = loadRoster();
let currentId: string | null = null;
try {
  currentId = localStorage.getItem(CURRENT_KEY);
} catch {
  // Without storage nothing is selected.
}
if (!roster.some((c) => c.id === currentId)) currentId = roster.length === 1 ? roster[0].id : null;

function setCurrent(id: string | null): void {
  currentId = id;
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    // The selection then lasts for this visit only.
  }
}

function storeRoster(message: string): void {
  rosterStatus.textContent = saveRoster(roster) ? message : t('saved.fail');
  render();
}

function saveAs(): void {
  const name = prompt(t('saved.name'), roster.find((c) => c.id === currentId)?.name ?? t('saved.default'))?.trim().slice(0, 40);
  if (!name) return;
  const saved: Saved = { id: newId(), name, state: structuredClone(state) };
  roster.push(saved);
  setCurrent(saved.id);
  storeRoster(t('saved.ok', { name }));
}

function saveCurrent(): void {
  const saved = roster.find((c) => c.id === currentId);
  if (!saved) return saveAs();
  saved.state = structuredClone(state);
  storeRoster(t('saved.ok', { name: saved.name }));
}

function deleteCurrent(): void {
  const saved = roster.find((c) => c.id === currentId);
  if (!saved || !confirm(t('saved.confirmDelete', { name: saved.name }))) return;
  roster = roster.filter((c) => c !== saved);
  setCurrent(null);
  storeRoster('');
}

async function importCharacter(): Promise<void> {
  let saved: Saved;
  try {
    saved = readCharacterFile(await pickFile());
  } catch {
    rosterStatus.textContent = t('saved.badFile');
    return;
  }
  roster.push(saved);
  setCurrent(saved.id);
  state = structuredClone(saved.state);
  saveState();
  version++;
  storeRoster(t('saved.imported', { name: saved.name }));
}

function rosterControls(): Node[] {
  const select = h('select', { class: 'chip', 'aria-label': t('saved.pick') },
    h('option', { value: '' }, t('saved.none')),
    ...roster.map((c) => h('option', { value: c.id }, c.name)),
  );
  select.value = currentId ?? '';
  select.addEventListener('change', () => {
    const saved = roster.find((c) => c.id === select.value);
    setCurrent(saved?.id ?? null);
    if (saved) state = structuredClone(saved.state);
    rosterStatus.textContent = '';
    changed();
  });
  const button = (label: string, onClick: () => void, disabled = false) => {
    const b = h('button', { type: 'button', class: 'chip' }, label);
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  };
  const current = roster.find((c) => c.id === currentId);
  return [
    select,
    button(t('saved.save'), saveCurrent),
    button(t('saved.saveAs'), saveAs),
    button(t('saved.delete'), deleteCurrent, !current),
    button(t('saved.export'), () => download(`${current?.name ?? t('saved.default')}.json`, characterFile({ id: '', name: current?.name ?? t('saved.default'), state }))),
    button(t('saved.import'), () => void importCharacter()),
  ];
}

function chip(label: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed) }, label);
  button.addEventListener('click', onClick);
  return button;
}

function changed(): void {
  version++;
  saveState();
  render();
}

const section = (title: string, ...children: Child[]) => h('section', { class: 'group' }, h('h3', {}, title), ...children);

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
    out.push(h('p', { class: 'note' }, t('beard.note')));
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
  const gender = h('div', { class: 'chips', role: 'group', 'aria-label': t('gender') },
    chip(t('gender.m'), state.frame === 'm', () => {
      state.frame = 'm';
      state.face.lashes = false;
      changed();
    }),
    chip(t('gender.f'), state.frame === 'f', () => {
      state.frame = 'f';
      state.face.lashes = true;
      changed();
    }),
  );
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
  const toggle = (label: string, key: 'blush' | 'freckles' | 'glasses' | 'lashes') => chip(label, face[key], () => {
    face[key] = !face[key];
    changed();
  });
  return [
    options(t('eyes'), 'eyes', EYE_SHAPES),
    swatches(t('eyeColor'), EYE_COLORS, face.eyeColor, (key) => {
      face.eyeColor = key;
      changed();
    }, t('eyeColor.dark')),
    options(t('brows'), 'brows', BROWS),
    section(t('details'), h('div', { class: 'chips' }, toggle(t('blush'), 'blush'), toggle(t('freckles'), 'freckles'), toggle(t('lashes'), 'lashes'), toggle(t('glasses'), 'glasses'))),
    // The frame colour only matters while glasses are worn.
    face.glasses && swatches(t('glassesColor'), GLASSES_COLORS, face.glassesColor ?? 'black', (key) => {
      face.glassesColor = key ?? 'black';
      changed();
    }),
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

function shuffle(): void {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
  const next = defaultState();
  next.skin = pick(SKIN_KEYS);
  next.build = pick(BUILDS).id;
  next.frame = pick(['m', 'f'] as const);
  // The condition is kept, so one can shuffle through neat passengers or through castaways.
  next.wear = state.wear;
  next.mood = state.mood;
  next.face = {
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
  state = next;
  changed();
}

function render(): void {
  stage.style.setProperty('--ground', GROUNDS.find((g) => g.id === state.ground)!.color);

  tabRow.replaceChildren(...TABS.map((id) => {
    const button = h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(id === tab) }, t(`tab.${id}` as Key));
    button.addEventListener('click', () => {
      tab = id;
      render();
    });
    return button;
  }));
  const scroll = panel.scrollTop;
  panel.replaceChildren(...(tab === 'body' ? bodyPanel() : tab === 'face' ? facePanel() : tab === 'hair' ? hairPanel() : slotPanel(tab)));
  panel.scrollTop = scroll;

  wearSlider.value = String(state.wear);
  wearSlider.setAttribute('aria-valuetext', wearName(state.wear));
  wearValue.textContent = wearName(state.wear);
  moodRow.replaceChildren(...MOODS.map((mood) => chip(t(`mood.${mood}` as Key), mood === state.mood, () => {
    state.mood = mood;
    changed();
  })));
  actionRow.replaceChildren(...Object.keys(CLIPS).map((key) => chip(t(`clip.${key}` as Key), key === clipKey, () => {
    clipKey = key;
    render();
  })));
  groundRow.replaceChildren(...GROUNDS.map((g) => chip(t(`ground.${g.id}` as Key), g.id === state.ground, () => {
    state.ground = g.id;
    saveState();
    render();
  })));
  [...facingRow.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === facing)));
  rosterRow.replaceChildren(...rosterControls());
}

/** Builds the page. Called again when the language changes, since every label is rebuilt. */
function mount(): void {
  document.documentElement.lang = currentLang();
  document.title = t('title');
  live.length = 0;
  facingRow.replaceChildren();
  stage.replaceChildren();
  root.replaceChildren();
  facingRow.setAttribute('aria-label', t('facing'));
  actionRow.setAttribute('aria-label', t('action'));
  groundRow.setAttribute('aria-label', t('ground'));
  wearSlider.setAttribute('aria-label', t('wear'));
  moodRow.setAttribute('aria-label', t('mood'));
  tabRow.setAttribute('aria-label', t('sections'));

  FACING_NAMES.forEach((_, i) => {
    const name = t(`facing.${i}` as Key);
    const button = h('button', { type: 'button', class: 'facing', 'aria-pressed': 'false', 'aria-label': t('facing.to', { name }) },
      liveView('sprite sprite--small', () => i as Facing, BODY_WINDOW),
      h('span', {}, name),
    );
    button.addEventListener('click', () => {
      facing = i as Facing;
      render();
    });
    facingRow.append(button);
  });
  stage.append(liveView('sprite sprite--hero', () => facing, HERO));

  const shuffleButton = h('button', { type: 'button', class: 'button button--primary', id: 'shuffle' }, t('shuffle'));
  shuffleButton.addEventListener('click', shuffle);
  const resetButton = h('button', { type: 'button', class: 'button', id: 'reset' }, t('reset'));
  resetButton.addEventListener('click', () => {
    state = defaultState();
    changed();
  });
  const languages = h('div', { class: 'langs', role: 'group', 'aria-label': t('language') },
    ...LANGS.map((l) => {
      const button = h('button', { type: 'button', class: 'lang', 'aria-pressed': String(l.id === currentLang()), lang: l.id, title: l.name }, l.label);
      button.addEventListener('click', () => {
        if (l.id === currentLang()) return;
        setLang(l.id);
        mount();
        render();
      });
      return button;
    }),
  );

  const paintCount = CATALOG.filter((e) => e.format === 'paint').length;
  root.append(
    h('main', { class: 'app' },
      h('header', { class: 'top' },
        h('div', { class: 'top__text' },
          h('a', { class: 'home-link', href: '../' }, t('home')),
          h('h1', {}, t('title')),
          h('p', { class: 'lede' }, t('lede')),
        ),
        h('div', { class: 'top__actions' }, languages, shuffleButton, resetButton),
      ),
      h('section', { class: 'stage', 'aria-label': t('preview') },
        h('div', { class: 'stage__view' }, stage, facingRow),
        h('div', { class: 'row row--slider' }, h('h3', {}, t('wear')), wearSlider, wearValue),
        h('div', { class: 'row' }, h('h3', {}, t('mood')), moodRow),
        h('div', { class: 'row' }, h('h3', {}, t('action')), actionRow),
        h('div', { class: 'row' }, h('h3', {}, t('ground')), groundRow),
        h('div', { class: 'row' }, h('h3', {}, t('saved')), rosterRow),
        rosterStatus,
      ),
      h('section', { class: 'panel', 'aria-label': t('wardrobe') }, tabRow, panel),
      h('footer', { class: 'foot' },
        h('p', {}, t('foot.items', { count: CATALOG.length, paint: paintCount, recipe: CATALOG.length - paintCount })),
        h('p', {}, t('foot.rules')),
        h('p', {}, t('foot.base')),
      ),
    ),
  );
}

// While dragging, only the preview follows; the item pictures are redrawn on release.
wearSlider.addEventListener('input', () => {
  state.wear = Number(wearSlider.value);
  version++;
  wearSlider.setAttribute('aria-valuetext', wearName(state.wear));
  wearValue.textContent = wearName(state.wear);
});
wearSlider.addEventListener('change', changed);

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    facing = ((facing + (event.key === 'ArrowRight' ? 1 : 3)) % 4) as Facing;
    render();
  }
});

if (import.meta.env.DEV) {
  // A new item without a translated name still works; this only points it out while developing.
  for (const l of LANGS) {
    const missing = missingItemNames(CATALOG.map((e) => e.id), l.id);
    if (missing.length) console.error(`No ${l.name} name for: ${missing.join(', ')}`);
  }
}

mount();
render();

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const frame = still ? 0 : Math.floor((ms / 1000) * clip.rate) % clip.frames.length;
  for (const view of live) {
    const at = view.facing();
    const key = `${version}|${clipKey}|${at}|${frame}`;
    if (key === view.shown) continue;
    view.shown = key;
    let sprite = frames.get(key);
    if (!sprite) frames.set(key, (sprite = drawCharacter(look, clip.frames[frame], at, { face: clip.faces?.[frame], swing: clip.swing })));
    paint(view.canvas, sprite, view.crop);
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
document.body.dataset.ready = '1';
