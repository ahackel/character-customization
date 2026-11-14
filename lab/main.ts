import './style.css';
import { baseLook, wear } from './base.ts';
import { compile } from './items.ts';
import { AUTHORED, STAND, clipsFromSamples, type Clip, type SampledFrame } from './poses.ts';
import { drawCharacter, FACING_NAMES, SPRITE_H, SPRITE_W, type Facing, type Item, type Look, type Sprite } from './puppet.ts';
import sampledData from './generated/poses3d.json';
import requests from './generated/requests.json';
import timings from './generated/timings.json';
import baselineUrl from './generated/baseline3d.png?inline';
import firstBaseUrl from './generated/base-v1.png?inline';

const generated = import.meta.glob<unknown[]>('./generated/{sprite,recipe}-*.json', { eager: true, import: 'default' });
const SAMPLED = clipsFromSamples(sampledData as unknown as Record<string, { name: string; rate: number; frames: SampledFrame[] }>);
const STILL: Clip = { name: 'Stand', rate: 1, frames: [STAND] };
const FACINGS: Facing[] = [0, 1, 2, 3];
type Format = 'sprite' | 'recipe';
const FORMAT_NAMES: Record<Format, string> = { sprite: 'Whole-sprite paint', recipe: 'Recipes and stamps' };

// ------------------------------------------------------------------ small DOM helper

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

// ------------------------------------------------------------------ animated sprite views

interface View {
  canvas: HTMLCanvasElement;
  draw: (seconds: number) => void;
}
const views: View[] = [];

function paint(ctx: CanvasRenderingContext2D, sprite: Sprite): void {
  const image = ctx.createImageData(SPRITE_W, SPRITE_H);
  sprite.pixels.forEach((hex, i) => {
    if (!hex) return;
    image.data[i * 4] = parseInt(hex.slice(1, 3), 16);
    image.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    image.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    image.data[i * 4 + 3] = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
  });
  ctx.putImageData(image, 0, 0);
}

/** A canvas showing one character, redrawn only when its frame, clip or facing changes. */
function puppetView(look: Look, state: () => { clip: Clip; facing: Facing }, scale: number): HTMLCanvasElement {
  const canvas = h('canvas', { class: `sprite sprite--x${scale}`, width: String(SPRITE_W), height: String(SPRITE_H) });
  const ctx = canvas.getContext('2d')!;
  const cache = new Map<string, Sprite>();
  let shown = '';
  views.push({
    canvas,
    draw: (seconds) => {
      const { clip, facing } = state();
      const count = clip.frames.length;
      const frame = Math.floor(seconds * clip.rate) % count;
      const key = `${clip.name}|${facing}|${frame}`;
      if (key === shown) return;
      shown = key;
      let sprite = cache.get(key);
      if (!sprite) {
        // Follow-through: when the body rises or drops, the hat arrives one frame late.
        const before = clip.frames[(frame + count - 1) % count];
        const hatLag = Math.sign(Math.round(clip.frames[frame].hips[1] - before.hips[1]));
        sprite = drawCharacter(look, clip.frames[frame], facing, { face: clip.faces?.[frame], hatLag });
        cache.set(key, sprite);
      }
      paint(ctx, sprite);
    },
  });
  return canvas;
}

/** One sprite from a strip image, drawn once. */
function stripView(image: HTMLImageElement, index: number, scale: number): HTMLCanvasElement {
  const canvas = h('canvas', { class: `sprite sprite--x${scale}`, width: String(SPRITE_W), height: String(SPRITE_H) });
  const ctx = canvas.getContext('2d')!;
  let done = false;
  views.push({
    canvas,
    draw: () => {
      if (done || !image.complete) return;
      done = true;
      ctx.drawImage(image, index * SPRITE_W, 0, SPRITE_W, SPRITE_H, 0, 0, SPRITE_W, SPRITE_H);
    },
  });
  return canvas;
}

const firstBase = new Image();
firstBase.src = firstBaseUrl;

const BASELINE = { cellW: 40, cellH: 56, frames: 6, rate: 8 };
const baseline = new Image();
baseline.src = baselineUrl;

/** One facing of the 3D render's walk, from the captured sheet. */
function baselineView(facing: Facing, scale: number): HTMLCanvasElement {
  const { cellW, cellH, frames, rate } = BASELINE;
  const canvas = h('canvas', { class: `sprite sprite--x${scale}`, width: String(SPRITE_W), height: String(SPRITE_H) });
  const ctx = canvas.getContext('2d')!;
  let shown = -1;
  views.push({
    canvas,
    draw: (seconds) => {
      const frame = Math.floor(seconds * rate) % frames;
      if (frame === shown || !baseline.complete) return;
      shown = frame;
      ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
      ctx.drawImage(baseline, frame * cellW + (cellW - SPRITE_W) / 2, facing * cellH + cellH - SPRITE_H, SPRITE_W, SPRITE_H, 0, 0, SPRITE_W, SPRITE_H);
    },
  });
  return canvas;
}

function segmented<T extends string>(label: string, options: [T, string][], initial: T, onChange: (value: T) => void): HTMLElement {
  const group = h('div', { class: 'segmented', role: 'group', 'aria-label': label }, h('span', {}, label));
  const buttons = options.map(([value, text]) => {
    const button = h('button', { type: 'button', 'aria-pressed': String(value === initial) }, text);
    button.addEventListener('click', () => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      onChange(value);
    });
    return button;
  });
  group.append(...buttons);
  return group;
}

const cell = (canvas: HTMLCanvasElement, caption: Child, extra?: Child) => h('figure', { class: 'cell' }, canvas, h('figcaption', {}, caption), extra);

// ------------------------------------------------------------------ generated items

interface Candidate {
  name: string;
  status: 'valid' | 'repaired' | 'rejected';
  detail: string;
  item: Item | null;
}

function candidates(format: Format, id: string): Candidate[] {
  const list = generated[`./generated/${format}-${id}.json`] ?? [];
  return list.map((raw) => {
    const name = String((raw as { name?: unknown }).name ?? 'Unnamed');
    const result = compile(format, raw);
    if (!result.ok) return { name, status: 'rejected', detail: result.error, item: null };
    const { item, repairs } = result.compiled;
    return { name, status: repairs.length ? 'repaired' : 'valid', detail: repairs.join('; '), item };
  });
}

const all: Record<Format, Record<string, Candidate[]>> = { sprite: {}, recipe: {} };
for (const request of requests) {
  all.sprite[request.id] = candidates('sprite', request.id);
  all.recipe[request.id] = candidates('recipe', request.id);
}

// One outfit picked from the candidates, used wherever a dressed character is shown.
const picked = [all.recipe.shirt?.[0], all.sprite.shorts?.[0], all.sprite.hat?.[2], all.sprite.spear?.[0]]
  .map((c) => c?.item)
  .filter((item): item is Item => !!item);
const bare = baseLook('skinB', 'hairBrown');
const dressed = wear(bare, ...picked);

// ------------------------------------------------------------------ base body, second version

function rebuilt(): HTMLElement {
  const idle = () => AUTHORED.idle;
  const before = h('div', { class: 'stage' },
    h('h3', {}, 'First version'),
    h('div', { class: 'strip strip--six' }, ...[0, 1, 2, 3, 4, 5].map((i) => stripView(firstBase, i, 3))),
  );
  const after = h('div', { class: 'stage' },
    h('h3', {}, 'Second version'),
    h('div', { class: 'strip strip--six' },
      ...FACINGS.map((f) => puppetView(bare, () => ({ clip: idle(), facing: f }), 3)),
      puppetView(dressed, () => ({ clip: idle(), facing: 0 }), 3),
      puppetView(dressed, () => ({ clip: idle(), facing: 3 }), 3),
    ),
  );
  const moving = (label: string, clip: Clip, look: Look) =>
    h('div', { class: 'stage' },
      h('h3', {}, label),
      h('div', { class: 'strip strip--four' }, ...FACINGS.map((f) => cell(puppetView(look, () => ({ clip, facing: f }), 3), FACING_NAMES[f]))),
    );
  const unarmed = { ...dressed, items: dressed.items.filter((item) => item.slot !== 'tool') };
  return h('section', {},
    h('h2', {}, 'The base body, rebuilt'),
    h('p', {}, 'You said the first body looked plain and generic, that one arm looked off and that the spear was not really held. This is the second version beside the first: the bare body in four facings, then dressed, front and back.'),
    before,
    after,
    h('div', { class: 'pair' }, moving('Walking with the spear', AUTHORED.walk, dressed), moving('Waving', AUTHORED.wave, unarmed)),
    h('div', { class: 'result' },
      h('h3', {}, 'What changed'),
      h('ul', {},
        h('li', {}, 'The arm. True isometry put one shoulder two pixels above the other, so the far arm hung from the neck. Shoulders are now level and the far arm sits behind the body in shade.'),
        h('li', {}, 'The grip. A pole now stands on the ground beside the body, the arm reaches out to it, and the fist is drawn over the shaft, from the front and from behind.'),
        h('li', {}, 'The face. Eyes three pixels tall with a shine, blush, an open smile, a blink in the idle and a laughing face for the wave.'),
        h('li', {}, 'Hair in clumps with a tuft that breaks the outline and a lit band across the crown.'),
        h('li', {}, 'Hands and feet as visible blocks, and legs with a gap between them.'),
        h('li', {}, 'Colour. Every material gets its shadow and highlight from one rule: shadows lean towards plum, highlights towards cream.'),
        h('li', {}, 'Separation without outlines: a shaded edge where the arm crosses the body, a shadow under the chin, and a ground shadow.'),
        h('li', {}, 'Motion: a breathing idle, a lean in the walk, and the hat arriving one frame late when the body rises or drops.'),
      ),
      h('p', {}, 'These follow common pixel-art practice for small sprites and how Stardew Valley, Habbo and the Liberated Pixel Cup characters are built. The research notes are in docs/pixel-style-research.md in the repository.'),
      h('p', {}, 'Still plain: the torso is a block, the back view has little to look at, and there is one body and one hairstyle. All generated items below were drawn for the first body and are shown on the second unchanged.'),
    ),
  );
}

// ------------------------------------------------------------------ experiment 1

function foundation(): HTMLElement {
  const walk = () => AUTHORED.walk;
  const puppet = h('div', { class: 'stage' },
    h('h3', {}, 'Rule-drawn puppet'),
    h('div', { class: 'strip strip--four' }, ...FACINGS.map((f) => cell(puppetView(dressed, () => ({ clip: walk(), facing: f }), 3), FACING_NAMES[f]))),
    h('div', { class: 'strip strip--four' }, ...FACINGS.map((f) => puppetView(dressed, () => ({ clip: walk(), facing: f }), 2))),
    h('p', { class: 'caption caption--page' }, 'Every pixel is placed by a drawing rule or comes from a small generated stamp. Wearing four of the generated items from experiment 3.'),
  );
  const render = h('div', { class: 'stage' },
    h('h3', {}, '3D model drawn at the same size'),
    h('div', { class: 'strip strip--four' }, ...FACINGS.map((f) => cell(baselineView(f, 3), FACING_NAMES[f]))),
    h('div', { class: 'strip strip--four' }, ...FACINGS.map((f) => baselineView(f, 2))),
    h('p', { class: 'caption caption--page' }, 'The 3D prototype rendered at this pixel density, with outlines switched off and flat colours.'),
  );
  return h('section', {},
    h('h2', {}, '1. Does a rule-drawn puppet read as pixel art?'),
    h('p', {}, 'Both columns show a walk cycle in the four diagonal facings, enlarged, with a smaller copy below. Each sprite is 32 by 48 pixels. Neither has an outline.'),
    h('div', { class: 'pair' }, puppet, render),
    h('div', { class: 'result' },
      h('h3', {}, 'What I see'),
      h('ul', {},
        h('li', {}, 'The puppet has straight limb edges, even stripes and a face made of chosen pixels. Its silhouette changes only where the pose changes.'),
        h('li', {}, 'The render has uneven edges and stray single pixels on hands, hair and the knife, and its silhouette shifts slightly from frame to frame.'),
        h('li', {}, 'The puppet is stiffer. Its torso is a rigid block and its limbs are flat, which suits the reference but is plainer than the 3D motion.'),
      ),
      h('p', {}, 'Whether the puppet meets your bar is for you to judge. It is closer to the reference photo than the render is.'),
    ),
  );
}

// ------------------------------------------------------------------ experiment 2

function motion(): HTMLElement {
  let key: 'idle' | 'walk' | 'wave' = 'walk';
  const strip = (source: Record<string, Clip>) =>
    h('div', { class: 'strip strip--four' }, ...FACINGS.map((f) => cell(puppetView(dressed, () => ({ clip: source[key], facing: f }), 3), FACING_NAMES[f])));
  const extra = (clipKey: string, label: string) =>
    h('div', { class: 'stage' },
      h('h3', {}, label),
      h('div', { class: 'strip strip--four' }, ...FACINGS.map((f) => cell(puppetView(dressed, () => ({ clip: SAMPLED[clipKey], facing: f }), 3), FACING_NAMES[f]))),
    );
  return h('section', {},
    h('h2', {}, '2. Can the 3D animation clips drive the puppet?'),
    h('p', {}, 'On the left, key poses written by hand as joint angles. On the right, the same actions sampled from the 3D prototype\'s clips at a few moments each. Only bone directions are taken from 3D; the drawing rules are the same on both sides.'),
    h('div', { class: 'controls' },
      segmented('Action', [['idle', 'Idle'], ['walk', 'Walk'], ['wave', 'Wave']], key, (value) => (key = value)),
    ),
    h('div', { class: 'pair' },
      h('div', { class: 'stage' }, h('h3', {}, 'Written key poses'), strip(AUTHORED)),
      h('div', { class: 'stage' }, h('h3', {}, 'Sampled from 3D clips'), strip(SAMPLED)),
    ),
    h('p', {}, 'Two more actions that exist only because the 3D library had them. They took no authoring.'),
    h('div', { class: 'pair' }, extra('run', 'Run, sampled'), extra('chop', 'Chop, sampled')),
    h('div', { class: 'result' },
      h('h3', {}, 'What I see'),
      h('ul', {},
        h('li', {}, 'The transfer works. Thirty-one clips are available this way, each costing a line of configuration.'),
        h('li', {}, 'Sampled motion carries the source character\'s posture: arms held away from the body and bent knees. It suits actions such as run and chop.'),
        h('li', {}, 'The written walk is tidier, because its poses were chosen for this size.'),
        h('li', {}, 'A pole stays planted beside the body in every action. Tools that swing, such as an axe in the chop, still need rotated versions.'),
      ),
      h('p', {}, 'A workable split: write the handful of poses seen all the time (idle, walk), and sample everything else.'),
    ),
  );
}

// ------------------------------------------------------------------ experiment 3

function generation(): HTMLElement {
  let clipKey: 'stand' | 'walk' | 'wave' = 'stand';
  let facing: Facing = 0;
  const clipOf = () => (clipKey === 'stand' ? STILL : AUTHORED[clipKey]);

  const blocks = requests.map((request) => {
    const formats = (['sprite', 'recipe'] as const).map((format) => {
      const list = all[format][request.id];
      const cells = list.map((candidate) => {
        const status = h('span', { class: `status status--${candidate.status}`, title: candidate.detail }, candidate.status === 'valid' ? 'valid' : candidate.status);
        if (!candidate.item) return h('figure', { class: 'cell' }, h('figcaption', {}, candidate.name), status);
        const look = wear(bare, candidate.item);
        return cell(puppetView(look, () => ({ clip: clipOf(), facing }), 3), candidate.name, status);
      });
      const seconds = (timings as Record<Format, Record<string, number>>)[format][request.id];
      return h('div', { class: 'format' },
        h('div', { class: 'format__head' }, h('h3', {}, FORMAT_NAMES[format]), h('span', { class: 'format__time' }, `${seconds} s for 3 candidates`)),
        h('div', { class: 'strip strip--candidates' }, ...cells),
      );
    });
    return h('div', { class: 'item' }, h('p', { class: 'item__request' }, `"${request.request}"`), h('div', { class: 'formats' }, ...formats));
  });

  const tally = (format: Format) => {
    const flat = Object.values(all[format]).flat();
    const seconds = Object.values((timings as Record<Format, Record<string, number>>)[format]);
    return h('tr', {},
      h('td', {}, FORMAT_NAMES[format]),
      h('td', {}, String(flat.filter((c) => c.status === 'valid').length)),
      h('td', {}, String(flat.filter((c) => c.status === 'repaired').length)),
      h('td', {}, String(flat.filter((c) => c.status === 'rejected').length)),
      h('td', {}, `${Math.min(...seconds)} to ${Math.max(...seconds)} s`),
    );
  };

  return h('section', {},
    h('h2', {}, '3. Which item format does a language model write well?'),
    h('p', {}, 'Five requests, each sent twice: once asking for the item painted over the whole 32 by 48 sprite, once asking for a recipe (clothing as a few settings drawn by rule; hats, beards and tools as small stamps). Every call was a fresh model call that saw only the format description and the request. All 30 results are shown exactly as returned, with no retries and no edits.'),
    h('div', { class: 'controls' },
      segmented('Show', [['stand', 'Standing'], ['walk', 'Walk'], ['wave', 'Wave']], clipKey, (value) => (clipKey = value)),
      segmented('Facing', FACINGS.map((f) => [String(f), FACING_NAMES[f]] as [string, string]), '0', (value) => (facing = Number(value) as Facing)),
    ),
    ...blocks,
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Format'), h('th', {}, 'Valid as returned'), h('th', {}, 'Auto-repaired'), h('th', {}, 'Rejected'), h('th', {}, 'Time per call'))),
        h('tbody', {}, tally('sprite'), tally('recipe')),
      ),
    ),
    h('div', { class: 'result' },
      h('h3', {}, 'What I see'),
      h('ul', {},
        h('li', {}, 'Both formats were reliable: every candidate parsed and stayed on the palette, and each item was drawn once and then followed the body in every pose and facing.'),
        h('li', {}, 'Clothing recipes are the fastest by far, 5 to 6 seconds for three candidates, and cannot come out misshapen. They can only express what the settings allow: no pocket, patch or contrasting hem unless a setting for it is added.'),
        h('li', {}, 'Whole-sprite paint is slower, 80 to 120 seconds per call, but freer. It produced a patch and a white frayed hem that the recipes had no setting for.'),
        h('li', {}, 'For tools, whole-sprite paint was clearly better: straight shafts with readable tips. The stamp versions lean and break into thin jagged lines.'),
        h('li', {}, 'Both formats drew beards wrongly from behind, as a tuft at the back of the neck. That needs a rule (hide beards in back views) or a touch-up.'),
        h('li', {}, 'The recipe shorts came out very short. That is my length scale in the format description, not the model.'),
      ),
      h('p', {}, 'Times include the overhead of running each call as a separate helper in this session, so read them as relative, not absolute.'),
    ),
  );
}

// ------------------------------------------------------------------ page

function findings(): HTMLElement {
  return h('section', { class: 'findings' },
    h('h2', {}, 'What I would take from this'),
    h('ul', {},
      h('li', {}, 'Build on the puppet. It gets the property that made 3D attractive, one definition working in every frame and facing, with pixels that are placed on purpose.'),
      h('li', {}, 'Use both formats, by item type: recipes for plain clothing and its wear states, whole-sprite paint for anything with a distinctive shape. Both end up as the same data, so the game and the curation tool see one kind of item.'),
      h('li', {}, 'Write the everyday poses by hand and sample the rest from the 3D clips.'),
      h('li', {}, 'Budget for curation. By my count about 18 of the 30 candidates are usable as returned. The six beards need their back view fixed, and the recipe shorts and stamp spears need a retry. A fresh opinion from you matters more than mine.'),
    ),
    h('h3', {}, 'Not tested here'),
    h('ul', {},
      h('li', {}, 'Consistency across a large catalogue. Fifteen candidates per format is a small sample.'),
      h('li', {}, 'Regenerating with a note, pixel touch-up, wear over time and beard growth. They are designed for but not built.'),
      h('li', {}, 'Hair that falls behind the shoulders, skirts, backpacks, and tools that rotate.'),
      h('li', {}, 'The base body, face and hair were also written by the model and corrected by looking at renders. The second version is at the top of this page; it is still one body and one hairstyle.'),
    ),
  );
}

const root = document.getElementById('lab')!;
root.append(
  h('main', { class: 'page' },
    h('header', { class: 'intro' },
      h('p', { class: 'kicker' }, 'Experiments for the 2D plan'),
      h('h1', {}, 'Pixel Puppet Lab'),
      h('p', { class: 'lede' }, 'A 2D replacement for the 3D character prototype: a 32 by 48 pixel survivor whose body is drawn by rules and whose clothing, hair and tools are written by a language model. First the rebuilt base body, then the three tests behind the approach.'),
    ),
    rebuilt(),
    foundation(),
    motion(),
    generation(),
    findings(),
  ),
);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const tick = (ms: number) => {
  const seconds = reduceMotion ? 0 : ms / 1000;
  for (const view of views) view.draw(seconds);
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
document.body.dataset.ready = '1';
