import type { Pose, Vec3 } from './puppet.ts';

/** Bone lengths of the puppet, in pixels. */
// Shoulder and hip offsets are chosen so the limbs land on whole pixel columns: arms just outside
// the nine-pixel torso, legs four wide with a one-pixel gap between them.
export const BONES = { thigh: 5, shin: 5, upperArm: 4.5, forearm: 4.5, spine: 10, shoulder: 7.07, hip: 3.54 };

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
    const shoulder = add(chest, [side * BONES.shoulder, -0.5, 0]);
    const elbow = add(shoulder, direction(arm.swing, arm.out ?? 0, side), BONES.upperArm);
    const hand = add(elbow, direction(arm.swing + (arm.bend ?? 0), arm.out ?? 0, side), BONES.forearm);
    pose[`shoulder${s}`] = shoulder;
    pose[`elbow${s}`] = elbow;
    pose[`hand${s}`] = hand;

    const leg = spec[`leg${s}`] ?? { swing: 0 };
    const hip = add(hips, [side * BONES.hip, -0.5, 0]);
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
// The body drops on the step and rises as the legs pass; arms swing against the legs.
const walkHalf: PoseSpec[] = [
  { legR: { swing: 32 }, legL: { swing: -28, bend: 12 }, armL: { swing: 34, bend: 22 }, armR: { swing: -28, bend: 8 }, lean: 3 },
  { bob: -1, legR: { swing: 14, bend: 22 }, legL: { swing: -34, bend: 38 }, armL: { swing: 20, bend: 18 }, armR: { swing: -16, bend: 8 }, lean: 4 },
  { bob: 1, legR: { swing: -4 }, legL: { swing: 24, bend: 62 }, armL: { swing: -6, bend: 10 }, armR: { swing: 8, bend: 14 }, lean: 2 },
];

export interface Clip {
  name: string;
  /** Frames shown per second. */
  rate: number;
  frames: Pose[];
  /** Face to show on each frame. Missing entries mean the neutral face. */
  faces?: (string | undefined)[];
  /** True for actions that swing the held tool, such as a chop. */
  swing?: boolean;
}

export const STAND = buildPose();

const breatheIn = buildPose({ armL: { swing: 0, out: 3 }, armR: { swing: 0, out: 3 } });
const breatheOut = buildPose({ sink: 1 });

export const AUTHORED: Record<string, Clip> = {
  // Breathing, with a blink every third breath.
  idle: {
    name: 'Idle',
    rate: 2.5,
    frames: [breatheIn, breatheOut, breatheIn, breatheOut, breatheIn, breatheOut],
    faces: [undefined, undefined, undefined, undefined, 'blink', undefined],
  },
  walk: { name: 'Walk', rate: 8, frames: [...walkHalf, ...walkHalf.map(mirrored)].map(buildPose) },
  wave: {
    name: 'Wave',
    rate: 6,
    frames: [
      { armL: { swing: 70, bend: 60, out: 15 } },
      { armL: { swing: 150, bend: 30, out: 25 }, bob: 1 },
      { armL: { swing: 160, bend: -30, out: 25 } },
      { armL: { swing: 150, bend: 30, out: 25 }, bob: 1 },
    ].map(buildPose),
    faces: ['happy', 'happy', 'happy', 'happy'],
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
    const shoulder = add(chest, [side * BONES.shoulder, -0.5, 0]);
    const elbow = add(shoulder, frame[`upperArm${s}`], BONES.upperArm);
    pose[`shoulder${s}`] = shoulder;
    pose[`elbow${s}`] = elbow;
    pose[`hand${s}`] = add(elbow, frame[`forearm${s}`], BONES.forearm);
    const hip = add(hips, [side * BONES.hip, -0.5, 0]);
    const knee = add(hip, frame[`thigh${s}`], BONES.thigh);
    pose[`hip${s}`] = hip;
    pose[`knee${s}`] = knee;
    pose[`foot${s}`] = add(knee, frame[`shin${s}`], BONES.shin);
  }
  return pose;
}

export function clipsFromSamples(data: Record<string, { name: string; rate: number; frames: SampledFrame[] }>): Record<string, Clip> {
  return Object.fromEntries(
    Object.entries(data).map(([key, clip]) => [key, { name: clip.name, rate: clip.rate, frames: clip.frames.map(poseFromSample), swing: key === 'chop' }]),
  );
}
