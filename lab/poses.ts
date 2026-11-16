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
// The body drops on the step and rises as the legs pass; arms swing against the legs. Strides are
// kept short and knees only a little bent, as in hand-drawn walks this size: wider swings turn
// the shins into long slanted runs, and a foot kicked up behind reads as a broken leg.
const walkHalf: PoseSpec[] = [
  { legR: { swing: 24, bend: 4 }, legL: { swing: -20, bend: 8 }, armL: { swing: 26, bend: 18 }, armR: { swing: -22, bend: 8 }, lean: 2 },
  { bob: -1, legR: { swing: 12, bend: 12 }, legL: { swing: -20, bend: 14 }, armL: { swing: 16, bend: 14 }, armR: { swing: -14, bend: 8 }, lean: 3 },
  { legR: { swing: -4 }, legL: { swing: 16, bend: 38 }, armL: { swing: -4, bend: 10 }, armR: { swing: 6, bend: 12 }, lean: 2 },
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

// Run: contact, passing, flight, then the same on the other foot. A small forward lean, elbows
// held at a right angle and swinging against the legs, the knee of the free leg carried high.
const runHalf: PoseSpec[] = [
  { bob: -1, lean: 7, legR: { swing: 34, bend: 12 }, legL: { swing: -30, bend: 40 }, armL: { swing: 36, bend: 80 }, armR: { swing: -42, bend: 75 } },
  { bob: 0, lean: 8, legR: { swing: 4, bend: 14 }, legL: { swing: 18, bend: 95 }, armL: { swing: 8, bend: 80 }, armR: { swing: -8, bend: 80 } },
  { bob: 1, lean: 7, legR: { swing: -38, bend: 18 }, legL: { swing: 52, bend: 72 }, armL: { swing: -36, bend: 75 }, armR: { swing: 34, bend: 80 } },
];

// Use: one generic action for whatever is in the hand, or for bare hands. The body stays put with
// one foot forward; the right arm works out to the side, where it reads from the front and from
// behind: it lifts, comes down and recovers.
const useStance = { legR: { swing: 9 }, legL: { swing: -9 }, armL: { swing: -8, bend: 12 } };
const useFrames: PoseSpec[] = [
  { ...useStance, armR: { swing: 50, bend: 75, out: 38 } },
  { ...useStance, lean: -2, armR: { swing: 95, bend: 55, out: 38 } },
  { ...useStance, lean: 4, armR: { swing: 60, bend: 20, out: 32 } },
  { ...useStance, lean: 6, armR: { swing: 34, bend: 14, out: 28 } },
  { ...useStance, lean: 3, armR: { swing: 44, bend: 45, out: 32 } },
];

// Wave: the raised hand swings from side to side, well clear of the head so that it also shows
// from behind.
const waveFrames: PoseSpec[] = [
  { armL: { swing: 150, bend: 20, out: 40 } },
  { armL: { swing: 154, bend: 0, out: 48 } },
  { armL: { swing: 156, bend: -20, out: 56 } },
  { armL: { swing: 154, bend: 0, out: 48 } },
];

// Sit: on the floor, legs straight out in front, hands resting on the thighs. Lie: on the back,
// arms at the sides; the renderer lays the figure down. Both only blink.
const SIT = buildPose({ bob: -9, legL: { swing: 90, out: 4 }, legR: { swing: 90, out: 4 }, armL: { swing: 35, bend: 25 }, armR: { swing: 35, bend: 25 } });
const LIE: Pose = { ...buildPose({ armL: { swing: 0, out: 8 }, armR: { swing: 0, out: 8 }, legL: { swing: 0, out: 3 }, legR: { swing: 0, out: 3 } }), lie: true };
const resting = (pose: Pose): Pick<Clip, 'rate' | 'frames' | 'faces'> => ({
  rate: 5,
  frames: Array<Pose>(15).fill(pose),
  faces: Array.from({ length: 15 }, (_, i) => (i === 13 ? 'blink' : undefined)),
});

// Look around: the eyes glance aside, then the head turns an eighth to the right, back and an
// eighth to the left. A game can turn the head on any pose with `look` and move the eyes with
// the 'aside' face.
const toward = (look: number): Pose => ({ ...STAND, look });
const LOOK_STEPS: [Pose, string | undefined][] = [
  [STAND, undefined], [STAND, undefined], [STAND, 'aside'], [toward(-1), undefined],
  [toward(-1), 'blink'], [toward(-1), 'aside'], [STAND, undefined], [toward(1), undefined],
  [toward(1), 'smile'], [toward(1), undefined], [STAND, undefined], [STAND, 'smile'], [STAND, undefined],
];

export const AUTHORED: Record<string, Clip> = {
  // Standing still. The only movement is a blink every three seconds.
  idle: { name: 'Idle', ...resting(STAND) },
  walk: { name: 'Walk', rate: 8, frames: [...walkHalf, ...walkHalf.map(mirrored)].map(buildPose) },
  run: { name: 'Run', rate: 11, frames: [...runHalf, ...runHalf.map(mirrored)].map(buildPose) },
  // Only the arm moves; the body stays where it is.
  wave: { name: 'Wave', rate: 7, frames: waveFrames.map(buildPose), faces: waveFrames.map(() => 'happy') },
  use: { name: 'Use', rate: 8, frames: useFrames.map(buildPose), swing: true },
  sit: { name: 'Sit', ...resting(SIT) },
  lie: { name: 'Lie', ...resting(LIE) },
  look: { name: 'Look around', rate: 3, frames: LOOK_STEPS.map(([pose]) => pose), faces: LOOK_STEPS.map(([, face]) => face) },
};

// ------------------------------------------------------------------ poses sampled from 3D clips

/** One frame sampled from a clip of the 3D prototype: a unit direction per bone, plus hip height. */
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
