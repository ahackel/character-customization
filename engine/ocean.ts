// The look of the sea: colours and motion, tweakable in the scene editor and kept on this device.
// The world reads `ocean` every frame; the ground is redrawn when a water colour changes.

export interface Ocean {
  /** Water from the shore out to deep sea; the shallow end mixes with the sand floor. */
  shore: string;
  shallow: string;
  middle: string;
  open: string;
  deep: string;
  /** The colour the water turns towards at the top of the view, and how far. */
  far: string;
  gradient: number;
  /** Wave lines on the coast. */
  wave: string;
  waveReach: number; // levels deep where crests rise
  wavePeriod: number; // seconds from rising to breaking
  waves: number; // crests on the way in at once
  /** Ripples on the open sea. */
  rippleDark: string;
  ripplePale: string;
  rippleOpacity: number; // how much a ripple covers the water under it
  ripples: number; // share of places with a ripple
  rippleLength: number; // longest ripple, pixels
  drift: number; // pixels a second down the screen
  glints: number; // share of places that blink
}

export const OCEAN_DEFAULTS: Ocean = {
  shore: '#b4fdec',
  shallow: '#74ddd3',
  middle: '#58b7d4',
  open: '#2f6599',
  deep: '#316392',
  far: '#87cdfa',
  gradient: 0.5,
  wave: '#ffffff',
  waveReach: 1.4,
  wavePeriod: 4.8,
  waves: 2,
  rippleDark: '#1e406f',
  ripplePale: '#c3eaf8',
  rippleOpacity: 0.5,
  ripples: 0.15,
  rippleLength: 40,
  drift: 2.5,
  glints: 0.05,
};

/** Ready-made looks to start tweaking from. */
export const OCEAN_PRESETS: Record<'blue' | 'aqua', Ocean> = {
  blue: OCEAN_DEFAULTS,
  // Bright shallow lagoon: pale cyan by the shore, aqua out to a clear blue.
  aqua: {
    ...OCEAN_DEFAULTS,
    shore: '#c8f8ee',
    shallow: '#7ee8e0',
    middle: '#3ed6e0',
    open: '#22c2dc',
    deep: '#18a4d4',
    far: '#0d6fb8',
    gradient: 0.2,
    wave: '#f0fffc',
    rippleDark: '#14b0d0',
    ripplePale: '#d8fbf6',
  },
};

export type OceanNumber = { [K in keyof Ocean]: Ocean[K] extends number ? K : never }[keyof Ocean];
export type OceanColor = { [K in keyof Ocean]: Ocean[K] extends string ? K : never }[keyof Ocean];
/** Slider limits: min, max, step. */
export const OCEAN_RANGES: Record<OceanNumber, [number, number, number]> = {
  gradient: [0, 0.5, 0.01],
  waveReach: [0.5, 4, 0.1],
  wavePeriod: [1, 12, 0.1],
  waves: [1, 5, 1],
  rippleOpacity: [0, 1, 0.05],
  ripples: [0, 1, 0.05],
  rippleLength: [4, 44, 1],
  drift: [0, 20, 0.5],
  glints: [0, 0.2, 0.01],
};
/** The colours that are baked into the ground picture; changing one means redrawing it. */
export const WATER_COLORS: OceanColor[] = ['shore', 'shallow', 'middle', 'open', 'deep'];

const KEY = 'pixel-scenes-ocean';
const HEX = /^#[0-9a-f]{6}$/i;

/** Saved settings, each checked: a missing or broken value falls back to its default. */
function load(): Ocean {
  const out = { ...OCEAN_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return out;
    for (const key of Object.keys(OCEAN_DEFAULTS) as (keyof Ocean)[]) {
      const v = saved[key];
      if (key in OCEAN_RANGES) {
        const [min, max] = OCEAN_RANGES[key as OceanNumber];
        if (typeof v === 'number' && Number.isFinite(v)) (out as Record<string, unknown>)[key] = Math.max(min, Math.min(max, v));
      } else if (typeof v === 'string' && HEX.test(v)) (out as Record<string, unknown>)[key] = v.toLowerCase();
    }
  } catch {
    // Unreadable storage: the defaults stand.
  }
  return out;
}

export const ocean: Ocean = load();

export function saveOcean(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ocean));
  } catch {
    // Not saved; the settings still hold until the page closes.
  }
}

export function useOcean(look: Ocean): void {
  Object.assign(ocean, look);
  saveOcean();
}

export const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
