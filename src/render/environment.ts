import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/**
 * The world beyond the arena walls: a scattering sky at dawn, the ring we are standing on
 * arching overhead, rolling terrain, and a star field that survives the daylight.
 */
export interface Environment {
  readonly group: THREE.Group;
  readonly sunDirection: THREE.Vector3;
  readonly sunColor: THREE.Color;
  readonly fogColor: THREE.Color;
  readonly sky: Sky;
  /** Advances slow ambient motion (ring rotation, star twinkle). */
  readonly update: (now: number) => void;
}

const RING_RADIUS = 6000;
const RING_TUBE = 360;
const RING_SINK = 820;

const makeRingSurfaceTexture = (): THREE.CanvasTexture => {
  // Inner surface of the ring: bands of ocean, land, and cloud, with atmosphere at the edges.
  const w = 1024;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#9fc4e8');
    base.addColorStop(0.12, '#355f8a');
    base.addColorStop(0.5, '#3f7d5a');
    base.addColorStop(0.88, '#355f8a');
    base.addColorStop(1, '#9fc4e8');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i += 1) {
      const x = Math.random() * w;
      const y = h * 0.18 + Math.random() * h * 0.64;
      const len = 8 + Math.random() * 60;
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(96, 140, 84, 0.9)' : 'rgba(176, 164, 120, 0.7)';
      ctx.fillRect(x, y, len, 3 + Math.random() * 6);
    }
    for (let i = 0; i < 140; i += 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * w,
        h * 0.2 + Math.random() * h * 0.6,
        6 + Math.random() * 18,
        2 + Math.random() * 4,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(40, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const noise2 = (x: number, z: number): number =>
  Math.sin(x * 0.011) * Math.cos(z * 0.013) * 0.6 +
  Math.sin(x * 0.031 + 1.7) * Math.cos(z * 0.027 - 0.4) * 0.3 +
  Math.sin(x * 0.09 + z * 0.07) * 0.1;

/** The arena floor sits at y = 0; the terrain under it is sunk well clear of depth-buffer precision. */
const INNER_DROP = 6;

const makeTerrain = (arenaHalf: number): THREE.Mesh => {
  const size = 2400;
  const segments = 160;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const low = new THREE.Color(0x2f6b45);
  const mid = new THREE.Color(0x6f8f5a);
  const high = new THREE.Color(0x8d8a7c);
  const snow = new THREE.Color(0xe6eef5);
  const scratch = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const d = Math.max(Math.abs(x), Math.abs(z));
    // Flat inside and just outside the arena, hills rising with distance, mountains at the rim.
    const ramp = THREE.MathUtils.smoothstep(d, arenaHalf + 8, arenaHalf + 160);
    const far = THREE.MathUtils.smoothstep(d, 500, 1100);
    const n = noise2(x, z);
    const y =
      ramp * (12 + 28 * (n + 0.6)) + far * (120 + 160 * (n + 0.6)) - (ramp === 0 ? INNER_DROP : 0);
    position.setY(i, y);
    const t = THREE.MathUtils.clamp(y / 260, 0, 1);
    if (t < 0.25) scratch.copy(low).lerp(mid, t / 0.25);
    else if (t < 0.7) scratch.copy(mid).lerp(high, (t - 0.25) / 0.45);
    else scratch.copy(high).lerp(snow, (t - 0.7) / 0.3);
    colors.set([scratch.r, scratch.g, scratch.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  );
  mesh.receiveShadow = true;
  return mesh;
};

export const createEnvironment = (arenaHalf: number): Environment => {
  const group = new THREE.Group();

  const sky = new Sky();
  sky.scale.setScalar(45000);
  const u = sky.material.uniforms;
  u.turbidity = { value: 4 };
  u.rayleigh = { value: 2.2 };
  u.mieCoefficient = { value: 0.003 };
  u.mieDirectionalG = { value: 0.82 };
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - 11),
    THREE.MathUtils.degToRad(205),
  );
  u.sunPosition = { value: sunDirection.clone() };
  group.add(sky);

  // The ring: we stand on its inner surface, so it rises from both horizons and crosses overhead.
  const ring = new THREE.Group();
  const ringMaterial = new THREE.MeshStandardMaterial({
    map: makeRingSurfaceTexture(),
    roughness: 0.8,
    metalness: 0.05,
    side: THREE.DoubleSide,
    fog: false,
  });
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 24, 256),
    ringMaterial,
  );
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS + RING_TUBE * 0.15, RING_TUBE * 0.12, 8, 256),
    new THREE.MeshStandardMaterial({
      color: 0xbfd4e6,
      roughness: 0.35,
      metalness: 0.7,
      fog: false,
    }),
  );
  ring.add(band, rim);
  ring.position.set(0, RING_RADIUS - RING_SINK, 0);
  ring.rotation.y = THREE.MathUtils.degToRad(35);
  group.add(ring);

  group.add(makeTerrain(arenaHalf));

  const starGeometry = new THREE.BufferGeometry();
  const count = 1600;
  const stars = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.95 + 0.05);
    const r = 20000;
    stars[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    stars[i * 3 + 1] = r * Math.cos(phi);
    stars[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2.2,
    sizeAttenuation: false,
    fog: false,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  group.add(new THREE.Points(starGeometry, starMaterial));

  return {
    group,
    sunDirection,
    sunColor: new THREE.Color(0xffe2b8),
    fogColor: new THREE.Color(0x9fb8d0),
    sky,
    update: (now) => {
      ring.rotation.z = now * 0.0015;
      starMaterial.opacity = 0.45 + 0.1 * Math.sin(now * 0.7);
    },
  };
};
