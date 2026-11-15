import '../wardrobe/style.css';
import './style.css';
import { baseLook, DEFAULT_FACE, facesFor, wear, type Mood } from '../lab/base.ts';
import { entryById } from '../lab/catalog.ts';
import { drawPlant, FRAMES, grow, type Raster } from '../lab/flora.ts';
import { FLORA } from '../lab/flora-catalog.ts';
import { middleOf, paintIsland, scatter, stamp, type Pixels, type Thing } from '../lab/island.ts';
import { type PaletteKey } from '../lab/palette.ts';
import { AUTHORED, type Clip } from '../lab/poses.ts';
import { drawCharacter, type Facing, type Item, type Look, type Sprite } from '../lab/puppet.ts';
import { weathered } from '../lab/wear.ts';
import { generateIsland, renderTerrain } from '../lab/terrain.ts';
import { currentLang, LANGS, setLang } from '../wardrobe/i18n.ts';

// The start page of the published site: what the tools are, each with a small live picture
// drawn by the same code as the tool itself.

const en = {
  'title': 'Pixel Art',
  'lede': 'Tools for a small pixel-art game about surviving on an island. A language model writes the content as short descriptions; rules draw everything in one style, with variants, animation and wear. People only review and touch up.',
  'language': 'Language',
  'tools': 'Tools',
  'wardrobe': 'Castaway Wardrobe',
  'wardrobe.text': 'Dress a small pixel person, then choose how long they have been on the island and how they feel. Every item follows the body in every action and facing.',
  'flora': 'Island Flora',
  'flora.text': 'Palms, grass, cacti, jungle, rocks and driftwood, grown by rule from short recipes. With wind, seasons and sizes, on islands made from a height map.',
  'scene': 'Scene Editor',
  'scene.text': 'Build an island: raise and lower the ground, paint sand, grass and rock, place the plants. Then walk around it with a character from the wardrobe.',
  'open': 'Open',
  'note': 'All tools are in English and German and keep your changes in this browser.',
};
type Key = keyof typeof en;
const de: Record<Key, string> = {
  'title': 'Pixel Art',
  'lede': 'Werkzeuge für ein kleines Pixel-Art-Spiel über das Überleben auf einer Insel. Ein Sprachmodell schreibt die Inhalte als kurze Beschreibungen; Regeln zeichnen alles in einem Stil, mit Varianten, Animation und Abnutzung. Menschen prüfen nur noch und bessern nach.',
  'language': 'Sprache',
  'tools': 'Werkzeuge',
  'wardrobe': 'Garderobe der Gestrandeten',
  'wardrobe.text': 'Kleide eine kleine Pixelfigur ein und lege fest, wie lange sie schon auf der Insel ist und wie sie sich fühlt. Jedes Teil folgt dem Körper in jeder Aktion und Blickrichtung.',
  'flora': 'Inselflora',
  'flora.text': 'Palmen, Gräser, Kakteen, Dschungel, Steine und Treibholz, nach Regeln aus kurzen Rezepten gewachsen. Mit Wind, Jahreszeiten und Größen, auf Inseln aus einer Höhenkarte.',
  'scene': 'Szenen-Editor',
  'scene.text': 'Baue eine Insel: Boden anheben und absenken, Sand, Gras und Fels malen, Pflanzen setzen. Dann lauf mit einer Figur aus der Garderobe darauf herum.',
  'open': 'Öffnen',
  'note': 'Alle Werkzeuge gibt es auf Deutsch und Englisch; deine Änderungen bleiben in diesem Browser gespeichert.',
};
const t = (key: Key) => (currentLang() === 'de' ? de : en)[key];

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
    stamp(image, sprite, 64, 64, c.x, 0);
  });
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
      things.push({ spot: person, picture: sprite, w: 64, h: 64, foot: { x: 32, y: 52 } });
      return paintIsland(map, ground, things);
    },
  };
}
const floraIsle = smallIsland(4, AUTHORED.idle, 0);
const sceneIsle = smallIsland(11, AUTHORED.wave, 1);

// ------------------------------------------------------------------ page

const castCanvas = h('canvas', { class: 'tool__canvas', width: String(CAST_SIZE.w), height: String(CAST_SIZE.h) });
const islandCanvas = h('canvas', { class: 'tool__canvas', width: String(floraIsle.ground.w), height: String(floraIsle.ground.h) });
const sceneCanvas = h('canvas', { class: 'tool__canvas', width: String(sceneIsle.ground.w), height: String(sceneIsle.ground.h) });

function paint(canvas: HTMLCanvasElement, image: Pixels): void {
  canvas.getContext('2d')!.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
}

function card(href: string, title: string, text: string, picture: HTMLElement, kind: string): HTMLElement {
  return h('a', { class: 'tool', href },
    h('span', { class: `tool__picture tool__picture--${kind}` }, picture),
    h('span', { class: 'tool__body' },
      h('h2', {}, title),
      h('p', {}, text),
      h('span', { class: 'button button--primary tool__open' }, t('open')),
    ),
  );
}

function mount(): void {
  document.documentElement.lang = currentLang();
  document.title = t('title');
  const languages = h('div', { class: 'langs', role: 'group', 'aria-label': t('language') },
    ...LANGS.map((l) => {
      const button = h('button', { type: 'button', class: 'lang', 'aria-pressed': String(l.id === currentLang()), lang: l.id, title: l.name }, l.label);
      button.addEventListener('click', () => {
        setLang(l.id);
        mount();
      });
      return button;
    }),
  );
  document.getElementById('home')!.replaceChildren(
    h('main', { class: 'app home' },
      h('header', { class: 'top' },
        h('div', { class: 'top__text' }, h('h1', {}, t('title')), h('p', { class: 'lede' }, t('lede'))),
        h('div', { class: 'top__actions' }, languages),
      ),
      h('section', { class: 'tools', 'aria-label': t('tools') },
        card('./wardrobe/', t('wardrobe'), t('wardrobe.text'), castCanvas, 'cast'),
        card('./flora/', t('flora'), t('flora.text'), islandCanvas, 'island'),
        card('./scene/', t('scene'), t('scene.text'), sceneCanvas, 'island'),
      ),
      h('p', { class: 'home__note' }, t('note')),
    ),
  );
  fit();
}

/** Whole-number enlargement that fits the card, so the pixels stay square. */
function fit(): void {
  for (const canvas of [castCanvas, islandCanvas, sceneCanvas]) {
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

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let shown = '';
const tick = (ms: number) => {
  const time = still ? 0 : ms;
  const frame = Math.floor((time / 1000) * 6) % FRAMES;
  const key = `${frame}|${Math.floor((time / 1000) * 10)}`;
  if (key !== shown) {
    shown = key;
    paint(castCanvas, castAt(time));
    paint(islandCanvas, floraIsle.at(time, frame));
    paint(sceneCanvas, sceneIsle.at(time, frame));
  }
  if (!still) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
document.body.dataset.ready = '1';
