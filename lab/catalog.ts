import { compile } from './items.ts';
import { PALETTE, SKIN_KEYS, type Cell, type PaletteKey } from './palette.ts';
import type { Item, Slot, Stamp, StampPair } from './puppet.ts';

/** One wearable in the wardrobe, compiled from what the model returned. */
export interface Entry {
  id: string;
  label: string;
  slot: Slot;
  /** Which format the model wrote it in. */
  format: 'paint' | 'recipe';
  item: Item;
  /** The item's own colours, most used first. These are the ones a player may swap. */
  colors: PaletteKey[];
}

const files = import.meta.glob<unknown[]>('./generated/{sprite,recipe}-*.json', { eager: true, import: 'default' });

// Sets left out of the wardrobe, with the reason. Everything else is included as returned.
const EXCLUDED: Record<string, string> = {
  'recipe-spear': 'the small-stamp spears lean and break into jagged lines',
  'recipe-shorts': 'came out as briefs because of the length scale in the first format description',
};

const FIXED: PaletteKey[] = ['ink', 'mouth', 'tooth', 'blush'];
/** Sentence case, so names from different model calls read alike. Words such as "T-shirt" keep their capital. */
const sentence = (text: string) =>
  text
    .split(' ')
    .map((word, i) => (i > 0 && /^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word))
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());

function eachCell(item: Item, visit: (cell: Cell) => void): void {
  const stamp = (s?: Stamp) => s?.forEach((row) => row.forEach((c) => c && visit(c)));
  const pair = (p?: StampPair) => {
    stamp(p?.front);
    stamp(p?.back);
  };
  pair(item.head);
  pair(item.headBehind);
  pair(item.torso);
  pair(item.tool);
  item.arm?.forEach((c) => c && visit(c));
  item.leg?.forEach((c) => c && visit(c));
  if (item.foot) visit(item.foot);
}

function colorsOf(item: Item): PaletteKey[] {
  const tally = new Map<PaletteKey, number>();
  eachCell(item, (cell) => {
    if (SKIN_KEYS.includes(cell.key) || FIXED.includes(cell.key)) return;
    tally.set(cell.key, (tally.get(cell.key) ?? 0) + 1);
  });
  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).filter(([, n]) => n / total >= 0.1).slice(0, 2).map(([key]) => key);
}

/** A copy of an item with some palette entries replaced by others. Shading is kept. */
export function recolor(item: Item, swap: Partial<Record<PaletteKey, PaletteKey>>): Item {
  if (!Object.keys(swap).length) return item;
  const cell = (c: Cell | null): Cell | null => (c && swap[c.key] ? { ...c, key: swap[c.key]! } : c);
  const stamp = (s: Stamp): Stamp => s.map((row) => row.map(cell));
  const pair = (p?: StampPair): StampPair | undefined => p && { front: stamp(p.front), back: stamp(p.back) };
  return {
    ...item,
    head: pair(item.head),
    headBehind: pair(item.headBehind),
    torso: pair(item.torso),
    tool: pair(item.tool),
    arm: item.arm?.map(cell),
    leg: item.leg?.map(cell),
    foot: cell(item.foot ?? null),
  };
}

function build(): Entry[] {
  const entries: Entry[] = [];
  for (const [path, list] of Object.entries(files)) {
    const [, format, set] = path.match(/(sprite|recipe)-([\w-]+)\.json$/)!;
    if (EXCLUDED[`${format}-${set}`]) continue;
    list.forEach((raw, index) => {
      const result = compile(format as 'sprite' | 'recipe', raw);
      if (!result.ok) return;
      const item = result.compiled.item;
      // Rule: a beard is not visible from behind. Both formats drew a tuft at the neck there.
      if (item.slot === 'beard' && item.head) item.head = { front: item.head.front, back: item.head.back.map((row) => row.map(() => null)) };
      entries.push({
        id: `${format}-${set}-${index}`,
        label: sentence(item.name),
        slot: item.slot,
        format: format === 'sprite' ? 'paint' : 'recipe',
        item,
        colors: colorsOf(item),
      });
    });
  }
  return entries;
}

export const CATALOG: Entry[] = build();
export const entryById = (id: string | null | undefined): Entry | undefined => CATALOG.find((e) => e.id === id);

/** Colours offered for clothing and hats. */
export const CLOTH_KEYS = (Object.keys(PALETTE) as PaletteKey[]).filter(
  (key) => !SKIN_KEYS.includes(key) && !FIXED.includes(key) && !key.startsWith('hair'),
);
