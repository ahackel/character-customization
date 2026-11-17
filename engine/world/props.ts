// Things lying about that a character can pick up and carry: for now a crate. Each is an object
// preset (engine/objects/object-presets.ts), drawn by the object renderer in the four camera turns.
import { drawObject, OBJECT_H, OBJECT_ORIGIN, OBJECT_W } from '../objects/object.ts';
import { objectPresetById } from '../objects/object-presets.ts';
import type { Thing } from './world.ts';

export const ITEMS = [{ id: 'crate', preset: 'crate' }] as const;
export const itemById = (id: unknown) => ITEMS.find((it) => it.id === id);

export interface PlacedItem {
  /** An `ITEMS` id. */
  item: string;
  /** Where it stands, in metres from the north corner of the map. */
  i: number;
  j: number;
}

/** How close a walker may come to an item, in metres. */
export const ITEM_ROOM = 0.3;

const frames = new Map<string, Pick<Thing, 'picture' | 'w' | 'h' | 'foot'>>();
/** An item's picture in a camera turn: quarter turns on the ground, eighths (0.5 steps) in a character's arms. */
export function itemPicture(id: string, turn: number): Pick<Thing, 'picture' | 'w' | 'h' | 'foot'> {
  const key = `${id}|${turn}`;
  let out = frames.get(key);
  if (!out) {
    const prop = objectPresetById(itemById(id)!.preset)!.prop;
    frames.set(key, (out = { picture: drawObject(prop, ((turn % 4) + 4) % 4).sprite, w: OBJECT_W, h: OBJECT_H, foot: OBJECT_ORIGIN }));
  }
  return out;
}
