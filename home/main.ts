import './style.css';
import { baseLook, DEFAULT_FACE, facesFor, wear, type Mood } from '../lab/base.ts';
import { entryById } from '../lab/catalog.ts';
import { ANIMAL_H, ANIMAL_ORIGIN, ANIMAL_W, cleanAnimal, CLIPS, drawAnimal, isShadow as isAnimalShadow, type AnimalSprite, type ClipId } from '../lab/animal.ts';
import { loadRoster, lookOf as characterLook } from '../lab/character.ts';
import { presetById } from '../lab/animal-presets.ts';
import { cleanProp, drawObject, isShadow as isObjectShadow, LOOP_FRAMES, LOOP_RATE, OBJECT_H, OBJECT_ORIGIN, OBJECT_W, type ObjectSprite, type Turn } from '../lab/object.ts';
import { objectPresetById } from '../lab/object-presets.ts';
import { drawPlant, FRAMES, grow, type Raster } from '../lab/flora.ts';
import { FLORA } from '../lab/flora-catalog.ts';
import { middleOf, paintIsland, scatter, stamp, type Pixels, type Thing } from '../lab/island.ts';
import { type PaletteKey } from '../lab/palette.ts';
import { AUTHORED, type Clip } from '../lab/poses.ts';
import { CHARACTER_ORIGIN, drawCharacter, SPRITE_H, SPRITE_W, type Facing, type Item, type Look, type Sprite } from '../lab/puppet.ts';
import { weathered } from '../lab/wear.ts';
import { generateIsland, renderTerrain } from '../lab/terrain.ts';
import { h, topBar, word, type ToolId } from '../shared/shell.ts';
import { currentLang } from '../shared/lang.ts';

// The start page of the published site: what the tools are, each with a small live picture
// drawn by the same code as the tool itself.

const en = {
  'title': 'Pixel Art',
  'lede': 'Tools for a small pixel-art game about surviving on an island. A language model writes the content as short descriptions; rules draw everything in one style, with variants, animation and wear. People only review and touch up.',
  'tools': 'Tools',
  'wardrobe.short': 'Dress up a castaway.',
  'animals.short': 'Make your own animal.',
  'objects.short': 'Build furniture and cars.',
  'flora.short': 'Grow palms and cacti.',
  'scene.short': 'Shape an island.',
  'things': 'My things',
  'things.note': 'Pick up where you left off.',
  'things.none': 'Things you make show up here.',
  'note': 'All tools are in English and German and keep your changes in this browser.',
  'pause': 'Pause',
  'play': 'Play',
};
type Key = keyof typeof en;
const de: Record<Key, string> = {
  'title': 'Pixel Art',
  'lede': 'Werkzeuge für ein kleines Pixel-Art-Spiel über das Überleben auf einer Insel. Ein Sprachmodell schreibt die Inhalte als kurze Beschreibungen; Regeln zeichnen alles in einem Stil, mit Varianten, Animation und Abnutzung. Menschen prüfen nur noch und bessern nach.',
  'tools': 'Werkzeuge',
  'wardrobe.short': 'Zieh eine Figur an.',
  'animals.short': 'Mach dein eigenes Tier.',
  'objects.short': 'Baue Möbel und Autos.',
  'flora.short': 'Lass Palmen wachsen.',
  'scene.short': 'Forme eine Insel.',
  'things': 'Meine Sachen',
  'things.note': 'Mach weiter, wo du warst.',
  'things.none': 'Was du machst, erscheint hier.',
  'note': 'Alle Werkzeuge gibt es auf Deutsch und Englisch; deine Änderungen bleiben in diesem Browser gespeichert.',
  'pause': 'Anhalten',
  'play': 'Abspielen',
};
const t = (key: Key) => (currentLang() === 'de' ? de : en)[key];


// ------------------------------------------------------------------ the castaways

function lookOf(skin: PaletteKey, hair: PaletteKey, mood: Mood, condition: number, ids: string[]): Look {
  const items = ids.map((id) => entryById(id)?.item).filter((i): i is Item => !!i).map((i) => weathered(i, condition as 0));
  const look = wear(baseLook(skin, hair), ...items);
  return { ...look, faces: facesFor(skin, DEFAULT_FACE, hair, mood), items: look.items.map((i) => weathered(i, condition as 0)) };
}

/** Three castaways at three stages of their stay, each doing something. */
const CAST: { look: Look; clip: Clip; facing: Facing; x: number }[] = [
  { look: lookOf('skinA', 'hairRed', 'smile', 0, ['recipe-hair-tied-0', 'recipe-tops-0', 'recipe-shorts-0', 'recipe-footwear-5']), clip: AUTHORED.wave, facing: 0, x: 0 },
  { look: lookOf('skinC', 'hairBlack', 'happy', 2, ['recipe-everyday-0', 'sprite-everyday-bottoms-0', 'sprite-hat-2']), clip: AUTHORED.walk, facing: 0, x: 40 },
  { look: lookOf('skinD', 'hairBlack', 'neutral', 3, ['sprite-beard-0', 'recipe-shirt-1', 'recipe-bottoms-4', 'recipe-spear-0']), clip: AUTHORED.idle, facing: 1, x: 80 },
];
const CAST_SIZE = { w: 144, h: 60 };
const castFrames = new Map<string, Sprite>();
function castAt(ms: number): Pixels {
  const image: Pixels = { data: new Uint8ClampedArray(CAST_SIZE.w * CAST_SIZE.h * 4), width: CAST_SIZE.w, height: CAST_SIZE.h };
  CAST.forEach((c, n) => {
    const i = Math.floor((ms / 1000) * c.clip.rate) % c.clip.frames.length;
    const key = `${n}|${i}`;
    let sprite = castFrames.get(key);
    if (!sprite) castFrames.set(key, (sprite = drawCharacter(c.look, c.clip.frames[i], c.facing, { face: c.clip.faces?.[i], swing: c.clip.swing })));
    stamp(image, sprite, SPRITE_W, SPRITE_H, c.x, 0);
  });
  return image;
}

// ------------------------------------------------------------------ the animals

/** Four of the animal presets on the move. `x` is where each stands on the ground row. */
const HERD: { id: string; clip: ClipId; facing: Facing; x: number }[] = [
  { id: 'rabbit', clip: 'run', facing: 0, x: 22 },
  { id: 'fox', clip: 'walk', facing: 0, x: 52 },
  { id: 'pig', clip: 'idle', facing: 1, x: 86 },
  { id: 'elephant', clip: 'walk', facing: 1, x: 136 },
];
const HERD_SIZE = { w: 168, h: 60, ground: 54 };
const herdFrames = new Map<string, AnimalSprite>();
function herdAt(ms: number): Pixels {
  const image: Pixels = { data: new Uint8ClampedArray(HERD_SIZE.w * HERD_SIZE.h * 4), width: HERD_SIZE.w, height: HERD_SIZE.h };
  for (const c of HERD) {
    const clip = CLIPS[c.clip];
    const i = Math.floor((ms / 1000) * clip.rate) % clip.frames;
    const key = `${c.id}|${i}`;
    let sprite = herdFrames.get(key);
    if (!sprite) herdFrames.set(key, (sprite = drawAnimal(presetById(c.id)!.animal, c.clip, i, c.facing).sprite));
    stamp(image, sprite, ANIMAL_W, ANIMAL_H, c.x - ANIMAL_ORIGIN.x, HERD_SIZE.ground - ANIMAL_ORIGIN.y);
  }
  return image;
}

// ------------------------------------------------------------------ the objects

/** A few of the object presets in a row, the fountain running. */
const SET: { id: string; turn: Turn; x: number }[] = [
  { id: 'car', turn: 1, x: 26 },
  { id: 'fountain', turn: 0, x: 76 },
  { id: 'examTable', turn: 0, x: 124 },
  { id: 'plant', turn: 0, x: 152 },
];
const SET_SIZE = { w: 172, h: 60, ground: 50 };
const setFrames = new Map<string, ObjectSprite>();
function setAt(ms: number): Pixels {
  const image: Pixels = { data: new Uint8ClampedArray(SET_SIZE.w * SET_SIZE.h * 4), width: SET_SIZE.w, height: SET_SIZE.h };
  const i = Math.floor((ms / 1000) * LOOP_RATE) % LOOP_FRAMES;
  for (const c of SET) {
    const key = `${c.id}|${i}`;
    let sprite = setFrames.get(key);
    if (!sprite) setFrames.set(key, (sprite = drawObject(objectPresetById(c.id)!.prop, c.turn, i).sprite));
    stamp(image, sprite, OBJECT_W, OBJECT_H, c.x - OBJECT_ORIGIN.x, SET_SIZE.ground - OBJECT_ORIGIN.y);
  }
  return image;
}

// ------------------------------------------------------------------ a small island

const islander = lookOf('skinB', 'hairBrown', 'happy', 1, ['recipe-everyday-1', 'recipe-shorts-1', 'recipe-footwear-6']);

/** A small island with plants and one person on it, doing `clip`. One for the flora card, one for the scene editor's. */
function smallIsland(seed: number, clip: Clip, facing: Facing) {
  const cells = 7;
  const map = generateIsland(seed, cells, cells, { land: 1.15, peak: 4 });
  const ground = renderTerrain(map, { w: cells * 32, h: cells * 16 + 104, origin: { x: cells * 16, y: 94 } });
  const person = middleOf(map);
  const pool = FLORA.filter((e) => e.category !== 'cactus');
  const plants = scatter(map, pool.flatMap((e) => (e.category === 'grass' || e.category === 'palm' ? [e, e, e] : [e])), 9, seed, person).map((p) => ({
    spot: p,
    grown: grow(p.item.plant, { seed: p.seed, size: p.scale }),
    frames: [] as Raster[],
  }));
  const sprites = new Map<number, Sprite>();
  return {
    ground,
    at(ms: number, frame: number): Pixels {
      const things: Thing[] = plants.map((p) => {
        const raster = (p.frames[frame] ??= drawPlant(p.grown, { frame, wind: 1 }));
        return { spot: p.spot, picture: raster, w: raster.w, h: raster.h, foot: raster.origin };
      });
      const i = Math.floor((ms / 1000) * clip.rate) % clip.frames.length;
      let sprite = sprites.get(i);
      if (!sprite) sprites.set(i, (sprite = drawCharacter(islander, clip.frames[i], facing, { face: clip.faces?.[i] })));
      things.push({ spot: person, picture: sprite, w: SPRITE_W, h: SPRITE_H, foot: CHARACTER_ORIGIN });
      return paintIsland(map, ground, things);
    },
  };
}
const floraIsle = smallIsland(4, AUTHORED.idle, 0);
const sceneIsle = smallIsland(11, AUTHORED.wave, 1);

// ------------------------------------------------------------------ page

const castCanvas = h('canvas', { class: 'tool__canvas', width: String(CAST_SIZE.w), height: String(CAST_SIZE.h) });
const herdCanvas = h('canvas', { class: 'tool__canvas', width: String(HERD_SIZE.w), height: String(HERD_SIZE.h) });
const setCanvas = h('canvas', { class: 'tool__canvas', width: String(SET_SIZE.w), height: String(SET_SIZE.h) });
const islandCanvas = h('canvas', { class: 'tool__canvas', width: String(floraIsle.ground.w), height: String(floraIsle.ground.h) });
const sceneCanvas = h('canvas', { class: 'tool__canvas', width: String(sceneIsle.ground.w), height: String(sceneIsle.ground.h) });

function paint(canvas: HTMLCanvasElement, image: Pixels): void {
  canvas.getContext('2d')!.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
}

let paused = false;

function card(tool: ToolId, href: string, picture: HTMLElement, kind: string): HTMLElement {
  return h('a', { class: 'tile', href },
    h('span', { class: `tile__picture tile__picture--${kind}` }, picture),
    h('span', { class: 'tile__cap' },
      h('span', {}, h('b', {}, word(tool)), h('span', {}, t(`${tool}.short` as Key))),
      h('span', { class: 'tile__go', 'aria-hidden': 'true' }, '→'),
    ),
  );
}

// ------------------------------------------------------------------ my things

interface Made { name: string; tool: ToolId; href: string; currentKey: string; id: string; picture: HTMLCanvasElement }
const read = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    // Without storage there is nothing to show.
    return null;
  }
};
/** A picture of a sprite, trimmed to what it paints and enlarged by whole numbers to fit the box. */
function trimmed(get: (x: number, y: number) => string | null | undefined, w: number, hh: number, skip: (hex: string) => boolean, box = 72): HTMLCanvasElement {
  let x0 = w, y0 = hh, x1 = 0, y1 = 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const hex = get(x, y);
    if (!hex || skip(hex)) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const cw = Math.max(1, x1 - x0 + 1), ch = Math.max(1, y1 - y0 + 1);
  const canvas = h('canvas', { width: String(cw), height: String(ch) });
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const hex = get(x + x0, y + y0);
    if (!hex || skip(hex)) continue;
    const o = (y * cw + x) * 4;
    for (let k = 0; k < 3; k++) image.data[o + k] = parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
    image.data[o + 3] = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
  }
  ctx.putImageData(image, 0, 0);
  const scale = Math.max(1, Math.floor(box / Math.max(cw, ch)));
  canvas.style.width = `${cw * scale}px`;
  canvas.style.height = `${ch * scale}px`;
  return canvas;
}
const list = (key: string): { id: string; name: string; [k: string]: unknown }[] => {
  const raw = read(key);
  return Array.isArray(raw) ? raw.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string') : [];
};
/** The newest few from every tool, newest last in each list, shown newest first. */
function madeThings(): Made[] {
  const people: Made[] = loadRoster().map((c) => {
    const sprite = drawCharacter(characterLook(c.state), AUTHORED.idle.frames[0], 0);
    return { name: c.name, tool: 'wardrobe', href: './wardrobe/', currentKey: 'castaway-characters-current', id: c.id, picture: trimmed((x, y) => sprite.get(x, y), SPRITE_W, SPRITE_H, () => false) };
  });
  const animals: Made[] = list('pixel-animals').map((s) => {
    const { sprite } = drawAnimal(cleanAnimal(s.animal), 'idle', 0, 0);
    return { name: s.name, tool: 'animals', href: './animals/', currentKey: 'pixel-animals-current', id: s.id, picture: trimmed((x, y) => sprite.get(x, y), ANIMAL_W, ANIMAL_H, isAnimalShadow) };
  });
  const objects: Made[] = list('pixel-objects').map((s) => {
    const { sprite } = drawObject(cleanProp(s.prop), 0);
    return { name: s.name, tool: 'objects', href: './objects/', currentKey: 'pixel-objects-current', id: s.id, picture: trimmed((x, y) => sprite.get(x, y), OBJECT_W, OBJECT_H, isObjectShadow) };
  });
  const out: Made[] = [];
  for (let i = 1; out.length < 12 && i <= Math.max(people.length, animals.length, objects.length); i++) {
    for (const l of [people, animals, objects]) if (l.length >= i) out.push(l[l.length - i]);
  }
  return out.slice(0, 12);
}
let made: Made[] | null = null;

function thingsRow(): HTMLElement {
  made ??= madeThings();
  if (!made.length) return h('p', { class: 'note' }, t('things.none'));
  return h('div', { class: 'things' }, ...made.map((m) => {
    const a = h('a', { class: 'card', href: m.href },
      h('span', { class: 'card__picture' }, m.picture),
      h('span', { class: 'card__label' }, m.name),
      h('span', { class: 'card__label', style: 'font-weight: 500; opacity: .7' }, word(m.tool)));
    // Opening it picks it in its tool.
    a.addEventListener('click', () => {
      try {
        localStorage.setItem(m.currentKey, m.currentKey === 'castaway-characters-current' ? m.id : JSON.stringify(m.id));
      } catch {
        // The tool then opens on what it had.
      }
    });
    return a;
  }));
}

function mount(): void {
  document.documentElement.lang = currentLang();
  document.title = t('title');
  const { bar, pops } = topBar({
    tool: 'home',
    title: t('title'),
    about: [t('lede'), t('note')],
    // The pictures move even with reduced motion (they show what the tools animate); this stops them.
    more: [{ label: t(paused ? 'play' : 'pause'), icon: 'pause', run: () => {
      paused = !paused;
      mount();
    } }],
    status: h('span', { class: 'bar__status' }),
    relabel: mount,
  });
  document.getElementById('home')!.replaceChildren(
    h('div', { class: 'shell' },
      bar, ...pops,
      h('main', { class: 'home' },
        h('section', { class: 'tiles', 'aria-label': t('tools') },
          card('wardrobe', './wardrobe/', castCanvas, 'cast'),
          card('animals', './animals/', herdCanvas, 'cast'),
          card('objects', './objects/', setCanvas, 'cast'),
          card('flora', './flora/', islandCanvas, 'island'),
          card('scene', './scene/', sceneCanvas, 'island'),
        ),
        h('section', { class: 'mine', 'aria-label': t('things') },
          h('div', { class: 'mine__head' }, h('h2', {}, t('things')), h('p', {}, t('things.note'))),
          thingsRow(),
        ),
      ),
    ),
  );
  fit();
}

/** Whole-number enlargement that fits the card, so the pixels stay square. */
function fit(): void {
  for (const canvas of [castCanvas, herdCanvas, setCanvas, islandCanvas, sceneCanvas]) {
    const box = canvas.parentElement;
    if (!box) continue;
    const room = box.clientWidth - 16;
    const scale = Math.max(1, Math.min(3, Math.floor(room / canvas.width)));
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${canvas.height * scale}px`;
  }
}

mount();
window.addEventListener('resize', fit);

let shown = '';
let time = 0;
const tick = (ms: number) => {
  if (!paused) time = ms;
  const frame = Math.floor((time / 1000) * 6) % FRAMES;
  const key = `${frame}|${Math.floor((time / 1000) * 10)}`;
  if (key !== shown) {
    shown = key;
    paint(castCanvas, castAt(time));
    paint(herdCanvas, herdAt(time));
    paint(setCanvas, setAt(time));
    paint(islandCanvas, floraIsle.at(time, frame));
    paint(sceneCanvas, sceneIsle.at(time, frame));
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
document.body.dataset.ready = '1';
