import * as THREE from 'three';
import type { Assets, ItemDef } from './assets';
import type { CharacterMaterials } from './materials';

const SIZE = 144;

/**
 * Renders item previews for the wardrobe with the same shader the characters use, so a preview
 * is exactly what the item looks like when worn. Results are cached as image URLs.
 */
export class Thumbnails {
  private readonly cache = new Map<string, Promise<string>>();
  private readonly target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  private readonly pixels = new Uint8Array(SIZE * SIZE * 4);

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly assets: Assets,
    private readonly materials: CharacterMaterials,
  ) {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b4a8d8', 1.6));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
    sun.position.set(-2, 5, 6);
    this.scene.add(sun);
  }

  get(item: ItemDef): Promise<string> {
    let pending = this.cache.get(item.id);
    if (!pending) {
      pending = this.assets.geometry(item.id).then((geometry) => this.render(geometry));
      this.cache.set(item.id, pending);
    }
    return pending;
  }

  private render(source: THREE.BufferGeometry): string {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.getAttribute('position'));
    geometry.setAttribute('normal', source.getAttribute('normal'));
    geometry.setAttribute('uv', source.getAttribute('uv'));
    geometry.setAttribute('outlineNormal', source.getAttribute('_outline'));
    const count = source.getAttribute('position').count;
    geometry.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
    geometry.setIndex(source.index);
    geometry.computeBoundingSphere();
    const { center, radius } = geometry.boundingSphere!;

    const body = new THREE.Mesh(geometry, this.materials.body);
    const outline = new THREE.Mesh(geometry, this.materials.outline);
    this.scene.add(body, outline);
    const half = radius * 1.08;
    this.camera.left = this.camera.bottom = -half;
    this.camera.right = this.camera.top = half;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(center).add(new THREE.Vector3(0.55, 0.4, 1).normalize().multiplyScalar(20));
    this.camera.lookAt(center);

    const { renderer } = this;
    const previousTarget = renderer.getRenderTarget();
    const previousColor = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColor, previousAlpha);
    this.scene.remove(body, outline);
    geometry.dispose();

    // The target holds linear, bottom-up pixels. Convert to sRGB, top-down.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(SIZE, SIZE);
    const toSrgb = (v: number) => {
      const c = v / 255;
      return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
    };
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const from = ((SIZE - 1 - y) * SIZE + x) * 4;
        const to = (y * SIZE + x) * 4;
        const alpha = this.pixels[from + 3];
        // Edge pixels come out premultiplied against a transparent clear colour.
        const scale = alpha > 0 ? 255 / alpha : 0;
        for (let k = 0; k < 3; k++) image.data[to + k] = toSrgb(Math.min(255, this.pixels[from + k] * scale));
        image.data[to + 3] = alpha;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
