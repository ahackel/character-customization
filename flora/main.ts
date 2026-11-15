import '../wardrobe/style.css';
import './style.css';
import { baseLook, DEFAULT_FACE, facesFor, wear } from '../lab/base.ts';
import { entryById } from '../lab/catalog.ts';
import {
  CATEGORIES, colorChoices, drawPlant, FLORA_H, FLORA_ORIGIN, FLORA_W, FRAMES, grow, plantColors, Raster, recolorPlant, SHADOW, SIZE_MAX, SIZE_MIN, tryPlant,
  type Category, type Grown, type Plant,
} from '../lab/flora.ts';
import {
  generateIsland, hiddenByGround, renderTerrain, surfaceAt, surfaceLevel, toScreen, type HeightMap, type Surface, type TerrainImage,
} from '../lab/terrain.ts';
import { FLORA, FLORA_CALLS, FLORA_REJECTED, plantById, type PlantEntry } from '../lab/flora-catalog.ts';
import { PALETTE, type PaletteKey } from '../lab/palette.ts';
import { AUTHORED } from '../lab/poses.ts';
import { drawCharacter, type Item, type Look, type Sprite } from '../lab/puppet.ts';
import { weathered } from '../lab/wear.ts';
import { currentLang, LANGS, missingPlantNames, plantName, setLang, t, type Key } from './i18n.ts';

// ------------------------------------------------------------------ state

type Tab = 'all' | Category;
const TABS: Tab[] = ['all', ...CATEGORIES];
const WINDS = { calm: 0, breeze: 1, storm: 2.5 } as const;
type Wind = keyof typeof WINDS;
const GROUNDS = [
  { id: 'sand', color: '#e9d9a0', side: '#c9b077' },
  { id: 'grass', color: '#8fcf78', side: '#6c9f55' },
  { id: 'earth', color: '#b98f63', side: '#8d6a47' },
  { id: 'rock', color: '#aeaba3', side: '#86837c' },
] as const;
type Ground = (typeof GROUNDS)[number]['id'];
const DENSITY = { sparse: 12, medium: 24, dense: 40 } as const;
type Density = keyof typeof DENSITY;
const VARIANTS = 4;

interface State {
  selected: string;
  tab: Tab;
  seed: number;
  wind: Wind;
  /** 0 lush to 1 dried out. */
  dryness: number;
  /** Scales the plants: 1 is the size the recipe describes. */
  size: number;
  ground: Ground;
  person: boolean;
  density: Density;
  sceneSeed: number;
  /** Per plant: which of its own colours is replaced by which. */
  colors: Record<string, Partial<Record<PaletteKey, PaletteKey>>>;
  /** Per plant: the recipe as edited here, as text. */
  custom: Record<string, string>;
}

const STORAGE_KEY = 'island-flora';
function defaultState(): State {
  return {
    selected: FLORA.find((e) => e.category === 'palm')?.id ?? FLORA[0]?.id ?? '',
    tab: 'all', seed: 0, wind: 'breeze', dryness: 0, size: 1, ground: 'sand', person: true, density: 'medium', sceneSeed: 1,
    colors: {}, custom: {},
  };
}

function loadState(): State {
  const state = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<State> | null;
    if (!saved) return state;
    if (plantById(saved.selected)) state.selected = saved.selected!;
    if (TABS.includes(saved.tab as Tab)) state.tab = saved.tab!;
    if (Number.isInteger(saved.seed) && saved.seed! >= 0 && saved.seed! < VARIANTS) state.seed = saved.seed!;
    if (saved.wind && saved.wind in WINDS) state.wind = saved.wind;
    if (typeof saved.dryness === 'number' && saved.dryness >= 0 && saved.dryness <= 1) state.dryness = saved.dryness;
    if (typeof saved.size === 'number' && saved.size >= SIZE_MIN && saved.size <= SIZE_MAX) state.size = saved.size;
    if (GROUNDS.some((g) => g.id === saved.ground)) state.ground = saved.ground!;
    if (typeof saved.person === 'boolean') state.person = saved.person;
    if (saved.density && saved.density in DENSITY) state.density = saved.density;
    if (Number.isInteger(saved.sceneSeed)) state.sceneSeed = saved.sceneSeed!;
    for (const [id, swap] of Object.entries(saved.colors ?? {})) {
      const clean = Object.entries(swap ?? {}).filter(([from, to]) => from in PALETTE && to && to in PALETTE);
      if (plantById(id) && clean.length) state.colors[id] = Object.fromEntries(clean);
    }
    for (const [id, text] of Object.entries(saved.custom ?? {})) if (plantById(id) && typeof text === 'string') state.custom[id] = text;
  } catch {
    // Saved settings are a convenience; without storage the page starts from the defaults.
  }
  return state;
}

let state = loadState();
let version = 0;
function saveState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private windows and embedded previews may refuse storage.
  }
}

// ------------------------------------------------------------------ plants

/** The recipe text shown in the editor: compact JSON, short lists kept on one line. */
function pretty(value: unknown, indent = ''): string {
  const flat = (v: unknown): string =>
    Array.isArray(v) ? `[${v.map(flat).join(', ')}]`
      : v && typeof v === 'object' ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${flat(x)}`).join(', ')} }`
        : JSON.stringify(v);
  const one = flat(value);
  if (one.length + indent.length <= 92 || value === null || typeof value !== 'object') return one;
  const inner = indent + '  ';
  if (Array.isArray(value)) return `[\n${value.map((x) => inner + pretty(x, inner)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(',\n')}\n${indent}}`;
}

interface Edited {
  text: string;
  plant: Plant | null;
  message: string;
  kind: 'ok' | 'warn' | 'error';
}
const edits = new Map<string, Edited>();

/** Reads an edited recipe. A broken one keeps the last plant that worked. */
function readRecipe(entry: PlantEntry, text: string): Edited {
  const known = edits.get(entry.id);
  if (known?.text === text) return known;
  let result: Edited;
  try {
    const parsed = tryPlant(JSON.parse(text));
    result = parsed.ok
      ? {
        text, plant: parsed.compiled.plant,
        message: parsed.compiled.repairs.length ? t('recipe.repaired', { list: parsed.compiled.repairs.join('; ') }) : t('recipe.ok'),
        kind: parsed.compiled.repairs.length ? 'warn' : 'ok',
      }
      : { text, plant: known?.plant ?? null, message: t('recipe.error', { error: parsed.error }), kind: 'error' };
  } catch (error) {
    result = { text, plant: known?.plant ?? null, message: t('recipe.json', { error: (error as Error).message }), kind: 'error' };
  }
  edits.set(entry.id, result);
  return result;
}

/** The plant as currently shown: the edited recipe if there is a working one, recoloured. */
function plantOf(entry: PlantEntry): Plant {
  const text = state.custom[entry.id];
  const base = text ? readRecipe(entry, text).plant ?? entry.plant : entry.plant;
  return recolorPlant(base, state.colors[entry.id] ?? {});
}

const grownCache = new Map<string, Grown>();
const rasterCache = new Map<string, Raster>();
const dryStep = (d: number) => Math.round(d * 20) / 20;
const sizeStep = (s: number) => Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(s * 20) / 20));

function grownOf(entry: PlantEntry, seed: number, dryness = state.dryness, size = state.size): { key: string; grown: Grown } {
  const key = `${entry.id}|${seed}|${dryStep(dryness)}|${sizeStep(size)}|${JSON.stringify(state.colors[entry.id] ?? {})}|${state.custom[entry.id] ?? ''}`;
  let grown = grownCache.get(key);
  if (!grown) {
    if (grownCache.size > 400) grownCache.clear();
    grown = grow(plantOf(entry), { seed, dryness: dryStep(dryness), size: sizeStep(size) });
    grownCache.set(key, grown);
  }
  return { key, grown };
}

/** One frame of a plant, on the canvas its size needs (see `canvasFor`). */
function rasterOf(entry: PlantEntry, seed: number, frame: number, wind: number, dryness = state.dryness, size = state.size): Raster {
  const { key, grown } = grownOf(entry, seed, dryness, size);
  const at = wind ? frame : 0;
  const full = `${key}|${wind}|${at}`;
  let raster = rasterCache.get(full);
  if (!raster) {
    if (rasterCache.size > 800) rasterCache.clear();
    raster = drawPlant(grown, { frame: at, wind });
    rasterCache.set(full, raster);
  }
  return raster;
}

// ------------------------------------------------------------------ the survivor, for scale

function survivorLook(): Look {
  const items: Item[] = ['recipe-everyday-0', 'sprite-everyday-bottoms-0', 'sprite-hat-2']
    .map((id) => entryById(id)?.item)
    .filter((i): i is Item => !!i)
    .map((i) => weathered(i, 2));
  const look = wear(baseLook('skinC', 'hairBlack'), ...items);
  return { ...look, faces: facesFor('skinC', DEFAULT_FACE, 'hairBlack', 'happy'), items: look.items.map((i) => weathered(i, 2)) };
}
const SURVIVOR = survivorLook();
const survivorFrames = new Map<number, Sprite>();
function survivorAt(ms: number): Sprite {
  const clip = AUTHORED.idle;
  const i = Math.floor((ms / 1000) * clip.rate) % clip.frames.length;
  let sprite = survivorFrames.get(i);
  if (!sprite) survivorFrames.set(i, (sprite = drawCharacter(SURVIVOR, clip.frames[i], 0, { face: clip.faces?.[i] })));
  return sprite;
}
/** The pixel in a character sprite that stands on the ground. */
const FEET = { x: 32, y: 52 };

// ------------------------------------------------------------------ painting

const rgbaOf = (hex: string): [number, number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
  hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255,
];

/** Lays a colour over a pixel of an image, blending the see-through shadow colour. */
function blend(image: ImageData, x: number, y: number, hex: string): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const [r, g, b, a] = rgbaOf(hex);
  const o = (y * image.width + x) * 4;
  const d = image.data;
  if (a === 255 || d[o + 3] === 0) {
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = Math.max(a, d[o + 3]);
    return;
  }
  const k = a / 255;
  d[o] = Math.round(r * k + d[o] * (1 - k));
  d[o + 1] = Math.round(g * k + d[o + 1] * (1 - k));
  d[o + 2] = Math.round(b * k + d[o + 2] * (1 - k));
}

type Picture = { get(x: number, y: number): string | null; shaded?(x: number, y: number): boolean };

/** Paints a picture's pixels, leaving out its ground shadow; `hide` can veto single pixels. */
function stamp(image: ImageData, raster: Picture, w: number, h: number, dx: number, dy: number, under = false, hide?: (x: number, y: number) => boolean): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hex = raster.get(x, y);
      if (!hex || hex === SHADOW) continue;
      if (hide?.(x + dx, y + dy)) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (under && tx >= 0 && ty >= 0 && tx < image.width && ty < image.height && image.data[(ty * image.width + tx) * 4 + 3] === 255) continue;
      blend(image, tx, ty, hex);
    }
  }
}

/**
 * Ground shadows are collected in one mask first and laid on the ground once, so where two
 * shadows overlap the ground is not darkened twice. Character sprites carry their shadow as
 * pixels of the shadow colour; plants keep it in a separate layer.
 */
function castShadow(mask: Uint8Array, mw: number, mh: number, pic: Picture, w: number, h: number, dx: number, dy: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!(pic.shaded?.(x, y) || pic.get(x, y) === SHADOW)) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < mw && ty < mh) mask[ty * mw + tx] = 1;
    }
  }
}
function layShadow(image: ImageData, mask: Uint8Array): void {
  for (let p = 0; p < mask.length; p++) if (mask[p]) blend(image, p % image.width, Math.floor(p / image.width), SHADOW);
}

/** A picture of one plant, cropped to what it paints and fitted to a box. */
function thumb(raster: Raster, box: number): HTMLCanvasElement {
  let x0 = raster.w, y0 = raster.h, x1 = 0, y1 = 0;
  for (let y = 0; y < raster.h; y++) for (let x = 0; x < raster.w; x++) {
    if (!raster.get(x, y) && !raster.shaded(x, y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const w = Math.max(1, x1 - x0 + 1);
  const hgt = Math.max(1, y1 - y0 + 1);
  const canvas = h('canvas', { class: 'thumb', width: String(w), height: String(hgt) });
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, hgt);
  const mask = new Uint8Array(w * hgt);
  castShadow(mask, w, hgt, raster, raster.w, raster.h, -x0, -y0);
  layShadow(image, mask);
  stamp(image, raster, raster.w, raster.h, -x0, -y0);
  ctx.putImageData(image, 0, 0);
  // Whole-number enlargements where they fit; large plants are shown smaller than life.
  const scale = Math.min(4, box / Math.max(w, hgt));
  const fitted = scale >= 1 ? Math.floor(scale) : scale;
  canvas.style.width = `${Math.round(w * fitted)}px`;
  canvas.style.height = `${Math.round(hgt * fitted)}px`;
  return canvas;
}

// ------------------------------------------------------------------ interface helpers

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

function chip(label: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed) }, label);
  button.addEventListener('click', onClick);
  return button;
}
const section = (title: string, ...children: Child[]) => h('section', { class: 'group' }, h('h3', {}, title), ...children);

function changed(): void {
  version++;
  saveState();
  render();
}

const selectedEntry = () => plantById(state.selected) ?? FLORA[0];

// ------------------------------------------------------------------ page

const root = document.getElementById('flora')!;
const SCENE_W = 16 * 32;
const SCENE_H = 318;
const stage = h('div', { class: 'stage__ground flora-stage' });
const preview = h('canvas', { class: 'flora-preview', width: String(FLORA_W), height: String(FLORA_H) });
const variantRow = h('div', { class: 'variants', role: 'group' });
const windRow = h('div', { class: 'chips', role: 'group' });
const groundRow = h('div', { class: 'chips', role: 'group' });
const personRow = h('div', { class: 'chips' });
const drySlider = h('input', { type: 'range', class: 'slider', min: '0', max: '1', step: '0.05' });
const dryValue = h('output', { class: 'slider__value' });
const sizeSlider = h('input', { type: 'range', class: 'slider', min: String(SIZE_MIN), max: String(SIZE_MAX), step: '0.05' });
const sizeValue = h('output', { class: 'slider__value' });
const tabRow = h('nav', { class: 'tabs', role: 'tablist' });
const grid = h('div', { class: 'grid' });
const colorBox = h('div', { class: 'panel__body' });
const editor = h('section', { class: 'recipe' });
const sceneCanvas = h('canvas', { class: 'scene__canvas', width: String(SCENE_W), height: String(SCENE_H) });
const sceneControls = h('div', { class: 'row' });
const variantCanvases: HTMLCanvasElement[] = [];
const cardPictures = new Map<string, HTMLElement>();
let editorFor = '';

const dryName = (d: number) => t(`dry.${Math.round(d * 2)}` as Key);
const sizeName = (s: number) => `${Math.round(sizeStep(s) * 100)}%`;

function renderCards(): void {
  cardPictures.clear();
  const entries = FLORA.filter((e) => state.tab === 'all' || e.category === state.tab);
  grid.replaceChildren(...entries.map((entry) => {
    const picture = h('span', { class: 'card__picture' }, thumb(rasterOf(entry, 0, 0, 0, state.dryness, 1), 60));
    cardPictures.set(entry.id, picture);
    const label = plantName(entry.id, entry.label);
    const button = h('button', { type: 'button', class: 'card', 'aria-pressed': String(entry.id === state.selected) },
      picture,
      h('span', { class: 'card__label' }, label),
      state.custom[entry.id] ? h('span', { class: 'card__note' }, t('recipe.edited')) : null,
    );
    button.addEventListener('click', () => {
      state.selected = entry.id;
      state.seed = 0;
      changed();
    });
    return button;
  }));
}

function renderColors(): void {
  const entry = selectedEntry();
  const own = plantColors(entry.plant);
  colorBox.replaceChildren(...own.map((from, i) => {
    // Only colours of the same kind: greens for leaves, woods for wood, stones for stone.
    const keys = colorChoices(from, entry.category).slice(1);
    const row = h('div', { class: 'swatches' });
    const title = i === 0 ? t('color.main') : t('color.second');
    const current = state.colors[entry.id]?.[from] ?? null;
    for (const key of [null, ...keys]) {
      const name = key ? t(`palette.${key}` as Key) : t('color.original');
      const button = h('button', {
        type: 'button', class: key === null ? 'swatch swatch--own' : 'swatch', 'aria-pressed': String(key === current),
        'aria-label': `${title}: ${name}`, title: name,
        style: key ? `--swatch: ${PALETTE[key].base}; --swatch-shade: ${PALETTE[key].shade}` : '',
      }, key === null ? t('color.original') : null);
      button.addEventListener('click', () => {
        const next = { ...state.colors[entry.id] };
        if (key) next[from] = key;
        else delete next[from];
        state.colors[entry.id] = next;
        changed();
      });
      row.append(button);
    }
    return section(title, row);
  }));
}

function renderEditor(): void {
  const entry = selectedEntry();
  if (editorFor === entry.id && editor.childElementCount) return;
  editorFor = entry.id;
  const text = state.custom[entry.id] ?? pretty(entry.raw);
  const area = h('textarea', { class: 'recipe__text', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': t('recipe'), rows: '16' });
  area.value = text;
  const status = h('p', { class: 'recipe__status', role: 'status' });
  const show = (edited: Edited | null) => {
    status.textContent = edited ? edited.message : t('recipe.ok');
    status.dataset.kind = edited?.kind ?? 'ok';
  };
  show(state.custom[entry.id] ? readRecipe(entry, state.custom[entry.id]) : null);
  let timer = 0;
  area.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const value = area.value;
      if (value.trim() === pretty(entry.raw).trim()) delete state.custom[entry.id];
      else state.custom[entry.id] = value;
      const edited = state.custom[entry.id] ? readRecipe(entry, value) : null;
      show(edited);
      version++;
      saveState();
      // Only the pictures change, so typing is not interrupted.
      cardPictures.get(entry.id)?.replaceChildren(thumb(rasterOf(entry, 0, 0, 0, state.dryness, 1), 60));
    }, 250);
  });
  const reset = h('button', { type: 'button', class: 'chip' }, t('recipe.reset'));
  reset.addEventListener('click', () => {
    delete state.custom[entry.id];
    edits.delete(entry.id);
    editorFor = '';
    changed();
  });
  const copy = h('button', { type: 'button', class: 'chip' }, t('recipe.copy'));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(area.value);
      copy.textContent = t('recipe.copied');
      setTimeout(() => (copy.textContent = t('recipe.copy')), 1500);
    } catch {
      area.select();
    }
  });
  editor.replaceChildren(
    h('h3', {}, t('recipe')),
    h('p', { class: 'note' }, t('recipe.note')),
    area,
    status,
    h('div', { class: 'chips' }, reset, copy),
  );
}

function render(): void {
  const ground = GROUNDS.find((g) => g.id === state.ground)!;
  stage.style.setProperty('--ground', ground.color);
  const entry = selectedEntry();

  tabRow.replaceChildren(...TABS.map((id) => {
    const button = h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(id === state.tab) }, t(`cat.${id}` as Key));
    button.addEventListener('click', () => {
      state.tab = id;
      state.sceneSeed++;
      // The preview follows the group: its first plant, unless the current one belongs to it.
      if (id !== 'all' && selectedEntry().category !== id) {
        state.selected = FLORA.find((e) => e.category === id)?.id ?? state.selected;
        state.seed = 0;
      }
      changed();
    });
    return button;
  }));
  renderCards();
  renderColors();
  renderEditor();

  variantRow.replaceChildren();
  variantCanvases.length = 0;
  for (let seed = 0; seed < VARIANTS; seed++) {
    const canvas = thumb(rasterOf(entry, seed, 0, 0), 56);
    variantCanvases.push(canvas);
    const button = h('button', { type: 'button', class: 'variant', 'aria-pressed': String(seed === state.seed), 'aria-label': t('variant.n', { n: seed + 1 }) }, canvas);
    button.addEventListener('click', () => {
      state.seed = seed;
      changed();
    });
    variantRow.append(button);
  }
  windRow.replaceChildren(...(Object.keys(WINDS) as Wind[]).map((w) => chip(t(`wind.${w}` as Key), w === state.wind, () => {
    state.wind = w;
    changed();
  })));
  groundRow.replaceChildren(...GROUNDS.map((g) => chip(t(`ground.${g.id}` as Key), g.id === state.ground, () => {
    state.ground = g.id;
    changed();
  })));
  personRow.replaceChildren(chip(t('person'), state.person, () => {
    state.person = !state.person;
    changed();
  }));
  drySlider.value = String(state.dryness);
  drySlider.setAttribute('aria-valuetext', dryName(state.dryness));
  dryValue.textContent = dryName(state.dryness);
  sizeSlider.value = String(state.size);
  sizeSlider.setAttribute('aria-valuetext', sizeName(state.size));
  sizeValue.textContent = sizeName(state.size);
  sceneControls.replaceChildren(
    h('h3', {}, t('density')),
    h('div', { class: 'chips' }, ...(Object.keys(DENSITY) as Density[]).map((d) => chip(t(`density.${d}` as Key), d === state.density, () => {
      state.density = d;
      changed();
    }))),
  );
}

function mount(): void {
  document.documentElement.lang = currentLang();
  document.title = t('title');
  editorFor = '';
  root.replaceChildren();
  stage.replaceChildren(preview);
  variantRow.setAttribute('aria-label', t('variant'));
  windRow.setAttribute('aria-label', t('wind'));
  groundRow.setAttribute('aria-label', t('ground'));
  drySlider.setAttribute('aria-label', t('dryness'));
  sizeSlider.setAttribute('aria-label', t('size'));
  tabRow.setAttribute('aria-label', t('sections'));

  const languages = h('div', { class: 'langs', role: 'group', 'aria-label': t('language') },
    ...LANGS.map((l) => {
      const button = h('button', { type: 'button', class: 'lang', 'aria-pressed': String(l.id === currentLang()), lang: l.id, title: l.name }, l.label);
      button.addEventListener('click', () => {
        if (l.id === currentLang()) return;
        setLang(l.id);
        edits.clear();
        mount();
        render();
      });
      return button;
    }),
  );
  const again = h('button', { type: 'button', class: 'button button--primary' }, t('scene.again'));
  again.addEventListener('click', () => {
    state.sceneSeed++;
    saveState();
  });

  const total = FLORA.length + FLORA_REJECTED.length;
  const repaired = FLORA.filter((e) => e.repairs.length).length;
  root.append(
    h('main', { class: 'app' },
      h('header', { class: 'top' },
        h('div', { class: 'top__text' }, h('h1', {}, t('title')), h('p', { class: 'lede' }, t('lede'))),
        h('div', { class: 'top__actions' }, languages),
      ),
      h('section', { class: 'stage', 'aria-label': t('preview') },
        h('div', { class: 'stage__view flora-view' }, stage, variantRow),
        h('div', { class: 'row row--slider' }, h('h3', {}, t('size')), sizeSlider, sizeValue),
        h('div', { class: 'row row--slider' }, h('h3', {}, t('dryness')), drySlider, dryValue),
        h('div', { class: 'row' }, h('h3', {}, t('wind')), windRow),
        h('div', { class: 'row' }, h('h3', {}, t('ground')), groundRow),
        personRow,
      ),
      h('section', { class: 'panel', 'aria-label': t('plants') }, tabRow, grid, colorBox, editor),
      h('section', { class: 'scene', 'aria-label': t('scene') },
        h('div', { class: 'scene__head' }, h('div', {}, h('h2', {}, t('scene')), h('p', { class: 'lede' }, t('scene.note'))), again),
        h('div', { class: 'scene__frame' }, sceneCanvas),
        sceneControls,
      ),
      h('footer', { class: 'foot' },
        h('p', {}, t('foot.items', {
          count: FLORA.length, calls: FLORA_CALLS, valid: FLORA.length - repaired, total,
          repaired: repaired ? t('foot.repaired', { n: repaired }) : '',
        })),
        h('p', {}, t('foot.rules')),
      ),
    ),
  );
}

drySlider.addEventListener('input', () => {
  state.dryness = Number(drySlider.value);
  drySlider.setAttribute('aria-valuetext', dryName(state.dryness));
  dryValue.textContent = dryName(state.dryness);
  version++;
});
drySlider.addEventListener('change', changed);
sizeSlider.addEventListener('input', () => {
  state.size = sizeStep(Number(sizeSlider.value));
  sizeSlider.setAttribute('aria-valuetext', sizeName(state.size));
  sizeValue.textContent = sizeName(state.size);
  version++;
});
sizeSlider.addEventListener('change', changed);

// ------------------------------------------------------------------ the island scene

/** The island: a 16 by 16 metre height map, drawn on a canvas that just holds it. */
const ISLAND = { cells: 16 };
const SCENE = { w: ISLAND.cells * 32, h: 318, origin: { x: ISLAND.cells * 16, y: 46 } };

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where each group grows. Rocks may stand in the shallows; driftwood only lies on the beach. */
const HOMES: Record<Category, Surface[]> = {
  palm: ['beach', 'sand', 'grass'],
  grass: ['sand', 'grass'],
  cactus: ['sand', 'rock'],
  jungle: ['grass'],
  rock: ['shallow', 'beach', 'sand', 'grass', 'rock'],
  driftwood: ['beach'],
};
/** Room each needs round it, in metres. */
const ROOM: Record<Category, number> = { palm: 1.3, cactus: 0.8, jungle: 1.1, grass: 0.5, rock: 0.9, driftwood: 1.1 };

let island: { seed: number; map: HeightMap; image: TerrainImage } | null = null;
function islandOf(seed: number): { map: HeightMap; image: TerrainImage } {
  if (island?.seed === seed) return island;
  const map = generateIsland(seed, ISLAND.cells, ISLAND.cells, { land: 0.85 });
  island = { seed, map, image: renderTerrain(map, SCENE) };
  return island;
}

/** Standing somewhere on the map: `i`, `j` in metres, on the ground of that cell. */
interface Spot { i: number; j: number; level: number }
/** `scale` varies each plant's size around the chosen one, the way plants of one kind differ. */
interface Placed extends Spot { entry: PlantEntry; seed: number; scale: number }
let layoutKey = '';
let placed: Placed[] = [];
let survivorSpot: Spot = { i: 7, j: 7, level: 1 };

/** Where things stand: each on ground it belongs on, clear of the others and of the survivor. */
function layout(): Placed[] {
  const pool = FLORA.filter((e) => state.tab === 'all' || e.category === state.tab);
  const key = `${state.sceneSeed}|${state.tab}|${state.density}|${pool.length}`;
  if (key === layoutKey) return placed;
  layoutKey = key;
  const { map } = islandOf(state.sceneSeed);
  const n = ISLAND.cells;
  const cells = new Map<Surface, [number, number][]>();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const s = surfaceAt(map, i, j);
    cells.set(s, [...(cells.get(s) ?? []), [i, j]]);
  }
  // The survivor stands on the dry land nearest the middle.
  const dry = [...(cells.get('sand') ?? []), ...(cells.get('grass') ?? [])];
  const middle = dry.sort((a, b) => Math.hypot(a[0] - n / 2, a[1] - n / 2) - Math.hypot(b[0] - n / 2, b[1] - n / 2))[0] ?? [n / 2, n / 2];
  survivorSpot = { i: middle[0] + 0.5, j: middle[1] + 0.5, level: surfaceLevel(map, middle[0], middle[1]) };

  const random = rng(state.sceneSeed * 7919 + pool.length);
  // Grass is common, so it is picked more often when every group is shown.
  const weighted = pool.flatMap((e) => (state.tab === 'all' && e.category === 'grass' ? [e, e, e] : [e]));
  const out: Placed[] = [];
  for (let tries = 0; out.length < DENSITY[state.density] && tries < 800 && weighted.length; tries++) {
    const entry = weighted[Math.floor(random() * weighted.length)];
    const homes = HOMES[entry.category].flatMap((s) => cells.get(s) ?? []);
    if (!homes.length) continue;
    const [ci, cj] = homes[Math.floor(random() * homes.length)];
    const i = ci + 0.2 + random() * 0.6;
    const j = cj + 0.2 + random() * 0.6;
    const r = ROOM[entry.category];
    const near = Math.hypot(i - survivorSpot.i, j - survivorSpot.j);
    if (near < 0.9 + r * 0.5) continue;
    // Nothing tall right in front of the survivor, or it would hide them.
    const tall = entry.category === 'palm' || entry.category === 'jungle' || entry.category === 'cactus';
    if (tall && i + j > survivorSpot.i + survivorSpot.j && near < 3) continue;
    if (out.some((p) => Math.hypot(p.i - i, p.j - j) < (ROOM[p.entry.category] + r) * 0.6)) continue;
    out.push({ entry, seed: Math.floor(random() * 8), scale: 0.8 + random() * 0.4, i, j, level: surfaceLevel(map, ci, cj) });
  }
  placed = out;
  return placed;
}

function drawScene(ms: number, frame: number): void {
  const ctx = sceneCanvas.getContext('2d')!;
  const { map, image: ground } = islandOf(state.sceneSeed);
  const image = new ImageData(new Uint8ClampedArray(ground.rgba), ground.w, ground.h);
  const wind = WINDS[state.wind];
  const at = (spot: Spot) => {
    const p = toScreen(spot.i, spot.j, spot.level);
    return { x: Math.round(ground.origin.x + p.x), y: Math.round(ground.origin.y + p.y) };
  };
  const things: { spot: Spot; picture: Picture; w: number; h: number; dx: number; dy: number }[] = layout().map((p) => {
    const raster = rasterOf(p.entry, p.seed, frame, wind, state.dryness, sizeStep(state.size * p.scale));
    const foot = at(p);
    return { spot: p, picture: raster, w: raster.w, h: raster.h, dx: foot.x - raster.origin.x, dy: foot.y - raster.origin.y };
  });
  const feet = at(survivorSpot);
  things.push({ spot: survivorSpot, picture: survivorAt(ms), w: 64, h: 64, dx: feet.x - FEET.x, dy: feet.y - FEET.y });
  // Shadows first, all together, then everything back to front; higher ground in front covers it.
  const mask = new Uint8Array(image.width * image.height);
  for (const t of things) castShadow(mask, image.width, image.height, t.picture, t.w, t.h, t.dx, t.dy);
  layShadow(image, mask);
  things.sort((a, b) => a.spot.i + a.spot.j - (b.spot.i + b.spot.j));
  for (const t of things) {
    stamp(image, t.picture, t.w, t.h, t.dx, t.dy, false, (x, y) => hiddenByGround(map, ground, x, y, t.spot.i, t.spot.j));
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * The part of the world the preview shows. It is drawn at twice the size while the plant fits the
 * standard canvas, and at its own size, showing twice as much, when the plant is grown too large
 * for that. Whole-number enlargement keeps the pixels square.
 */
const fitCache = new Map<string, boolean>();
function previewWindow(entry: PlantEntry): { w: number; h: number; origin: { x: number; y: number } } {
  const { key } = grownOf(entry, state.seed);
  let fits = fitCache.get(key);
  if (fits === undefined) {
    const calm = rasterOf(entry, state.seed, 0, 0);
    const { origin } = calm;
    // Room left for the plant to sway in a storm.
    const margin = 4;
    fits = true;
    for (let y = 0; y < calm.h && fits; y++) for (let x = 0; x < calm.w; x++) {
      if (!calm.get(x, y)) continue;
      const dx = x - origin.x;
      const dy = y - origin.y;
      if (Math.abs(dx) > FLORA_ORIGIN.x - margin || -dy > FLORA_ORIGIN.y - margin || dy >= FLORA_H - FLORA_ORIGIN.y) { fits = false; break; }
    }
    if (fitCache.size > 400) fitCache.clear();
    fitCache.set(key, fits);
  }
  return fits
    ? { w: FLORA_W, h: FLORA_H, origin: FLORA_ORIGIN }
    : { w: FLORA_W * 2, h: FLORA_H * 2, origin: { x: FLORA_W, y: FLORA_H * 2 - (FLORA_H - FLORA_ORIGIN.y) } };
}

function drawPreview(ms: number, frame: number): void {
  const entry = selectedEntry();
  const view = previewWindow(entry);
  if (preview.width !== view.w) {
    preview.width = view.w;
    preview.height = view.h;
  }
  const ctx = preview.getContext('2d')!;
  const image = ctx.createImageData(view.w, view.h);
  const raster = rasterOf(entry, state.seed, frame, WINDS[state.wind]);
  const { origin } = raster;
  const dx = view.origin.x - origin.x;
  const dy = view.origin.y - origin.y;
  // The survivor stands a little in front and to the left, and is never hidden by the plant.
  const person = { x: view.origin.x - 30 - FEET.x, y: view.origin.y + 4 - FEET.y };
  const mask = new Uint8Array(view.w * view.h);
  castShadow(mask, view.w, view.h, raster, raster.w, raster.h, dx, dy);
  if (state.person) castShadow(mask, view.w, view.h, survivorAt(ms), 64, 64, person.x, person.y);
  layShadow(image, mask);
  stamp(image, raster, raster.w, raster.h, dx, dy);
  if (state.person) stamp(image, survivorAt(ms), 64, 64, person.x, person.y);
  ctx.putImageData(image, 0, 0);
}

function fitScene(): void {
  const width = sceneCanvas.parentElement?.clientWidth ?? SCENE.w;
  const scale = Math.max(1, Math.min(2, Math.floor(width / SCENE.w)));
  sceneCanvas.style.width = `${SCENE.w * scale}px`;
  // Narrower screens shrink it; the height follows so the pixels keep their shape.
  sceneCanvas.style.height = 'auto';
}

if (import.meta.env.DEV) {
  const missing = missingPlantNames(FLORA.map((e) => e.id));
  if (missing.length) console.error(`No German name for: ${missing.join(', ')}`);
  if (FLORA_REJECTED.length) console.error('Rejected plants:', FLORA_REJECTED);
}

mount();
render();
fitScene();
window.addEventListener('resize', fitScene);

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let shown = '';
const tick = (ms: number) => {
  const frame = still || state.wind === 'calm' ? 0 : Math.floor((ms / 1000) * 6) % FRAMES;
  const blink = Math.floor((ms / 1000) * AUTHORED.idle.rate) % AUTHORED.idle.frames.length;
  const key = `${version}|${frame}|${blink}|${state.sceneSeed}|${state.seed}|${state.selected}|${state.person}|${currentLang()}`;
  if (key !== shown) {
    shown = key;
    drawPreview(ms, frame);
    drawScene(ms, frame);
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
document.body.dataset.ready = '1';
