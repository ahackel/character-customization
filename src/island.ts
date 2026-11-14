import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonRamp } from './materials';

/** Distance from the island centre to the waterline in a given direction. Mirrored in the ground shader. */
function shoreRadius(angle: number): number {
  return 11 + 1.3 * Math.sin(3 * angle + 0.6) + 0.8 * Math.sin(5 * angle + 2.1) + 0.5 * Math.sin(2 * angle - 1);
}

const polar = (angle: number, distance: number): [number, number] => [Math.cos(angle) * distance, Math.sin(angle) * distance];

/** Sand, grass and sea drawn by one shader on a flat plane, in flat bands of colour. */
function groundMaterial(time: { value: number }): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = ( modelMatrix * vec4( position, 1.0 ) ).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;\nuniform float time;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        float angle = atan( vGround.y, vGround.x );
        float shore = 11.0 + 1.3 * sin( 3.0 * angle + 0.6 ) + 0.8 * sin( 5.0 * angle + 2.1 ) + 0.5 * sin( 2.0 * angle - 1.0 );
        float d = length( vGround ) - shore; // negative on land
        float wobble = 0.7 * sin( vGround.x * 0.9 + 1.3 ) + 0.6 * sin( vGround.y * 1.3 + 0.4 );
        float tide = 0.18 * sin( time * 0.9 );
        vec3 c;
        if ( d < -5.0 + wobble ) {
          float patches = sin( vGround.x * 0.55 + 2.0 ) * sin( vGround.y * 0.7 - 1.0 );
          c = patches > 0.25 ? vec3( 0.36, 0.69, 0.30 ) : vec3( 0.45, 0.76, 0.34 );
        } else if ( d < -4.7 + wobble ) {
          c = vec3( 0.80, 0.74, 0.44 );
        } else if ( d < -0.55 + tide ) {
          c = vec3( 0.95, 0.87, 0.62 );
        } else if ( d < tide ) {
          c = vec3( 0.84, 0.75, 0.50 );
        } else if ( d < 0.2 + tide ) {
          c = vec3( 1.0 );
        } else if ( d < 1.5 ) {
          c = vec3( 0.42, 0.85, 0.82 );
        } else if ( d < 3.6 + 0.4 * sin( angle * 7.0 + time * 0.5 ) ) {
          c = vec3( 0.25, 0.71, 0.84 );
        } else {
          c = vec3( 0.18, 0.53, 0.79 );
          // Slow wave crests far out.
          float wave = sin( d * 1.6 - time * 0.8 + 2.0 * sin( angle * 5.0 ) );
          if ( wave > 0.985 ) c = vec3( 0.42, 0.75, 0.90 );
        }
        diffuseColor.rgb = pow( c, vec3( 2.2 ) );
        `,
      );
  };
  return material;
}

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

/** The castaway island: ground, sea, palms, rocks, wreckage, a campfire and an SOS in stones. */
export class Island {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];
  private readonly time = { value: 0 };
  private readonly outline: THREE.Mesh;
  private readonly props = new THREE.Group();
  private readonly flames: THREE.Mesh[] = [];

  constructor() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), groundMaterial(this.time));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

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
    const at = (x: number, y: number, z: number, rotation = new THREE.Euler(), sx = 1, sy = sx, sz = sx) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(sx, sy, sz));

    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    // ---- palms
    const palms: [number, number][] = [[0.35, 7.4], [1.35, 6.9], [2.3, 7.6], [3.2, 6.6], [4.1, 7.5], [5.0, 6.8], [5.75, 7.7]];
    for (const [angle, distance] of palms) {
      const [x, z] = polar(angle, distance);
      const lean = 0.5 + random() * 0.6;
      const leanAngle = random() * Math.PI * 2;
      const height = 3.4 + random() * 1.2;
      const segments = 5;
      let top = new THREE.Vector3(x, 0, z);
      for (let i = 0; i < segments; i++) {
        const t = (i + 0.5) / segments;
        const off = lean * t * t;
        const cx = x + Math.cos(leanAngle) * off;
        const cz = z + Math.sin(leanAngle) * off;
        const r = 0.3 - t * 0.12;
        add(new THREE.CylinderGeometry(r, r + 0.05, height / segments + 0.04, 6), i % 2 ? '#9a6a48' : '#ad7b54', at(cx, t * height, cz));
        top = new THREE.Vector3(x + Math.cos(leanAngle) * lean, height, z + Math.sin(leanAngle) * lean);
      }
      const fronds = 7;
      for (let i = 0; i < fronds; i++) {
        const turn = (i / fronds) * Math.PI * 2 + random() * 0.4;
        const droop = 0.35 + random() * 0.35;
        const length = 2.1 + random() * 0.5;
        const blade = new THREE.ConeGeometry(0.5, length, 4);
        blade.translate(0, length / 2, 0);
        blade.scale(1, 1, 0.22);
        blade.rotateZ(-(Math.PI / 2 + droop));
        blade.rotateY(turn);
        add(blade, i % 2 ? '#3f9f58' : '#57b862', at(top.x, top.y, top.z));
      }
      add(new THREE.IcosahedronGeometry(0.2, 0), '#6b4a34', at(top.x + 0.2, top.y - 0.25, top.z + 0.1));
      add(new THREE.IcosahedronGeometry(0.2, 0), '#6b4a34', at(top.x - 0.15, top.y - 0.3, top.z + 0.2));
      this.obstacles.push({ x, z, radius: 0.45 });
    }

    // ---- rocks, on the beach and in the shallows
    const rocks: [number, number, number][] = [[0.95, 1.4, 1.1], [2.75, 0.5, 0.8], [4.55, 1.9, 1.3], [3.75, -1.3, 0.7], [1.75, -1.0, 0.6], [5.5, 0.9, 0.9], [0.1, 2.6, 0.7]];
    for (const [angle, beyondShore, size] of rocks) {
      const [x, z] = polar(angle, shoreRadius(angle) + beyondShore);
      add(new THREE.DodecahedronGeometry(1, 0), '#8c93b0', at(x, size * 0.35, z, new THREE.Euler(random(), random() * 3, 0), size * 1.25, size * 0.8, size));
      add(new THREE.DodecahedronGeometry(1, 0), '#a4aac4', at(x + size * 0.7, size * 0.2, z + size * 0.5, new THREE.Euler(0, random() * 3, random()), size * 0.5));
      this.obstacles.push({ x, z, radius: size * 1.05 });
    }

    // ---- the wreck: mast and torn sail, crates, a barrel and planks washed up on the near beach
    const wreckAngle = 0.25;
    const [wx, wz] = polar(wreckAngle, shoreRadius(wreckAngle) - 2.2);
    add(new THREE.CylinderGeometry(0.13, 0.17, 6.2, 7), '#7b5539', at(wx + 1.2, 0.55, wz + 0.6, new THREE.Euler(0.2, 0.4, 1.38)));
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2.6, 0.1, 0.3, 0.3, 0.05, 2.2, 0, 0, 0, 0.3, 0.05, 2.2, 2.6, 0.1, 0.3], 3));
    add(sail, '#f3efe2', at(wx - 0.6, 0.12, wz + 0.9, new THREE.Euler(0, 0.5, 0)));
    const crate = (x: number, z: number, size: number, turn: number, tilt = 0) => {
      add(new THREE.BoxGeometry(1, 1, 1), '#b98a55', at(x, size / 2 - tilt * 0.3, z, new THREE.Euler(tilt, turn, 0), size));
      add(new THREE.BoxGeometry(1.06, 0.16, 1.06), '#8f643c', at(x, size - 0.1 - tilt * 0.3, z, new THREE.Euler(tilt, turn, 0), size));
      this.obstacles.push({ x, z, radius: size * 0.75 });
    };
    crate(wx - 1.6, wz - 0.9, 0.9, 0.5);
    crate(wx - 0.5, wz - 1.6, 0.7, 1.1, 0.25);
    add(new THREE.CylinderGeometry(0.38, 0.38, 0.95, 9), '#9a6a48', at(wx - 2.6, 0.38, wz + 0.4, new THREE.Euler(Math.PI / 2, 0, 0.7)));
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.14, 9), '#5d5f73', at(wx - 2.6, 0.38, wz + 0.4, new THREE.Euler(Math.PI / 2, 0, 0.7)));
    this.obstacles.push({ x: wx - 2.6, z: wz + 0.4, radius: 0.6 });
    for (let i = 0; i < 6; i++) {
      const a = wreckAngle + (random() - 0.5) * 1.1;
      const [px, pz] = polar(a, shoreRadius(a) - 0.6 - random() * 2.5);
      add(new THREE.BoxGeometry(1.5 + random(), 0.08, 0.26), i % 2 ? '#8f643c' : '#7b5539', at(px, 0.05, pz, new THREE.Euler(0, random() * 3, 0)));
    }

    // ---- campfire near the middle of the island
    const fire = { x: 2.3, z: 0.6 };
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      add(new THREE.DodecahedronGeometry(0.2, 0), '#8c93b0', at(fire.x + Math.cos(a) * 0.62, 0.1, fire.z + Math.sin(a) * 0.62, new THREE.Euler(a, a, 0)));
    }
    for (let i = 0; i < 3; i++) {
      add(new THREE.CylinderGeometry(0.09, 0.09, 0.95, 6), '#5f4230', at(fire.x, 0.14, fire.z, new THREE.Euler(Math.PI / 2, 0, (i / 3) * Math.PI)));
    }
    this.obstacles.push({ x: fire.x, z: fire.z, radius: 0.85 });
    for (const [hex, radius, height] of [['#f2792b', 0.34, 0.95], ['#ffd34d', 0.2, 0.6]] as const) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 5).translate(0, height / 2, 0), new THREE.MeshBasicMaterial({ color: hex }));
      flame.position.set(fire.x, 0.12, fire.z);
      this.flames.push(flame);
      this.props.add(flame);
    }

    // ---- SOS laid out in stones on the near beach, upright for the camera
    const S: [number, number][] = [[0, 4], [1, 4], [2, 4], [0, 3], [0, 2], [1, 2], [2, 2], [2, 1], [0, 0], [1, 0], [2, 0]];
    const O: [number, number][] = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2], [0, 3], [2, 3], [0, 4], [1, 4], [2, 4]];
    const right = new THREE.Vector2(Math.SQRT1_2, -Math.SQRT1_2); // screen right on the ground
    const up = new THREE.Vector2(-Math.SQRT1_2, -Math.SQRT1_2); // screen up on the ground
    const origin = new THREE.Vector2(6.9, 4.3);
    [S, O, S].forEach((letter, n) => {
      for (const [col, row] of letter) {
        const p = origin.clone().addScaledVector(right, (n * 4 + col - 5) * 0.42).addScaledVector(up, (row - 2) * 0.62);
        add(new THREE.DodecahedronGeometry(0.17, 0), '#5d5f73', at(p.x, 0.07, p.y, new THREE.Euler(random() * 3, random() * 3, 0)));
      }
    });

    // ---- undergrowth
    for (let i = 0; i < 26; i++) {
      const a = random() * Math.PI * 2;
      const [x, z] = polar(a, 1.2 + random() * 4);
      if (Math.hypot(x - fire.x, z - fire.z) < 1.4) continue;
      const blade = new THREE.ConeGeometry(0.1, 0.42, 4).translate(0, 0.21, 0);
      for (const lean of [-0.4, 0, 0.4]) add(blade.clone(), '#3f9f58', at(x + lean * 0.3, 0, z, new THREE.Euler(0, a, lean)));
    }
    for (let i = 0; i < 5; i++) {
      const a = 0.8 + i * 1.2 + random() * 0.4;
      const [x, z] = polar(a, 4.6 + random() * 1.2);
      add(new THREE.IcosahedronGeometry(1, 1), i % 2 ? '#3f9f58' : '#4fae5c', at(x, 0.35, z, new THREE.Euler(0, a, 0), 0.75, 0.55, 0.7));
      this.obstacles.push({ x, z, radius: 0.7 });
    }

    const geometry = mergeGeometries(parts)!;
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp, side: THREE.DoubleSide }),
    );
    mesh.castShadow = true;
    const outlineMaterial = new THREE.MeshBasicMaterial({ color: '#2f2a52', side: THREE.BackSide });
    outlineMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed += normal * 0.035;',
      );
    };
    this.outline = new THREE.Mesh(geometry, outlineMaterial);
    this.props.add(mesh, this.outline);
    this.group.add(this.props);
  }

  /** Hull outlines are for the smooth look; the pixel look draws its own. */
  set hullOutline(visible: boolean) {
    this.outline.visible = visible;
  }

  /** Trees, rocks and wreckage. Hidden in the wardrobe so nothing stands in front of the hero. */
  set propsVisible(visible: boolean) {
    this.props.visible = visible;
  }

  /** Keeps a point on land or in ankle-deep water. Returns true if it had to be moved. */
  clampToLand(point: THREE.Vector3): boolean {
    const distance = Math.hypot(point.x, point.z);
    const limit = shoreRadius(Math.atan2(point.z, point.x)) + 0.25;
    if (distance <= limit) return false;
    point.x *= limit / distance;
    point.z *= limit / distance;
    return true;
  }

  /** Pushes a point out of trees, rocks and wreckage. */
  avoidObstacles(point: THREE.Vector3, bodyRadius = 0.4): void {
    for (const o of this.obstacles) {
      const dx = point.x - o.x;
      const dz = point.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.radius + bodyRadius;
      if (d >= min || d < 1e-4) continue;
      point.x = o.x + (dx / d) * min;
      point.z = o.z + (dz / d) * min;
    }
  }

  update(dt: number): void {
    this.time.value += dt;
    const t = this.time.value;
    // Flames flicker in steps, like a short sprite loop.
    const step = Math.floor(t * 8);
    this.flames.forEach((flame, i) => {
      const wave = Math.sin(step * 2.4 + i * 1.7);
      flame.scale.set(1 + wave * 0.12, 1 + Math.sin(step * 1.9 + i) * 0.22, 1 + wave * 0.12);
      flame.rotation.y = step * 0.9 + i;
    });
  }
}
