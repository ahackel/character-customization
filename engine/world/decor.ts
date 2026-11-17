// Small things lying flat on the ground: starfish, shells, pebbles, coral. Each is a few pixels of
// hand-drawn art, centred on where it was placed. They are drawn on the ground, under everything
// standing, so walkers step over them and nothing sorts or blocks.

export interface DecorKind {
  id: string;
  /** Pixel rows, top to bottom; '.' is empty, other letters look up `colors`. */
  rows: string[];
  colors: Record<string, string>;
}

const STAR = ['...a...', 'aaabaaa', '..aba..', '.a...c.', 'a.....c'];

export const DECOR: DecorKind[] = [
  { id: 'starfish-orange', rows: STAR, colors: { a: '#f0793a', b: '#ffbf73', c: '#b9552c' } },
  { id: 'starfish-pink', rows: STAR, colors: { a: '#ea6f9a', b: '#ffb3cb', c: '#a8476d' } },
  { id: 'shell-spiral', rows: ['.ccc.', 'cbbac', 'cbaac', '.aaa.'], colors: { a: '#e9c49c', b: '#fff1da', c: '#b88d66' } },
  { id: 'shell-scallop', rows: ['.aba.', 'ababa', 'ababa', '..c..'], colors: { a: '#f0947f', b: '#ffd3c6', c: '#b8665a' } },
  { id: 'pebbles-grey', rows: ['.aa...', 'abba.a', '.aa.ab'], colors: { a: '#8f8b83', b: '#c9c5bd' } },
  { id: 'pebbles-brown', rows: ['.aa...', 'abba.a', '.aa.ab'], colors: { a: '#94735a', b: '#cdab88' } },
  { id: 'coral', rows: ['a.a.a', 'babab', '.bab.', '..b..'], colors: { a: '#ff9c8a', b: '#e2574c' } },
  { id: 'driftwood', rows: ['..aab...', 'abbaaaab', '.a....a.'], colors: { a: '#9c7650', b: '#c9a679' } },
];

export const decorById = (id: unknown) => DECOR.find((d) => d.id === id);

export interface PlacedDecor {
  /** A `DECOR` id. */
  decor: string;
  /** Where its middle lies, in metres from the north corner of the map. */
  i: number;
  j: number;
}

/** Every coloured pixel of a decoration, relative to its middle. */
export function decorPixels(kind: DecorKind): { x: number; y: number; color: string }[] {
  const h = kind.rows.length;
  const w = Math.max(...kind.rows.map((r) => r.length));
  const out: { x: number; y: number; color: string }[] = [];
  kind.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const color = kind.colors[ch];
    if (color) out.push({ x: x - Math.floor(w / 2), y: y - Math.floor(h / 2), color });
  }));
  return out;
}
