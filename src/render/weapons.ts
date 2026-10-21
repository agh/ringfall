import * as THREE from 'three';
import type { GameEvent, GameState } from '../core/game';
import type { Vec3 } from '../core/vec3';
import { WEAPON_KINDS, type Weapon, type WeaponKind } from '../core/weapon';
import type { LightPool } from './lights';
import type { ParticleSystem } from './particles';
import { renderRandom } from './random';

/**
 * First-person weapon rigs and their fire effects. One primitive rig per `WeaponKind` hangs
 * under a single sway group that `scene.ts` positions exactly as it positioned the old rifle;
 * tracers, beams and impact sparks go into a separate world-space `effects` group. Everything
 * is procedural: the only textures are canvas gradients drawn at construction.
 */

/**
 * Emissive accent per kind. Each kind owns one colour family so the held weapon, its tracers
 * and its pickup emblem all read as the same thing. Rifle keeps Beacon, scatter takes Dawn; the
 * rest are named here because the brand palette has no token for them yet.
 */
export const WEAPON_ACCENT: Readonly<Record<WeaponKind, number>> = {
  rifle: 0x7dd3fc, // Beacon
  laser: 0xdbeafe, // Ice: cold white-blue
  scatter: 0xf6b26b, // Dawn
  beam: 0xd8b4fe, // Violet-white
  launcher: 0xbef264, // Lime, matching the grenade shell
  minigun: 0x5eead4, // Mint
};

/** Seconds a drawn weapon takes to rise into place after a swap or pickup. */
export const DRAW_TIME = 0.25;
/** Seconds the laser's bolt and impact dot persist. */
export const LASER_LIFE = 0.1;
/** Radius in metres of the laser bolt: a cylinder, so it is still a few pixels wide at 4K. */
export const LASER_RADIUS = 0.015;
/** Seconds the beam takes to fade. */
export const BEAM_LIFE = 0.3;
/** Radius in metres of the beam's soft sheath. */
export const BEAM_RADIUS = 0.14;
/** Radius in metres of the beam's hot core; it has to stay well under the sheath to read as one. */
export const BEAM_CORE_RADIUS = 0.035;
/**
 * Candela of the point light that rides inside the beam. Three.js attenuates a point light by
 * `intensity / distance^decay`; with decay 1.5 a wall 2 m away receives about 8.5 lux, which
 * at the game's exposure lights it to roughly two thirds of white without clipping.
 */
export const BEAM_LIGHT = 24;
/**
 * Metres across the launcher's muzzle ring reaches as it fades out. It opens 0.4 m past the
 * muzzle, about 1.6 m from the eye, so even fully open it is under 170 px at 1280x720.
 */
export const LAUNCHER_RING_DIAMETER = 0.6;
/** Seconds the launcher's muzzle ring lives. */
export const LAUNCHER_RING_LIFE = 0.1;
/** Radians per second of barrel rotation at full minigun spin. */
const MINIGUN_SPIN_RATE = 45;
/** Where the old rifle sat relative to the camera; the mount keeps it so sway code is untouched. */
const MOUNT_OFFSET = new THREE.Vector3(0.3, -0.27, -0.5);

interface FlashStyle {
  readonly color: number;
  /**
   * Sprite width in metres at the muzzle, about 1.2 m from the eye, where one metre is about
   * 370 px at 1280x720 with the 78 degree field of view. The gradient texture is transparent
   * past 60 % of its radius, so `scale + jitter` under 0.4 m keeps the visible disc inside
   * 160 px even before the flash has started to fade.
   */
  readonly scale: number;
  readonly jitter: number;
  /** Peak point-light candela; the light shares the sprite's life. */
  readonly light: number;
  readonly lightColor: number;
  /** Seconds from full opacity to gone; every kind stays under 80 ms. */
  readonly life: number;
}

const FLASH: Readonly<Record<WeaponKind, FlashStyle>> = {
  rifle: {
    color: 0xffe9b0,
    scale: 0.22,
    jitter: 0.06,
    light: 28,
    lightColor: 0xffd27a,
    life: 0.05,
  },
  laser: {
    color: 0xffffff,
    scale: 0.12,
    jitter: 0.03,
    light: 16,
    lightColor: 0xdbeafe,
    life: 0.035,
  },
  scatter: {
    color: 0xffc98a,
    scale: 0.3,
    jitter: 0.06,
    light: 40,
    lightColor: 0xf6b26b,
    life: 0.07,
  },
  beam: {
    color: 0xf3e8ff,
    scale: 0.28,
    jitter: 0.05,
    light: 48,
    lightColor: 0xd8b4fe,
    life: 0.075,
  },
  launcher: {
    color: 0xffb070,
    scale: 0.26,
    jitter: 0.05,
    light: 34,
    lightColor: 0xffa040,
    life: 0.07,
  },
  minigun: {
    color: 0xfff6e0,
    scale: 0.15,
    jitter: 0.04,
    light: 22,
    lightColor: 0xfff1c4,
    life: 0.04,
  },
};

interface Rig {
  readonly root: THREE.Group;
  /** Anchor at the muzzle in rig space; its world position is where effects start. */
  readonly muzzle: THREE.Object3D;
  readonly flash: THREE.Sprite;
  readonly animate: (weapon: Weapon, dt: number, now: number) => void;
}

/**
 * An effect frees its geometry when it expires but keeps its material. A material with no
 * texture owns nothing on the GPU except its share of a shader program, and `dispose()` only
 * drops that share: when a tracer's material was the last one on the program, three.js deletes
 * the program and the next shot compiles it again, a hitch on every shot whose effect outlived
 * the previous one (measured on seed 7: the program count rose and fell 44 times in 41 s).
 * An undisposed material is garbage-collected like any object; the program it holds stays.
 */
interface Effect {
  readonly object: THREE.Object3D;
  readonly bornAt: number;
  readonly life: number;
  readonly update: (t: number) => void;
  readonly dispose: () => void;
}

interface Materials {
  readonly body: THREE.MeshStandardMaterial;
  readonly dark: THREE.MeshStandardMaterial;
}

const toVector = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);
const toVec3 = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

const makeFlashTexture = (): THREE.Texture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,220,140,0.9)');
    g.addColorStop(0.6, 'rgba(255,140,40,0.35)');
    g.addColorStop(1, 'rgba(255,100,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,240,200,0.9)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(size / 2, size / 2);
      ctx.lineTo(size / 2 + Math.cos(a) * size * 0.5, size / 2 + Math.sin(a) * size * 0.5);
      ctx.stroke();
    }
  }
  return new THREE.CanvasTexture(canvas);
};

/** A soft white disc, used for the laser's impact dot. */
const makeDotTexture = (): THREE.Texture => {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
};

const accentMaterial = (kind: WeaponKind, intensity = 1.5): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color: WEAPON_ACCENT[kind],
    emissive: WEAPON_ACCENT[kind],
    emissiveIntensity: intensity,
  });

const box = (
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
};

/** A cylinder lying along -Z (the barrel axis), centred at (x, y, z). */
const tube = (
  rTop: number,
  rBottom: number,
  length: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  segments = 12,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBottom, length, segments),
    material,
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
};

/** A ring in the XY plane (around the barrel axis), centred at (x, y, z). */
const ring = (
  radius: number,
  thickness: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 8, 24), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
};

const gripAndStock = (m: Materials, root: THREE.Group, stock = true): void => {
  const grip = box(0.06, 0.17, 0.08, m.dark, 0, -0.13, 0.14);
  grip.rotation.x = 0.3;
  root.add(grip);
  if (stock) root.add(box(0.07, 0.09, 0.24, m.body, 0, -0.01, 0.36));
};

const makeRig = (
  root: THREE.Group,
  muzzleAt: THREE.Vector3,
  flashTexture: THREE.Texture,
  kind: WeaponKind,
  animate: Rig['animate'],
): Rig => {
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(muzzleAt);
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flashTexture,
      color: FLASH[kind].color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }),
  );
  flash.position.copy(muzzleAt).add(new THREE.Vector3(0, 0, -0.02));
  root.add(muzzle, flash);
  root.visible = false;
  return { root, muzzle, flash, animate };
};

/** The original rifle, unchanged: the baseline every other kind is a variation on. */
const buildRifle = (m: Materials, texture: THREE.Texture): Rig => {
  const root = new THREE.Group();
  const accent = accentMaterial('rifle');
  const magazine = box(0.05, 0.2, 0.1, m.dark, 0, -0.14, -0.02);
  magazine.rotation.x = 0.1;
  root.add(
    box(0.1, 0.13, 0.52, m.body, 0, 0, 0),
    box(0.08, 0.05, 0.6, m.dark, 0, 0.09, -0.08),
    tube(0.018, 0.024, 0.42, m.dark, 0, 0.03, -0.46),
    box(0.07, 0.08, 0.3, m.body, 0, 0.02, -0.38),
    box(0.016, 0.03, 0.12, accent, 0, 0.125, -0.02),
    box(0.03, 0.012, 0.1, accent, -0.052, 0.02, 0.05),
    magazine,
  );
  gripAndStock(m, root);
  return makeRig(root, new THREE.Vector3(0, 0.03, -0.7), texture, 'rifle', () => {});
};

/** Long, slim, finned: a precision tool with a glowing emitter at the tip. */
const buildLaser = (m: Materials, texture: THREE.Texture): Rig => {
  const root = new THREE.Group();
  const accent = accentMaterial('laser', 2);
  root.add(
    box(0.08, 0.1, 0.46, m.body, 0, 0, 0.02),
    tube(0.012, 0.016, 0.62, m.dark, 0, 0.04, -0.5),
    box(0.012, 0.008, 0.44, accent, 0, 0.055, -0.06),
    box(0.05, 0.12, 0.12, m.dark, 0, -0.1, 0),
  );
  for (let i = 0; i < 4; i += 1) {
    root.add(box(0.07, 0.03, 0.012, m.dark, 0, 0.04, -0.3 - i * 0.09));
  }
  const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 10), accent);
  emitter.position.set(0, 0.04, -0.8);
  root.add(emitter);
  gripAndStock(m, root, false);
  return makeRig(root, new THREE.Vector3(0, 0.04, -0.82), texture, 'laser', (_w, _dt, now) => {
    accent.emissiveIntensity = 1.8 + Math.sin(now * 6) * 0.3;
  });
};

/** Fat and short: twin barrels, a tube magazine under them, a wide Dawn muzzle ring. */
const buildScatter = (m: Materials, texture: THREE.Texture): Rig => {
  const root = new THREE.Group();
  const accent = accentMaterial('scatter');
  const pump = box(0.09, 0.06, 0.12, m.dark, 0, -0.02, -0.34);
  root.add(
    box(0.11, 0.14, 0.4, m.body, 0, 0, 0.02),
    tube(0.028, 0.03, 0.42, m.dark, -0.03, 0.045, -0.42),
    tube(0.028, 0.03, 0.42, m.dark, 0.03, 0.045, -0.42),
    tube(0.026, 0.026, 0.36, m.body, 0, -0.03, -0.36),
    ring(0.07, 0.012, accent, 0, 0.045, -0.6),
    box(0.03, 0.012, 0.1, accent, -0.058, 0.02, 0.05),
    pump,
  );
  gripAndStock(m, root);
  return makeRig(root, new THREE.Vector3(0, 0.045, -0.66), texture, 'scatter', () => {});
};

/** A capacitor ring and a violet core that both swell with the held charge. */
const buildBeam = (m: Materials, texture: THREE.Texture): Rig => {
  const root = new THREE.Group();
  const capacitor = accentMaterial('beam', 0.8);
  const core = new THREE.MeshBasicMaterial({ color: 0xf3e8ff, transparent: true, opacity: 0.5 });
  const capRing = ring(0.075, 0.016, capacitor, 0, 0.03, -0.3);
  const coreRod = tube(0.02, 0.02, 0.5, core, 0, 0.03, -0.45);
  root.add(
    box(0.1, 0.12, 0.46, m.body, 0, 0, 0.04),
    tube(0.034, 0.046, 0.44, m.dark, 0, 0.03, -0.46),
    capRing,
    coreRod,
    box(0.03, 0.012, 0.1, accentMaterial('beam'), -0.052, 0.02, 0.06),
  );
  for (const [px, py] of [
    [0.04, 0.03],
    [-0.04, 0.03],
    [0, 0.075],
  ] as const) {
    root.add(box(0.014, 0.014, 0.12, m.dark, px, py, -0.7));
  }
  gripAndStock(m, root);
  return makeRig(root, new THREE.Vector3(0, 0.03, -0.74), texture, 'beam', (w, _dt, now) => {
    const c = w.charge;
    capacitor.emissiveIntensity = 0.8 + c * 4 + Math.sin(now * (8 + c * 50)) * c * 1.5;
    capRing.scale.setScalar(1 + c * 0.2);
    core.opacity = 0.35 + c * 0.65;
  });
};

/** A three-round drum that turns one notch per round, under a wide flared muzzle. */
const buildLauncher = (m: Materials, texture: THREE.Texture): Rig => {
  const root = new THREE.Group();
  const drum = new THREE.Group();
  drum.position.set(0, -0.04, -0.06);
  drum.add(tube(0.09, 0.09, 0.12, m.body, 0, 0, 0, 18));
  const chambers: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const material = accentMaterial('launcher');
    chambers.push(material);
    drum.add(tube(0.022, 0.022, 0.13, material, Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0, 10));
  }
  root.add(
    box(0.1, 0.12, 0.3, m.body, 0, 0.02, 0.14),
    tube(0.045, 0.045, 0.42, m.dark, 0, 0.02, -0.34),
    tube(0.048, 0.075, 0.1, m.body, 0, 0.02, -0.58, 14),
    box(0.016, 0.03, 0.08, accentMaterial('launcher'), 0, 0.11, 0.04),
    drum,
  );
  gripAndStock(m, root);
  let angle = 0;
  return makeRig(root, new THREE.Vector3(0, 0.02, -0.66), texture, 'launcher', (w, dt) => {
    const notch = (Math.PI * 2) / Math.max(1, w.magazineSize);
    const target = (w.magazineSize - w.magazine) * notch;
    angle += (target - angle) * (1 - Math.exp(-dt * 14));
    drum.rotation.z = -angle;
    chambers.forEach((c, i) => {
      c.emissiveIntensity = w.magazine > i ? 1.5 : 0.08;
    });
  });
};

/** Six barrels on a spindle that turn with the spin-up; a side-fed ammo box with a mint strip. */
const buildMinigun = (m: Materials, texture: THREE.Texture): Rig => {
  const root = new THREE.Group();
  const accent = accentMaterial('minigun');
  const cluster = new THREE.Group();
  cluster.position.set(0, 0.03, -0.46);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    cluster.add(tube(0.011, 0.011, 0.5, m.dark, Math.cos(a) * 0.034, Math.sin(a) * 0.034, 0, 8));
  }
  cluster.add(
    tube(0.052, 0.052, 0.03, m.body, 0, 0, -0.22, 16),
    tube(0.052, 0.052, 0.03, m.body, 0, 0, 0.02, 16),
    tube(0.015, 0.015, 0.54, m.dark, 0, 0, 0, 8),
  );
  root.add(
    box(0.12, 0.14, 0.34, m.body, 0, 0, 0.04),
    tube(0.06, 0.06, 0.1, m.dark, 0, 0.03, -0.18, 16),
    box(0.08, 0.1, 0.14, m.dark, -0.1, -0.02, 0.06),
    box(0.012, 0.06, 0.1, accent, -0.145, -0.02, 0.06),
    box(0.04, 0.012, 0.2, accent, 0, 0.075, 0.04),
    box(0.04, 0.1, 0.05, m.dark, 0, -0.1, -0.22),
    cluster,
  );
  gripAndStock(m, root);
  return makeRig(root, new THREE.Vector3(0, 0.03, -0.72), texture, 'minigun', (w, dt) => {
    cluster.rotation.z += w.spin * MINIGUN_SPIN_RATE * dt;
  });
};

const BUILDERS: Readonly<Record<WeaponKind, (m: Materials, t: THREE.Texture) => Rig>> = {
  rifle: buildRifle,
  laser: buildLaser,
  scatter: buildScatter,
  beam: buildBeam,
  launcher: buildLauncher,
  minigun: buildMinigun,
};

export class WeaponViewmodels {
  /** Sway group under the camera; `scene.ts` drives its position and rotation every frame. */
  readonly group = new THREE.Group();
  /** World-space fire effects (tracers, beams, laser dots). Add it to the scene once. */
  readonly effects = new THREE.Group();
  /** Extra recoil asked for by a heavy shot; `scene.ts` folds it into its recoil and clears it. */
  recoilRequest = 0;

  private readonly mount = new THREE.Group();
  private readonly rigs: Record<WeaponKind, Rig>;
  private readonly light = new THREE.PointLight(0xffd27a, 0, 9, 1.5);
  private readonly dotTexture = makeDotTexture();
  private readonly particles: ParticleSystem;
  private readonly lights: LightPool;
  private activeKind: WeaponKind = 'rifle';
  private swapAt = -1;
  private lightDecay = 900;
  private charging = false;
  private lastNow: number | null = null;
  private pending: Effect[] = [];

  constructor(camera: THREE.Camera, particles: ParticleSystem, lights: LightPool) {
    this.particles = particles;
    this.lights = lights;
    const materials: Materials = {
      body: new THREE.MeshStandardMaterial({ color: 0x4b5664, roughness: 0.42, metalness: 0.8 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1d242c, roughness: 0.6, metalness: 0.7 }),
    };
    const flashTexture = makeFlashTexture();
    const build = (kind: WeaponKind): Rig => BUILDERS[kind](materials, flashTexture);
    this.rigs = {
      rifle: build('rifle'),
      laser: build('laser'),
      scatter: build('scatter'),
      beam: build('beam'),
      launcher: build('launcher'),
      minigun: build('minigun'),
    };
    for (const kind of WEAPON_KINDS) this.mount.add(this.rigs[kind].root);
    this.mount.add(this.light);
    this.mount.position.copy(MOUNT_OFFSET);
    this.group.add(this.mount);
    // The sway group hangs off the camera at the origin; scene.ts moves it, never the mount.
    camera.add(this.group);
    this.setActive('rifle', -1);
  }

  /** Shows `kind` with a draw animation that starts at `swapAt` (seconds, the render clock). */
  setActive(kind: WeaponKind, swapAt: number): void {
    this.activeKind = kind;
    this.swapAt = swapAt;
    for (const k of WEAPON_KINDS) this.rigs[k].root.visible = k === kind;
    this.light.position.copy(this.rigs[kind].muzzle.position);
    this.light.color.set(FLASH[kind].lightColor);
  }

  get active(): WeaponKind {
    return this.activeKind;
  }

  /** World position of the active weapon's muzzle, where tracers and smoke start. */
  muzzleWorldPosition(): THREE.Vector3 {
    return this.rigs[this.activeKind].muzzle.getWorldPosition(new THREE.Vector3());
  }

  update(now: number, state: GameState): void {
    const dt = this.lastNow === null ? 0 : THREE.MathUtils.clamp(now - this.lastNow, 0, 0.1);
    this.lastNow = now;
    const weapon = state.player.weapon;
    // A new game hands the player a rifle without an event; follow the state, not only events.
    if (weapon.kind !== this.activeKind) this.setActive(weapon.kind, now);

    const rig = this.rigs[this.activeKind];
    const t = THREE.MathUtils.clamp((now - this.swapAt) / DRAW_TIME, 0, 1);
    const ease = 1 - (1 - t) ** 3;
    rig.root.position.y = -0.3 * (1 - ease);
    rig.root.rotation.x = -0.55 * (1 - ease);
    rig.animate(weapon, dt, now);

    this.light.intensity = Math.max(0, this.light.intensity - dt * this.lightDecay);
    for (const kind of WEAPON_KINDS) {
      const m = this.rigs[kind].flash.material;
      m.opacity = Math.max(0, m.opacity - dt / FLASH[kind].life);
    }
    if (this.charging && weapon.charge > 0) this.chargeInflow(now, weapon.charge);
    this.tickEffects(now);
  }

  handle(events: readonly GameEvent[], now: number, camera: THREE.Camera): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          this.onShot(e.kind, e.from, e.to, e.hitEnemy, now);
          break;
        case 'beamFired':
          this.onBeam(e.from, e.to, e.hits, now);
          break;
        case 'chargeStarted':
          this.charging = true;
          break;
        case 'chargeReleased':
          this.charging = false;
          break;
        case 'launcherFired':
          this.onLauncher(now, camera);
          break;
        case 'weaponSwapped':
        case 'pickupTaken':
          this.charging = false;
          break;
      }
    }
  }

  private flash(kind: WeaponKind): void {
    const style = FLASH[kind];
    const sprite = this.rigs[kind].flash;
    sprite.material.opacity = 1;
    sprite.material.rotation = renderRandom() * Math.PI;
    sprite.scale.setScalar(style.scale + renderRandom() * style.jitter);
    this.light.intensity = style.light;
    this.lightDecay = style.light / style.life;
  }

  private onShot(kind: WeaponKind, from: Vec3, to: Vec3, hitEnemy: boolean, now: number): void {
    const start = this.muzzleWorldPosition();
    const end = toVector(to);
    switch (kind) {
      case 'rifle':
        this.flash(kind);
        this.tracer(start, end, 0xfff3b0, 0.06, 0.9, now);
        this.impact(to, start, hitEnemy ? 22 : 10, hitEnemy ? 0xffd166 : 0xfff1c4, now);
        break;
      case 'laser':
        this.flash(kind);
        this.laserLine(start, end, now);
        this.impact(to, start, hitEnemy ? 18 : 8, 0xffffff, now, 0xdbeafe);
        break;
      case 'scatter':
        this.flash(kind);
        this.recoilRequest = Math.max(this.recoilRequest, 1.6);
        this.scatterFan(from, to, start, now, hitEnemy);
        break;
      case 'minigun':
        this.flash(kind);
        this.tracer(start, end, 0xffffff, 0.04, 0.8, now);
        this.impact(to, start, hitEnemy ? 10 : 5, 0xfff6e0, now, 0xff8c42);
        break;
      case 'beam':
        // The `beamFired` event right after this one draws the beam itself.
        this.flash(kind);
        break;
      case 'launcher':
        break;
    }
  }

  private laserLine(start: THREE.Vector3, end: THREE.Vector3, now: number): void {
    this.bolt(start, end, LASER_RADIUS, 0xffffff, 0.9, LASER_LIFE, now);
    const dot = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.dotTexture,
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    dot.position.copy(end);
    dot.scale.setScalar(0.28);
    this.addEffect(
      dot,
      now,
      LASER_LIFE,
      (t) => {
        dot.material.opacity = 1 - t;
        dot.scale.setScalar(0.28 + t * 0.2);
      },
      () => {},
    );
  }

  /** Eight short tracers fanned around the first pellet's end point, plus a spark at each. */
  private scatterFan(from: Vec3, to: Vec3, start: THREE.Vector3, now: number, hit: boolean): void {
    const origin = toVector(from);
    const end = toVector(to);
    const dir = end.clone().sub(origin);
    const dist = Math.max(1, dir.length());
    dir.normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    const up = dir.clone().cross(side).normalize();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 + renderRandom() * 0.6;
      const r = i === 0 ? 0 : dist * 0.09 * (0.35 + renderRandom() * 0.65);
      const pelletEnd = end
        .clone()
        .addScaledVector(side, Math.cos(a) * r)
        .addScaledVector(up, Math.sin(a) * r);
      const back = Math.min(dist * 0.4, 2.5 + renderRandom());
      const pelletStart = pelletEnd
        .clone()
        .sub(start)
        .normalize()
        .multiplyScalar(-back)
        .add(pelletEnd);
      this.tracer(i === 0 ? start : pelletStart, pelletEnd, 0xffd9a0, 0.08, 0.5, now);
      this.impact(toVec3(pelletEnd), start, hit ? 6 : 3, 0xf6b26b, now, 0xff6a1f, 5);
    }
  }

  private onBeam(from: Vec3, to: Vec3, hits: number, now: number): void {
    this.recoilRequest = Math.max(this.recoilRequest, 1.5);
    const start = this.muzzleWorldPosition();
    const origin = toVector(from);
    const end = toVector(to);
    const axis = end.clone().sub(start);
    const length = Math.max(0.1, axis.length());
    const dir = axis.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const mid = start.clone().add(end).multiplyScalar(0.5);

    // A hot core inside a soft sheath. Both are additive over an HDR scene that bloom reads
    // above 1.25, so the sheath stays faint and only the thin core is allowed to run white.
    const shell = new THREE.MeshBasicMaterial({
      color: 0xd8b4fe,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beam = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, length, 14, 1, true),
      shell,
    );
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAM_CORE_RADIUS, BEAM_CORE_RADIUS, length, 10, 1, true),
      core,
    );
    beam.add(outer, inner);
    // Children live in beam space, where the axis is +Y: the light sits 2.5 m in from the muzzle.
    const light = this.lights.acquire(beam, 0xd8b4fe, BEAM_LIGHT, 10, 1.5);
    light?.position.set(0, -length / 2 + Math.min(2.5, length / 2), 0);
    beam.position.copy(mid);
    beam.quaternion.copy(quaternion);
    this.addEffect(
      beam,
      now,
      BEAM_LIFE,
      (t) => {
        const k = 1 - t;
        shell.opacity = 0.18 * k;
        core.opacity = 0.8 * k * k;
        outer.scale.set(1 + t * 0.5, 1, 1 + t * 0.5);
        inner.scale.set(k, 1, k);
        if (light) light.intensity = BEAM_LIGHT * k;
      },
      () => {
        this.lights.release(light);
        outer.geometry.dispose();
        inner.geometry.dispose();
      },
    );

    // Sparks: one burst per enemy it passed through, spaced evenly, plus the stopping point.
    const span = end.clone().sub(origin);
    for (let i = 0; i < hits; i += 1) {
      const at = origin.clone().addScaledVector(span, (i + 1) / (hits + 1));
      if (at.distanceTo(origin) < 2) continue;
      this.particles.burst(
        {
          at: toVec3(at),
          count: 24,
          color: 0xf3e8ff,
          colorEnd: 0x7c3aed,
          speed: 5,
          life: 0.5,
          size: 3,
          gravity: 5,
        },
        now,
      );
    }
    this.impact(to, start, 20, 0xf3e8ff, now, 0x7c3aed);
  }

  private onLauncher(now: number, camera: THREE.Camera): void {
    this.flash('launcher');
    this.recoilRequest = Math.max(this.recoilRequest, 2);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const muzzle = this.muzzleWorldPosition();
    this.muzzleRing(muzzle.clone().addScaledVector(forward, 0.4), forward, now);
    // Particle sprites fade inside two metres of the eye, so the smoke starts a metre out,
    // where it reads as a puff rather than a few huge motes on the lens.
    const at = toVec3(muzzle.addScaledVector(forward, 1));
    this.particles.burst(
      {
        at,
        count: 16,
        color: 0x8a8a8a,
        colorEnd: 0x2a2a2a,
        speed: 1.8,
        spread: 0.6,
        direction: toVec3(forward),
        life: 1.1,
        size: 0.6,
        gravity: -0.5,
        drag: 1.6,
      },
      now,
    );
    this.particles.burst(
      {
        at,
        count: 10,
        color: 0xffd9a0,
        colorEnd: 0xff6a1f,
        speed: 4,
        spread: 0.5,
        direction: toVec3(forward),
        life: 0.3,
        size: 0.5,
        gravity: 3,
      },
      now,
    );
  }

  /** A flat ring in front of the muzzle that opens to `LAUNCHER_RING_DIAMETER` and fades. */
  private muzzleRing(at: THREE.Vector3, forward: THREE.Vector3, now: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffb070,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const geometry = new THREE.RingGeometry(0.34, 0.5, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(at);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
    const open = 0.3;
    mesh.scale.setScalar(open);
    this.addEffect(
      mesh,
      now,
      LAUNCHER_RING_LIFE,
      (t) => {
        mesh.scale.setScalar(open + (LAUNCHER_RING_DIAMETER - open) * t);
        material.opacity = 0.45 * (1 - t) ** 2;
      },
      () => geometry.dispose(),
    );
  }

  /** While the beam charges, motes stream in from around the muzzle and vanish into it. */
  private chargeInflow(now: number, charge: number): void {
    const muzzle = this.muzzleWorldPosition();
    const count = 1 + Math.floor(charge * 3);
    for (let i = 0; i < count; i += 1) {
      const offset = new THREE.Vector3(
        renderRandom() - 0.5,
        renderRandom() - 0.5,
        renderRandom() - 0.5,
      )
        .normalize()
        .multiplyScalar(0.3 + renderRandom() * 0.4);
      const life = 0.22;
      this.particles.burst(
        {
          at: toVec3(muzzle.clone().add(offset)),
          count: 1,
          color: 0xd8b4fe,
          colorEnd: 0xffffff,
          speed: offset.length() / life,
          spread: 0,
          direction: toVec3(offset.clone().negate()),
          life,
          size: 0.12 + charge * 0.12,
        },
        now,
      );
    }
  }

  private tracer(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    life: number,
    opacity: number,
    now: number,
  ): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geometry, material);
    this.addEffect(
      line,
      now,
      life,
      (t) => {
        material.opacity = opacity * (1 - t);
      },
      () => geometry.dispose(),
    );
  }

  /**
   * A thin additive cylinder from `start` to `end`: a tracer with real width, so it keeps a few
   * pixels at 4K where a `Line` stays at one.
   */
  private bolt(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    color: number,
    opacity: number,
    life: number,
    now: number,
  ): void {
    const axis = end.clone().sub(start);
    const length = Math.max(0.1, axis.length());
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    this.addEffect(
      mesh,
      now,
      life,
      (t) => {
        material.opacity = opacity * (1 - t);
        mesh.scale.set(1 - t * 0.6, 1, 1 - t * 0.6);
      },
      () => geometry.dispose(),
    );
  }

  /** Impact sparks thrown back towards the shooter. */
  private impact(
    at: Vec3,
    from: THREE.Vector3,
    count: number,
    color: number,
    now: number,
    colorEnd = 0x7a6a4a,
    size = 7,
  ): void {
    const dir = from.clone().sub(toVector(at)).normalize();
    this.particles.burst(
      {
        at,
        count,
        color,
        colorEnd,
        speed: 4,
        spread: 0.9,
        direction: toVec3(dir),
        life: 0.45,
        size,
        gravity: 9,
      },
      now,
    );
  }

  private addEffect(
    object: THREE.Object3D,
    bornAt: number,
    life: number,
    update: (t: number) => void,
    dispose: () => void,
  ): void {
    this.effects.add(object);
    this.pending.push({ object, bornAt, life, update, dispose });
  }

  private tickEffects(now: number): void {
    this.pending = this.pending.filter((effect) => {
      const t = (now - effect.bornAt) / effect.life;
      if (t >= 1) {
        this.effects.remove(effect.object);
        effect.dispose();
        return false;
      }
      effect.update(Math.max(0, t));
      return true;
    });
  }
}
