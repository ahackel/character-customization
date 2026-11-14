import type { Assets, SlotId } from './assets';
import type { Look } from './character';
import { EYE_STYLES, MOUTH_STYLES } from './face';

export const SKIN_TONES = [
  '#fbd3b4', '#f5bb96', '#e3a57e', '#c98a5f', '#a56b45', '#7a4a30', '#5a3622', '#9ccf8a', '#a9b8e8',
];
/** null means "the colour the item was made with". */
export const HAIR_COLORS: (string | null)[] = [
  null, '#2a2226', '#5b3a29', '#9e5d46', '#d9a655', '#f0d9a0', '#c9462f', '#8e8e99', '#f2f2f2',
  '#e86aa6', '#4aa3df', '#6bbf59', '#8a5bd6',
];
export const ITEM_COLORS: (string | null)[] = [
  null, '#d64348', '#e8833a', '#f2c230', '#5fb04b', '#2f9e8f', '#3f7fd0', '#5a55b8', '#9a55c2',
  '#e56fa8', '#8a5a3c', '#f1ece2', '#8d969c', '#34343c',
];
export const EYE_COLORS = ['#4a7bd0', '#3f9a5a', '#8a5a3c', '#7a52c4', '#d0802e', '#3a3a44'];

export function defaultLook(): Look {
  return {
    items: {
      head: 'rogue-head',
      headwear: 'knight-helmet',
      top: 'knight-body',
      arms: 'rogue-arms',
      legs: 'knight-legs',
      back: 'knight-cape',
      handR: '1h-sword',
      handL: 'round-shield',
    },
    skin: SKIN_TONES[1],
    hair: null,
    colors: { top: { primary: '#3f7fd0' }, back: { primary: '#f2c230' } },
    face: { eyes: 'shine', mouth: 'smile', blush: true, eyeColor: EYE_COLORS[0] },
  };
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A random but valid look. Used for the crowd and the shuffle button. */
export function randomLook(assets: Assets): Look {
  const items = {} as Look['items'];
  const noneChance: Partial<Record<SlotId, number>> = { headwear: 0.45, back: 0.4, handR: 0.25, handL: 0.45 };
  for (const slot of assets.catalog.slots) {
    const options = assets.itemsFor(slot.id);
    items[slot.id] = slot.optional && Math.random() < (noneChance[slot.id] ?? 0.3) ? null : pick(options).id;
  }
  const colors: Look['colors'] = {};
  for (const slot of assets.catalog.slots) {
    if (slot.id === 'head' || slot.id === 'handR' || slot.id === 'handL') continue;
    if (Math.random() < 0.55) colors[slot.id] = { primary: pick(ITEM_COLORS.slice(1)) };
  }
  return {
    items,
    skin: pick(SKIN_TONES.slice(0, 7)),
    hair: Math.random() < 0.5 ? pick(HAIR_COLORS) : null,
    colors,
    face: {
      eyes: pick(EYE_STYLES),
      mouth: pick(MOUTH_STYLES),
      blush: Math.random() < 0.4,
      eyeColor: pick(EYE_COLORS),
    },
  };
}

/** Drops anything a saved look refers to that this catalogue no longer has. */
export function sanitizeLook(assets: Assets, input: unknown): Look | null {
  try {
    const saved = input as Look;
    const look = defaultLook();
    for (const slot of assets.catalog.slots) {
      const id = saved.items[slot.id];
      if (id === null && slot.optional) look.items[slot.id] = null;
      else if (typeof id === 'string' && assets.itemsFor(slot.id).some((i) => i.id === id)) look.items[slot.id] = id;
    }
    const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
    if (isColor(saved.skin)) look.skin = saved.skin;
    look.hair = isColor(saved.hair) ? saved.hair : null;
    look.colors = {};
    for (const slot of assets.catalog.slots) {
      const c = saved.colors?.[slot.id];
      if (!c) continue;
      look.colors[slot.id] = {
        primary: isColor(c.primary) ? c.primary : null,
        secondary: isColor(c.secondary) ? c.secondary : null,
      };
    }
    if ((EYE_STYLES as readonly string[]).includes(saved.face?.eyes)) look.face.eyes = saved.face.eyes;
    if ((MOUTH_STYLES as readonly string[]).includes(saved.face?.mouth)) look.face.mouth = saved.face.mouth;
    look.face.blush = !!saved.face?.blush;
    if (isColor(saved.face?.eyeColor)) look.face.eyeColor = saved.face.eyeColor;
    return look;
  } catch {
    return null;
  }
}
