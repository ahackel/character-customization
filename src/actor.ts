import * as THREE from 'three';
import type { Character } from './character';
import type { Expression } from './face';

export type ActionId = 'attack' | 'block' | 'jump' | 'cheer' | 'sit' | 'ouch';

export const ACTIONS: { id: ActionId; label: string }[] = [
  { id: 'attack', label: 'Attack' },
  { id: 'block', label: 'Block' },
  { id: 'jump', label: 'Jump' },
  { id: 'cheer', label: 'Cheer' },
  { id: 'sit', label: 'Sit' },
  { id: 'ouch', label: 'Ouch' },
];

// Which clips an attack uses depends on what the character holds, not on who it is.
const ATTACKS = {
  unarmed: ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Kick', 'Unarmed_Melee_Attack_Punch_B'],
  melee1h: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab'],
  melee2h: ['2H_Melee_Attack_Slice', '2H_Melee_Attack_Chop', '2H_Melee_Attack_Spin'],
  dual: ['Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Stab'],
  magic: ['Spellcast_Shoot', 'Spellcast_Raise'],
  ranged1h: ['1H_Ranged_Shoot'],
  ranged2h: ['2H_Ranged_Shoot'],
  throw: ['Throw'],
  prop: ['Use_Item'],
};

const _desired = new THREE.Vector3();
const _delta = new THREE.Vector3();

/** A character placed in the world: movement, facing, and actions on top of the look. */
export class Actor {
  readonly velocity = new THREE.Vector3();
  /** Keyboard or stick input in world space, length 0 to 1. Overrides tap targets while non-zero. */
  readonly steer = new THREE.Vector3();
  target: THREE.Vector3 | null = null;
  /** When set, the actor turns to this yaw instead of its direction of travel. */
  faceYaw: number | null = null;
  run = true;
  /** Animation speed to show while standing still, for previewing gaits on the spot. */
  treadmill = 0;
  /** Number of facing directions. 0 turns freely; 8 gives the eight facings of an isometric sprite. */
  facings = 0;
  /** Optional mapping of the true position to where the character is drawn (pixel grid snapping). */
  drawAt: ((position: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3) | null = null;
  /** Optional world limits, applied to the position after each move. */
  confine: ((position: THREE.Vector3) => void) | null = null;
  private stuck = 0;
  private yaw = 0;
  private attackIndex = 0;
  private sitting = false;

  constructor(readonly character: Character) {}

  get position(): THREE.Vector3 {
    return this.character.root.position;
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get busy(): boolean {
    return this.character.animator.busy;
  }

  place(x: number, z: number, yaw: number): void {
    this.position.set(x, 0, z);
    this.yaw = yaw;
    this.character.root.rotation.y = yaw;
    this.velocity.set(0, 0, 0);
    this.target = null;
    this.character.resetMotion();
  }

  moveTo(point: THREE.Vector3, run = true): void {
    if (this.sitting) this.stand();
    this.target = point.clone().setY(0);
    // A destination in the sea or inside a rock is moved to the nearest reachable spot.
    this.confine?.(this.target);
    this.run = run;
  }

  /** Picks the standing pose that fits what is held. Call after the look changes. */
  refreshStance(): void {
    const grip = this.character.worn('handR')?.grip;
    this.character.animator.setIdle(grip === 'melee2h' ? '2H_Melee_Idle' : 'Idle');
  }

  perform(action: ActionId): void {
    const { animator } = this.character;
    if (this.sitting) {
      this.stand();
      if (action === 'sit') return;
    }
    this.target = null;
    const once = (clip: string, expression: Expression, speed = 1) => {
      this.character.expression = expression;
      animator.play(clip, { speed, onDone: () => (this.character.expression = 'neutral') });
    };
    switch (action) {
      case 'attack':
        once(this.attackClip(), 'effort', 1.15);
        break;
      case 'block':
        once(this.character.worn('handL')?.grip === 'shield' ? 'Block' : 'Dodge_Backward', 'effort');
        break;
      case 'jump':
        once('Jump_Full_Short', 'neutral');
        break;
      case 'cheer':
        once('Cheer', 'happy');
        break;
      case 'ouch':
        once('Hit_A', 'hurt');
        break;
      case 'sit':
        this.sitting = true;
        animator.play('Sit_Floor_Down', {
          onDone: () => {
            if (this.sitting) animator.play('Sit_Floor_Idle', { loop: true, fade: 0.2 });
          },
        });
        break;
    }
  }

  private stand(): void {
    this.sitting = false;
    this.character.animator.play('Sit_Floor_StandUp', { fade: 0.15 });
  }

  private attackClip(): string {
    const right = this.character.worn('handR')?.grip;
    const left = this.character.worn('handL')?.grip;
    let list = ATTACKS.unarmed;
    if (right === 'melee1h' && left === 'offhandWeapon') list = ATTACKS.dual;
    else if (right && right in ATTACKS) list = ATTACKS[right as keyof typeof ATTACKS];
    return list[this.attackIndex++ % list.length];
  }

  update(dt: number): void {
    const { animator } = this.character;
    const walkSpeed = animator.walkSpeed;
    const topSpeed = this.run ? animator.runSpeed : walkSpeed;

    // Desired velocity: steering input, else arrive at the tap target, else stand still.
    _desired.set(0, 0, 0);
    const locked = animator.busy;
    if (!locked && this.steer.lengthSq() > 1e-4) {
      this.target = null;
      _desired.copy(this.steer).multiplyScalar(animator.runSpeed);
    } else if (!locked && this.target) {
      _delta.subVectors(this.target, this.position).setY(0);
      const distance = _delta.length();
      if (distance < 0.06) {
        this.target = null;
      } else {
        // Slow down on arrival so the character settles instead of snapping to a stop.
        const arrive = Math.min(topSpeed, Math.max(walkSpeed * 0.6, distance * 4.5));
        _desired.copy(_delta).multiplyScalar(arrive / distance);
      }
    }
    const accel = _desired.lengthSq() > 0 ? 26 : 34;
    _delta.subVectors(_desired, this.velocity).setY(0);
    const change = _delta.length();
    if (change > 0) this.velocity.addScaledVector(_delta, Math.min(1, (accel * dt) / change));
    _delta.copy(this.position);
    this.position.addScaledVector(this.velocity, dt);
    this.confine?.(this.position);
    // Give up on a destination that an obstacle keeps blocking.
    const moved = _delta.distanceTo(this.position);
    this.stuck = this.target && dt > 0 && moved < 0.25 * dt ? this.stuck + dt : 0;
    if (this.stuck > 0.5) {
      this.target = null;
      this.stuck = 0;
    }

    // Facing follows travel direction, turning quickly but not instantly.
    const speed = this.speed;
    let wanted: number | null = this.faceYaw;
    if (speed > 0.4) wanted = Math.atan2(this.velocity.x, this.velocity.z);
    if (wanted !== null) {
      let diff = wanted - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 13);
    }
    const facingStep = this.facings > 0 ? (Math.PI * 2) / this.facings : 0;
    this.character.root.rotation.y = facingStep ? Math.round(this.yaw / facingStep) * facingStep : this.yaw;
    if (this.drawAt) {
      // Offset the drawn body, in the root's own frame, without touching the true position.
      const drawn = this.drawAt(this.position, _desired).sub(this.position);
      drawn.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -this.character.root.rotation.y);
      this.character.body.position.copy(drawn);
    } else {
      this.character.body.position.set(0, 0, 0);
    }

    const shown = speed < 0.1 && !animator.busy ? Math.max(speed, this.treadmill) : speed;
    this.character.update(dt, shown, this.velocity);
  }
}

/** Wandering behaviour for the crowd: stroll to a random spot, pause, sometimes do something. */
export class Wanderer {
  private wait = Math.random() * 2;

  constructor(readonly actor: Actor, private readonly radius: number) {}

  update(dt: number): void {
    const { actor } = this;
    if (actor.target || actor.busy) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = 1.5 + Math.random() * 3.5;
    const roll = Math.random();
    if (roll < 0.14) actor.perform('cheer');
    else if (roll < 0.26) actor.perform('attack');
    else if (roll < 0.32) actor.perform('jump');
    else {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.radius;
      actor.moveTo(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r), Math.random() < 0.45);
    }
  }
}

/** Keeps actors from standing inside each other. */
export function separate(actors: Actor[], minDistance = 1.15): void {
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const a = actors[i].position;
      const b = actors[j].position;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= minDistance || d < 1e-4) continue;
      const push = (minDistance - d) / 2 / d;
      a.x -= dx * push;
      a.z -= dz * push;
      b.x += dx * push;
      b.z += dz * push;
    }
  }
}
