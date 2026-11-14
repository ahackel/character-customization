import * as THREE from 'three';
import type { FaceAnchor, ItemDef } from './assets';
import { toonRamp } from './materials';

export const EYE_STYLES = ['dot', 'shine', 'big', 'sleepy', 'narrow', 'happy'] as const;
export const MOUTH_STYLES = ['none', 'smile', 'grin', 'open', 'flat', 'smirk', 'cat'] as const;
export type EyeStyle = (typeof EYE_STYLES)[number];
export type MouthStyle = (typeof MOUTH_STYLES)[number];
export type Expression = 'neutral' | 'blink' | 'happy' | 'effort' | 'hurt';

export interface FaceStyle {
  eyes: EyeStyle;
  mouth: MouthStyle;
  blush: boolean;
  eyeColor: string;
}

export const FACE_SIZE = 256;
const INK = '#2b1b1f';
const CX = FACE_SIZE / 2;
// The decal is 2.4 eye distances wide and the eye line sits 41% from its top (see buildFaceDecal).
const EYE_DX = FACE_SIZE / 2.4 / 2;
const EYE_Y = FACE_SIZE * 0.41;
const MOUTH_Y = EYE_Y + 56;

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function drawEye(ctx: CanvasRenderingContext2D, style: EyeStyle | 'closed' | 'squeeze', x: number, side: number, eyeColor: string): void {
  const y = EYE_Y;
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (style) {
    case 'dot':
      ellipse(ctx, x, y, 12, 16);
      ctx.fill();
      break;
    case 'shine':
      ellipse(ctx, x, y, 14, 18);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ellipse(ctx, x - 4, y - 7, 4.6, 5.4);
      ctx.fill();
      ellipse(ctx, x + 5, y + 7, 2.2, 2.2);
      ctx.fill();
      break;
    case 'big':
      ctx.fillStyle = '#ffffff';
      ellipse(ctx, x, y, 17, 20);
      ctx.fill();
      ctx.save();
      ellipse(ctx, x, y, 17, 20);
      ctx.clip();
      ctx.fillStyle = eyeColor;
      ellipse(ctx, x - side * 1.5, y + 2, 12, 15);
      ctx.fill();
      ctx.fillStyle = INK;
      ellipse(ctx, x - side * 1.5, y + 3, 6.5, 8.5);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ellipse(ctx, x - 5, y - 6, 4.2, 4.8);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(x, y, 17, 20, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      break;
    case 'sleepy':
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 20, y - 3, 40, 30);
      ctx.clip();
      ellipse(ctx, x, y, 13, 16);
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x - 16, y - 3);
      ctx.lineTo(x + 16, y - 3);
      ctx.stroke();
      break;
    case 'narrow':
      ellipse(ctx, x, y, 15, 8);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ellipse(ctx, x - 5, y - 2.5, 3, 2.4);
      ctx.fill();
      break;
    case 'happy':
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(x, y + 8, 14, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      break;
    case 'closed':
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.arc(x, y - 6, 14, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
      break;
    case 'squeeze':
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x + side * 13, y - 10);
      ctx.lineTo(x - side * 9, y);
      ctx.lineTo(x + side * 13, y + 10);
      ctx.stroke();
      break;
  }
}

function drawMouth(ctx: CanvasRenderingContext2D, style: MouthStyle | 'shout'): void {
  const y = MOUTH_Y;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  switch (style) {
    case 'none':
      break;
    case 'smile':
      ctx.beginPath();
      ctx.arc(CX, y - 12, 20, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
      break;
    case 'grin': {
      ctx.beginPath();
      ctx.moveTo(CX - 24, y - 6);
      ctx.quadraticCurveTo(CX, y - 2, CX + 24, y - 6);
      ctx.quadraticCurveTo(CX + 20, y + 20, CX, y + 20);
      ctx.quadraticCurveTo(CX - 20, y + 20, CX - 24, y - 6);
      ctx.closePath();
      ctx.fillStyle = '#5a1f2b';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(CX - 26, y - 8, 52, 9);
      ctx.fillStyle = '#f0717f';
      ellipse(ctx, CX, y + 21, 13, 8);
      ctx.fill();
      ctx.restore();
      ctx.stroke();
      break;
    }
    case 'open':
      ctx.fillStyle = '#5a1f2b';
      ellipse(ctx, CX, y + 3, 10, 12);
      ctx.fill();
      ctx.stroke();
      break;
    case 'shout':
      ctx.fillStyle = '#5a1f2b';
      ctx.beginPath();
      ctx.roundRect(CX - 17, y - 7, 34, 24, 9);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(CX - 18, y - 8, 36, 8);
      ctx.restore();
      ctx.stroke();
      break;
    case 'flat':
      ctx.beginPath();
      ctx.moveTo(CX - 14, y);
      ctx.lineTo(CX + 14, y);
      ctx.stroke();
      break;
    case 'smirk':
      ctx.beginPath();
      ctx.moveTo(CX - 14, y + 2);
      ctx.quadraticCurveTo(CX + 6, y + 6, CX + 18, y - 8);
      ctx.stroke();
      break;
    case 'cat':
      ctx.beginPath();
      ctx.arc(CX - 9, y - 4, 9, Math.PI * 0.1, Math.PI * 0.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(CX + 9, y - 4, 9, Math.PI * 0.05, Math.PI * 0.9);
      ctx.stroke();
      break;
  }
}

/** Composes the face layers into a canvas. The same function draws the option previews in the UI. */
export function drawFace(ctx: CanvasRenderingContext2D, style: FaceStyle, expression: Expression): void {
  ctx.clearRect(0, 0, FACE_SIZE, FACE_SIZE);

  let eyes: EyeStyle | 'closed' | 'squeeze' = style.eyes;
  let mouth: MouthStyle | 'shout' = style.mouth;
  if (expression === 'blink' && eyes !== 'happy') eyes = 'closed';
  if (expression === 'happy') {
    eyes = 'happy';
    mouth = 'grin';
  }
  if (expression === 'effort') mouth = 'shout';
  if (expression === 'hurt') {
    eyes = 'squeeze';
    mouth = 'open';
  }

  if (style.blush) {
    for (const side of [-1, 1]) {
      const x = CX + side * (EYE_DX + 22);
      const gradient = ctx.createRadialGradient(x, EYE_Y + 34, 0, x, EYE_Y + 34, 22);
      gradient.addColorStop(0, 'rgba(240, 96, 112, 0.6)');
      gradient.addColorStop(1, 'rgba(240, 96, 112, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x - 24, EYE_Y + 10, 48, 48);
    }
  }
  for (const side of [-1, 1]) {
    drawEye(ctx, eyes, CX + side * EYE_DX, side, style.eyeColor);
  }
  drawMouth(ctx, mouth);
}

/** A per-character canvas texture holding the composed face. */
export class FaceTexture {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshToonMaterial;
  private readonly ctx: CanvasRenderingContext2D;
  private drawn = '';

  constructor() {
    this.canvas.width = this.canvas.height = FACE_SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshToonMaterial({
      map: this.texture,
      gradientMap: toonRamp,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  draw(style: FaceStyle, expression: Expression): void {
    const key = JSON.stringify([style, expression]);
    if (key === this.drawn) return;
    this.drawn = key;
    drawFace(this.ctx, style, expression);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

/**
 * Builds the surface the face texture is drawn on: a grid projected onto the skin of the head
 * from the front. The head keeps its own UV layout, so any head works with any face.
 * Returned geometry is in the head joint's local space.
 */
export function buildFaceDecal(
  headGeometry: THREE.BufferGeometry,
  head: ItemDef,
  headInverseBind: THREE.Matrix4,
): THREE.BufferGeometry | null {
  const anchor: FaceAnchor | undefined = head.face;
  if (!anchor) return null;
  const channel = headGeometry.getAttribute('_channel');
  const skinChannel = head.channels.findIndex((c) => c.role === 'skin');

  const eyeDistance = anchor.eyeL[0] - anchor.eyeR[0];
  const size = eyeDistance * 2.4;
  const left = (anchor.eyeL[0] + anchor.eyeR[0]) / 2 - size / 2;
  const top = anchor.eyeL[1] + size * 0.41;
  const frontZ = anchor.eyeL[2];

  const target = new THREE.Mesh(headGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1);

  const N = 16;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const valid: boolean[] = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      origin.set(left + (size * i) / N, top - (size * j) / N, frontZ + 2);
      raycaster.set(origin, forward);
      const hit = raycaster.intersectObject(target, false)[0];
      const onSkin = !!hit && !!hit.face && channel.getX(hit.face.a) === skinChannel;
      valid.push(onSkin);
      const p = onSkin ? hit.point.clone() : origin.clone().setZ(frontZ);
      const n = onSkin && hit.normal ? hit.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
      p.addScaledVector(n, 0.004).applyMatrix4(headInverseBind);
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      uvs.push(i / N, 1 - j / N);
    }
  }
  const indices: number[] = [];
  const row = N + 1;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      if (valid[a] && valid[b] && valid[c] && valid[d]) indices.push(a, c, b, b, c, d);
    }
  }
  (target.material as THREE.Material).dispose();
  if (!indices.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
