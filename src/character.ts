import * as THREE from 'three';
import type { Assets, Channel, ItemDef, SlotId } from './assets';
import { Animator } from './animator';
import { buildFaceDecal, FaceTexture, type Expression, type FaceStyle } from './face';
import { BodyJuice, SpringBone } from './juice';
import type { CharacterMaterials } from './materials';

export interface SlotColors {
  primary?: string | null;
  secondary?: string | null;
}

/** Everything that defines how a character looks. Plain data, so it can be saved or sent over a network. */
export interface Look {
  items: Record<SlotId, string | null>;
  skin: string;
  /** null keeps the hair colour the head item was made with. */
  hair: string | null;
  colors: Partial<Record<SlotId, SlotColors>>;
  face: FaceStyle;
}

interface Segment {
  item: ItemDef;
  start: number;
  count: number;
  channel: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
}

const LUMA = [0.2126, 0.7152, 0.0722];
const sanitize = THREE.PropertyBinding.sanitizeNodeName;
const _color = new THREE.Color();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();

export class Character {
  /** Position and facing in the world. */
  readonly root = new THREE.Group();
  /** Receives squash, stretch and lean. Its origin is at the feet. */
  readonly body = new THREE.Group();
  readonly animator: Animator;
  readonly juice = new BodyJuice();
  readonly stats = { triangles: 0, vertices: 0, bones: 0, drawCalls: 0 };
  /** Set by gameplay code; a blink is layered on top of 'neutral' automatically. */
  expression: Expression = 'neutral';

  private readonly rig: THREE.Object3D;
  private readonly joints: THREE.Object3D[];
  private readonly bindWorld: THREE.Matrix4[];
  private readonly inverseBind: THREE.Matrix4[];
  private readonly hips: THREE.Object3D;
  private readonly hatBone = new THREE.Bone();
  private readonly capeBone = new THREE.Bone();
  private readonly hatSpring: SpringBone;
  private readonly capeSpring: SpringBone;
  private readonly skeleton: THREE.Skeleton;
  private readonly mesh: THREE.SkinnedMesh;
  private readonly outline: THREE.SkinnedMesh;
  private readonly face = new FaceTexture();
  private faceMesh: THREE.Mesh | null = null;
  private faceHead: string | null = null;
  private segments: Segment[] = [];
  private version = 0;
  private blinkIn = 1 + Math.random() * 3;
  private blinkLeft = 0;
  private springsWanted = true;

  constructor(
    private readonly assets: Assets,
    materials: CharacterMaterials,
    public look: Look,
  ) {
    const { rig: rigData } = assets.catalog;
    this.rig = assets.rigScene.clone(true);
    this.joints = rigData.joints.map((name) => {
      const joint = this.rig.getObjectByName(sanitize(name));
      if (!joint) throw new Error(`Rig is missing joint "${name}"`);
      return joint;
    });
    this.inverseBind = rigData.inverseBind.map((m) => new THREE.Matrix4().fromArray(m));
    this.bindWorld = this.inverseBind.map((m) => m.clone().invert());
    this.hips = this.joint('hips');

    // Two extra bones carry the hat and the cape so they can swing on springs while still being
    // part of the single merged mesh.
    this.joint('head').add(this.hatBone);
    this.joint('chest').add(this.capeBone);
    this.hatSpring = new SpringBone(this.hatBone, { stiffness: 420, damping: 16, gravity: 0, maxAngle: 0.2 });
    this.capeSpring = new SpringBone(this.capeBone, {
      stiffness: 46, damping: 5.5, gravity: 16, maxAngle: 1.25,
      // A cape can fly out behind the character but never swings forward into the back, and
      // only a little to the sides.
      limit: (d) => {
        d.z = Math.min(d.z, -0.1);
        d.x = THREE.MathUtils.clamp(d.x, -0.28, 0.28);
      },
    });

    this.skeleton = new THREE.Skeleton(
      [...this.joints, this.hatBone, this.capeBone] as THREE.Bone[],
      [...this.inverseBind.map((m) => m.clone()), new THREE.Matrix4(), new THREE.Matrix4()],
    );
    this.stats.bones = this.skeleton.bones.length;

    const empty = new THREE.BufferGeometry();
    this.mesh = new THREE.SkinnedMesh(empty, materials.body);
    this.outline = new THREE.SkinnedMesh(empty, materials.outline);
    for (const mesh of [this.mesh, this.outline]) {
      mesh.bind(this.skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.visible = false;
    }
    this.mesh.castShadow = true;

    this.body.add(this.rig, this.mesh, this.outline);
    this.root.add(this.body);
    this.animator = new Animator(this.rig, assets.clips, sanitize('foot.l'));
  }

  private joint(name: string): THREE.Object3D {
    return this.joints[this.assets.catalog.rig.joints.indexOf(name)];
  }

  set outlineVisible(visible: boolean) {
    this.outline.userData.wanted = visible;
    this.outline.visible = visible && this.mesh.visible;
  }

  /** Items actually shown: the look's choices minus slots blocked by another worn item. */
  wornItems(): ItemDef[] {
    const chosen = this.assets.catalog.slots
      .map((slot) => this.look.items[slot.id])
      .filter((id): id is string => !!id)
      .map((id) => this.assets.item(id));
    const blocked = new Set(chosen.flatMap((item) => item.blocks ?? []));
    return chosen.filter((item) => !blocked.has(item.slot));
  }

  worn(slot: SlotId): ItemDef | undefined {
    return this.wornItems().find((item) => item.slot === slot);
  }

  /**
   * Rebuilds the character after an item change: fetches missing geometry, then merges every
   * worn item into one skinned mesh so the whole character is drawn in one call (plus outline).
   */
  async rebuild(): Promise<void> {
    const version = ++this.version;
    const worn = this.wornItems();
    const geometries = await Promise.all(worn.map((item) => this.assets.geometry(item.id)));
    if (version !== this.version) return; // a newer change superseded this one

    const names = this.assets.catalog.rig.joints;
    const hatIndex = this.joints.length;
    const capeIndex = this.joints.length + 1;
    const headIndex = names.indexOf('head');
    const chestIndex = names.indexOf('chest');

    // Cover masking: a hat hides the hair it sits on, so nothing pokes through.
    const masks = new Map<ItemDef, Uint8Array>();
    const headAt = worn.findIndex((i) => i.slot === 'head');
    const hatAt = worn.findIndex((i) => i.slot === 'headwear');
    if (headAt >= 0 && hatAt >= 0) {
      masks.set(worn[headAt], this.assets.coverMask(
        worn[headAt], geometries[headAt], worn[hatAt], geometries[hatAt], this.inverseBind[headIndex], ['hair'],
      ));
    }

    let vertexCount = 0;
    let indexCount = 0;
    worn.forEach((item, n) => {
      const g = geometries[n];
      vertexCount += g.getAttribute('position').count;
      const mask = masks.get(item);
      indexCount += g.index!.count - (mask ? mask.reduce((sum, hidden) => sum + hidden, 0) * 3 : 0);
    });
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const outlineNormal = new Float32Array(vertexCount * 3);
    const uv = new Float32Array(vertexCount * 2);
    const skinIndex = new Uint16Array(vertexCount * 4);
    const skinWeight = new Float32Array(vertexCount * 4);
    const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

    this.segments = [];
    let v0 = 0;
    let i0 = 0;
    worn.forEach((item, n) => {
      const g = geometries[n];
      const gp = g.getAttribute('position');
      const gn = g.getAttribute('normal');
      const go = g.getAttribute('_outline');
      const gu = g.getAttribute('uv');
      const count = gp.count;

      // Rigid items are stored relative to the joint they hang from. Move them into the bind pose
      // and weight them fully to one bone.
      let rigidBone = -1;
      if (item.kind === 'rigid') {
        const parent = names.indexOf(item.attach!);
        _m.copy(this.bindWorld[parent]);
        _normalMatrix.getNormalMatrix(_m);
        rigidBone = parent;
        if (item.slot === 'headwear' && item.sway) {
          rigidBone = hatIndex;
          this.configureHat(item, headIndex, hatIndex);
        } else if (item.slot === 'back') {
          rigidBone = capeIndex;
          this.configureCape(item, chestIndex, capeIndex);
        }
      }

      for (let i = 0; i < count; i++) {
        const o = v0 + i;
        _v.fromBufferAttribute(gp, i);
        if (rigidBone >= 0) _v.applyMatrix4(_m);
        _v.toArray(position, o * 3);
        _n.fromBufferAttribute(gn, i);
        if (rigidBone >= 0) _n.applyMatrix3(_normalMatrix).normalize();
        _n.toArray(normal, o * 3);
        _n.fromBufferAttribute(go, i);
        if (rigidBone >= 0) _n.applyMatrix3(_normalMatrix).normalize();
        _n.toArray(outlineNormal, o * 3);
        uv[o * 2] = gu.getX(i);
        uv[o * 2 + 1] = gu.getY(i);
      }
      if (rigidBone >= 0) {
        for (let i = 0; i < count; i++) {
          skinIndex[(v0 + i) * 4] = rigidBone;
          skinWeight[(v0 + i) * 4] = 1;
        }
      } else {
        const gi = g.getAttribute('skinIndex');
        const gw = g.getAttribute('skinWeight');
        for (let i = 0; i < count; i++) {
          for (let k = 0; k < 4; k++) {
            skinIndex[(v0 + i) * 4 + k] = gi.getComponent(i, k);
            skinWeight[(v0 + i) * 4 + k] = gw.getComponent(i, k);
          }
        }
      }
      const gIndex = g.index!;
      const mask = masks.get(item);
      for (let i = 0; i < gIndex.count; i++) {
        if (mask?.[Math.floor(i / 3)]) continue;
        index[i0++] = gIndex.getX(i) + v0;
      }

      this.segments.push({ item, start: v0, count, channel: g.getAttribute('_channel') });
      v0 += count;
    });

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    merged.setAttribute('outlineNormal', new THREE.BufferAttribute(outlineNormal, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    merged.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    merged.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(vertexCount * 4), 4));
    merged.setIndex(new THREE.BufferAttribute(index, 1));

    this.mesh.geometry.dispose();
    this.mesh.geometry = merged;
    this.outline.geometry = merged;
    this.mesh.visible = true;
    this.outline.visible = this.outline.userData.wanted !== false;
    this.applySprings();

    await this.rebuildFace(worn.find((i) => i.slot === 'head'));
    this.recolor();

    this.stats.vertices = vertexCount;
    this.stats.triangles = indexCount / 3 + (this.faceMesh ? this.faceMesh.geometry.index!.count / 3 : 0);
    this.stats.drawCalls = 2 + (this.faceMesh ? 1 : 0);
  }

  /** The hat pivots at its base, just above the brow line. */
  private configureHat(item: ItemDef, headIndex: number, boneIndex: number): void {
    const { min, max } = item.bounds;
    const pivot = new THREE.Vector3(0, min[1] + (max[1] - min[1]) * 0.2, 0);
    this.hatSpring.options.maxAngle = item.sway ?? 0;
    this.configureSlotBone(this.hatSpring, headIndex, boneIndex, pivot, new THREE.Vector3(0, 0.6, 0));
  }

  /** The cape hangs from its top edge. */
  private configureCape(item: ItemDef, chestIndex: number, boneIndex: number): void {
    const { min, max } = item.bounds;
    const pivot = new THREE.Vector3(0, max[1] - 0.04, max[2] - 0.04);
    this.configureSlotBone(this.capeSpring, chestIndex, boneIndex, pivot, new THREE.Vector3(0, min[1] - max[1], -0.12));
  }

  /**
   * Places a slot bone at `pivot` (given in the parent joint's space), aligned with the world
   * axes in the bind pose so "down" and "forward" mean what they say for the spring.
   */
  private configureSlotBone(
    spring: SpringBone, parentIndex: number, boneIndex: number, pivot: THREE.Vector3, tail: THREE.Vector3,
  ): void {
    const pivotWorld = pivot.clone().applyMatrix4(this.bindWorld[parentIndex]);
    const bind = new THREE.Matrix4().makeTranslation(pivotWorld.x, pivotWorld.y, pivotWorld.z);
    const restLocal = this.inverseBind[parentIndex].clone().multiply(bind);
    spring.configure(restLocal, tail);
    this.skeleton.boneInverses[boneIndex].copy(bind).invert();
  }

  private async rebuildFace(head: ItemDef | undefined): Promise<void> {
    if (head?.id === this.faceHead) return;
    this.faceHead = head?.id ?? null;
    if (this.faceMesh) {
      this.faceMesh.removeFromParent();
      this.faceMesh.geometry.dispose();
      this.faceMesh = null;
    }
    if (!head) return;
    const headIndex = this.assets.catalog.rig.joints.indexOf('head');
    const decal = buildFaceDecal(await this.assets.geometry(head.id), head, this.inverseBind[headIndex]);
    if (!decal) return;
    this.faceMesh = new THREE.Mesh(decal, this.face.material);
    this.faceMesh.renderOrder = 1;
    this.joints[headIndex].add(this.faceMesh);
  }

  /** Writes the look's colours into the merged mesh. No geometry is rebuilt. */
  recolor(): void {
    const tint = this.mesh.geometry.getAttribute('tint') as THREE.BufferAttribute | undefined;
    if (!tint) return;
    const data = tint.array as Float32Array;
    for (const segment of this.segments) {
      const tints = segment.item.channels.map((channel) => this.tintFor(segment.item, channel));
      for (let i = 0; i < segment.count; i++) {
        data.set(tints[segment.channel.getX(i)], (segment.start + i) * 4);
      }
    }
    tint.needsUpdate = true;
    this.redrawFace();
  }

  private tintFor(item: ItemDef, channel: Channel): number[] {
    let hex: string | null | undefined;
    if (channel.role === 'skin') hex = this.look.skin;
    else if (channel.role === 'hair') hex = this.look.hair;
    else if (channel.role === 'primary') hex = this.look.colors[item.slot]?.primary;
    else if (channel.role === 'secondary') hex = this.look.colors[item.slot]?.secondary;
    if (!hex) return [0, 0, 0, 0];
    _color.set(hex);
    const luminance = channel.linear[0] * LUMA[0] + channel.linear[1] * LUMA[1] + channel.linear[2] * LUMA[2];
    return [_color.r, _color.g, _color.b, 1 / Math.max(luminance, 0.02)];
  }

  redrawFace(): void {
    const expression = this.expression === 'neutral' && this.blinkLeft > 0 ? 'blink' : this.expression;
    this.face.draw(this.look.face, expression);
  }

  /**
   * @param speed     ground speed, selects idle / walk / run
   * @param velocity  horizontal world velocity, drives lean and trailing parts
   */
  update(dt: number, speed: number, velocity: THREE.Vector3): void {
    this.animator.update(dt, speed);
    this.juice.update(this.body, this.hips.position.y, velocity, this.root.rotation.y, dt);

    this.root.updateMatrixWorld(true);
    this.hatSpring.update(dt);
    this.capeSpring.update(dt);

    this.blinkIn -= dt;
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
    } else if (this.blinkIn <= 0) {
      this.blinkLeft = 0.11;
      this.blinkIn = 1.8 + Math.random() * 3.5;
    }
    this.redrawFace();
  }

  set springsEnabled(enabled: boolean) {
    this.springsWanted = enabled;
    this.applySprings();
  }

  private applySprings(): void {
    const worn = this.wornItems();
    this.hatSpring.enabled = this.springsWanted && worn.some((i) => i.slot === 'headwear' && !!i.sway);
    this.capeSpring.enabled = this.springsWanted && worn.some((i) => i.slot === 'back');
  }

  /** Call after teleporting the character so trailing parts do not whip. */
  resetMotion(): void {
    this.hatSpring.reset();
    this.capeSpring.reset();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.faceMesh?.geometry.dispose();
    this.face.dispose();
    this.skeleton.dispose();
  }
}
