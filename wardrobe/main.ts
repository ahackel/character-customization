import './style.css';
import { facesFor, headFor, HAIR_STYLES, UNDERSHORTS } from '../lab/base.ts';
import { CATALOG, CLOTH_KEYS, entryById, recolor, type Entry } from '../lab/catalog.ts';
import { HAIR_KEYS, PALETTE, SKIN_KEYS, type PaletteKey } from '../lab/palette.ts';
import { AUTHORED, STAND, clipsFromSamples, type Clip, type SampledFrame } from '../lab/poses.ts';
import { BUILDS, drawCharacter, FACING_NAMES, SPRITE_H, SPRITE_W, type Facing, type Item, type Look, type Slot } from '../lab/puppet.ts';
import sampledData from '../lab/generated/poses3d.json';

// ------------------------------------------------------------------ state

type WornSlot = Exclude<Slot, 'hair'>;
const WORN_SLOTS: WornSlot[] = ['top', 'bottom', 'shoes', 'hat', 'beard', 'tool'];
type TabId = 'body' | 'hair' | WornSlot;
const TABS: { id: TabId; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'hair', label: 'Hair' },
  { id: 'beard', label: 'Beard' },
  { id: 'hat', label: 'Hat' },
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'tool', label: 'Tool' },
];

interface State {
  skin: PaletteKey;
  build: string;
  hair: string | null;
  hairColor: PaletteKey;
  worn: Record<WornSlot, string | null>;
  /** Per slot: which of the item's own colours is replaced by which palette colour. */
  colors: Partial<Record<WornSlot, Partial<Record<PaletteKey, PaletteKey>>>>;
  ground: string;
}

const HAIR_COLORS: PaletteKey[] = [...HAIR_KEYS, 'white', 'pink', 'teal', 'purple'];
const GROUNDS = [
  { id: 'sand', label: 'Sand', color: '#e9d9a0' },
  { id: 'grass', label: 'Grass', color: '#8fcf78' },
  { id: 'deck', label: 'Deck', color: '#c39a6b' },
  { id: 'shallows', label: 'Shallows', color: '#7fd6d0' },
];

const firstOf = (slot: Slot, match: RegExp) => CATALOG.find((e) => e.slot === slot && match.test(e.id))?.id ?? null;

function defaultState(): State {
  return {
    skin: 'skinB',
    build: 'slim',
    hair: 'short',
    hairColor: 'hairBrown',
    worn: {
      top: firstOf('top', /recipe-shirt-0/) ?? firstOf('top', /./),
      bottom: firstOf('bottom', /sprite-shorts-0/) ?? firstOf('bottom', /./),
      shoes: null,
      hat: firstOf('hat', /sprite-hat-2/),
      beard: null,
      tool: firstOf('tool', /sprite-spear-0/),
    },
    colors: {},
    ground: 'sand',
  };
}

const STORAGE_KEY = 'castaway-wardrobe';

function loadState(): State {
  const state = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<State> | null;
    if (!saved) return state;
    if (saved.skin && SKIN_KEYS.includes(saved.skin)) state.skin = saved.skin;
    if (BUILDS.some((b) => b.id === saved.build)) state.build = saved.build!;
    if (saved.hair === null || HAIR_STYLES.some((s) => s.id === saved.hair)) state.hair = saved.hair ?? null;
    if (saved.hairColor && saved.hairColor in PALETTE) state.hairColor = saved.hairColor;
    for (const slot of WORN_SLOTS) {
      const id = saved.worn?.[slot];
      if (id === null || entryById(id)?.slot === slot) state.worn[slot] = id ?? null;
    }
    for (const slot of WORN_SLOTS) {
      const swap = saved.colors?.[slot];
      if (!swap) continue;
      const clean = Object.entries(swap).filter(([from, to]) => from in PALETTE && to && to in PALETTE);
      if (clean.length) state.colors[slot] = Object.fromEntries(clean);
    }
    if (GROUNDS.some((g) => g.id === saved.ground)) state.ground = saved.ground!;
  } catch {
    // Saved looks are a convenience. Without storage the wardrobe starts from the default.
  }
  return state;
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

const SAMPLED = clipsFromSamples(sampledData as unknown as Record<string, { name: string; rate: number; frames: SampledFrame[] }>);
const CLIPS: Record<string, { label: string; clip: Clip }> = {
  idle: { label: 'Idle', clip: AUTHORED.idle },
  walk: { label: 'Walk', clip: AUTHORED.walk },
  run: { label: 'Run', clip: SAMPLED.run },
  wave: { label: 'Wave', clip: AUTHORED.wave },
  chop: { label: 'Chop', clip: SAMPLED.chop },
};

// ------------------------------------------------------------------ look

/** The item a slot shows, with the player's colour choices applied. A beard follows the hair colour. */
function wornItem(source: State, slot: WornSlot): Item | null {
  const entry = entryById(source.worn[slot]);
  if (!entry) return null;
  if (slot === 'beard') return entry.colors.length ? recolor(entry.item, { [entry.colors[0]]: source.hairColor }) : entry.item;
  return recolor(entry.item, source.colors[slot] ?? {});
}

function lookOf(source: State): Look {
  const items: Item[] = [];
  const hair = HAIR_STYLES.find((s) => s.id === source.hair);
  if (hair) items.push(hair.make(source.hairColor));
  for (const slot of WORN_SLOTS) {
    const item = wornItem(source, slot);
    if (item) items.push(item);
  }
  // The body is never bare: undershorts appear when nothing else is worn below.
  if (!source.worn.bottom) items.push(UNDERSHORTS);
  return {
    skin: source.skin,
    build: BUILDS.find((b) => b.id === source.build),
    head: headFor(source.skin),
    faces: facesFor(source.skin),
    items,
  };
}

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

interface Window32 {
  y: number;
  h: number;
}
const FULL: Window32 = { y: 0, h: SPRITE_H };

function paint(canvas: HTMLCanvasElement, look: Look, clip: Clip, frame: number, at: Facing, crop: Window32): void {
  const sprite = drawCharacter(look, clip.frames[frame], at, { face: clip.faces?.[frame] });
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(SPRITE_W, crop.h);
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const hex = sprite.get(x, y + crop.y);
      if (!hex) continue;
      const o = (y * SPRITE_W + x) * 4;
      image.data[o] = parseInt(hex.slice(1, 3), 16);
      image.data[o + 1] = parseInt(hex.slice(3, 5), 16);
      image.data[o + 2] = parseInt(hex.slice(5, 7), 16);
      image.data[o + 3] = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

interface Live {
  canvas: HTMLCanvasElement;
  facing: () => Facing;
  shown: string;
}
const live: Live[] = [];

function liveView(className: string, at: () => Facing): HTMLCanvasElement {
  const canvas = h('canvas', { class: className, width: String(SPRITE_W), height: String(SPRITE_H) });
  live.push({ canvas, facing: at, shown: '' });
  return canvas;
}

/** A still preview of the current look with one thing changed. */
function preview(change: (draft: State) => void, crop: Window32 = FULL): HTMLCanvasElement {
  const draft: State = structuredClone(state);
  change(draft);
  const canvas = h('canvas', { class: 'thumb', width: String(SPRITE_W), height: String(crop.h) });
  paint(canvas, lookOf(draft), { name: 'Stand', rate: 1, frames: [STAND] }, 0, 0, crop);
  return canvas;
}

// ------------------------------------------------------------------ interface

const root = document.getElementById('wardrobe')!;
const stage = h('div', { class: 'stage__ground' });
const facingRow = h('div', { class: 'facings', role: 'group', 'aria-label': 'Facing' });
const actionRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Action' });
const groundRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Ground' });
const tabRow = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Wardrobe sections' });
const panel = h('div', { class: 'panel__body', role: 'tabpanel' });

function chip(label: string, pressed: boolean, onClick: () => void, extra = ''): HTMLButtonElement {
  const button = h('button', { type: 'button', class: `chip ${extra}`.trim(), 'aria-pressed': String(pressed) }, label);
  button.addEventListener('click', onClick);
  return button;
}

function changed(): void {
  version++;
  saveState();
  render();
}

function swatches(title: string, keys: (PaletteKey | null)[], selected: PaletteKey | null, pick: (key: PaletteKey | null) => void): HTMLElement {
  const row = h('div', { class: 'swatches' });
  for (const key of keys) {
    const button = h('button', {
      type: 'button',
      class: key === null ? 'swatch swatch--own' : 'swatch',
      'aria-pressed': String(key === selected),
      'aria-label': key === null ? `${title}: original` : `${title}: ${key}`,
      title: key ?? 'Original',
      style: key ? `--swatch: ${PALETTE[key].base}; --swatch-shade: ${PALETTE[key].shade}` : '',
    }, key === null ? 'Original' : null);
    button.addEventListener('click', () => pick(key));
    row.append(button);
  }
  return h('section', { class: 'group' }, h('h3', {}, title), row);
}

function card(label: string, selected: boolean, canvas: HTMLCanvasElement | null, onClick: () => void, note?: string): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'card', 'aria-pressed': String(selected) },
    canvas ?? h('span', { class: 'card__none', 'aria-hidden': 'true' }),
    h('span', { class: 'card__label' }, label),
    note ? h('span', { class: 'card__note' }, note) : null,
  );
  button.addEventListener('click', onClick);
  return button;
}

const CROPS: Record<TabId, Window32> = {
  body: FULL,
  hair: { y: 0, h: 32 },
  beard: { y: 0, h: 32 },
  hat: { y: 0, h: 32 },
  top: { y: 14, h: 32 },
  bottom: { y: 16, h: 32 },
  shoes: { y: 16, h: 32 },
  tool: FULL,
};

function slotPanel(slot: WornSlot): HTMLElement[] {
  const entries = CATALOG.filter((e) => e.slot === slot);
  const current = entryById(state.worn[slot]);
  const grid = h('div', { class: 'grid' });
  const none = slot === 'bottom' ? 'Undershorts' : 'None';
  grid.append(card(none, !current, preview((d) => (d.worn[slot] = null), CROPS[slot]), () => {
    state.worn[slot] = null;
    changed();
  }));
  for (const entry of entries) {
    grid.append(card(entry.label, entry.id === current?.id, preview((d) => {
      d.worn[slot] = entry.id;
      delete d.colors[slot];
    }, CROPS[slot]), () => {
      if (state.worn[slot] !== entry.id) delete state.colors[slot];
      state.worn[slot] = entry.id;
      changed();
    }));
  }
  const out: HTMLElement[] = [grid];
  if (current && slot === 'beard') {
    out.push(h('p', { class: 'note' }, 'A beard takes the hair colour. Change it under Hair.'));
  } else if (current) {
    current.colors.forEach((own, i) => {
      const swap = state.colors[slot]?.[own] ?? null;
      out.push(swatches(i === 0 ? 'Main colour' : 'Second colour', [null, ...CLOTH_KEYS], swap, (key) => {
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
  const builds = h('div', { class: 'grid' });
  for (const build of BUILDS) {
    builds.append(card(build.label, state.build === build.id, preview((d) => (d.build = build.id)), () => {
      state.build = build.id;
      changed();
    }));
  }
  return [
    swatches('Skin', SKIN_KEYS, state.skin, (key) => {
      state.skin = key ?? 'skinB';
      changed();
    }),
    h('section', { class: 'group' }, h('h3', {}, 'Build'), builds),
  ];
}

function hairPanel(): HTMLElement[] {
  const styles = h('div', { class: 'grid' });
  styles.append(card('Bald', state.hair === null, preview((d) => (d.hair = null), CROPS.hair), () => {
    state.hair = null;
    changed();
  }));
  for (const style of HAIR_STYLES) {
    styles.append(card(style.label, state.hair === style.id, preview((d) => (d.hair = style.id), CROPS.hair), () => {
      state.hair = style.id;
      changed();
    }));
  }
  return [
    styles,
    swatches('Hair colour', HAIR_COLORS, state.hairColor, (key) => {
      state.hairColor = key ?? 'hairBrown';
      changed();
    }),
  ];
}

function shuffle(): void {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
  const next = defaultState();
  next.skin = pick(SKIN_KEYS);
  next.build = pick(BUILDS).id;
  next.hair = Math.random() < 0.12 ? null : pick(HAIR_STYLES).id;
  next.hairColor = pick(HAIR_COLORS.slice(0, 6));
  const chance: Record<WornSlot, number> = { top: 0.85, bottom: 0.9, shoes: 0.4, hat: 0.5, beard: 0.3, tool: 0.6 };
  for (const slot of WORN_SLOTS) {
    const options = CATALOG.filter((e) => e.slot === slot);
    const entry: Entry | null = options.length && Math.random() < chance[slot] ? pick(options) : null;
    next.worn[slot] = entry?.id ?? null;
    if (entry && slot !== 'beard' && entry.colors.length && Math.random() < 0.45) next.colors[slot] = { [entry.colors[0]]: pick(CLOTH_KEYS) };
  }
  next.ground = state.ground;
  state = next;
  changed();
}

function render(): void {
  stage.style.setProperty('--ground', GROUNDS.find((g) => g.id === state.ground)!.color);

  tabRow.replaceChildren(...TABS.map((t) => {
    const button = h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(t.id === tab) }, t.label);
    button.addEventListener('click', () => {
      tab = t.id;
      render();
    });
    return button;
  }));
  const scroll = panel.scrollTop;
  panel.replaceChildren(...(tab === 'body' ? bodyPanel() : tab === 'hair' ? hairPanel() : slotPanel(tab)));
  panel.scrollTop = scroll;

  actionRow.replaceChildren(...Object.entries(CLIPS).map(([key, { label }]) => chip(label, key === clipKey, () => {
    clipKey = key;
    render();
  })));
  groundRow.replaceChildren(...GROUNDS.map((g) => chip(g.label, g.id === state.ground, () => {
    state.ground = g.id;
    saveState();
    render();
  })));
  [...facingRow.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === facing)));
}

function mount(): void {
  FACING_NAMES.forEach((name, i) => {
    const button = h('button', { type: 'button', class: 'facing', 'aria-pressed': 'false', 'aria-label': `Face ${name}` },
      liveView('sprite sprite--small', () => i as Facing),
      h('span', {}, name),
    );
    button.addEventListener('click', () => {
      facing = i as Facing;
      render();
    });
    facingRow.append(button);
  });
  stage.append(liveView('sprite sprite--hero', () => facing));

  const shuffleButton = h('button', { type: 'button', class: 'button button--primary', id: 'shuffle' }, 'Shuffle');
  shuffleButton.addEventListener('click', shuffle);
  const resetButton = h('button', { type: 'button', class: 'button', id: 'reset' }, 'Start over');
  resetButton.addEventListener('click', () => {
    state = defaultState();
    changed();
  });

  const paintCount = CATALOG.filter((e) => e.format === 'paint').length;
  root.append(
    h('main', { class: 'app' },
      h('header', { class: 'top' },
        h('div', { class: 'top__text' },
          h('h1', {}, 'Castaway Wardrobe'),
          h('p', { class: 'lede' }, 'Dress a 32 by 48 pixel survivor. Everything is drawn once and follows the body in every action and facing.'),
        ),
        h('div', { class: 'top__actions' }, shuffleButton, resetButton),
      ),
      h('section', { class: 'stage', 'aria-label': 'Preview' },
        h('div', { class: 'stage__view' }, stage, facingRow),
        h('div', { class: 'row' }, h('h3', {}, 'Action'), actionRow),
        h('div', { class: 'row' }, h('h3', {}, 'Ground'), groundRow),
      ),
      h('section', { class: 'panel', 'aria-label': 'Wardrobe' }, tabRow, panel),
      h('footer', { class: 'foot' },
        h('p', {}, `The ${CATALOG.length} wearable items here were written by a language model from one-line requests and are shown as returned: ${paintCount} painted over the whole sprite, ${CATALOG.length - paintCount} as recipes. Two rules are applied on top: beards are hidden from behind, and colours can be swapped. The body, faces and the two hairstyles were also written by the model, then corrected by looking at the result.`),
        h('p', {}, 'Known rough edges: tools do not rotate in the chop, long hair and hats overlap without a tucked-in variant, and items drawn for the first body can sit a pixel off on the second.'),
      ),
    ),
  );

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      facing = ((facing + (event.key === 'ArrowRight' ? 1 : 3)) % 4) as Facing;
      render();
    }
  });
}

mount();
render();

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let look = lookOf(state);
let lookVersion = version;
const tick = (ms: number) => {
  if (lookVersion !== version) {
    look = lookOf(state);
    lookVersion = version;
  }
  const { clip } = CLIPS[clipKey];
  const frame = still ? 0 : Math.floor((ms / 1000) * clip.rate) % clip.frames.length;
  for (const view of live) {
    const key = `${version}|${clipKey}|${view.facing()}|${frame}`;
    if (key === view.shown) continue;
    view.shown = key;
    paint(view.canvas, look, clip, frame, view.facing(), FULL);
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
document.body.dataset.ready = '1';
