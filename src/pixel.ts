import * as THREE from 'three';

/** World units are drawn at this many low-resolution pixels, in every view. */
export const TEXELS_PER_UNIT = 22;

/**
 * Pixel-art presentation of the 3D scene: render small, then enlarge by a whole number with no
 * filtering. A one-pixel outline is drawn where a surface sits in front of what is behind it.
 * The camera moves in whole low-resolution pixels; the leftover fraction is applied when
 * enlarging, so scrolling stays smooth while the artwork never shimmers.
 */
export class PixelPipeline {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  outline = true;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(4, 4),
    });
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        lowSize: { value: new THREE.Vector2(4, 4) },
        scale: { value: 1 },
        offset: { value: new THREE.Vector2() },
        depthRange: { value: 1 },
        outline: { value: 1 },
      },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4( position.xy, 0.0, 1.0 );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 lowSize;
        uniform float scale;
        uniform vec2 offset;
        uniform float depthRange;
        uniform float outline;

        float depthAt( vec2 texel ) {
          return texture2D( tDepth, ( texel + 0.5 ) / lowSize ).x * depthRange;
        }

        void main() {
          vec2 texel = floor( gl_FragCoord.xy / scale + offset );
          vec4 color = texture2D( tColor, ( texel + 0.5 ) / lowSize );
          if ( outline > 0.5 ) {
            float here = depthAt( texel );
            float behind = max(
              max( depthAt( texel + vec2( 1.0, 0.0 ) ), depthAt( texel - vec2( 1.0, 0.0 ) ) ),
              max( depthAt( texel + vec2( 0.0, 1.0 ) ), depthAt( texel - vec2( 0.0, 1.0 ) ) )
            );
            // The orthographic camera makes depth linear, so one threshold works everywhere.
            if ( behind - here > 0.3 ) color.rgb = color.rgb * 0.1 + vec3( 0.012, 0.01, 0.03 );
          }
          gl_FragColor = vec4( color.rgb, 1.0 );
          #include <colorspace_fragment>
        }
      `,
    });
    // One triangle that covers the screen.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    if (this.target.width === width && this.target.height === height) return;
    this.target.setSize(width, height);
    this.material.uniforms.lowSize.value.set(width, height);
  }

  /**
   * @param scale     whole number of screen pixels per low-resolution pixel
   * @param fraction  how far the true camera is from its snapped position, in low-resolution pixels
   */
  render(
    renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera,
    scale: number, fraction: THREE.Vector2,
  ): void {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const u = this.material.uniforms;
    u.scale.value = scale;
    u.offset.value.set(1 + fraction.x, 1 + fraction.y); // the target has a one-pixel margin
    u.depthRange.value = camera.far - camera.near;
    u.outline.value = this.outline ? 1 : 0;
    renderer.render(this.quadScene, this.quadCamera);
  }
}
