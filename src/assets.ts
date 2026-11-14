import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type SlotId = 'head' | 'headwear' | 'top' | 'arms' | 'legs' | 'back' | 'handR' | 'handL';
export type ChannelRole = 'skin' | 'hair' | 'primary' | 'secondary' | 'fixed';
export type Grip =
  | 'melee1h' | 'melee2h' | 'magic' | 'ranged1h' | 'ranged2h' | 'throw' | 'prop'
  | 'offhandWeapon' | 'shield' | 'book';

export interface Channel {
  role: ChannelRole;
  color: string;
  linear: [number, number, number];
  share: number;
}

export interface FaceAnchor {
  eyeL: [number, number, number];
  eyeR: [number, number, number];
  eyeWidth: number;
  eyeHeight: number;
}

export interface ItemDef {
  id: string;
  slot: SlotId;
  label: string;
  set: string;
  file: string;
  kind: 'skinned' | 'rigid';
  attach?: string;
  grip?: Grip;
  blocks?: SlotId[];
  /** Headwear only: how far the hat may wobble on its spring, in radians. 0 keeps it rigid. */
  sway?: number;
  triangles: number;
  vertices: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  channels: Channel[];
  face?: FaceAnchor;
}

export interface SlotDef {
  id: SlotId;
  label: string;
  optional: boolean;
}

export interface Catalog {
  source: string;
  atlas: string;
  rig: { file: string; joints: string[]; inverseBind: number[][] };
  slots: SlotDef[];
  animations: { name: string; duration: number }[];
  items: ItemDef[];
}

/** Loads the catalogue, the shared rig with its animations, the atlas, and item geometry on demand. */
export class Assets {
  readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly itemsById = new Map<string, ItemDef>();
  private readonly geometries = new Map<string, Promise<THREE.BufferGeometry>>();
  private readonly coverMasks = new Map<string, Uint8Array>();
  private readonly loader = new GLTFLoader();

  private constructor(
    readonly base: string,
    readonly catalog: Catalog,
    readonly rigScene: THREE.Object3D,
    readonly atlas: THREE.Texture,
  ) {
    for (const item of catalog.items) this.itemsById.set(item.id, item);
  }

  static async load(base = 'assets/'): Promise<Assets> {
    const catalog: Catalog = await (await fetch(base + 'catalog.json')).json();
    const loader = new GLTFLoader();
    const [rig, atlas] = await Promise.all([
      loader.loadAsync(base + catalog.rig.file),
      new THREE.TextureLoader().loadAsync(base + catalog.atlas),
    ]);
    // Item UVs follow the glTF convention (origin top left), and tiles must not bleed into
    // each other, so no flip and no mipmaps.
    atlas.flipY = false;
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.generateMipmaps = false;
    atlas.minFilter = THREE.LinearFilter;
    atlas.magFilter = THREE.LinearFilter;

    const assets = new Assets(base, catalog, rig.scene, atlas);
    for (const clip of rig.animations) assets.clips.set(clip.name, clip);
    return assets;
  }

  item(id: string): ItemDef {
    const item = this.itemsById.get(id);
    if (!item) throw new Error(`Unknown item "${id}"`);
    return item;
  }

  itemsFor(slot: SlotId): ItemDef[] {
    return this.catalog.items.filter((i) => i.slot === slot);
  }

  /**
   * Cover masking. Returns, per triangle of `under`, whether `cover` hides it, so hair does not
   * poke through hats. Nothing is authored per pair: a triangle is hidden when the cover lies
   * just outside all three of its corners, seen from the middle of the covered item.
   *
   * @param toCoverSpace  transform from the space of `under` to the space of `cover`
   * @param roles         only triangles in channels with these roles can be hidden
   */
  coverMask(
    under: ItemDef, underGeometry: THREE.BufferGeometry,
    cover: ItemDef, coverGeometry: THREE.BufferGeometry,
    toCoverSpace: THREE.Matrix4, roles: ChannelRole[],
  ): Uint8Array {
    const key = `${under.id}|${cover.id}`;
    const cached = this.coverMasks.get(key);
    if (cached) return cached;

    const position = underGeometry.getAttribute('position');
    const channel = underGeometry.getAttribute('_channel');
    const index = underGeometry.index!;
    const centre = new THREE.Vector3(
      (under.bounds.min[0] + under.bounds.max[0]) / 2,
      (under.bounds.min[1] + under.bounds.max[1]) / 2,
      (under.bounds.min[2] + under.bounds.max[2]) / 2,
    ).applyMatrix4(toCoverSpace);
    const target = new THREE.Mesh(coverGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const raycaster = new THREE.Raycaster();
    const point = new THREE.Vector3();
    const direction = new THREE.Vector3();

    // 0 = not tested, 1 = covered, 2 = exposed
    const vertexState = new Uint8Array(position.count);
    const covered = (i: number): boolean => {
      if (vertexState[i] === 0) {
        point.fromBufferAttribute(position, i).applyMatrix4(toCoverSpace);
        const distance = direction.subVectors(point, centre).length();
        raycaster.set(centre, direction.normalize());
        // The cover must sit close to the corner: before it (the corner pokes through) or
        // slightly beyond it. A hat brim far out in the same direction does not count.
        raycaster.far = distance * 1.3;
        vertexState[i] = raycaster.intersectObject(target, false).length ? 1 : 2;
      }
      return vertexState[i] === 1;
    };
    const mask = new Uint8Array(index.count / 3);
    for (let t = 0; t < mask.length; t++) {
      const a = index.getX(t * 3);
      if (!roles.includes(under.channels[channel.getX(a)].role)) continue;
      if (covered(a) && covered(index.getX(t * 3 + 1)) && covered(index.getX(t * 3 + 2))) mask[t] = 1;
    }
    (target.material as THREE.Material).dispose();
    this.coverMasks.set(key, mask);
    return mask;
  }

  /** Item geometry is fetched the first time an item is worn and cached after that. */
  geometry(id: string): Promise<THREE.BufferGeometry> {
    let pending = this.geometries.get(id);
    if (!pending) {
      pending = this.loader.loadAsync(this.base + this.item(id).file).then((gltf) => {
        let geometry: THREE.BufferGeometry | undefined;
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) geometry = (o as THREE.Mesh).geometry;
        });
        if (!geometry) throw new Error(`No mesh in ${id}`);
        return geometry;
      });
      this.geometries.set(id, pending);
    }
    return pending;
  }
}
