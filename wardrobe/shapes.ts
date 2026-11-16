// The eye and mouth shape editor: a small pixel editor over the face, for the shapes every
// character uses (lab/face-shapes.json). Changes show at once; Save writes them into the project
// through the dev server, which only exists while developing.
import { EYE_SHAPES, EYE_STATES, FACE_REGIONS, FACE_SHAPES, FACE_VIEWS, faceRows, headRows, MOODS, type EyeState, type FaceOptions, type FaceView, type Mood } from '../lab/base.ts';
import { PALETTE, type PaletteKey } from '../lab/palette.ts';
import { button, h, row, segmented } from '../shared/shell.ts';
import { t, type Key } from './i18n.ts';

export interface ShapeContext {
  face: FaceOptions;
  skin: PaletteKey;
  hair: PaletteKey;
  mood: Mood;
  /** A pixel changed: redraw the preview. */
  live: () => void;
  /** A stroke ended: rebuild the pictures. */
  done: () => void;
  /** Turn the preview to show this view. */
  show: (view: FaceView) => void;
}

// What is being edited stays picked while the panel is rebuilt.
let feature: 'eyes' | 'mouths' = 'eyes';
let view: FaceView = 'diagonal';
let eyeShape: (typeof EYE_SHAPES)[number] | null = null;
let eyeState: EyeState = 'open';
let mouth: Mood | null = null;
let ink = 'I';
let status = '';
let dirty = false;

/** The letters a shape can hold, with a label each; '.' leaves the skin. */
const INKS: { id: string; key: Key }[] = [
  { id: 'I', key: 'shapes.ink.I' }, { id: 'C', key: 'shapes.ink.C' }, { id: 'T', key: 'shapes.ink.T' },
  { id: 'M', key: 'shapes.ink.M' }, { id: '%', key: 'shapes.ink.%' }, { id: '.', key: 'shapes.ink..' },
];

/** The mood, blink and glance that show an eye state. */
const SHOWS: Record<EyeState, [Mood, boolean, boolean]> = {
  open: ['neutral', false, false], aside: ['neutral', false, true], blink: ['neutral', true, false], laughing: ['laughing', false, false],
  surprised: ['surprised', false, false], 'surprised-aside': ['surprised', false, true], angry: ['angry', false, false], 'angry-aside': ['angry', false, true],
  sad: ['sad', false, false], 'sad-aside': ['sad', false, true],
};

// The part of the head grid shown: brows to chin, ear to nose.
const CROP = { x: 2, y: 8, w: 19, h: 14 };
const CELL = 16;

export function shapeEditor(ctx: ShapeContext): HTMLElement {
  eyeShape ??= ctx.face.eyes;
  mouth ??= ctx.mood;
  const shapes = () => (feature === 'eyes' ? FACE_SHAPES.eyes[view][eyeShape!][eyeState] : FACE_SHAPES.mouths[view][mouth!]);
  const region = () => FACE_REGIONS[feature][view];
  const canvas = h('canvas', { class: 'shapes__canvas', width: String(CROP.w * CELL), height: String(CROP.h * CELL) });
  const g = canvas.getContext('2d')!;

  const colour = (ch: string): string | null => {
    const tone = (key: PaletteKey, shade = false) => PALETTE[key][shade ? 'shade' : 'base'];
    switch (ch) {
      case '#': return tone(ctx.skin);
      case '%': return tone(ctx.skin, true);
      case '+': return PALETTE[ctx.skin].light;
      case 'I': return tone('ink');
      case 'C': return tone(ctx.face.eyeColor ?? 'ink');
      case 'T': return tone('tooth');
      case 'M': return tone('mouth');
      case 'B': return tone('blush');
      case 'e': return tone(ctx.hair, true);
      case 'G': return tone(ctx.face.glassesColor ?? 'black');
      default: return null;
    }
  };

  const draw = () => {
    const [mood, blink, aside] = feature === 'eyes' ? SHOWS[eyeState] : [mouth!, false, false];
    const head = headRows(view, ctx.face.shape);
    const face = faceRows({ ...ctx.face, eyes: eyeShape! }, mood, blink, aside, view);
    const [rx, ry, rw, rh] = region();
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < CROP.h; y++) {
      for (let x = 0; x < CROP.w; x++) {
        const hx = x + CROP.x, hy = y + CROP.y;
        const inside = hx >= rx && hx < rx + rw && hy >= ry && hy < ry + rh;
        const fill = colour(face[hy]?.[hx] ?? '.') ?? colour(head[hy]?.[hx] ?? '.');
        if (!fill) continue;
        g.globalAlpha = inside ? 1 : 0.45;
        g.fillStyle = fill;
        g.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    g.globalAlpha = 1;
    // A grid over the editable cells and a frame round them.
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 1;
    for (let i = 0; i <= rw; i++) g.strokeRect((rx - CROP.x + i) * CELL + 0.5, (ry - CROP.y) * CELL + 0.5, 0, rh * CELL);
    for (let j = 0; j <= rh; j++) g.strokeRect((rx - CROP.x) * CELL + 0.5, (ry - CROP.y + j) * CELL + 0.5, rw * CELL, 0);
    g.strokeStyle = '#e8487a';
    g.lineWidth = 2;
    g.strokeRect((rx - CROP.x) * CELL, (ry - CROP.y) * CELL, rw * CELL, rh * CELL);
  };

  // Painting: press and drag; the right button rubs out.
  let painting: string | null = null;
  const paintAt = (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * CROP.w) + CROP.x;
    const y = Math.floor(((e.clientY - box.top) / box.height) * CROP.h) + CROP.y;
    const [rx, ry, rw, rh] = region();
    if (painting === null || x < rx || x >= rx + rw || y < ry || y >= ry + rh) return;
    const rows = shapes();
    const line = rows[y - ry];
    if (line[x - rx] === painting) return;
    rows[y - ry] = line.slice(0, x - rx) + painting + line.slice(x - rx + 1);
    dirty = true;
    status = t('shapes.unsaved');
    statusEl.textContent = status;
    draw();
    ctx.live();
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    painting = e.button === 2 ? '.' : ink;
    canvas.setPointerCapture(e.pointerId);
    paintAt(e);
  });
  canvas.addEventListener('pointermove', paintAt);
  const end = () => {
    if (painting === null) return;
    painting = null;
    ctx.done();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const statusEl = h('span', { class: 'shapes__status', role: 'status' }, status);
  const save = async () => {
    try {
      const response = await fetch('/__face-shapes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(FACE_SHAPES) });
      if (!response.ok) throw new Error(await response.text());
      dirty = false;
      status = t('shapes.saved');
    } catch {
      status = t('shapes.failed');
    }
    statusEl.textContent = status;
  };

  const rebuild = () => ctx.done();
  const picker = feature === 'eyes'
    ? [
        row(t('eyes'), segmented(t('eyes'), EYE_SHAPES.map((id) => ({ id, label: t(`eyes.${id}` as Key) })), eyeShape!, (id) => {
          eyeShape = id;
          rebuild();
        })),
        row(t('shapes.state'), segmented(t('shapes.state'), EYE_STATES.map((id) => ({ id, label: t(`shapes.state.${id}` as Key) })), eyeState, (id) => {
          eyeState = id;
          rebuild();
        }, 'seg seg--wrap')),
      ]
    : [
        row(t('mood'), segmented(t('mood'), MOODS.map((id) => ({ id, label: t(`mood.${id}` as Key) })), mouth!, (id) => {
          mouth = id;
          rebuild();
        }, 'seg seg--wrap')),
      ];

  draw();
  return h('div', { class: 'shapes' },
    h('p', { class: 'note' }, t('shapes.note')),
    row(t('shapes.part'), segmented(t('shapes.part'), [{ id: 'eyes' as const, label: t('eyes') }, { id: 'mouths' as const, label: t('shapes.mouth') }], feature, (id) => {
      feature = id;
      rebuild();
    })),
    row(t('shapes.view'), segmented(t('shapes.view'), FACE_VIEWS.map((id) => ({ id, label: t(`shapes.view.${id}` as Key) })), view, (id) => {
      view = id;
      ctx.show(id);
      rebuild();
    })),
    ...picker,
    row(t('shapes.inkLabel'), segmented(t('shapes.inkLabel'), INKS.map((i) => ({ id: i.id, label: t(i.key) })), ink, (id) => {
      ink = id;
      rebuild();
    }, 'seg seg--wrap')),
    canvas,
    h('div', { class: 'shapes__actions' },
      import.meta.env.DEV
        ? button({ class: 'shapes__save' }, () => void save(), t('shapes.save'))
        : h('span', { class: 'note' }, t('shapes.devOnly')),
      dirty && import.meta.env.DEV && button({}, () => location.reload(), t('shapes.revert')),
      statusEl),
  );
}
