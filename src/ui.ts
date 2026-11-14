import type { Assets, ItemDef, SlotId } from './assets';
import { ACTIONS, type ActionId } from './actor';
import type { Look } from './character';
import { drawFace, EYE_STYLES, FACE_SIZE, MOUTH_STYLES, type FaceStyle } from './face';
import { EYE_COLORS, HAIR_COLORS, ITEM_COLORS, SKIN_TONES } from './looks';
import type { Thumbnails } from './thumbnails';

export type Toggle = 'outline' | 'juice' | 'shadows';
export type Gait = 'stand' | 'walk' | 'run';

export interface UiHost {
  assets: Assets;
  thumbnails: Thumbnails;
  look(): Look;
  /** The worn item that hides this slot, if any. */
  blockedBy(slot: SlotId): ItemDef | undefined;
  itemsChanged(): void;
  colorsChanged(): void;
  faceChanged(): void;
  shuffle(): void;
  setMode(mode: 'play' | 'dress'): void;
  perform(action: ActionId): void;
  setGait(gait: Gait): void;
  setCrowd(count: number): void;
  setToggle(name: Toggle, on: boolean): void;
}

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  characters: number;
  player: { triangles: number; bones: number; drawCalls: number };
}

type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | ((e: Event) => void)>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function') node.addEventListener(key, value as EventListener);
    else if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

type TabId = SlotId | 'face';

const SLOT_COLOR_LABELS: Record<'primary' | 'secondary', string> = { primary: 'Main colour', secondary: 'Trim colour' };

export class Ui {
  readonly canvasHost: HTMLElement;
  readonly bottomBar: HTMLElement;
  private readonly root: HTMLElement;
  private readonly sheetBody: HTMLElement;
  private readonly tabBar: HTMLElement;
  private readonly statsChip: HTMLElement;
  private readonly scenePanel: HTMLElement;
  private readonly sceneNumbers: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly gaitButtons = new Map<Gait, HTMLButtonElement>();
  private tab: TabId = 'head';
  private mode: 'play' | 'dress' = 'play';
  private gait: Gait = 'stand';
  private readonly facePreview = document.createElement('canvas');

  constructor(root: HTMLElement, private readonly host: UiHost) {
    this.root = root;
    root.replaceChildren();
    root.className = 'app';
    this.facePreview.width = this.facePreview.height = FACE_SIZE;

    // ---- stage with heads-up display
    this.canvasHost = el('div', { class: 'stage__canvas' });
    this.statsChip = el('output', { class: 'chip', 'aria-label': 'Frames per second' });
    this.sceneNumbers = el('dl', { class: 'numbers' });
    this.scenePanel = this.buildScenePanel();
    const sceneButton = el('button', {
      class: 'btn btn--small', type: 'button', id: 'scene-toggle', 'aria-expanded': 'false', text: 'Scene',
      click: () => {
        this.scenePanel.hidden = !this.scenePanel.hidden;
        sceneButton.setAttribute('aria-expanded', String(!this.scenePanel.hidden));
      },
    });
    this.hint = el('p', { class: 'hint', text: 'Tap the ground to walk' });

    const actions = el('div', { class: 'actions', role: 'group', 'aria-label': 'Actions' });
    for (const gait of ['walk', 'run'] as const) {
      const button = el('button', {
        class: 'btn btn--small dress-only', type: 'button', 'aria-pressed': 'false',
        text: gait === 'walk' ? 'Walk' : 'Run',
        click: () => this.setGait(this.gait === gait ? 'stand' : gait),
      });
      this.gaitButtons.set(gait, button);
      actions.append(button);
    }
    for (const action of ACTIONS) {
      actions.append(
        el('button', {
          class: 'btn btn--small', type: 'button', text: action.label,
          click: () => {
            this.setGait('stand');
            host.perform(action.id);
          },
        }),
      );
    }

    this.bottomBar = el('footer', { class: 'hud__bottom' },
      actions,
      el('button', {
        class: 'btn btn--primary play-only', type: 'button', id: 'open-wardrobe', text: 'Customize',
        click: () => this.setMode('dress'),
      }),
    );
    const stage = el('main', { class: 'stage' },
      this.canvasHost,
      el('div', { class: 'hud' },
        el('header', { class: 'hud__top' },
          el('h1', { class: 'brand', text: 'Hero Wardrobe' }),
          el('div', { class: 'hud__tools' }, this.statsChip, sceneButton),
        ),
        this.scenePanel,
        this.hint,
        this.bottomBar,
      ),
    );

    // ---- wardrobe sheet
    this.tabBar = el('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Wardrobe sections' });
    this.sheetBody = el('div', { class: 'sheet__body', role: 'tabpanel' });
    const sheet = el('aside', { class: 'sheet', 'aria-label': 'Wardrobe' },
      el('header', { class: 'sheet__head' },
        el('h2', { text: 'Wardrobe' }),
        el('button', { class: 'btn btn--small', type: 'button', id: 'shuffle', text: 'Shuffle', click: () => host.shuffle() }),
        el('button', { class: 'btn btn--small btn--primary', type: 'button', id: 'done', text: 'Done', click: () => this.setMode('play') }),
      ),
      this.tabBar,
      this.sheetBody,
    );

    root.append(stage, sheet);
    root.dataset.mode = this.mode;
    this.buildTabs();
  }

  // ------------------------------------------------------------------ modes

  setMode(mode: 'play' | 'dress'): void {
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.setGait('stand');
    this.hint.textContent = mode === 'play' ? 'Tap the ground to walk' : 'Drag to turn';
    this.hint.classList.remove('hint--gone');
    this.host.setMode(mode);
    if (mode === 'dress') this.refresh();
  }

  dismissHint(): void {
    this.hint.classList.add('hint--gone');
  }

  private setGait(gait: Gait): void {
    this.gait = gait;
    for (const [id, button] of this.gaitButtons) button.setAttribute('aria-pressed', String(id === gait));
    this.host.setGait(gait);
  }

  // ------------------------------------------------------------------ scene panel

  private buildScenePanel(): HTMLElement {
    const crowdValue = el('output', { for: 'crowd', text: '5' });
    const crowd = el('input', {
      type: 'range', id: 'crowd', min: 1, max: 10, step: 1, value: 5,
      input: (e) => {
        const value = Number((e.target as HTMLInputElement).value);
        crowdValue.textContent = String(value);
        this.host.setCrowd(value);
      },
    });
    const toggle = (name: Toggle, label: string) =>
      el('label', { class: 'switch' },
        el('input', {
          type: 'checkbox', id: `toggle-${name}`, checked: true,
          change: (e) => this.host.setToggle(name, (e.target as HTMLInputElement).checked),
        }),
        el('span', { text: label }),
      );
    return el('section', { class: 'popover', id: 'scene-panel', hidden: true, 'aria-label': 'Scene settings' },
      el('label', { class: 'field', for: 'crowd' }, el('span', { text: 'Characters on screen' }), crowdValue),
      crowd,
      toggle('outline', 'Outlines'),
      toggle('juice', 'Squash, lean and springs'),
      toggle('shadows', 'Shadows'),
      this.sceneNumbers,
    );
  }

  setStats(stats: FrameStats): void {
    this.statsChip.textContent = `${Math.round(stats.fps)} fps`;
    if (this.scenePanel.hidden) return;
    const rows: [string, string][] = [
      ['Frame work', `${stats.frameMs.toFixed(1)} ms`],
      ['Draw calls', String(stats.drawCalls)],
      ['Triangles', stats.triangles.toLocaleString('en-US')],
      ['Your hero', `${stats.player.triangles.toLocaleString('en-US')} triangles, ${stats.player.bones} bones, ${stats.player.drawCalls} draw calls`],
    ];
    this.sceneNumbers.replaceChildren(
      ...rows.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', { text: value })]),
    );
  }

  // ------------------------------------------------------------------ wardrobe

  private buildTabs(): void {
    const tabs: { id: TabId; label: string }[] = [];
    for (const slot of this.host.assets.catalog.slots) {
      tabs.push({ id: slot.id, label: slot.label });
      if (slot.id === 'head') tabs.push({ id: 'face', label: 'Face' });
    }
    for (const tab of tabs) {
      this.tabBar.append(
        el('button', {
          class: 'tab', type: 'button', role: 'tab', id: `tab-${tab.id}`, 'data-tab': tab.id, text: tab.label,
          click: () => {
            this.tab = tab.id;
            this.refresh();
          },
        }),
      );
    }
  }

  /** Redraws the open wardrobe section from the current look. */
  refresh(): void {
    for (const button of this.tabBar.children) {
      const selected = (button as HTMLElement).dataset.tab === this.tab;
      button.setAttribute('aria-selected', String(selected));
    }
    const scroll = this.sheetBody.scrollTop;
    this.sheetBody.replaceChildren(...(this.tab === 'face' ? this.facePanel() : this.slotPanel(this.tab)));
    this.sheetBody.scrollTop = scroll;
  }

  private slotPanel(slotId: SlotId): HTMLElement[] {
    const { assets } = this.host;
    const look = this.host.look();
    const slot = assets.catalog.slots.find((s) => s.id === slotId)!;
    const current = look.items[slotId];
    const out: HTMLElement[] = [];

    const blocker = this.host.blockedBy(slotId);
    if (blocker) {
      out.push(el('p', { class: 'note', text: `Hidden while wearing ${blocker.label.toLowerCase()}.` }));
    }

    const grid = el('div', { class: 'grid' });
    const choose = (id: string | null) => {
      look.items[slotId] = id;
      this.host.itemsChanged();
      this.refresh();
    };
    if (slot.optional) {
      grid.append(
        el('button', { class: 'card', type: 'button', 'aria-pressed': String(current === null), click: () => choose(null) },
          el('span', { class: 'card__none', 'aria-hidden': 'true' }),
          el('span', { class: 'card__label', text: 'None' }),
        ),
      );
    }
    for (const item of assets.itemsFor(slotId)) {
      const image = el('img', { class: 'card__image', alt: '', width: 72, height: 72 });
      void this.host.thumbnails.get(item).then((url) => (image.src = url));
      grid.append(
        el('button', { class: 'card', type: 'button', 'aria-pressed': String(current === item.id), click: () => choose(item.id) },
          image,
          el('span', { class: 'card__label', text: item.label }),
        ),
      );
    }
    out.push(grid);

    const item = current ? assets.item(current) : null;
    if (item && slotId === 'head' && item.channels.some((c) => c.role === 'hair')) {
      const own = item.channels.find((c) => c.role === 'hair')!.color;
      out.push(this.swatches('Hair colour', HAIR_COLORS, look.hair, own, (color) => {
        look.hair = color;
        this.host.colorsChanged();
      }));
    }
    if (item) {
      for (const role of ['primary', 'secondary'] as const) {
        const channel = item.channels.find((c) => c.role === role);
        if (!channel) continue;
        out.push(this.swatches(SLOT_COLOR_LABELS[role], ITEM_COLORS, look.colors[slotId]?.[role] ?? null, channel.color, (color) => {
          look.colors[slotId] = { ...look.colors[slotId], [role]: color };
          this.host.colorsChanged();
        }));
      }
    }
    return out;
  }

  private facePanel(): HTMLElement[] {
    const look = this.host.look();
    const face = look.face;
    const changed = () => {
      this.host.faceChanged();
      this.refresh();
    };
    const options = <K extends 'eyes' | 'mouth'>(title: string, key: K, values: readonly FaceStyle[K][], base: FaceStyle) => {
      const row = el('div', { class: 'grid grid--faces' });
      for (const value of values) {
        const style = { ...base, [key]: value };
        row.append(
          el('button', {
            class: 'card card--face', type: 'button', 'aria-pressed': String(face[key] === value), 'aria-label': `${title}: ${value}`,
            click: () => {
              face[key] = value;
              changed();
            },
          }, this.faceTile(style, look.skin)),
        );
      }
      return el('section', { class: 'group' }, el('h3', { text: title }), row);
    };
    return [
      this.swatches('Skin', SKIN_TONES, look.skin, null, (color) => {
        look.skin = color ?? SKIN_TONES[1];
        this.host.colorsChanged();
      }),
      options('Eyes', 'eyes', EYE_STYLES, { ...face, mouth: 'none', blush: false }),
      options('Mouth', 'mouth', MOUTH_STYLES, { ...face, eyes: 'dot', blush: false }),
      this.swatches('Eye colour (large eyes)', EYE_COLORS, face.eyeColor, null, (color) => {
        face.eyeColor = color ?? EYE_COLORS[0];
        this.host.faceChanged();
      }),
      el('label', { class: 'switch' },
        el('input', {
          type: 'checkbox', id: 'blush', checked: face.blush,
          change: (e) => {
            face.blush = (e.target as HTMLInputElement).checked;
            this.host.faceChanged();
          },
        }),
        el('span', { text: 'Blush' }),
      ),
    ];
  }

  /** A small preview drawn with the same function that paints the real face texture. */
  private faceTile(style: FaceStyle, skin: string): HTMLCanvasElement {
    drawFace(this.facePreview.getContext('2d')!, style, 'neutral');
    const tile = el('canvas', { width: 128, height: 128, class: 'card__face' });
    const ctx = tile.getContext('2d')!;
    ctx.fillStyle = skin;
    ctx.fillRect(0, 0, 128, 128);
    // Crop to the features so they read at thumbnail size.
    const crop = FACE_SIZE * 0.8;
    const top = style.mouth === 'none' ? 0 : FACE_SIZE * 0.14;
    ctx.drawImage(this.facePreview, (FACE_SIZE - crop) / 2, top, crop, crop, 0, 0, 128, 128);
    return tile;
  }

  /**
   * A row of colour choices. A null entry in `colors` is the item's own colour, shown as an
   * "Original" button filled with `own`.
   */
  private swatches(
    title: string, colors: readonly (string | null)[], selected: string | null, own: string | null,
    pick: (color: string | null) => void,
  ): HTMLElement {
    const row = el('div', { class: 'swatches' });
    for (const color of colors) {
      const isSelected = color === selected || (color !== null && selected !== null && color.toLowerCase() === selected.toLowerCase());
      const button = el('button', {
        class: color === null ? 'swatch swatch--own' : 'swatch', type: 'button',
        'aria-pressed': String(isSelected), 'aria-label': color === null ? `${title}: original` : `${title}: ${color}`,
        style: `--swatch: ${color ?? own ?? 'transparent'}`,
        click: () => {
          pick(color);
          this.refresh();
        },
      });
      if (color === null) button.append(el('span', { text: 'Original' }));
      row.append(button);
    }
    return el('section', { class: 'group' }, el('h3', { text: title }), row);
  }
}
