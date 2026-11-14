import type { Pose, Vec3 } from './puppet.ts';

/** Bone lengths of the puppet, in pixels. */
export const BONES = { thigh: 5, shin: 5, upperArm: 4.5, forearm: 4.5, spine: 10, shoulder: 6.6, hip: 2.8 };

/** Joint angles in degrees. swing: forward is positive. bend: elbow or knee flex. out: away from the body. */
export interface LimbAngles {
  swing: number;
  bend?: number;
  out?: number;
}

export interface PoseSpec {
  /** Whole body up or down, in pixels. */
  bob?: number;
  /** Chest lowered towards the hips, for breathing and crouching. */
  sink?: number;
  /** Torso tilted forward, in degrees. */
  lean?: number;
  armL?: LimbAngles;
  armR?: LimbAngles;
  legL?: LimbAngles;
  legR?: LimbAngles;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** Direction of a hanging limb segment after swinging forward and out. */
function direction(swing: number, out: number, side: number): Vec3 {
  const s = rad(swing);
  const o = rad(out);
  return [Math.sin(o) * side, -Math.cos(s) * Math.cos(o), Math.sin(s) * Math.cos(o)];
}

/** Builds joint positions from joint angles, the way an animator would pose a puppet. */
export function buildPose(spec: PoseSpec = {}): Pose {
  const bob = spec.bob ?? 0;
  const lean = rad(spec.lean ?? 0);
  const hips: Vec3 = [0, 1 + BONES.thigh + BONES.shin + bob, 0];
  const spine = BONES.spine - (spec.sink ?? 0);
  const chest: Vec3 = [0, hips[1] + Math.cos(lean) * spine, Math.sin(lean) * spine];
  const pose = { hips, chest, neck: add(chest, [0, 1, 0]) } as Pose;
  for (const [s, side] of [['L', -1], ['R', 1]] as const) {
    const arm = spec[`arm${s}`] ?? { swing: 0 };
    const shoulder = add(chest, [side * BONES.shoulder, -1, 0]);
    const elbow = add(shoulder, direction(arm.swing, arm.out ?? 0, side), BONES.upperArm);
    const hand = add(elbow, direction(arm.swing + (arm.bend ?? 0), arm.out ?? 0, side), BONES.forearm);
    pose[`shoulder${s}`] = shoulder;
    pose[`elbow${s}`] = elbow;
    pose[`hand${s}`] = hand;

    const leg = spec[`leg${s}`] ?? { swing: 0 };
    const hip = add(hips, [side * BONES.hip, 0, 0]);
    const knee = add(hip, direction(leg.swing, leg.out ?? 0, side), BONES.thigh);
    const foot = add(knee, direction(leg.swing - (leg.bend ?? 0), leg.out ?? 0, side), BONES.shin);
    pose[`hip${s}`] = hip;
    pose[`knee${s}`] = knee;
    pose[`foot${s}`] = foot;
  }
  return pose;
}

const mirrored = (spec: PoseSpec): PoseSpec => ({
  ...spec, armL: spec.armR, armR: spec.armL, legL: spec.legR, legR: spec.legL,
});

// Walk: contact, down, passing, then the same on the other foot. Authored as key poses.
const walkHalf: PoseSpec[] = [
  { legR: { swing: 30 }, legL: { swing: -26, bend: 10 }, armL: { swing: 30, bend: 12 }, armR: { swing: -24, bend: 6 } },
  { bob: -1, legR: { swing: 14, bend: 20 }, legL: { swing: -32, bend: 34 }, armL: { swing: 18, bend: 10 }, armR: { swing: -14, bend: 6 } },
  { bob: 1, legR: { swing: -4 }, legL: { swing: 22, bend: 58 }, armL: { swing: -4, bend: 6 }, armR: { swing: 6, bend: 8 } },
];

export interface Clip {
  name: string;
  /** Frames shown per second. */
  rate: number;
  frames: Pose[];
}

export const STAND = buildPose();

export const AUTHORED: Record<string, Clip> = {
  idle: { name: 'Idle', rate: 2, frames: [buildPose(), buildPose({ sink: 1 })] },
  walk: { name: 'Walk', rate: 8, frames: [...walkHalf, ...walkHalf.map(mirrored)].map(buildPose) },
  wave: {
    name: 'Wave',
    rate: 6,
    frames: [
      { armR: { swing: 70, bend: 60, out: 15 } },
      { armR: { swing: 150, bend: 30, out: 25 } },
      { armR: { swing: 160, bend: -30, out: 25 } },
      { armR: { swing: 150, bend: 30, out: 25 } },
    ].map(buildPose),
  },
};

// ------------------------------------------------------------------ poses sampled from 3D clips

/** One frame as exported by tools/export-poses.mjs: a unit direction per bone, plus hip height. */
export interface SampledFrame {
  bob: number;
  spine: Vec3;
  upperArmL: Vec3; forearmL: Vec3; upperArmR: Vec3; forearmR: Vec3;
  thighL: Vec3; shinL: Vec3; thighR: Vec3; shinR: Vec3;
}

/**
 * Poses the puppet from 3D bone directions. Only directions are taken from the 3D rig; the
 * puppet keeps its own bone lengths, so the source character's proportions do not matter.
 */
export function poseFromSample(frame: SampledFrame): Pose {
  const legs = BONES.thigh + BONES.shin;
  const hips: Vec3 = [0, 1 + legs + frame.bob * legs, 0];
  const chest = add(hips, frame.spine, BONES.spine);
  const pose = { hips, chest, neck: add(chest, [0, 1, 0]) } as Pose;
  for (const [s, side] of [['L', -1], ['R', 1]] as const) {
    const shoulder = add(chest, [side * BONES.shoulder, -1, 0]);
    const elbow = add(shoulder, frame[`upperArm${s}`], BONES.upperArm);
    pose[`shoulder${s}`] = shoulder;
    pose[`elbow${s}`] = elbow;
    pose[`hand${s}`] = add(elbow, frame[`forearm${s}`], BONES.forearm);
    const hip = add(hips, [side * BONES.hip, 0, 0]);
    const knee = add(hip, frame[`thigh${s}`], BONES.thigh);
    pose[`hip${s}`] = hip;
    pose[`knee${s}`] = knee;
    pose[`foot${s}`] = add(knee, frame[`shin${s}`], BONES.shin);
  }
  return pose;
}

export function clipsFromSamples(data: Record<string, { name: string; rate: number; frames: SampledFrame[] }>): Record<string, Clip> {
  return Object.fromEntries(
    Object.entries(data).map(([key, clip]) => [key, { name: clip.name, rate: clip.rate, frames: clip.frames.map(poseFromSample) }]),
  );
}
