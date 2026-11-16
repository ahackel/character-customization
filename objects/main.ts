// The object editor: pick a thing, then change its size, parts and colours, see it in all four
// camera turns, and keep a named list on the device. Points for the game sit behind Expert tools.
// Built on the shared editor shell, like the wardrobe.
import {
  AXES, COLOR_KEYS, cleanProp, DEFAULT_PROP, drawObject, framesOf, heightOf, isShadow, KINDS, LOOP_RATE, LOOPS, MAX_HEIGHT, MAX_PARTS, MAX_TILES, newPart,
  ObjectSprite, OBJECT_H, OBJECT_W, PAINTS, propFile, readPropFile, SHAPES, UNIT,
  type ObjectFrame, type Part, type Prop, type Turn,
} from '../lab/object.ts';
import { OBJECT_PRESETS } from '../lab/object-presets.ts';
import { download, newId, pickFile } from '../lab/files.ts';
import { PALETTE, type PaletteKey } from '../lab/palette.ts';
import {
  button, checkbox, cheer, dragToTurn, h, history, NAMES, nameTag, pick, pickStart, row, savePicture, section, segmented, snapButton, tabs, tabTools, topBar, undoKeys, word,
  type IconName,
} from '../shared/shell.ts';
import { currentLang } from '../shared/lang.ts';

// ------------------------------------------------------------------ words

const LABEL: Record<string, [string, string]> = {
  furniture: ['Furniture', 'Möbel'], device: ['Device', 'Gerät'], garden: ['Garden', 'Garten'], car: ['Car', 'Auto'],
  box: ['Box', 'Quader'], cylinder: ['Cylinder', 'Zylinder'], ball: ['Ball', 'Kugel'],
  y: ['Standing', 'Stehend'], x: ['Lying across', 'Quer liegend'], z: ['Lying along', 'Längs liegend'],
  solid: ['Solid', 'Fest'], glow: ['Glows', 'Leuchtet'], water: ['Water', 'Wasser'],
  none: ['Still', 'Ruhig'], blink: ['Blinks', 'Blinkt'], flow: ['Flows', 'Fließt'], bob: ['Bobs', 'Hüpft'],
  px: ['Across (x)', 'Quer (x)'], py: ['Height above floor', 'Höhe über Boden'], pz: ['Along (z)', 'Längs (z)'],
  w: ['Width', 'Breite'], h: ['Height', 'Höhe'], d: ['Depth', 'Tiefe'],
  tw: ['Footprint width', 'Grundfläche Breite'], td: ['Footprint depth', 'Grundfläche Tiefe'],
};
const de = () => currentLang() === 'de';
const L = (en: string, german: string) => (de() ? german : en);
const label = (key: string) => (LABEL[key] ? LABEL[key][de() ? 1 : 0] : key);

// ------------------------------------------------------------------ state

const DRAFT_KEY = 'pixel-object-draft';
const ROSTER_KEY = 'pixel-objects';
const CURRENT_KEY = 'pixel-objects-current';
interface Saved { id: string; name: string; prop: Prop }

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    // Without storage the editor starts from the first preset.
    return fallback;
  }
};
const write = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

let prop = cleanProp(read(DRAFT_KEY, OBJECT_PRESETS[0].prop));
let roster: Saved[] = (() => {
  const list = read<unknown>(ROSTER_KEY, []);
  return Array.isArray(list)
    ? list.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string').map((s) => ({ id: s.id, name: s.name.slice(0, 40), prop: cleanProp(s.prop) }))
    : [];
})();
let currentId: string | null = read<string | null>(CURRENT_KEY, null);
if (!roster.some((s) => s.id === currentId)) currentId = null;

const current = () => roster.find((s) => s.id === currentId);
// Opening the editor shows the object picked in My things, even if the draft moved on.
if (current()) prop = structuredClone(current()!.prop);
const EXPERT_KEY = 'pixel-objects-expert';
let expert = read<boolean>(EXPERT_KEY, false) === true;

type TabId = 'things' | 'size' | 'parts' | 'points';
const TABS: [TabId, string, string, IconName][] = [['things', 'Things', 'Dinge', 'armchair'], ['size', 'Size', 'Größe', 'box'], ['parts', 'Parts', 'Teile', 'shapes'], ['points', 'Points', 'Punkte', 'pin']];
let tab: TabId = 'things';
let turn: Turn = 0;
let selected = 0;
let paused = false;
let version = 0;
let crop: Crop = { x: 0, y: 0, w: OBJECT_W, h: OBJECT_H };
const GROUNDS = [['Floor', 'Boden', '#d9d3c4'], ['Grass', 'Gras', '#8fcf78'], ['Path', 'Weg', '#c9bfae']] as const;
let ground: string = GROUNDS[0][2];
let message = '';

// ------------------------------------------------------------------ drawing

interface Crop { x: number; y: number; w: number; h: number }

/** A square around the object in every turn, so the view does not jump when turning. */
function cropFor(p: Prop): Crop {
  let x0 = OBJECT_W, y0 = OBJECT_H, x1 = 0, y1 = 0;
  for (const at of [0, 1, 2, 3] as const) {
    const { sprite } = drawObject(p, at);
    for (let y = 0; y < OBJECT_H; y++) for (let x = 0; x < OBJECT_W; x++) {
      if (!sprite.get(x, y)) continue;
      x0 = Math.min(x0, x, OBJECT_W - 1 - x); x1 = Math.max(x1, x, OBJECT_W - 1 - x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const side = Math.max(24, x1 - x0 + 5, y1 - y0 + 5);
  return { x: Math.round(OBJECT_W / 2 - side / 2), y: Math.round((y0 + y1) / 2 - side / 2), w: side, h: side };
}

function paint(canvas: HTMLCanvasElement, sprite: ObjectSprite, crop: Crop): void {
  if (canvas.width !== crop.w || canvas.height !== crop.h) Object.assign(canvas, { width: crop.w, height: crop.h });
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(crop.w, crop.h);
  for (let y = 0; y < crop.h; y++) for (let x = 0; x < crop.w; x++) {
    const hex = sprite.get(x + crop.x, y + crop.y);
    if (!hex) continue;
    const o = (y * crop.w + x) * 4;
    for (let k = 0; k < 3; k++) image.data[o + k] = parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
    image.data[o + 3] = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
  }
  ctx.putImageData(image, 0, 0);
}

/** Whole-number enlargement that fits a box, so pixels stay square. */
function fit(canvas: HTMLCanvasElement, box: number): void {
  const scale = Math.max(1, Math.floor(box / Math.max(canvas.width, canvas.height)));
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
}

/** A small picture of an object, trimmed to what it paints. */
function thumbnail(p: Prop, box = 60): HTMLCanvasElement {
  const { sprite } = drawObject(p, 0);
  let x0 = OBJECT_W, y0 = OBJECT_H, x1 = 0, y1 = 0;
  for (let y = 0; y < OBJECT_H; y++) for (let x = 0; x < OBJECT_W; x++) {
    const hex = sprite.get(x, y);
    if (!hex || isShadow(hex)) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const canvas = h('canvas', { class: 'thumb' });
  paint(canvas, sprite, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  fit(canvas, box);
  return canvas;
}

// ------------------------------------------------------------------ saving

const undo = history(() => prop, (value) => {
  prop = value;
  persist();
  crop = cropFor(prop);
  render();
});

function storeRoster(note = ''): void {
  message = write(ROSTER_KEY, roster) ? note : L('Could not save: this browser refuses storage here.', 'Nicht gespeichert: Dieser Browser erlaubt hier keinen Speicher.');
}

/** Keeps the draft and, if one is picked, its entry in My things. */
function persist(): void {
  version++;
  write(DRAFT_KEY, prop);
  selected = Math.max(0, Math.min(selected, prop.parts.length - 1));
  const saved = current();
  if (saved) {
    saved.prop = structuredClone(prop);
    storeRoster();
  }
}

function changed(): void {
  undo.commit();
  message = '';
  persist();
  // The crop takes four drawings, so a slider drag keeps the old one until release.
  crop = cropFor(prop);
  render();
}
function setCurrent(id: string | null): void {
  currentId = id;
  write(CURRENT_KEY, id);
}
function addThing(name: string, from: Prop): void {
  const saved = { id: newId(), name: name.slice(0, 40), prop: structuredClone(from) };
  roster.push(saved);
  setCurrent(saved.id);
  storeRoster();
}
function load(next: Prop, id: string | null): void {
  prop = structuredClone(next);
  selected = 0;
  setCurrent(id);
  undo.reset();
  persist();
  crop = cropFor(prop);
  render();
}
function renameThing(name: string): void {
  const saved = current();
  if (saved) {
    if (saved.name === name) return;
    saved.name = name.slice(0, 40);
    storeRoster();
  } else addThing(name, prop);
  render();
}
function remove(): void {
  const saved = current();
  if (!saved || !confirm(L(`Delete "${saved.name}" from this device?`, `„${saved.name}“ von diesem Gerät löschen?`))) return;
  roster = roster.filter((s) => s !== saved);
  setCurrent(null);
  storeRoster(L(`Deleted "${saved.name}".`, `„${saved.name}“ gelöscht.`));
  render();
}
async function importFile(): Promise<void> {
  let file: { name: string; prop: Prop };
  try {
    file = readPropFile(await pickFile());
  } catch {
    message = L('That file is not an object.', 'Diese Datei ist kein Objekt.');
    return render();
  }
  addThing(file.name, file.prop);
  message = L(`Imported "${file.name}".`, `„${file.name}“ importiert.`);
  load(file.prop, currentId);
}

// ------------------------------------------------------------------ shuffle

/** New colours for every part; parts of one colour stay one colour. */
function recolour(p: Prop): Prop {
  const next = structuredClone(p);
  const map = new Map<PaletteKey, PaletteKey>();
  for (const part of next.parts) {
    if (!map.has(part.color)) map.set(part.color, pick(COLOR_KEYS));
    part.color = map.get(part.color)!;
  }
  return next;
}
/** A random thing: one of the presets in new colours. */
const roll = () => recolour(pick(OBJECT_PRESETS).prop);
function shuffle(only?: TabId): void {
  prop = only === 'parts' ? recolour(prop) : roll();
  changed();
  cheer(stage);
}

// ------------------------------------------------------------------ controls

/** A slider. The preview follows while dragging; the panel is rebuilt only on release, so the drag is not interrupted. */
function slider(title: string, value: number, min: number, max: number, set: (v: number) => void): HTMLElement {
  const input = h('input', { type: 'range', class: 'slider', min: String(min), max: String(max), step: '1', 'aria-label': title });
  input.value = String(value);
  const out = h('b', {}, String(value));
  input.addEventListener('input', () => {
    set(Number(input.value));
    out.textContent = input.value;
    // Only the preview follows a drag; the crop and the panel wait for the release.
    version++;
  });
  input.addEventListener('change', () => changed());
  return row(title, input, out);
}

function choice<T extends string>(title: string, values: readonly T[], value: T, set: (v: T) => void): HTMLElement {
  return row(title, segmented(title, values.map((v) => ({ id: v, label: label(v) })), value, (v) => {
    set(v);
    changed();
  }));
}

function swatches(title: string, value: PaletteKey, set: (key: PaletteKey) => void): HTMLElement {
  return row(title, h('div', { class: 'swatches' }, ...COLOR_KEYS.map((key) => {
    const b = h('button', {
      type: 'button', class: 'swatch', 'aria-pressed': String(key === value), 'aria-label': `${title}: ${key}`, title: key,
      style: `--swatch: ${PALETTE[key].base}; --swatch-shade: ${PALETTE[key].shade}`,
    });
    b.addEventListener('click', () => {
      set(key);
      changed();
    });
    return b;
  })));
}

const press = (text: string, onClick: () => void, pressed?: boolean, disabled = false) => {
  const b = button({ class: 'toggle', ...(pressed === undefined ? {} : { 'aria-pressed': String(pressed) }) }, onClick, text);
  b.disabled = disabled;
  return b;
};
const partName = (p: Part, i: number) => `${i + 1} ${label(p.shape)}`;

function panelFor(id: TabId): HTMLElement[] {
  const reach = prop.w * UNIT + 8;
  const deep = prop.d * UNIT + 8;
  switch (id) {
    case 'things': {
      const grid = h('div', { class: 'grid' });
      for (const preset of OBJECT_PRESETS) {
        const card = h('button', { type: 'button', class: 'card', 'aria-pressed': String(JSON.stringify(preset.prop) === JSON.stringify(prop)) },
          h('span', { class: 'card__picture' }, thumbnail(preset.prop)),
          h('span', { class: 'card__label' }, preset.name),
        );
        card.addEventListener('click', () => {
          prop = structuredClone(preset.prop);
          selected = 0;
          changed();
        });
        grid.append(card);
      }
      return [section(L('Things', 'Dinge'), grid, h('p', { class: 'note' }, L(
        'The furniture, devices, fountain and cars of Animal Hospital, built from parts. Pick one, then change its size, parts and colours.',
        'Die Möbel, Geräte, der Brunnen und die Autos aus Animal Hospital, aus Teilen gebaut. Wähle eines und ändere Größe, Teile und Farben.')))];
    }
    case 'size':
      return [section(L('Size', 'Größe'),
        choice(L('Kind', 'Art'), KINDS, prop.kind, (v) => { prop.kind = v; }),
        slider(label('tw'), prop.w, 1, MAX_TILES, (v) => { prop.w = v; }),
        slider(label('td'), prop.d, 1, MAX_TILES, (v) => { prop.d = v; }),
        h('p', { class: 'note' }, L(
          `Tiles are 32×16 pixels. Across the floor a part is measured in sixteenths of a tile edge (${UNIT} to a tile), up in pixels; people are 48 px tall.`,
          `Felder sind 32×16 Pixel. Über den Boden misst ein Teil in Sechzehnteln einer Feldkante (${UNIT} pro Feld), nach oben in Pixeln; Menschen sind 48 px groß.`)),
      )];
    case 'parts': {
      const part = prop.parts[selected];
      const list = h('div', { class: 'toggles' }, ...prop.parts.map((p, i) => press(partName(p, i), () => {
        selected = i;
        render();
      }, i === selected)));
      const add = (shape: Part['shape']) => {
        if (prop.parts.length >= MAX_PARTS) return;
        prop.parts.push(newPart({ shape, x: Math.max(0, prop.w * 8 - 4), z: Math.max(0, prop.d * 8 - 4) }));
        selected = prop.parts.length - 1;
        changed();
      };
      const actions = h('div', { class: 'toggles' },
        ...SHAPES.map((s) => press(`+ ${label(s)}`, () => add(s), undefined, prop.parts.length >= MAX_PARTS)),
        press(L('Duplicate', 'Verdoppeln'), () => {
          prop.parts.splice(selected + 1, 0, { ...part, x: part.x + 2 });
          selected++;
          changed();
        }, undefined, !part || prop.parts.length >= MAX_PARTS),
        press(L('Delete', 'Löschen'), () => {
          prop.parts.splice(selected, 1);
          changed();
        }, undefined, prop.parts.length <= 1),
      );
      if (!part) return [section(L('Parts', 'Teile'), list, actions)];
      return [
        section(L('Parts (or tap the picture)', 'Teile (oder ins Bild tippen)'), list, actions),
        section(L('Look', 'Aussehen'),
          swatches(L('Colour', 'Farbe'), part.color, (k) => { part.color = k; }),
          choice(L('Shape', 'Form'), SHAPES, part.shape, (v) => { part.shape = v; }),
          part.shape === 'cylinder' ? choice(L('Lies', 'Lage'), AXES, part.axis, (v) => { part.axis = v; }) : '',
          choice(L('Paint', 'Anstrich'), PAINTS, part.paint, (v) => { part.paint = v; }),
          choice(L('Loop', 'Bewegung'), LOOPS, part.loop, (v) => { part.loop = v; }),
        ),
        section(L('Place and size', 'Lage und Größe'),
          slider(label('px'), part.x, -8, reach, (v) => { part.x = v; }),
          slider(label('pz'), part.z, -8, deep, (v) => { part.z = v; }),
          slider(label('py'), part.y, 0, MAX_HEIGHT - 1, (v) => { part.y = v; part.h = Math.min(part.h, MAX_HEIGHT - v); }),
          slider(label('w'), part.w, 1, reach, (v) => { part.w = v; }),
          slider(label('d'), part.d, 1, deep, (v) => { part.d = v; }),
          slider(label('h'), part.h, 1, MAX_HEIGHT - part.y, (v) => { part.h = v; }),
        ),
      ];
    }
    case 'points': {
      const rows = prop.points.map((pt, i) => {
        const name = h('input', { type: 'text', class: 'select', value: pt.name, maxlength: '16', 'aria-label': L('Point name', 'Name des Punkts') });
        name.addEventListener('change', () => {
          const v = name.value.trim().toLowerCase();
          if (/^[a-z][a-z0-9]{0,15}$/.test(v)) pt.name = v;
          changed();
        });
        return section(pt.name,
          h('div', { class: 'toggles' }, name, press(L('Delete', 'Löschen'), () => {
            prop.points.splice(i, 1);
            changed();
          })),
          slider(label('px'), pt.x, -8, reach, (v) => { pt.x = v; }),
          slider(label('pz'), pt.z, -8, deep, (v) => { pt.z = v; }),
          slider(label('py'), pt.y, 0, MAX_HEIGHT, (v) => { pt.y = v; }),
        );
      });
      return [
        ...rows,
        h('div', { class: 'toggles', style: 'margin-top: 12px' }, press(L('+ Point', '+ Punkt'), () => {
          prop.points.push({ name: `point${prop.points.length + 1}`, x: prop.w * 8, y: 10, z: prop.d * 8 });
          changed();
        }, undefined, prop.points.length >= 8)),
        h('p', { class: 'note' }, L(
          'Points tell the game where things go: "bed" where an animal lies or stands (its feet), "screen" on a desk, "seat1" and "seat2" on a bench. Shown in pink, faint when hidden behind the object.',
          'Punkte sagen dem Spiel, wo etwas hingehört: „bed“, wo ein Tier liegt oder steht (seine Füße), „screen“ auf einem Schreibtisch, „seat1“ und „seat2“ auf einer Bank. Rosa gezeigt, blass wenn vom Objekt verdeckt.')),
      ];
    }
  }
}

// ------------------------------------------------------------------ page

const root = document.getElementById('objects')!;
const stage = h('div', { class: 'stage' });
const hero = h('canvas', { class: 'stage__sprite', style: 'cursor: crosshair' });
const stageTag = h('span', { class: 'stage__tag' });
const sideSlider = h('input', { type: 'range', class: 'slider', min: '0', max: '3', step: '1' });
const sideValue = h('b');
const previewRows = h('div', { class: 'sec__body' });
const tabSlot = h('div');
const panel = h('div', { class: 'library__body', role: 'tabpanel' });
panel.addEventListener('click', (e) => (e.target as Element).closest('.card, .swatch') && cheer(stage));
const barSlot = h('div', { style: 'display: contents' });
const name = nameTag();
name.onRename(renameThing);
const TURN_NAMES = ['0°', '90°', '180°', '270°'];
let sizeText = '';

function setTurn(next: Turn): void {
  turn = next;
  sideSlider.value = String(turn);
  sideSlider.setAttribute('aria-valuetext', TURN_NAMES[turn]);
  sideValue.textContent = TURN_NAMES[turn];
  stageTag.textContent = `${TURN_NAMES[turn]} · ${sizeText}`;
}

/** New: pick one of three rolled things, straight into My things. */
function newThing(): void {
  pickStart(() => [...OBJECT_PRESETS].sort(() => Math.random() - 0.5).slice(0, 3).map((preset) => {
    const look = recolour(preset.prop);
    return {
      label: preset.name,
      picture: thumbnail(look, 150),
      choose: () => {
        addThing(preset.name, look);
        load(look, currentId);
        cheer(stage);
      },
    };
  }));
}

function renderBar(): void {
  const saved = current();
  const picker = h('select', { class: 'select bar__things', 'aria-label': L('My things', 'Meine Sachen') },
    h('option', { value: '' }, L('Not saved yet', 'Noch nicht gespeichert')), ...roster.map((s) => h('option', { value: s.id }, s.name)));
  picker.value = currentId ?? '';
  picker.addEventListener('change', () => {
    const chosen = roster.find((s) => s.id === picker.value);
    message = '';
    if (chosen) load(chosen.prop, chosen.id);
    else {
      setCurrent(null);
      render();
    }
  });
  const fileName = saved?.name ?? L('Object', 'Objekt');
  const { bar, undo: undoButton, redo: redoButton, pops } = topBar({
    tool: 'objects',
    title: word('objects'),
    about: [
      L('Build furniture, devices and cars from boxes, cylinders and balls on a tile footprint. Rules draw them in the island look, in all four camera turns. Made for Animal Hospital.',
        'Baue Möbel, Geräte und Autos aus Quadern, Zylindern und Kugeln auf einer Grundfläche aus Feldern. Regeln zeichnen sie im Insel-Stil, in allen vier Kameradrehungen. Gemacht für Animal Hospital.'),
      L('Every part is ray-cast in the 2:1 view with the master palette and the light of the plants: tops light, fronts in their colour, sides in shade. All four turns are drawn, so an object need not be symmetric.',
        'Jedes Teil wird in der 2:1-Ansicht mit der Hauptpalette und dem Licht der Pflanzen gezeichnet: Oberseiten hell, Fronten in ihrer Farbe, Seiten im Schatten. Alle vier Drehungen werden gezeichnet, ein Objekt muss also nicht symmetrisch sein.'),
      L('Files are JSON of type "pixel-object". The game draws them with drawObject() from lab/object.ts, which also gives the points for every frame.',
        'Dateien sind JSON vom Typ „pixel-object“. Das Spiel zeichnet sie mit drawObject() aus lab/object.ts, das für jedes Bild auch die Punkte liefert.'),
    ],
    things: picker,
    more: [
      { label: L('New object', 'Neues Objekt'), icon: 'plus', run: newThing },
      { label: saved ? L('Make a copy', 'Kopie machen') : L('Keep in My things', 'In Meine Sachen behalten'), icon: 'copy', run: () => {
        addThing(saved ? `${saved.name} 2` : pick(NAMES), prop);
        render();
      } },
      { label: L('Start over', 'Neu beginnen'), icon: 'reset', run: () => {
        prop = structuredClone(DEFAULT_PROP);
        selected = 0;
        changed();
      } },
      { label: L('Export', 'Exportieren'), icon: 'download', run: () => download(`${fileName}.json`, propFile(fileName, prop)) },
      { label: L('Import', 'Importieren'), icon: 'upload', run: () => void importFile() },
      { label: expert ? L('Expert tools: on', 'Expertenwerkzeuge: an') : L('Expert tools: off', 'Expertenwerkzeuge: aus'), icon: 'sliders', run: () => {
        expert = !expert;
        write(EXPERT_KEY, expert);
        if (!expert && tab === 'points') tab = 'things';
        render();
      } },
      { label: L('Delete', 'Löschen'), icon: 'trash', run: remove, danger: true, disabled: !saved },
    ],
    status: h('span', { class: 'bar__status', 'aria-live': 'polite' }, message || (saved ? L('Saved by itself', 'Speichert sich selbst') : '')),
    undo: undo.undo,
    redo: undo.redo,
    shuffle: () => shuffle(),
    relabel: () => {
      mount();
      render();
      shownVersion = -1;
    },
  });
  undoButton!.disabled = !undo.canUndo();
  redoButton!.disabled = !undo.canRedo();
  barSlot.replaceChildren(bar, ...pops);
}

function render(): void {
  stage.style.setProperty('--ground', ground);
  renderBar();
  setTurn(turn);
  name.set(current()?.name ?? '', L('Not saved yet', 'Noch nicht gespeichert'));
  const shownTabs = TABS.filter(([id]) => id !== 'points' || expert);
  // The die rolls a new thing, or new colours on the Parts tab; there is nothing to lock.
  const die = tab === 'things' || tab === 'parts' ? tabTools(() => shuffle(tab)) : [];
  tabSlot.replaceChildren(tabs(L('Sections', 'Bereiche'), shownTabs.map(([id, en, german, icon]) => ({ id, label: L(en, german), icon })), tab, (id) => {
    tab = id;
    panel.scrollTop = 0;
    render();
  }, new Set(), die));
  const scroll = panel.scrollTop;
  panel.replaceChildren(...panelFor(tab));
  panel.scrollTop = scroll;
  previewRows.replaceChildren(
    row(L('Turn', 'Drehung'), sideSlider, sideValue),
    row('', checkbox(word('animate'), !paused, (on) => {
      paused = !on;
    })),
    row(L('Ground', 'Boden'), segmented(L('Ground', 'Boden'), GROUNDS.map(([en, german, color]) => ({ id: color as string, label: L(en, german) })), ground, (color) => {
      ground = color;
      render();
    })),
  );
  shown = '';
}

/** Builds the page. Called again when the language changes, since every label is rebuilt. */
function mount(): void {
  document.documentElement.lang = currentLang();
  document.title = L('Object Editor', 'Objekt-Editor');
  sideSlider.setAttribute('aria-label', L('Turn', 'Drehung'));
  stage.replaceChildren(hero, stageTag, name.el, snapButton(() => savePicture(hero, current()?.name ?? L('Object', 'Objekt'))));
  const preview = h('details', { class: 'sec' }, h('summary', {}, word('preview')), previewRows);
  preview.open = true;
  root.replaceChildren(
    h('div', { class: 'shell' },
      barSlot,
      h('main', { class: 'shell__main' },
        h('section', { class: 'preview', 'aria-label': L('Preview', 'Vorschau') }, stage, preview),
        h('section', { class: 'library', 'aria-label': L('Object', 'Objekt') }, tabSlot, panel),
      ),
    ),
  );
}

// What the preview shows now; render() clears `shown` so marks follow the panel.
let shownVersion = -1;
let shown = '';
let ticks = 0;
let frameNow = 0;

// Tapping the picture picks the part under the pointer.
hero.addEventListener('click', (event) => {
  const box = hero.getBoundingClientRect();
  const x = Math.floor(((event.clientX - box.left) / box.width) * crop.w) + crop.x;
  const y = Math.floor(((event.clientY - box.top) / box.height) * crop.h) + crop.y;
  const i = drawObject(prop, turn, frameNow).partAt[y * OBJECT_W + x];
  if (i === undefined || i < 0) return;
  selected = i;
  tab = 'parts';
  render();
});

sideSlider.addEventListener('input', () => setTurn(Number(sideSlider.value) as Turn));
dragToTurn(stage, (step) => setTurn(((turn + step + 4) % 4) as Turn));
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.metaKey || event.ctrlKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setTurn(((turn + (event.key === 'ArrowRight' ? 1 : 3)) % 4) as Turn);
});
undoKeys(undo.undo, undo.redo);

mount();
crop = cropFor(prop);
render();

const frames = new Map<string, ObjectFrame>();
const frameOf = (at: Turn, frame: number) => {
  const key = `${at}|${frame}`;
  let hit = frames.get(key);
  if (!hit) frames.set(key, (hit = drawObject(prop, at, frame)));
  return hit;
};
const tick = (ms: number) => {
  if (shownVersion !== version) {
    shownVersion = version;
    frames.clear();
    sizeText = L(`${prop.w}×${prop.d} tiles, ${heightOf(prop)} px`, `${prop.w}×${prop.d} Felder, ${heightOf(prop)} px`);
    setTurn(turn);
  }
  if (!paused) ticks = ms;
  frameNow = Math.floor((ticks / 1000) * LOOP_RATE) % framesOf(prop);
  const key = `${version}|${turn}|${frameNow}|${tab}|${selected}|${stage.clientWidth}`;
  if (key !== shown) {
    shown = key;
    const { sprite, points, partAt } = frameOf(turn, frameNow);
    // Marks go on a copy, not on the cached frame.
    const marked = new ObjectSprite();
    sprite.pixels.forEach((c, i) => (marked.pixels[i] = c));
    if (tab === 'parts') {
      // The chosen part's outline in pink.
      for (let y = 1; y < OBJECT_H - 1; y++) for (let x = 1; x < OBJECT_W - 1; x++) {
        const at = y * OBJECT_W + x;
        if (partAt[at] === selected && [1, -1, OBJECT_W, -OBJECT_W].some((o) => partAt[at + o] !== selected)) marked.set(x, y, '#ff00ff');
      }
    }
    if (tab === 'points') for (const p of Object.values(points)) marked.set(p.x, p.y, p.visible ? '#ff00ff' : '#ff00ff66');
    paint(hero, marked, crop);
    fit(hero, Math.min(stage.clientWidth, stage.clientHeight) - 40);
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
document.body.dataset.ready = '1';
