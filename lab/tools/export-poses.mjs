// Experiment 2: sample the 3D animation clips at key moments and record each bone's direction,
// so the 2D puppet can be posed from the 3D animation library.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CLIPS = [
  { key: 'idle', clip: 'Idle', frames: 2, rate: 2 },
  { key: 'walk', clip: 'Walking_A', frames: 6, rate: 8 },
  { key: 'run', clip: 'Running_A', frames: 6, rate: 10 },
  { key: 'wave', clip: 'Cheer', frames: 4, rate: 6 },
  { key: 'chop', clip: '1H_Melee_Attack_Chop', frames: 4, rate: 7 },
];

const data = fs.readFileSync('public/assets/rig.glb');
const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
const rig = gltf.scene;
const joint = (name) => rig.getObjectByName(name);
const at = (name) => joint(name).getWorldPosition(new THREE.Vector3());
// The source faces +z with +x on the character's left. The puppet's x is the character's right.
const dir = (from, to) => {
  const d = at(to).sub(at(from)).normalize();
  return [-d.x, d.y, d.z].map((v) => +v.toFixed(3));
};

rig.updateMatrixWorld(true);
const restHips = at('hips').y;
const legLength = at('upperlegl').distanceTo(at('lowerlegl')) + at('lowerlegl').distanceTo(at('footl'));

const out = {};
for (const { key, clip: clipName, frames, rate } of CLIPS) {
  const clip = gltf.animations.find((a) => a.name === clipName);
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(clip).play();
  const list = [];
  for (let i = 0; i < frames; i++) {
    mixer.setTime((clip.duration * i) / frames);
    rig.updateMatrixWorld(true);
    list.push({
      // Hip height relative to standing, as a fraction of leg length.
      bob: +((at('hips').y - restHips) / legLength).toFixed(3),
      spine: dir('hips', 'head'),
      upperArmL: dir('upperarml', 'lowerarml'), forearmL: dir('lowerarml', 'wristl'),
      upperArmR: dir('upperarmr', 'lowerarmr'), forearmR: dir('lowerarmr', 'wristr'),
      thighL: dir('upperlegl', 'lowerlegl'), shinL: dir('lowerlegl', 'footl'),
      thighR: dir('upperlegr', 'lowerlegr'), shinR: dir('lowerlegr', 'footr'),
    });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(rig);
  out[key] = { name: clipName, rate, frames: list };
}
fs.writeFileSync('lab/generated/poses3d.json', JSON.stringify(out));
console.log(Object.entries(out).map(([k, v]) => `${k}: ${v.frames.length} frames`).join(', '));
console.log('idle frame 0', JSON.stringify(out.idle.frames[0]));
