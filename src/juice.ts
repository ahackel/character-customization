import * as THREE from 'three';

const _restWorld = new THREE.Matrix4();
const _origin = new THREE.Vector3();
const _restTail = new THREE.Vector3();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _restWorldQuat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _identity = new THREE.Quaternion();

export interface SpringOptions {
  /** Pull back towards the rest pose. */
  stiffness: number;
  /** Velocity damping. */
  damping: number;
  /** Downward pull in world units per second squared. */
  gravity: number;
  /** Largest deviation from the rest direction, in radians. */
  maxAngle: number;
  /**
   * Optional extra limit on the tail direction, given in the bone's rest space where +Z is the
   * character's front and -Y is down. Mutate the vector; it is renormalised afterwards.
   */
  limit?: (direction: THREE.Vector3) => void;
}

/**
 * A single-bone spring. The bone's tail is simulated as a point mass in world space, so it lags
 * behind when the character moves, and the bone is rotated to point at it. Used for capes and hats.
 */
export class SpringBone {
  private readonly restLocal = new THREE.Matrix4();
  private readonly restQuat = new THREE.Quaternion();
  private readonly restPos = new THREE.Vector3();
  private readonly tailLocal = new THREE.Vector3();
  private readonly tailDir = new THREE.Vector3();
  private readonly current = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private started = false;
  enabled = true;

  constructor(readonly bone: THREE.Object3D, readonly options: SpringOptions) {}

  /** Sets the rest pose (local to the bone's parent) and where the simulated tail sits. */
  configure(restLocal: THREE.Matrix4, tailLocal: THREE.Vector3): void {
    this.restLocal.copy(restLocal);
    restLocal.decompose(this.restPos, this.restQuat, _scale);
    this.tailLocal.copy(tailLocal);
    this.tailDir.copy(tailLocal).normalize();
    this.bone.position.copy(this.restPos);
    this.bone.quaternion.copy(this.restQuat);
    this.started = false;
  }

  reset(): void {
    this.started = false;
  }

  /** Call after the parent's world matrix is up to date for this frame. */
  update(dt: number): void {
    const parent = this.bone.parent;
    if (!parent) return;
    if (!this.enabled) {
      this.bone.quaternion.copy(this.restQuat);
      this.started = false;
      return;
    }
    _restWorld.multiplyMatrices(parent.matrixWorld, this.restLocal);
    _origin.setFromMatrixPosition(_restWorld);
    _restTail.copy(this.tailLocal).applyMatrix4(_restWorld);
    const length = _restTail.distanceTo(_origin);
    if (!this.started || dt <= 0) {
      this.current.copy(_restTail);
      this.velocity.set(0, 0, 0);
      this.started = true;
    }

    const { stiffness, damping, gravity, maxAngle, limit } = this.options;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = Math.min(dt, 0.1) / steps;
    for (let i = 0; i < steps; i++) {
      _v.subVectors(_restTail, this.current).multiplyScalar(stiffness);
      _v.addScaledVector(this.velocity, -damping);
      _v.y -= gravity;
      this.velocity.addScaledVector(_v, h);
      this.current.addScaledVector(this.velocity, h);
      // Keep the tail on a sphere around the bone origin.
      _dir.subVectors(this.current, _origin).normalize();
      this.current.copy(_origin).addScaledVector(_dir, length);
    }

    // Express the tail direction in the bone's rest space and rotate the bone towards it.
    _restWorld.decompose(_pos, _restWorldQuat, _scale);
    _dir.subVectors(this.current, _origin).normalize().applyQuaternion(_restWorldQuat.invert());
    if (limit) {
      limit(_dir);
      _dir.normalize();
    }
    _q.setFromUnitVectors(this.tailDir, _dir);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
    let clamped = limit !== undefined;
    if (angle > maxAngle) {
      _q.slerpQuaternions(_identity, _q, maxAngle / angle);
      clamped = true;
    }
    if (clamped) {
      // Write the limited pose back so the simulation does not wind up against the limit.
      _restWorldQuat.invert();
      _dir.copy(this.tailDir).applyQuaternion(_q).applyQuaternion(_restWorldQuat);
      _v.copy(_origin).addScaledVector(_dir, length);
      if (_v.distanceToSquared(this.current) > 1e-8) {
        this.current.copy(_v);
        this.velocity.multiplyScalar(0.6);
      }
    }
    this.bone.quaternion.copy(this.restQuat).multiply(_q);
  }
}

/** Critically tunable second-order spring on a scalar. */
class Spring1 {
  value: number;
  velocity = 0;
  constructor(private readonly rest: number, private readonly stiffness: number, private readonly damping: number) {
    this.value = rest;
  }
  update(target: number, dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = Math.min(dt, 0.1) / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity += ((target - this.value) * this.stiffness - this.velocity * this.damping) * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  reset(): void {
    this.value = this.rest;
    this.velocity = 0;
  }
}

/**
 * Cartoon follow-through applied on top of whatever clip is playing:
 *  - squash and stretch from the vertical speed of the hips, volume preserving,
 *  - a lean into horizontal acceleration.
 * Both are springs, so they overshoot and settle instead of tracking the input exactly.
 */
export class BodyJuice {
  enabled = true;
  private readonly stretch = new Spring1(1, 260, 16);
  private readonly leanX = new Spring1(0, 90, 13);
  private readonly leanZ = new Spring1(0, 90, 13);
  private lastHipsY: number | null = null;
  private readonly lastVelocity = new THREE.Vector3();

  /**
   * @param target       group whose scale and rotation receive the effect (pivot at the feet)
   * @param hipsY        hips height in the character's own space this frame
   * @param velocity     horizontal world velocity of the character
   * @param yaw          facing of the character, to turn world acceleration into a local lean
   */
  update(target: THREE.Object3D, hipsY: number, velocity: THREE.Vector3, yaw: number, dt: number): void {
    if (!this.enabled || dt <= 0) {
      target.scale.set(1, 1, 1);
      target.rotation.set(0, 0, 0);
      this.lastHipsY = hipsY;
      this.lastVelocity.copy(velocity);
      this.stretch.reset();
      this.leanX.reset();
      this.leanZ.reset();
      return;
    }
    const hipsSpeed = this.lastHipsY === null ? 0 : (hipsY - this.lastHipsY) / dt;
    this.lastHipsY = hipsY;
    const stretchTarget = 1 + THREE.MathUtils.clamp(hipsSpeed * 0.07, -0.16, 0.2);
    const s = THREE.MathUtils.clamp(this.stretch.update(stretchTarget, dt), 0.78, 1.28);
    const side = 1 / Math.sqrt(s);
    target.scale.set(side, s, side);

    // World acceleration rotated into character space: +z is forward.
    const ax = (velocity.x - this.lastVelocity.x) / dt;
    const az = (velocity.z - this.lastVelocity.z) / dt;
    this.lastVelocity.copy(velocity);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const forward = ax * sin + az * cos;
    const right = ax * cos - az * sin;
    const k = 0.011;
    const limit = 0.22;
    target.rotation.x = this.leanX.update(THREE.MathUtils.clamp(forward * k, -limit, limit), dt);
    target.rotation.z = this.leanZ.update(THREE.MathUtils.clamp(-right * k, -limit, limit), dt);
  }
}
