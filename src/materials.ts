import * as THREE from 'three';

/** Stepped light ramp for cel shading: shadow, mid tone, lit. */
function makeRamp(): THREE.DataTexture {
  const steps = [0.34, 0.34, 0.34, 0.36, 0.7, 0.72, 1, 1];
  const data = new Uint8Array(steps.map((s) => Math.round(s * 255)));
  const texture = new THREE.DataTexture(data, steps.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export const toonRamp = makeRamp();

/**
 * Recolouring. Each vertex carries a `tint` (rgb = target colour, a = 1 / mean luminance of the
 * swatch it replaces, or 0 for "keep the texture"). The swatch's own gradient is kept as shading
 * and only its hue is replaced, so one mesh and one texture serve every colour variant.
 */
function patchTint(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 tint;\nvarying vec4 vTint;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = tint;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec4 vTint;')
    .replace(
      '#include <map_fragment>',
      /* glsl */ `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        if ( vTint.a > 0.0 ) {
          float shade = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) * vTint.a;
          sampledDiffuseColor.rgb = vTint.rgb * clamp( shade, 0.5, 1.6 );
        }
        diffuseColor *= sampledDiffuseColor;
      #endif
      `,
    );
}

export interface CharacterMaterials {
  body: THREE.MeshToonMaterial;
  outline: THREE.MeshBasicMaterial;
  outlineWidth: { value: number };
}

/** One material pair shared by every character: all per-character variation lives in vertex data. */
export function createCharacterMaterials(atlas: THREE.Texture): CharacterMaterials {
  const outlineWidth = { value: 0.022 };

  const body = new THREE.MeshToonMaterial({ map: atlas, gradientMap: toonRamp });
  body.onBeforeCompile = patchTint;

  // Inverted hull outline: back faces pushed out along smoothed normals, drawn in a darkened
  // version of the surface colour.
  const outline = new THREE.MeshBasicMaterial({ map: atlas, side: THREE.BackSide });
  outline.onBeforeCompile = (shader) => {
    patchTint(shader);
    shader.uniforms.outlineWidth = outlineWidth;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 outlineNormal;\nuniform float outlineWidth;')
      .replace('vTint = tint;', 'vTint = tint;\ntransformed += outlineNormal * outlineWidth;');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      'outgoingLight = outgoingLight * 0.22 + vec3( 0.03, 0.015, 0.04 );\n#include <opaque_fragment>',
    );
  };

  return { body, outline, outlineWidth };
}
