import * as THREE from 'three';

export interface PlayOptions {
  /** Keep looping until another clip is played or `stop()` is called. */
  loop?: boolean;
  /** Seconds to blend in. */
  fade?: number;
  /** Playback speed multiplier. */
  speed?: number;
  onDone?: () => void;
}

const strideCache = new Map<string, number>();

/**
 * Ground speed at which a locomotion clip's feet do not slide: the average backward speed of
 * a foot while it is on the ground. Measured once per clip on a scratch copy of the rig.
 */
function measureStride(rig: THREE.Object3D, clip: THREE.AnimationClip, footName: string): number {
  const cached = strideCache.get(clip.name);
  if (cached !== undefined) return cached;
  const copy = rig.clone(true);
  const mixer = new THREE.AnimationMixer(copy);
  mixer.clipAction(clip).play();
  const foot = copy.getObjectByName(footName)!;
  const samples: { y: number; z: number }[] = [];
  const count = 48;
  const p = new THREE.Vector3();
  for (let i = 0; i <= count; i++) {
    mixer.setTime((clip.duration * i) / count);
    copy.updateMatrixWorld(true);
    foot.getWorldPosition(p);
    samples.push({ y: p.y, z: p.z });
  }
  const minY = Math.min(...samples.map((s) => s.y));
  let distance = 0;
  let time = 0;
  const step = clip.duration / count;
  for (let i = 1; i <= count; i++) {
    if (samples[i].y > minY + 0.04 || samples[i - 1].y > minY + 0.04) continue;
    const dz = samples[i - 1].z - samples[i].z;
    if (dz <= 0) continue;
    distance += dz;
    time += step;
  }
  const speed = time > 0 ? distance / time : 1;
  strideCache.set(clip.name, speed);
  return speed;
}

/**
 * Drives one character's skeleton: a speed-blended idle / walk / run base layer, with one-shot
 * and looping clips cross-faded on top. Every character uses the same clips, whatever it wears.
 */
export class Animator {
  readonly mixer: THREE.AnimationMixer;
  readonly walkSpeed: number;
  readonly runSpeed: number;
  private idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly run: THREE.AnimationAction;
  private previousIdle: THREE.AnimationAction | null = null;
  private idleBlend = 1;
  private phase = Math.random();
  private override: THREE.AnimationAction | null = null;
  private fading: { action: THREE.AnimationAction; weight: number }[] = [];
  private overrideWeight = 0;
  private overrideFade = 0.12;
  private overrideDone: (() => void) | undefined;
  private releasing = false;

  constructor(
    rig: THREE.Object3D,
    private readonly clips: Map<string, THREE.AnimationClip>,
    footName: string,
  ) {
    this.mixer = new THREE.AnimationMixer(rig);
    this.idle = this.action('Idle');
    this.walk = this.action('Walking_A');
    this.run = this.action('Running_A');
    this.walkSpeed = measureStride(rig, this.clips.get('Walking_A')!, footName);
    this.runSpeed = measureStride(rig, this.clips.get('Running_A')!, footName);
    for (const a of [this.idle, this.walk, this.run]) a.play();
    this.idle.time = Math.random() * this.idle.getClip().duration;
    this.walk.timeScale = 0;
    this.run.timeScale = 0;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.override) this.release();
    });
  }

  private action(name: string): THREE.AnimationAction {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Unknown animation "${name}"`);
    return this.mixer.clipAction(clip);
  }

  get busy(): boolean {
    return this.override !== null && !this.releasing;
  }

  get current(): string | null {
    return this.override && !this.releasing ? this.override.getClip().name : null;
  }

  /** Changes the standing pose, for example when a two-handed weapon is equipped. */
  setIdle(name: string): void {
    const next = this.action(name);
    if (next === this.idle) return;
    this.previousIdle?.stop();
    this.previousIdle = this.idle;
    this.idle = next;
    this.idleBlend = 0;
    next.reset().play();
  }

  play(name: string, options: PlayOptions = {}): void {
    const next = this.action(name);
    this.fading = this.fading.filter((f) => f.action !== next);
    if (this.override && this.override !== next) {
      this.fading.push({ action: this.override, weight: this.overrideWeight });
      this.overrideWeight = 0;
    }
    this.override = next;
    this.overrideDone = options.onDone;
    this.overrideFade = options.fade ?? 0.12;
    this.releasing = false;
    next.reset();
    next.setLoop(options.loop ? THREE.LoopRepeat : THREE.LoopOnce, options.loop ? Infinity : 1);
    next.clampWhenFinished = true;
    next.timeScale = options.speed ?? 1;
    next.setEffectiveWeight(this.overrideWeight);
    next.play();
  }

  /** Ends a looping clip and blends back to locomotion. */
  stop(): void {
    if (this.override && !this.releasing) this.release();
  }

  private release(): void {
    this.releasing = true;
    this.overrideFade = 0.22;
    const done = this.overrideDone;
    this.overrideDone = undefined;
    done?.();
  }

  update(dt: number, speed: number): void {
    // Override layer weight.
    const target = this.override && !this.releasing ? 1 : 0;
    const rate = dt / Math.max(this.overrideFade, 1e-3);
    this.overrideWeight = THREE.MathUtils.clamp(
      this.overrideWeight + Math.sign(target - this.overrideWeight) * rate, 0, 1);
    if (this.override) {
      this.override.setEffectiveWeight(this.overrideWeight);
      if (this.releasing && this.overrideWeight === 0) {
        this.override.stop();
        this.override = null;
        this.releasing = false;
      }
    }
    for (const f of this.fading) {
      f.weight = Math.max(0, f.weight - dt / 0.12);
      f.action.setEffectiveWeight(f.weight);
      if (f.weight === 0) f.action.stop();
    }
    this.fading = this.fading.filter((f) => f.weight > 0);
    const fadingWeight = this.fading.reduce((s, f) => s + f.weight, 0);
    const base = Math.max(0, 1 - this.overrideWeight - fadingWeight);

    // Base layer: idle -> walk -> run by ground speed, feet kept in phase.
    const { walkSpeed, runSpeed } = this;
    let idleW: number;
    let walkW: number;
    let runW: number;
    let cyclesPerSecond: number;
    const walkRate = 1 / this.walk.getClip().duration;
    const runRate = 1 / this.run.getClip().duration;
    if (speed <= walkSpeed) {
      walkW = THREE.MathUtils.smoothstep(speed, 0.05, walkSpeed * 0.7);
      idleW = 1 - walkW;
      runW = 0;
      cyclesPerSecond = walkRate * Math.max(speed / walkSpeed, 0.55);
    } else {
      const t = THREE.MathUtils.clamp((speed - walkSpeed) / (runSpeed - walkSpeed), 0, 1);
      idleW = 0;
      walkW = 1 - t;
      runW = t;
      const natural = THREE.MathUtils.lerp(walkSpeed, runSpeed, t);
      cyclesPerSecond = THREE.MathUtils.lerp(walkRate, runRate, t) * (speed / natural);
    }
    this.phase = (this.phase + cyclesPerSecond * dt) % 1;
    this.walk.time = this.phase * this.walk.getClip().duration;
    this.run.time = this.phase * this.run.getClip().duration;

    this.idleBlend = Math.min(1, this.idleBlend + dt / 0.25);
    this.idle.setEffectiveWeight(base * idleW * this.idleBlend);
    if (this.previousIdle) {
      this.previousIdle.setEffectiveWeight(base * idleW * (1 - this.idleBlend));
      if (this.idleBlend === 1) {
        this.previousIdle.stop();
        this.previousIdle = null;
      }
    }
    this.walk.setEffectiveWeight(base * walkW);
    this.run.setEffectiveWeight(base * runW);

    this.mixer.update(dt);
  }
}
