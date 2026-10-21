import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Vec3 } from '../core/vec3';
import type { Atmosphere, TimeOfDay, Weather } from '../core/waves';
import type { ParticleSystem } from './particles';

/** Light-rig numbers the scene applies every frame; the environment owns their blend. */
export interface Lighting {
  readonly sunIntensity: number;
  readonly sunColor: THREE.Color;
  readonly hemisphereIntensity: number;
  readonly hemisphereSky: THREE.Color;
  readonly hemisphereGround: THREE.Color;
  readonly exposure: number;
  readonly moonIntensity: number;
  readonly moonColor: THREE.Color;
  readonly fogDensity: number;
  /** Scale for the image-based lighting baked from the dawn sky. */
  readonly environmentIntensity: number;
  /** 0 when the sun is below the horizon: the flare sprites fade with it. */
  readonly sunDisc: number;
  /** Brightness of the airborne dust motes, which would bloom like lamps on a dark night. */
  readonly dust: number;
}

/** What the environment needs from the scene to rain on the player. */
export interface SceneContext {
  readonly particles: ParticleSystem;
  readonly eye: Vec3;
}

/**
 * The world beyond the arena walls: a scattering sky, the ring we are standing on arching
 * overhead, rolling terrain, and a star field that survives the daylight. Each wave sets a time
 * of day and a weather (`setAtmosphere`); the rig blends to it over the wave countdown.
 */
export interface Environment {
  readonly group: THREE.Group;
  /** Mutated in place as the sun moves; the scene reads it every frame. */
  readonly sunDirection: THREE.Vector3;
  readonly sunColor: THREE.Color;
  readonly fogColor: THREE.Color;
  readonly sky: Sky;
  /** Cool fill from the far side of the sky; on at night. The scene adds it. */
  readonly moonLight: THREE.DirectionalLight;
  /** Starts a blend from the current rig to `target` over `seconds`. */
  readonly setAtmosphere: (target: Atmosphere, seconds: number) => void;
  readonly atmosphere: () => Atmosphere;
  readonly lighting: () => Lighting;
  /** Advances the blend, slow ambient motion (ring rotation, star twinkle), and the rain. */
  readonly update: (now: number, scene?: SceneContext) => void;
}

/** Every number the blend interpolates. Colours are lerped in linear RGB. */
interface Rig {
  sunElevation: number;
  sunAzimuth: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunDisc: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  fogColor: THREE.Color;
  fogDensity: number;
  starOpacity: number;
  exposure: number;
  hemisphereSky: THREE.Color;
  hemisphereGround: THREE.Color;
  hemisphereIntensity: number;
  moonIntensity: number;
  moonColor: THREE.Color;
  ringGlow: number;
  environmentIntensity: number;
  dust: number;
}

const color = (hex: number): THREE.Color => new THREE.Color(hex);

/**
 * Time-of-day presets. `day` is the dawn rig the brand doc describes (low warm sun towards the
 * ring) and is byte-for-byte the pre-atmosphere look; the others move the sun around the sky.
 */
const TIME_PRESETS: Record<TimeOfDay, () => Rig> = {
  day: () => ({
    sunElevation: 11,
    sunAzimuth: 205,
    sunColor: color(0xffe2b8),
    sunIntensity: 2.4,
    sunDisc: 1,
    turbidity: 4,
    rayleigh: 2.2,
    mieCoefficient: 0.003,
    mieDirectionalG: 0.82,
    cloudCoverage: 0.4,
    fogColor: color(0x9fb8d0),
    fogDensity: 0.0032,
    starOpacity: 0.1,
    exposure: 0.38,
    hemisphereSky: color(0xbfd8f5),
    hemisphereGround: color(0x3b4a3a),
    hemisphereIntensity: 0.55,
    moonIntensity: 0,
    moonColor: color(0xa9bdd6),
    ringGlow: 0,
    environmentIntensity: 0.35,
    dust: 1,
  }),
  dawn: () => ({
    sunElevation: 5,
    sunAzimuth: 150,
    sunColor: color(0xf6b26b),
    sunIntensity: 2,
    sunDisc: 1,
    turbidity: 6,
    rayleigh: 3,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.85,
    cloudCoverage: 0.45,
    fogColor: color(0xb0a4a8),
    fogDensity: 0.0038,
    starOpacity: 0.3,
    exposure: 0.42,
    hemisphereSky: color(0xc8b8c8),
    hemisphereGround: color(0x2e3340),
    hemisphereIntensity: 0.5,
    moonIntensity: 0.1,
    moonColor: color(0xa9bdd6),
    ringGlow: 0.06,
    environmentIntensity: 0.3,
    dust: 0.6,
  }),
  dusk: () => ({
    sunElevation: 6,
    sunAzimuth: 260,
    sunColor: color(0xff9a4a),
    sunIntensity: 1.9,
    sunDisc: 1,
    turbidity: 7,
    rayleigh: 2.6,
    mieCoefficient: 0.008,
    mieDirectionalG: 0.86,
    cloudCoverage: 0.45,
    fogColor: color(0x6a5a6e),
    fogDensity: 0.0038,
    starOpacity: 0.4,
    exposure: 0.44,
    hemisphereSky: color(0x8a6a86),
    hemisphereGround: color(0x1c1f2c),
    hemisphereIntensity: 0.6,
    moonIntensity: 0.3,
    moonColor: color(0xa9bdd6),
    ringGlow: 0.1,
    environmentIntensity: 0.25,
    dust: 0.3,
  }),
  night: () => ({
    // The sun sits just under the horizon: the Sky shader keeps a thin twilight band there.
    sunElevation: -1,
    sunAzimuth: 300,
    sunColor: color(0xffe2b8),
    sunIntensity: 0,
    sunDisc: 0,
    turbidity: 10,
    rayleigh: 0.4,
    mieCoefficient: 0.003,
    mieDirectionalG: 0.8,
    cloudCoverage: 0.25,
    fogColor: color(0x0b1a2e),
    fogDensity: 0.0045,
    starOpacity: 0.9,
    exposure: 0.55,
    hemisphereSky: color(0x4a6a9a),
    hemisphereGround: color(0x1e2a3a),
    hemisphereIntensity: 1.2,
    moonIntensity: 2.4,
    moonColor: color(0xb4c6dc),
    ringGlow: 0.22,
    environmentIntensity: 0.18,
    dust: 0.15,
  }),
};

/** Weather overlays on top of the time of day. */
const applyWeather = (rig: Rig, weather: Weather): Rig => {
  switch (weather) {
    case 'clear':
      return rig;
    case 'rain': {
      const grey = rig.sunElevation > 0 ? 0.55 : 1;
      return {
        ...rig,
        sunIntensity: rig.sunIntensity * 0.75,
        sunColor: rig.sunColor.clone().lerp(color(0xd8dde6), 0.3),
        turbidity: Math.max(rig.turbidity, 9),
        rayleigh: rig.rayleigh * 0.8,
        cloudCoverage: 0.85,
        fogColor: rig.fogColor.clone().lerp(color(0x55606c), 1 - grey),
        fogDensity: rig.fogDensity * 1.3,
        hemisphereIntensity: rig.hemisphereIntensity * 0.85,
        hemisphereSky: rig.hemisphereSky.clone().lerp(color(0x8aa0b8), 0.35),
        exposure: rig.exposure * 0.9,
        starOpacity: rig.starOpacity * 0.35,
        environmentIntensity: rig.environmentIntensity * 0.7,
      };
    }
    case 'fog': {
      const night = rig.sunElevation <= 0;
      return {
        ...rig,
        sunIntensity: rig.sunIntensity * 0.6,
        turbidity: Math.max(rig.turbidity, 10),
        mieCoefficient: Math.max(rig.mieCoefficient, 0.01),
        cloudCoverage: 0.6,
        fogColor: night ? color(0x2b3d55) : rig.fogColor.clone().lerp(color(0xc8d2dc), 0.6),
        // Dense enough to swallow the hills and soften the far wall; a 40 m enemy keeps half
        // its contrast and all of its emissive against the lighter bank.
        fogDensity: 0.018,
        hemisphereIntensity: rig.hemisphereIntensity * (night ? 1.1 : 0.9),
        hemisphereSky: rig.hemisphereSky.clone().lerp(color(0xb8c6d2), 0.3),
        exposure: night ? 0.5 : 0.46,
        starOpacity: rig.starOpacity * 0.4,
        environmentIntensity: rig.environmentIntensity * 0.6,
      };
    }
  }
};

const rigFor = (atmosphere: Atmosphere): Rig =>
  applyWeather(TIME_PRESETS[atmosphere.timeOfDay](), atmosphere.weather);

const cloneRig = (rig: Rig): Rig => ({
  ...rig,
  sunColor: rig.sunColor.clone(),
  fogColor: rig.fogColor.clone(),
  hemisphereSky: rig.hemisphereSky.clone(),
  hemisphereGround: rig.hemisphereGround.clone(),
  moonColor: rig.moonColor.clone(),
});

/** Shortest-arc blend between two azimuths in degrees. */
const lerpAngle = (a: number, b: number, t: number): number => {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return a + delta * t;
};

/** Writes `from` blended towards `to` by `t` into `out`. */
const blendRig = (out: Rig, from: Rig, to: Rig, t: number): void => {
  const L = THREE.MathUtils.lerp;
  out.sunElevation = L(from.sunElevation, to.sunElevation, t);
  out.sunAzimuth = lerpAngle(from.sunAzimuth, to.sunAzimuth, t);
  out.sunColor.copy(from.sunColor).lerp(to.sunColor, t);
  out.sunIntensity = L(from.sunIntensity, to.sunIntensity, t);
  out.sunDisc = L(from.sunDisc, to.sunDisc, t);
  out.turbidity = L(from.turbidity, to.turbidity, t);
  out.rayleigh = L(from.rayleigh, to.rayleigh, t);
  out.mieCoefficient = L(from.mieCoefficient, to.mieCoefficient, t);
  out.mieDirectionalG = L(from.mieDirectionalG, to.mieDirectionalG, t);
  out.cloudCoverage = L(from.cloudCoverage, to.cloudCoverage, t);
  out.fogColor.copy(from.fogColor).lerp(to.fogColor, t);
  out.fogDensity = L(from.fogDensity, to.fogDensity, t);
  out.starOpacity = L(from.starOpacity, to.starOpacity, t);
  out.exposure = L(from.exposure, to.exposure, t);
  out.hemisphereSky.copy(from.hemisphereSky).lerp(to.hemisphereSky, t);
  out.hemisphereGround.copy(from.hemisphereGround).lerp(to.hemisphereGround, t);
  out.hemisphereIntensity = L(from.hemisphereIntensity, to.hemisphereIntensity, t);
  out.moonIntensity = L(from.moonIntensity, to.moonIntensity, t);
  out.moonColor.copy(from.moonColor).lerp(to.moonColor, t);
  out.ringGlow = L(from.ringGlow, to.ringGlow, t);
  out.environmentIntensity = L(from.environmentIntensity, to.environmentIntensity, t);
  out.dust = L(from.dust, to.dust, t);
};

const TIMES: readonly TimeOfDay[] = ['dawn', 'day', 'dusk', 'night'];
const WEATHERS: readonly Weather[] = ['clear', 'rain', 'fog'];

/**
 * Dev override: `?atmo=night` (or dawn, day, dusk) and/or `?weather=rain` (or fog, clear) pin
 * that part of the atmosphere from the first frame, whatever wave is playing.
 */
const readOverride = (): Partial<Atmosphere> => {
  const params = new URLSearchParams(window.location.search);
  const atmo = params.get('atmo');
  const weather = params.get('weather');
  const override: { timeOfDay?: TimeOfDay; weather?: Weather } = {};
  const time = TIMES.find((t) => t === atmo);
  if (time) override.timeOfDay = time;
  const w = WEATHERS.find((x) => x === weather);
  if (w) override.weather = w;
  return override;
};

/** The moon above the far horizon: a fixed direction, lit only while its light is up. */
const MOON_DIRECTION = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(90 - 48),
  THREE.MathUtils.degToRad(70),
);

const makeDiscTexture = (inner: string, outer: string): THREE.Texture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.22, inner);
    g.addColorStop(0.3, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

/** Rain tuning: drops per second around the player, and how often one lands visibly. */
const RAIN_RATE = 1500;
const RAIN_SPLASH_RATE = 24;
const RAIN_BOX = 16;
const RAIN_FALL_SPEED = 9;
const RAIN_LIFE = 1.2;
/** Additive particles have no alpha: a dim Ring colour is a Ring streak at low alpha. */
const RAIN_COLOR = new THREE.Color(0xb8d8ea).multiplyScalar(0.18);
const SPLASH_COLOR = new THREE.Color(0xe8e4d8).multiplyScalar(0.3);

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
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - 11),
    THREE.MathUtils.degToRad(205),
  );
  const u = {
    turbidity: { value: 4 },
    rayleigh: { value: 2.2 },
    mieCoefficient: { value: 0.003 },
    mieDirectionalG: { value: 0.82 },
    cloudCoverage: { value: 0.4 },
    showSunDisc: { value: 1 },
    sunPosition: { value: sunDirection.clone() },
  };
  Object.assign(sky.material.uniforms, u);
  group.add(sky);

  // The ring: we stand on its inner surface, so it rises from both horizons and crosses overhead.
  const ring = new THREE.Group();
  const ringTexture = makeRingSurfaceTexture();
  const ringMaterial = new THREE.MeshStandardMaterial({
    map: ringTexture,
    emissive: 0xb8d8ea,
    emissiveMap: ringTexture,
    emissiveIntensity: 0,
    roughness: 0.8,
    metalness: 0.05,
    side: THREE.DoubleSide,
    fog: false,
  });
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 24, 256),
    ringMaterial,
  );
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xbfd4e6,
    emissive: 0xbfd4e6,
    emissiveIntensity: 0,
    roughness: 0.35,
    metalness: 0.7,
    fog: false,
  });
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS + RING_TUBE * 0.15, RING_TUBE * 0.12, 8, 256),
    rimMaterial,
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

  // Moon: a cool directional fill plus a small disc sprite, both fading in with the night.
  const moonLight = new THREE.DirectionalLight(0xa9bdd6, 0);
  moonLight.position.copy(MOON_DIRECTION).multiplyScalar(120);
  const moonSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeDiscTexture('rgba(214,228,240,0.95)', 'rgba(169,189,214,0.25)'),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: false,
      opacity: 0,
    }),
  );
  moonSprite.scale.setScalar(420);
  moonSprite.position.copy(MOON_DIRECTION).multiplyScalar(9000);
  group.add(moonSprite);

  const override = readOverride();
  let atmosphere: Atmosphere = { timeOfDay: 'day', weather: 'clear', ...override };
  const current = rigFor(atmosphere);
  let from = cloneRig(current);
  let to = cloneRig(current);
  let blendStart = Number.NaN;
  let blendSeconds = 0;
  let lastNow = Number.NaN;
  let splashDebt = 0;

  const sunColor = current.sunColor.clone();
  const fogColor = current.fogColor.clone();
  const lighting: {
    sunIntensity: number;
    sunColor: THREE.Color;
    hemisphereIntensity: number;
    hemisphereSky: THREE.Color;
    hemisphereGround: THREE.Color;
    exposure: number;
    moonIntensity: number;
    moonColor: THREE.Color;
    fogDensity: number;
    environmentIntensity: number;
    sunDisc: number;
    dust: number;
  } = {
    sunIntensity: current.sunIntensity,
    sunColor,
    hemisphereIntensity: current.hemisphereIntensity,
    hemisphereSky: current.hemisphereSky.clone(),
    hemisphereGround: current.hemisphereGround.clone(),
    exposure: current.exposure,
    moonIntensity: current.moonIntensity,
    moonColor: current.moonColor.clone(),
    fogDensity: current.fogDensity,
    environmentIntensity: current.environmentIntensity,
    sunDisc: current.sunDisc,
    dust: current.dust,
  };

  /** Pushes the blended rig into the sky, lights, fog, stars, ring and the shared getters. */
  const apply = (now: number): void => {
    sunDirection.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - current.sunElevation),
      THREE.MathUtils.degToRad(current.sunAzimuth),
    );
    u.sunPosition.value.copy(sunDirection);
    u.turbidity.value = current.turbidity;
    u.rayleigh.value = current.rayleigh;
    u.mieCoefficient.value = current.mieCoefficient;
    u.mieDirectionalG.value = current.mieDirectionalG;
    u.cloudCoverage.value = current.cloudCoverage;
    u.showSunDisc.value = current.sunDisc > 0.5 ? 1 : 0;
    sunColor.copy(current.sunColor);
    fogColor.copy(current.fogColor);
    starMaterial.opacity = current.starOpacity * (0.85 + 0.15 * Math.sin(now * 0.7));
    ringMaterial.emissiveIntensity = current.ringGlow;
    rimMaterial.emissiveIntensity = current.ringGlow * 1.8;
    moonLight.color.copy(current.moonColor);
    moonLight.intensity = current.moonIntensity;
    moonSprite.material.opacity = Math.min(1, current.moonIntensity);
    lighting.sunIntensity = current.sunIntensity;
    lighting.hemisphereIntensity = current.hemisphereIntensity;
    lighting.hemisphereSky.copy(current.hemisphereSky);
    lighting.hemisphereGround.copy(current.hemisphereGround);
    lighting.exposure = current.exposure;
    lighting.moonIntensity = current.moonIntensity;
    lighting.moonColor.copy(current.moonColor);
    lighting.fogDensity = current.fogDensity;
    lighting.environmentIntensity = current.environmentIntensity;
    lighting.sunDisc = current.sunDisc;
    lighting.dust = current.dust;
  };
  apply(0);

  const rain = (dt: number, scene: SceneContext, now: number): void => {
    const { particles, eye } = scene;
    const drops = Math.min(160, Math.round(RAIN_RATE * dt));
    for (let i = 0; i < drops; i += 1) {
      particles.burst(
        {
          at: {
            x: eye.x + (Math.random() - 0.5) * RAIN_BOX,
            y: eye.y + 1 + Math.random() * (RAIN_BOX / 2),
            z: eye.z + (Math.random() - 0.5) * RAIN_BOX,
          },
          count: 1,
          color: RAIN_COLOR,
          speed: RAIN_FALL_SPEED,
          direction: { x: 0.04, y: -1, z: 0.02 },
          spread: 0.03,
          life: RAIN_LIFE,
          size: 0.3,
          stretch: 8,
        },
        now,
      );
    }
    splashDebt += RAIN_SPLASH_RATE * dt;
    while (splashDebt >= 1) {
      splashDebt -= 1;
      particles.burst(
        {
          at: {
            x: eye.x + (Math.random() - 0.5) * 12,
            y: 0.06,
            z: eye.z + (Math.random() - 0.5) * 12,
          },
          count: 4,
          color: SPLASH_COLOR,
          colorEnd: 0x1e3a5f,
          speed: 1.1,
          direction: { x: 0, y: 1, z: 0 },
          spread: 0.8,
          life: 0.3,
          size: 0.25,
          gravity: 7,
        },
        now,
      );
    }
  };

  /** Moves `current` along the pending blend; a blend of zero seconds lands on the first frame. */
  const advanceBlend = (now: number): void => {
    if (blendSeconds <= 0 && !Number.isNaN(blendStart)) return;
    if (Number.isNaN(blendStart)) blendStart = now;
    const raw = blendSeconds > 0 ? (now - blendStart) / blendSeconds : 1;
    const t = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(raw, 0, 1), 0, 1);
    blendRig(current, from, to, t);
    if (raw >= 1) blendSeconds = 0;
  };

  return {
    group,
    sunDirection,
    sunColor,
    fogColor,
    sky,
    moonLight,
    atmosphere: () => atmosphere,
    lighting: () => lighting,
    setAtmosphere: (target, seconds) => {
      const next: Atmosphere = { ...target, ...override };
      if (next.timeOfDay === atmosphere.timeOfDay && next.weather === atmosphere.weather) return;
      atmosphere = next;
      from = cloneRig(current);
      to = rigFor(next);
      blendSeconds = Math.max(0, seconds);
      blendStart = Number.NaN;
    },
    update: (now, scene) => {
      const dt = Number.isNaN(lastNow) ? 0 : THREE.MathUtils.clamp(now - lastNow, 0, 0.1);
      lastNow = now;
      ring.rotation.z = now * 0.0015;
      advanceBlend(now);
      apply(now);
      if (scene && atmosphere.weather === 'rain' && dt > 0) rain(dt, scene, now);
    },
  };
};
