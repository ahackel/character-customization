import '../wardrobe/style.css';
import './style.css';
import { baseLook, DEFAULT_FACE, facesFor, wear } from '../lab/base.ts';
import { entryById } from '../lab/catalog.ts';
import {
  canvasFor, CATEGORIES, drawPlant, FLORA_H, FLORA_ORIGIN, FLORA_W, FRAMES, grow, plantColors, Raster, recolorPlant, SIZE_MAX, SIZE_MIN, tryPlant,
  type Category, type Grown, type Plant,
} from '../lab/flora.ts';
import { FLORA, FLORA_CALLS, FLORA_REJECTED, plantById, type PlantEntry } from '../lab/flora-catalog.ts';
import { PALETTE, PALETTE_KEYS, SKIN_KEYS, type PaletteKey } from '../lab/palette.ts';
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
const DENSITY = { sparse: 7, medium: 14, dense: 24 } as const;
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

function stamp(image: ImageData, raster: { get(x: number, y: number): string | null }, w: number, h: number, dx: number, dy: number, under = false): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hex = raster.get(x, y);
      if (!hex) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (under && tx >= 0 && ty >= 0 && tx < image.width && ty < image.height && image.data[(ty * image.width + tx) * 4 + 3] === 255) continue;
      blend(image, tx, ty, hex);
    }
  }
}

/** A picture of one plant, cropped to what it paints and fitted to a box. */
function thumb(raster: Raster, box: number): HTMLCanvasElement {
  let x0 = raster.w, y0 = raster.h, x1 = 0, y1 = 0;
  for (let y = 0; y < raster.h; y++) for (let x = 0; x < raster.w; x++) {
    if (!raster.get(x, y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const w = Math.max(1, x1 - x0 + 1);
  const hgt = Math.max(1, y1 - y0 + 1);
  const canvas = h('canvas', { class: 'thumb', width: String(w), height: String(hgt) });
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, hgt);
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
const sceneCanvas = h('canvas', { class: 'scene__canvas', width: '320', height: '232' });
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
  const keys = PALETTE_KEYS.filter((k) => !SKIN_KEYS.includes(k) && !k.startsWith('hair') && !['ink', 'mouth', 'tooth', 'blush'].includes(k));
  colorBox.replaceChildren(...own.map((from, i) => {
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

const SCENE = { w: 320, h: 232, tiles: 7, tw: 32, th: 16, cx: 160, top: 100 };

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** `scale` varies each plant's size around the chosen one, the way plants of one kind differ. */
interface Placed { entry: PlantEntry; seed: number; scale: number; x: number; y: number }
let layoutKey = '';
let placed: Placed[] = [];

/** Where plants stand: scattered over the island, clear of each other and of the survivor. */
function layout(): Placed[] {
  const pool = FLORA.filter((e) => state.tab === 'all' || e.category === state.tab);
  const key = `${state.sceneSeed}|${state.tab}|${state.density}|${pool.length}`;
  if (key === layoutKey) return placed;
  layoutKey = key;
  const random = rng(state.sceneSeed * 7919 + pool.length);
  const room = { palm: 1.4, cactus: 0.8, jungle: 1.1, grass: 0.45 } as const;
  // Grass is common, so it is picked more often when every group is shown.
  const weighted = pool.flatMap((e) => (state.tab === 'all' && e.category === 'grass' ? [e, e, e] : [e]));
  const out: (Placed & { i: number; j: number; r: number })[] = [];
  const n = SCENE.tiles;
  for (let tries = 0; out.length < DENSITY[state.density] && tries < 600 && weighted.length; tries++) {
    const entry = weighted[Math.floor(random() * weighted.length)];
    const i = 0.4 + random() * (n - 0.8);
    const j = 0.4 + random() * (n - 0.8);
    const r = room[entry.category];
    if (Math.hypot(i - n / 2, j - n / 2) < 1.1 + r * 0.5) continue;
    if (out.some((p) => Math.hypot(p.i - i, p.j - j) < (p.r + r) * 0.75)) continue;
    out.push({ entry, seed: Math.floor(random() * 8), scale: 0.8 + random() * 0.4, i, j, r, x: Math.round(SCENE.cx + (i - j) * (SCENE.tw / 2)), y: Math.round(SCENE.top + (i + j) * (SCENE.th / 2)) });
  }
  placed = out;
  return placed;
}

let groundImage: ImageData | null = null;
let groundKey = '';
function groundOf(ctx: CanvasRenderingContext2D): ImageData {
  if (groundImage && groundKey === state.ground) return groundImage;
  groundKey = state.ground;
  const g = GROUNDS.find((x) => x.id === state.ground)!;
  const image = ctx.createImageData(SCENE.w, SCENE.h);
  const sea = rgbaOf('#7fd6d0');
  const foam = '#e8fbf6';
  for (let i = 0; i < image.data.length; i += 4) { image.data[i] = sea[0]; image.data[i + 1] = sea[1]; image.data[i + 2] = sea[2]; image.data[i + 3] = 255; }
  // A few short wave lines on the water.
  const waves = rng(11);
  for (let k = 0; k < 40; k++) {
    const x = Math.floor(waves() * SCENE.w);
    const y = Math.floor(waves() * SCENE.h);
    for (let d = 0; d < 4; d++) blend(image, x + d, y, '#a6e6df');
  }
  const n = SCENE.tiles;
  const half = { w: (n * SCENE.tw) / 2, h: (n * SCENE.th) / 2 };
  const cy = SCENE.top + half.h;
  const inside = (x: number, y: number) => Math.abs(x + 0.5 - SCENE.cx) / half.w + Math.abs(y + 0.5 - cy) / half.h <= 1;
  for (let y = 0; y < SCENE.h; y++) {
    for (let x = 0; x < SCENE.w; x++) {
      if (inside(x, y)) {
        // Tiles alternate faintly, so the 2:1 grid shows.
        const u = (x - SCENE.cx) / SCENE.tw + (y - SCENE.top) / SCENE.th;
        const v = (y - SCENE.top) / SCENE.th - (x - SCENE.cx) / SCENE.tw;
        const odd = (Math.floor(u) + Math.floor(v)) % 2 === 0;
        blend(image, x, y, g.color);
        if (odd) blend(image, x, y, '#ffffff14');
      } else if (inside(x, y - 1) || inside(x, y - 2) || inside(x, y - 3) || inside(x, y - 4) || inside(x, y - 5)) {
        // The island's edge, below its two front sides, then a line of foam.
        if (y > cy) blend(image, x, y, g.side);
      } else if (y > cy && (inside(x, y - 6) || inside(x, y - 7))) {
        blend(image, x, y, foam);
      }
    }
  }
  groundImage = image;
  return image;
}

function drawScene(ms: number, frame: number): void {
  const ctx = sceneCanvas.getContext('2d')!;
  const base = groundOf(ctx);
  const image = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  const wind = WINDS[state.wind];
  const people = { x: SCENE.cx, y: SCENE.top + (SCENE.tiles * SCENE.th) / 2 };
  const things: { y: number; draw: () => void }[] = layout().map((p) => ({
    y: p.y,
    draw: () => {
      const size = sizeStep(state.size * p.scale);
      const raster = rasterOf(p.entry, p.seed, frame, wind, state.dryness, size);
      const { origin } = canvasFor(size);
      stamp(image, raster, raster.w, raster.h, p.x - origin.x, p.y - origin.y);
    },
  }));
  things.push({ y: people.y, draw: () => stamp(image, survivorAt(ms), 64, 64, people.x - FEET.x, people.y - FEET.y) });
  things.sort((a, b) => a.y - b.y);
  for (const thing of things) thing.draw();
  ctx.putImageData(image, 0, 0);
}

/**
 * The part of the world the preview shows. It is drawn at twice the size while the plant fits the
 * standard canvas, and at its own size, showing twice as much, when the plant is grown too large
 * for that. Whole-number enlargement keeps the pixels square.
 */
const fitCache = new Map<string, boolean>();
function previewWindow(entry: PlantEntry): { w: number; h: number; origin: { x: number; y: number } } {
  const { key, grown } = grownOf(entry, state.seed);
  let fits = fitCache.get(key);
  if (fits === undefined) {
    const calm = rasterOf(entry, state.seed, 0, 0);
    const { origin } = canvasFor(grown.size);
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
  const { origin } = canvasFor(sizeStep(state.size));
  stamp(image, raster, raster.w, raster.h, view.origin.x - origin.x, view.origin.y - origin.y);
  // The survivor stands a little in front and to the left, and is never hidden by the plant.
  if (state.person) stamp(image, survivorAt(ms), 64, 64, view.origin.x - 30 - FEET.x, view.origin.y + 4 - FEET.y);
  ctx.putImageData(image, 0, 0);
}

function fitScene(): void {
  const width = sceneCanvas.parentElement?.clientWidth ?? SCENE.w;
  const scale = Math.max(1, Math.min(2, Math.floor(width / SCENE.w)));
  sceneCanvas.style.width = `${SCENE.w * scale}px`;
  sceneCanvas.style.height = `${SCENE.h * scale}px`;
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
