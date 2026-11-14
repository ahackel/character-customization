import * as THREE from 'three';
import { Island } from './island';
import { PixelPipeline, TEXELS_PER_UNIT } from './pixel';

export type CameraMode = 'play' | 'dress';

// Classic pixel-art isometric view: 45 degrees around, 30 degrees down, so ground lines run 2:1.
const YAW = Math.PI / 4;
const PITCH = Math.PI / 6;
const CAMERA_DISTANCE = 50;
/** Tallest outfit (wizard hat) plus margin, and widest (weapons out), in world units. */
const HERO_HEIGHT = 3.6;
const HERO_WIDTH = 3.3;
const TOP_BAR = 56;

const _v = new THREE.Vector3();

/** Renderer, lighting, the island and the fixed isometric camera that follows the player. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 140);
  readonly island = new Island();
  readonly focus = new THREE.Vector3();
  mode: CameraMode = 'play';
  /** Art pixels per world unit in the pixel look. */
  texelsPerUnit = TEXELS_PER_UNIT;
  /** Height in CSS pixels of controls covering the bottom of the stage. */
  bottomInset = 0;

  private readonly pipeline = new PixelPipeline();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly fraction = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly marker: THREE.Mesh;
  private markerAge = 1;
  private pixelated = true;
  private scale = 2;
  private unitsHigh = 13;
  private lastMode: CameraMode = 'play';

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Several render calls make one frame, so the frame loop resets the statistics itself.
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#2d86c9');

    // The camera never rotates, so its axes are fixed.
    this.back.set(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
    this.camera.position.copy(this.back).multiplyScalar(CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);

    // Smooth look: sky light gives soft gradients. Pixel look: flat ambient light, so every
    // surface has a small, fixed set of tones.
    this.hemisphere = new THREE.HemisphereLight('#ffffff', '#b4a8d8', 0);
    this.ambient = new THREE.AmbientLight('#ffffff', 1.35);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -16;
    s.right = s.top = 16;
    s.near = 1;
    s.far = 70;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemisphere, this.ambient, this.sun, this.sun.target, this.island.group);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.46, 24),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.03;
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.pixel = true;
  }

  get pixel(): boolean {
    return this.pixelated;
  }

  set pixel(on: boolean) {
    this.pixelated = on;
    this.hemisphere.intensity = on ? 0 : 1.55;
    this.ambient.intensity = on ? 1.35 : 0;
    this.sun.intensity = on ? 2.2 : 2.5;
    this.island.hullOutline = !on;
  }

  set pixelOutline(on: boolean) {
    this.pipeline.outline = on;
  }

  set shadows(enabled: boolean) {
    this.sun.castShadow = enabled;
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
  }

  /** Where a screen position hits the ground, or null if it misses the island. */
  groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    if (!point) return null;
    this.island.clampToLand(point);
    return point;
  }

  showMarker(point: THREE.Vector3): void {
    this.marker.position.set(point.x, 0.03, point.z);
    this.markerAge = 0;
    this.marker.visible = true;
  }

  /** Yaw a character must have to face the camera. */
  get cameraYaw(): number {
    return YAW;
  }

  /** Direction on the ground for "up" and "right" on screen, for keyboard movement. */
  screenAxes(): { forward: THREE.Vector3; right: THREE.Vector3 } {
    const forward = new THREE.Vector3(-Math.sin(YAW), 0, -Math.cos(YAW));
    return { forward, right: new THREE.Vector3(-forward.z, 0, forward.x) };
  }

  /**
   * Moves a ground position onto the low-resolution pixel grid, so a character is drawn the
   * same way wherever it stands. Returns the input unchanged in the smooth look.
   */
  snapToPixel(position: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(position);
    if (!this.pixelated) return out;
    const { right, up } = this;
    const sr = Math.round((position.x * right.x + position.z * right.z) * this.texelsPerUnit) / this.texelsPerUnit;
    const su = Math.round((position.x * up.x + position.z * up.z) * this.texelsPerUnit) / this.texelsPerUnit;
    // Invert the ground-to-screen mapping.
    const det = right.x * up.z - right.z * up.x;
    out.x = (sr * up.z - right.z * su) / det;
    out.z = (right.x * su - sr * up.x) / det;
    return out;
  }

  update(dt: number): void {
    this.island.update(dt);

    const { clientWidth: cssW, clientHeight: cssH } = this.container;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const dpr = size.x / Math.max(cssW, 1);
    const dress = this.mode === 'dress';
    const inset = dress ? Math.min(this.bottomInset, cssH * 0.45) : 0;
    const freeCss = Math.max(cssH - inset - TOP_BAR, cssH * 0.3);
    const cut = this.mode !== this.lastMode;
    this.lastMode = this.mode;
    this.island.propsVisible = !dress;
    const k = cut && this.pixelated ? 1 : 1 - Math.exp(-dt * 6);

    let halfW: number;
    let halfH: number;
    let insetWorld: number;
    if (this.pixelated) {
      // Zoom is a whole number of screen pixels per art pixel. The art itself has one fixed
      // density, so the wardrobe shows exactly the sprite seen in play, only enlarged.
      this.scale = dress
        ? Math.max(2, Math.floor(Math.min((freeCss * dpr) / (HERO_HEIGHT * this.texelsPerUnit), size.x / (HERO_WIDTH * this.texelsPerUnit))))
        : Math.max(2, Math.floor(Math.min(size.x, size.y) / 210));
      const lowW = Math.ceil(size.x / this.scale) + 2;
      const lowH = Math.ceil(size.y / this.scale) + 2;
      this.pipeline.setSize(lowW, lowH);
      halfW = lowW / (2 * this.texelsPerUnit);
      halfH = lowH / (2 * this.texelsPerUnit);
      insetWorld = (inset * dpr) / (this.scale * this.texelsPerUnit);
    } else {
      const aspect = cssW / cssH;
      const wanted = dress
        ? Math.max((HERO_HEIGHT * cssH) / freeCss, HERO_WIDTH / aspect)
        : 13 * Math.max(1, 0.85 / aspect);
      this.unitsHigh += (wanted - this.unitsHigh) * k;
      halfH = this.unitsHigh / 2;
      halfW = halfH * aspect;
      insetWorld = (inset / cssH) * this.unitsHigh;
    }
    if (this.camera.top !== halfH || this.camera.right !== halfW) {
      this.camera.left = -halfW;
      this.camera.right = halfW;
      this.camera.top = halfH;
      this.camera.bottom = -halfH;
      this.camera.updateProjectionMatrix();
    }

    // Follow the player. In the wardrobe the view is centred on the body and lifted clear of
    // the controls at the bottom.
    _v.copy(this.focus).setY(dress ? 1.5 : 0.9).addScaledVector(this.up, -insetWorld / 2);
    this.lookAt.lerp(_v, k);
    this.camera.position.copy(this.lookAt).addScaledVector(this.back, CAMERA_DISTANCE);
    this.fraction.set(0, 0);
    if (this.pixelated) {
      const r = this.camera.position.dot(this.right) * this.texelsPerUnit;
      const u = this.camera.position.dot(this.up) * this.texelsPerUnit;
      this.fraction.set(r - Math.round(r), u - Math.round(u));
      this.camera.position
        .addScaledVector(this.right, -this.fraction.x / this.texelsPerUnit)
        .addScaledVector(this.up, -this.fraction.y / this.texelsPerUnit);
    }
    this.camera.updateMatrixWorld();

    this.sun.target.position.copy(this.lookAt).setY(0);
    this.sun.position.copy(this.sun.target.position).add(_v.set(-10, 24, 9));

    if (this.marker.visible) {
      this.markerAge += dt * 1.8;
      const t = Math.min(this.markerAge, 1);
      this.marker.scale.setScalar(0.5 + t * 0.8);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      if (t >= 1) this.marker.visible = false;
    }
  }

  render(): void {
    if (this.pixelated) this.pipeline.render(this.renderer, this.scene, this.camera, this.scale, this.fraction);
    else this.renderer.render(this.scene, this.camera);
  }
}
