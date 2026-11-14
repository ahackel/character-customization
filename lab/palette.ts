/**
 * The master palette. Every colour an item may use is an entry here with a paired shade, which
 * is what keeps separately generated items looking like one set.
 */
export const PALETTE = {
  skinA: ['#f6cfa8', '#dba57f'],
  skinB: ['#e8b48a', '#c88e62'],
  skinC: ['#c98a5f', '#a66a45'],
  skinD: ['#9a6240', '#774628'],
  skinE: ['#6b4128', '#4f2d1b'],
  hairBlack: ['#2b2530', '#1b1720'],
  hairBrown: ['#6b4530', '#4d2f20'],
  hairBlond: ['#e2b85c', '#b98a3a'],
  hairRed: ['#c2552d', '#933a1c'],
  hairGrey: ['#a9a9b3', '#7f7f8c'],
  white: ['#f2efe4', '#cfc9b8'],
  cream: ['#e8dcb8', '#c4b58a'],
  red: ['#d1453f', '#a02e33'],
  orange: ['#e88a3a', '#b9652a'],
  yellow: ['#f1c644', '#c79a2c'],
  leaf: ['#5aa84e', '#3d7f3f'],
  green: ['#2f8f6a', '#226b55'],
  teal: ['#3fb3b0', '#2a8a8c'],
  blue: ['#3f7fd0', '#2d5ea6'],
  navy: ['#2f3f6e', '#222c50'],
  purple: ['#8a5bbf', '#653f94'],
  pink: ['#e87aa5', '#bb557f'],
  brown: ['#8a5a3c', '#66402a'],
  tan: ['#c9a06a', '#a07a4a'],
  straw: ['#e6cf7a', '#bfa350'],
  wood: ['#9a6a48', '#744c33'],
  grey: ['#8d939c', '#666c78'],
  steel: ['#b9c2cc', '#8a94a3'],
  black: ['#33333d', '#22222a'],
  ink: ['#2b1b1f', '#2b1b1f'],
  mouth: ['#9a4040', '#7a2f33'],
  tooth: ['#ffffff', '#e6e6ee'],
  blush: ['#f08a8a', '#d86a72'],
} as const satisfies Record<string, readonly [string, string]>;

export type PaletteKey = keyof typeof PALETTE;
export const PALETTE_KEYS = Object.keys(PALETTE) as PaletteKey[];
export const SKIN_KEYS: PaletteKey[] = ['skinA', 'skinB', 'skinC', 'skinD', 'skinE'];
export const HAIR_KEYS: PaletteKey[] = ['hairBlack', 'hairBrown', 'hairBlond', 'hairRed', 'hairGrey'];

/** One pixel of paint: a palette entry, lit or shaded. */
export interface Cell {
  key: PaletteKey;
  shade: boolean;
}

export const hexOf = (cell: Cell): string => PALETTE[cell.key][cell.shade ? 1 : 0];
