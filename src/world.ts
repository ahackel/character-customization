import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonRamp } from './materials';

export type CameraMode = 'play' | 'dress';

const SKY = '#e6e9fb';
const VIEWS: Record<CameraMode, { yaw: number; pitch: number; distance: number; height: number }> = {
  // Fixed three-quarter game camera.
  play: { yaw: Math.PI / 4, pitch: 0.62, distance: 17.5, height: 0.9 },
  // Close, near eye level, for the wardrobe.
  dress: { yaw: 0.42, pitch: 0.16, distance: 10.5, height: 1.45 },
};

function checkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d3d7f1';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#c9cdec';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillRect(64, 64, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(30, 30);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Trees and rocks around the play area, merged into one mesh plus one outline mesh. */
function buildProps(): THREE.Group {
  const parts: THREE.BufferGeometry[] = [];
  const color = new THREE.Color();
  const add = (geometry: THREE.BufferGeometry, hex: string, matrix: THREE.Matrix4) => {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-3);
    g.computeVertexNormals();
    g.applyMatrix4(matrix);
    color.set(hex);
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, turn = 0) =>
    m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn), new THREE.Vector3(sx, sy, sz));

  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const crowns = ['#58b99a', '#6cc7a4', '#4aa98f'];
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + random() * 0.25;
    const radius = 10.5 + random() * 7;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (i % 3 === 2) {
      const s = 0.6 + random() * 0.7;
      add(new THREE.DodecahedronGeometry(1, 0), '#aeb3d6', place(x, s * 0.45, z, s * 1.3, s * 0.8, s, random() * 3));
    } else {
      const h = 1.3 + random() * 0.9;
      const r = 1.2 + random() * 0.6;
      add(new THREE.CylinderGeometry(0.2, 0.3, h, 7), '#8d6f8f', place(x, h / 2, z, 1, 1, 1));
      add(new THREE.IcosahedronGeometry(1, 1), crowns[i % 3], place(x, h + r * 0.7, z, r, r * 0.95, r, random() * 3));
      add(new THREE.IcosahedronGeometry(1, 1), crowns[(i + 1) % 3], place(x + r * 0.5, h + r * 0.35, z + r * 0.3, r * 0.6, r * 0.55, r * 0.6));
    }
  }
  const geometry = mergeGeometries(parts)!;
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp }));
  mesh.castShadow = true;
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: '#3b3560', side: THREE.BackSide });
  outlineMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normal * 0.035;',
    );
  };
  group.add(mesh, new THREE.Mesh(geometry, outlineMaterial));
  return group;
}

/** Renderer, lighting, ground and the camera that follows the player. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 120);
  readonly focus = new THREE.Vector3();
  mode: CameraMode = 'play';
  /** Height in pixels of controls covering the bottom of the stage; the wardrobe view keeps the hero above them. */
  bottomInset = 0;
  private inset = 0;
  private readonly sun: THREE.DirectionalLight;
  private readonly view = { ...VIEWS.play };
  private readonly lookAt = new THREE.Vector3(0, VIEWS.play.height, 0);
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly marker: THREE.Mesh;
  private markerAge = 1;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 34, 62);

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b4a8d8', 1.55));
    this.sun = new THREE.DirectionalLight('#fff1dc', 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -13;
    s.right = s.top = 13;
    s.near = 1;
    s.far = 60;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshLambertMaterial({ map: checkerTexture() }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground, buildProps());

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.44, 40),
      new THREE.MeshBasicMaterial({ color: '#2a2550', transparent: true, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.02;
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  set shadows(enabled: boolean) {
    this.sun.castShadow = enabled;
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Where a screen position hits the ground, or null if it misses. */
  groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    if (!point || point.length() > 26) return null;
    return point;
  }

  showMarker(point: THREE.Vector3): void {
    this.marker.position.set(point.x, 0.02, point.z);
    this.markerAge = 0;
    this.marker.visible = true;
  }

  /** Yaw a character must have to face the camera. */
  get cameraYaw(): number {
    return this.view.yaw;
  }

  /** Direction on the ground for "up" and "right" on screen, for keyboard movement. */
  screenAxes(): { forward: THREE.Vector3; right: THREE.Vector3 } {
    const forward = new THREE.Vector3(-Math.sin(this.view.yaw), 0, -Math.cos(this.view.yaw));
    return { forward, right: new THREE.Vector3(-forward.z, 0, forward.x) };
  }

  update(dt: number): void {
    const goal = VIEWS[this.mode];
    const k = 1 - Math.exp(-dt * 6);
    const { clientWidth: w, clientHeight: h } = this.container;
    let wanted = goal.distance;
    let inset = 0;
    if (this.mode === 'play') {
      // A tall, narrow screen needs more distance to keep the same width in view.
      wanted *= Math.max(1, 0.8 / this.camera.aspect);
    } else {
      // Fit the whole hero, hat included, into the part of the stage the controls leave free.
      inset = Math.min(this.bottomInset, h * 0.45);
      const free = Math.max(h - inset - 56, h * 0.3);
      wanted = Math.max((6.9 * h) / free, 5.6 / this.camera.aspect);
    }
    this.inset += (inset - this.inset) * k;
    if (this.inset > 0.5) this.camera.setViewOffset(w, h, 0, this.inset / 2, w, h);
    else if (this.camera.view) this.camera.clearViewOffset();
    this.view.yaw += (goal.yaw - this.view.yaw) * k;
    this.view.pitch += (goal.pitch - this.view.pitch) * k;
    this.view.distance += (wanted - this.view.distance) * k;
    this.view.height += (goal.height - this.view.height) * k;
    this.lookAt.x += (this.focus.x - this.lookAt.x) * k;
    this.lookAt.z += (this.focus.z - this.lookAt.z) * k;
    this.lookAt.y = this.view.height;

    const { yaw, pitch, distance } = this.view;
    this.camera.position.set(
      this.lookAt.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      this.lookAt.y + Math.sin(pitch) * distance,
      this.lookAt.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.camera.lookAt(this.lookAt);

    this.sun.target.position.copy(this.lookAt).setY(0);
    this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(-9, 22, 12));

    if (this.marker.visible) {
      this.markerAge += dt * 1.6;
      const t = Math.min(this.markerAge, 1);
      this.marker.scale.setScalar(0.6 + t * 0.9);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
      if (t >= 1) this.marker.visible = false;
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
