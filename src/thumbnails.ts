import * as THREE from 'three';
import type { Assets, ItemDef } from './assets';
import type { CharacterMaterials } from './materials';

export type ThumbnailStyle = 'smooth' | 'pixel';
const SIZES: Record<ThumbnailStyle, number> = { smooth: 144, pixel: 48 };

/**
 * Renders item previews for the wardrobe with the same shader the characters use, so a preview
 * is exactly what the item looks like when worn. Results are cached as image URLs.
 */
export class Thumbnails {
  private readonly cache = new Map<string, Promise<string>>();
  private readonly targets: Record<ThumbnailStyle, THREE.WebGLRenderTarget> = {
    smooth: new THREE.WebGLRenderTarget(SIZES.smooth, SIZES.smooth, { samples: 4 }),
    pixel: new THREE.WebGLRenderTarget(SIZES.pixel, SIZES.pixel),
  };
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  private readonly hemisphere = new THREE.HemisphereLight('#ffffff', '#b4a8d8', 1.6);
  private readonly ambient = new THREE.AmbientLight('#ffffff', 1.35);
  style: ThumbnailStyle = 'pixel';

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly assets: Assets,
    private readonly materials: CharacterMaterials,
  ) {
    const sun = new THREE.DirectionalLight('#fff1dc', 2.3);
    sun.position.set(-2, 5, 6);
    this.scene.add(this.hemisphere, this.ambient, sun);
  }

  get(item: ItemDef): Promise<string> {
    const style = this.style;
    const key = `${style}:${item.id}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.assets.geometry(item.id).then((geometry) => this.render(geometry, item, style));
      this.cache.set(key, pending);
    }
    return pending;
  }

  private render(source: THREE.BufferGeometry, item: ItemDef, style: ThumbnailStyle): string {
    const SIZE = SIZES[style];
    const target = this.targets[style];
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    const pixel = style === 'pixel';
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.getAttribute('position'));
    geometry.setAttribute('normal', source.getAttribute('normal'));
    geometry.setAttribute('uv', source.getAttribute('uv'));
    geometry.setAttribute('outlineNormal', source.getAttribute('_outline'));
    // Each vertex gets its channel's own colour, as on an unrecoloured character.
    const count = source.getAttribute('position').count;
    const channel = source.getAttribute('_channel');
    const tint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) tint.set(item.channels[channel.getX(i)].linear, i * 4);
    geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 4));
    geometry.setIndex(source.index);
    geometry.computeBoundingSphere();
    const { center, radius } = geometry.boundingSphere!;

    const body = new THREE.Mesh(geometry, this.materials.body);
    const outline = new THREE.Mesh(geometry, this.materials.outline);
    this.scene.add(body, outline);
    const half = radius * 1.08;
    // Match the look of the scene: flat colours and a one-pixel outline, or gradients and a hull.
    const { flatColors, outlineWidth } = this.materials;
    const previous = { flat: flatColors.value, width: outlineWidth.value };
    flatColors.value = pixel ? 1 : 0;
    outlineWidth.value = pixel ? ((2 * half) / SIZE) * 0.9 : previous.width;
    this.hemisphere.intensity = pixel ? 0 : 1.6;
    this.ambient.intensity = pixel ? 1.35 : 0;
    this.camera.left = this.camera.bottom = -half;
    this.camera.right = this.camera.top = half;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(center).add(new THREE.Vector3(0.55, 0.4, 1).normalize().multiplyScalar(20));
    this.camera.lookAt(center);

    const { renderer } = this;
    const previousTarget = renderer.getRenderTarget();
    const previousColor = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColor, previousAlpha);
    this.scene.remove(body, outline);
    geometry.dispose();
    flatColors.value = previous.flat;
    outlineWidth.value = previous.width;

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
        const alpha = pixels[from + 3];
        // Edge pixels come out premultiplied against a transparent clear colour.
        const scale = alpha > 0 ? 255 / alpha : 0;
        for (let k = 0; k < 3; k++) image.data[to + k] = toSrgb(Math.min(255, pixels[from + k] * scale));
        image.data[to + 3] = alpha;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
