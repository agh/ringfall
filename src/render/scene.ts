import * as THREE from 'three';
import type { Enemy } from '../core/enemy';
import { CORPSE_LINGER, type GameEvent, type GameState, playerEye } from '../core/game';
import { GRENADE_BLAST_RADIUS } from '../core/grenade';
import type { Vec3 } from '../core/vec3';
import { WAVE_COUNTDOWN, waveAtmosphere } from '../core/waves';
import { ARENA_HALF_SIZE, type Arena } from '../core/world';
import { type EnemyRig, makeEnemyRig } from './enemies';
import { createEnvironment, type Environment } from './environment';
import { ParticleSystem } from './particles';
import { PickupMeshes } from './pickups';
import { PostStack } from './post';
import { WeaponViewmodels } from './weapons';

const FOG_DENSITY = 0.0032;
/** Hard cap on camera shake in radians (docs/brand.md). */
const SHAKE_CAP = 0.035;
const BASE_FOV = 78;

interface Effect {
  readonly object: THREE.Object3D;
  readonly bornAt: number;
  readonly life: number;
  readonly update: (t: number) => void;
}

const toVector = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);

/** Procedural floor plating with a height map turned into a normal map, so light rakes across seams. */
const makeFloorMaps = (): { map: THREE.Texture; normalMap: THREE.Texture } => {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const height = new Float32Array(size * size);
  if (ctx) {
    ctx.fillStyle = '#2a3b4d';
    ctx.fillRect(0, 0, size, size);
    const cells = 4;
    const cell = size / cells;
    for (let cy = 0; cy < cells; cy += 1) {
      for (let cx = 0; cx < cells; cx += 1) {
        const shade = 0x2a + Math.floor(Math.random() * 10);
        ctx.fillStyle = `rgb(${shade}, ${shade + 16}, ${shade + 34})`;
        ctx.fillRect(cx * cell + 4, cy * cell + 4, cell - 8, cell - 8);
        ctx.fillStyle = 'rgba(125, 211, 252, 0.22)';
        ctx.fillRect(cx * cell + 10, cy * cell + 10, cell - 20, 2);
        for (let i = 0; i < 3; i += 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(cx * cell + 12 + i * 22, cy * cell + cell - 20, 6, 6);
        }
      }
    }
    const data = ctx.getImageData(0, 0, size, size).data;
    for (let i = 0; i < size * size; i += 1) {
      const r = data[i * 4] ?? 0;
      const g = data[i * 4 + 1] ?? 0;
      height[i] = (r + g) / 510;
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  const normal = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (xx: number, yy: number): number =>
        height[((yy + size) % size) * size + ((xx + size) % size)] ?? 0;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 6;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 6;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const o = (y * size + x) * 4;
      normal[o] = Math.round((n.x * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
    }
  }
  const normalMap = new THREE.DataTexture(normal, size, size);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.needsUpdate = true;
  return { map, normalMap };
};

/** Owns the Three.js scene graph and mirrors immutable game state into it every frame. */
export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly post: PostStack;
  private readonly world = new THREE.Group();
  private readonly dynamic = new THREE.Group();
  private readonly weaponViewmodels: WeaponViewmodels;
  private readonly pickupMeshes: PickupMeshes;
  private sunLight: THREE.DirectionalLight | null = null;
  private hemisphere: THREE.HemisphereLight | null = null;
  private flareCore: THREE.Sprite | null = null;
  /** Wave whose atmosphere the environment was last told to blend towards. */
  private lastAtmosphereWave = 0;
  private readonly particles = new ParticleSystem();
  private readonly environment: Environment;
  private readonly enemies = new Map<number, EnemyRig>();
  private readonly bolts = new Map<number, THREE.Group>();
  private readonly grenades = new Map<number, THREE.Mesh>();
  private effects: Effect[] = [];
  private recoil = 0;
  private shake = 0;
  private bobPhase = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private swayX = 0;
  private swayY = 0;
  private lastPlayerPos = new THREE.Vector3();
  private arenaBuilt: Arena | null = null;
  private endCamera = 0;
  private flareGhosts: Array<[THREE.Sprite, number]> = [];
  private frameTimes: number[] = [];
  private pixelRatio = Math.min(window.devicePixelRatio, 2);
  private lastDprChange = 0;
  /** `?nopost` bypasses the composer: a diagnostic for GPUs that reject the HDR render target. */
  private readonly debugNoPost = new URLSearchParams(window.location.search).has('nopost');

  private readonly boltGeometry = new THREE.CapsuleGeometry(0.12, 0.5, 4, 8);
  private readonly boltMaterial = new THREE.MeshBasicMaterial({ color: 0xd8b4fe });
  private readonly grenadeGeometry = new THREE.SphereGeometry(0.15, 12, 12);
  private readonly grenadeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9acd32,
    emissive: 0x65a30d,
    emissiveIntensity: 0.8,
    roughness: 0.35,
    metalness: 0.4,
  });

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.38;
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 40000);
    this.camera.rotation.order = 'YXZ';

    this.environment = createEnvironment(ARENA_HALF_SIZE);
    this.scene.add(this.environment.group, this.world, this.dynamic, this.particles.points);
    this.scene.add(this.environment.moonLight, this.environment.moonLight.target);
    this.scene.fog = new THREE.FogExp2(this.environment.fogColor, FOG_DENSITY);
    this.scene.background = null;

    // Image-based lighting from the sky itself, so metal picks up the dawn.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    skyScene.add(this.environment.sky);
    this.scene.environment = pmrem.fromScene(skyScene, 0.04).texture;
    this.environment.group.add(this.environment.sky);
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.buildLights();
    this.buildFlare();
    this.scene.add(this.camera);
    this.weaponViewmodels = new WeaponViewmodels(this.camera, this.particles);
    this.dynamic.add(this.weaponViewmodels.effects);
    this.pickupMeshes = new PickupMeshes(this.dynamic, this.particles);
    this.post = new PostStack(this.renderer, this.scene, this.camera);
    window.ringfallDebug = {
      uniforms: () => this.post.debugUniforms(),
      info: () => this.renderer.info.render,
    };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** (Re)builds the static arena when a new game starts. */
  setArena(arena: Arena): void {
    if (this.arenaBuilt === arena) return;
    this.arenaBuilt = arena;
    this.world.clear();
    const size = arena.halfSize * 2;
    const { map, normalMap } = makeFloorMaps();
    map.repeat.set(size / 8, size / 8);
    normalMap.repeat.copy(map.repeat);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        map,
        normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: 0.72,
        metalness: 0.35,
        envMapIntensity: 0.6,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.01;
    ground.receiveShadow = true;
    this.world.add(ground);

    // Boundary: a low energy fence of glowing posts and a faint translucent field.
    const fieldMaterial = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x7dd3fc,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.08,
      roughness: 0.1,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x30455c,
      emissive: 0x7dd3fc,
      emissiveIntensity: 0.9,
      roughness: 0.4,
      metalness: 0.7,
    });
    const postGeometry = new THREE.CylinderGeometry(0.12, 0.18, 3.2, 8);
    const fieldGeometry = new THREE.PlaneGeometry(size, 3);
    for (const [x, z, rot] of [
      [0, -arena.halfSize, 0],
      [0, arena.halfSize, 0],
      [-arena.halfSize, 0, Math.PI / 2],
      [arena.halfSize, 0, Math.PI / 2],
    ] as const) {
      const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
      field.position.set(x, 1.5, z);
      field.rotation.y = rot;
      this.world.add(field);
    }
    const posts = Math.floor(size / 6);
    for (let i = 0; i <= posts; i += 1) {
      const t = -arena.halfSize + (i / posts) * size;
      for (const [x, z] of [
        [t, -arena.halfSize],
        [t, arena.halfSize],
        [-arena.halfSize, t],
        [arena.halfSize, t],
      ] as const) {
        const post = new THREE.Mesh(postGeometry, postMaterial);
        post.position.set(x, 1.6, z);
        post.castShadow = true;
        this.world.add(post);
      }
    }

    const coverMaterial = new THREE.MeshStandardMaterial({
      color: 0x51677d,
      roughness: 0.42,
      metalness: 0.6,
      envMapIntensity: 1,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x7dd3fc,
      emissiveIntensity: 1.4,
    });
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x1f2d3d,
      roughness: 0.7,
      metalness: 0.5,
    });
    for (const box of arena.obstacles) {
      const w = box.max.x - box.min.x;
      const h = box.max.y - box.min.y;
      const d = box.max.z - box.min.z;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), coverMaterial);
      mesh.position.set(cx, h / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.world.add(mesh);
      // Inset panel band and a glowing top trim give the slabs a manufactured look.
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.04, h * 0.3, d + 0.04),
        panelMaterial,
      );
      band.position.set(cx, h * 0.45, cz);
      this.world.add(band);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.05, d + 0.06), trimMaterial);
      trim.position.set(cx, h, cz);
      this.world.add(trim);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.12, d + 0.3), panelMaterial);
      skirt.position.set(cx, 0.06, cz);
      this.world.add(skirt);
    }
  }

  handle(events: readonly GameEvent[], now: number): void {
    this.weaponViewmodels.handle(events, now, this.camera);
    this.pickupMeshes.handle(events, now);
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          this.recoil = 1;
          break;
        case 'weaponSwapped':
        case 'pickupTaken':
          this.weaponViewmodels.setActive(e.kind, now);
          break;
        case 'explosion':
          this.spawnExplosion(e.at, now);
          this.shake = Math.max(this.shake, 0.9);
          break;
        case 'enemyKilled':
          this.spawnDeath(e.at, now);
          break;
        case 'playerDamaged':
          this.shake = Math.max(this.shake, 0.3);
          this.post.onDamage();
          this.post.onShieldHit();
          break;
        case 'shieldBroken':
          this.particles.burst(
            {
              at: {
                x: this.camera.position.x,
                y: this.camera.position.y - 0.3,
                z: this.camera.position.z,
              },
              count: 160,
              color: 0x7dd3fc,
              colorEnd: 0x1e3a5f,
              speed: 5,
              life: 0.9,
              size: 10,
              gravity: 4,
            },
            now,
          );
          break;
        case 'boltFired':
          break;
        case 'grenadeThrown':
          break;
      }
    }
  }

  render(state: GameState, now: number, frameDt: number): void {
    this.setArena(state.arena);
    this.syncAtmosphere(state.wave.number);
    this.environment.update(now, { particles: this.particles, eye: playerEye(state.player) });
    this.applyLighting();
    this.syncEnemies(state.enemies, state.time);
    this.syncBolts(state, now);
    this.syncGrenades(state, now);
    this.pickupMeshes.sync(state, now);
    this.weaponViewmodels.update(now, state);
    this.updateEffects(now);
    this.particles.update(now);

    // Airborne dust around the player: a hint of drift, never a disc. The rig sets motes per
    // second, their life and brightness per time of day and weather. The enemy rigs take the
    // same rig's night factor here, the one place render() reads the blend each frame.
    const atmosphere = this.environment.lighting();
    for (const rig of this.enemies.values()) rig.setNight?.(atmosphere.night);
    const motes = Math.floor(atmosphere.dustRate * frameDt + Math.random());
    for (let i = 0; i < motes; i += 1) {
      const e = playerEye(state.player);
      // Spawned 3.5 to 10 m out at size 0.09: the largest a mote can draw is 0.09 * 1.4 * 300
      // / 3.5 = 11 px, and most are 2 to 5 px.
      const angle = Math.random() * Math.PI * 2;
      const radius = 3.5 + Math.random() * 6.5;
      this.particles.burst(
        {
          at: {
            x: e.x + Math.cos(angle) * radius,
            y: e.y + (Math.random() - 0.3) * 5,
            z: e.z + Math.sin(angle) * radius,
          },
          count: 1,
          color: new THREE.Color(0xe8e4d8).multiplyScalar(atmosphere.dust),
          colorEnd: new THREE.Color(0xb8d8ea).multiplyScalar(atmosphere.dust),
          speed: 0.25,
          life: atmosphere.dustLife,
          size: 0.09,
          gravity: -0.05,
        },
        now,
      );
    }
    this.adaptResolution(frameDt);

    const eye = playerEye(state.player);
    const pos = toVector(eye);
    const moved = pos.distanceTo(this.lastPlayerPos);
    const speed = frameDt > 0 ? moved / frameDt : 0;
    this.lastPlayerPos.copy(pos);
    const bobAmount = THREE.MathUtils.clamp(speed / 9, 0, 1) * (state.player.onGround ? 1 : 0.2);
    this.bobPhase += frameDt * (speed > 7 ? 11 : 9) * (bobAmount > 0.05 ? 1 : 0);
    const bobY = Math.sin(this.bobPhase * 2) * 0.03 * bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.02 * bobAmount;

    this.camera.position.set(eye.x + bobX, eye.y + bobY, eye.z);
    this.camera.rotation.set(
      state.player.pitch,
      state.player.yaw,
      Math.sin(this.bobPhase) * 0.004 * bobAmount,
    );
    // End cameras: death sinks and rolls; victory lifts the gaze to the ring.
    if (state.status !== 'playing') {
      this.endCamera = Math.min(1, this.endCamera + frameDt / 1.6);
      const t = 1 - (1 - this.endCamera) ** 3;
      if (state.status === 'dead') {
        this.camera.position.y -= 1.1 * t;
        this.camera.rotation.z += 0.35 * t;
        this.camera.rotation.x += -0.25 * t;
      } else {
        this.camera.rotation.x = THREE.MathUtils.lerp(state.player.pitch, 0.55, t);
      }
    } else {
      this.endCamera = 0;
    }
    this.camera.updateMatrixWorld();
    this.updateFlare();
    if (this.shake > 0) {
      const amount = Math.min(SHAKE_CAP, 0.03 * this.shake);
      this.camera.rotation.z += (Math.random() - 0.5) * amount;
      this.camera.rotation.x += (Math.random() - 0.5) * amount * 0.5;
      this.shake = Math.max(0, this.shake - frameDt * 2.5);
    }

    // Weapon sway lags the look direction; recoil kicks it back and up.
    const yawDelta = state.player.yaw - this.lastYaw;
    const pitchDelta = state.player.pitch - this.lastPitch;
    this.lastYaw = state.player.yaw;
    this.lastPitch = state.player.pitch;
    this.swayX = THREE.MathUtils.lerp(
      this.swayX,
      THREE.MathUtils.clamp(-yawDelta * 2.5, -0.06, 0.06),
      1 - Math.exp(-frameDt * 12),
    );
    this.swayY = THREE.MathUtils.lerp(
      this.swayY,
      THREE.MathUtils.clamp(-pitchDelta * 2.5, -0.05, 0.05),
      1 - Math.exp(-frameDt * 12),
    );
    this.recoil = Math.max(this.recoil, this.weaponViewmodels.recoilRequest);
    this.weaponViewmodels.recoilRequest = 0;
    this.recoil = Math.max(0, this.recoil - frameDt * 10);
    const sway = this.weaponViewmodels.group;
    sway.position.set(this.swayX + bobX * 0.6, this.swayY + bobY * 0.8, this.recoil * 0.09);
    sway.rotation.set(this.recoil * 0.08 - this.swayY * 0.8, this.swayX * 1.2, this.swayX * 0.6);

    const targetFov = BASE_FOV + (speed > 7.5 && state.player.onGround ? 6 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(
        this.camera.fov,
        targetFov,
        1 - Math.exp(-frameDt * 8),
      );
      this.camera.updateProjectionMatrix();
    }

    if (this.debugNoPost) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.post.render(now, frameDt, state.player.vitality.shield <= 0 && state.status === 'playing');
  }

  /**
   * Procedural sun flare: an additive core sprite at the sun plus three ghosts placed along
   * the sun-to-centre axis in screen space every frame. No occlusion query, so it works on a
   * multisampled target and on software GL.
   */
  private buildFlare(): void {
    const make = (size: number, inner: string, outer: string): THREE.Texture => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, inner);
        g.addColorStop(0.35, outer);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    };
    const sprite = (texture: THREE.Texture, scale: number): THREE.Sprite => {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          transparent: true,
          fog: false,
        }),
      );
      sp.scale.setScalar(scale);
      sp.renderOrder = 10;
      return sp;
    };
    const core = sprite(make(256, 'rgba(255,245,220,0.9)', 'rgba(255,200,120,0.18)'), 520);
    core.position.copy(this.environment.sunDirection).multiplyScalar(9000);
    this.scene.add(core);
    this.flareCore = core;
    this.flareGhosts = [
      [sprite(make(128, 'rgba(125,211,252,0.5)', 'rgba(125,211,252,0.05)'), 0.16), 0.35],
      [sprite(make(128, 'rgba(246,178,107,0.45)', 'rgba(246,178,107,0.04)'), 0.26), 0.6],
      [sprite(make(128, 'rgba(184,216,234,0.4)', 'rgba(184,216,234,0.03)'), 0.1), 0.85],
    ];
    for (const [ghost] of this.flareGhosts) this.camera.add(ghost);
  }

  /** Places the flare ghosts on the line from the sun through the screen centre. */
  private updateFlare(): void {
    const sunNdc = this.environment.sunDirection.clone().multiplyScalar(9000).project(this.camera);
    const visible = sunNdc.z < 1 && Math.abs(sunNdc.x) < 1.6 && Math.abs(sunNdc.y) < 1.6;
    for (const [ghost, k] of this.flareGhosts) {
      ghost.visible = visible;
      if (!visible) continue;
      // Ghost at NDC = sun * (1 - 2k): passes through the centre and out the other side.
      const f = 1 - 2 * k;
      const depth = 2;
      const h = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * depth;
      ghost.position.set(sunNdc.x * f * h * this.camera.aspect, sunNdc.y * f * h, -depth);
      const fade = 1 - Math.min(1, Math.hypot(sunNdc.x, sunNdc.y) / 1.5);
      ghost.material.opacity = 0.9 * fade * this.environment.lighting().sunDisc;
    }
  }

  /**
   * Each wave turns the ring a little further: a new time of day and weather, blended in over
   * the countdown so the sky never snaps.
   */
  private syncAtmosphere(wave: number): void {
    if (wave === this.lastAtmosphereWave) return;
    this.lastAtmosphereWave = wave;
    this.environment.setAtmosphere(waveAtmosphere(wave), WAVE_COUNTDOWN);
  }

  /** Copies the environment's blended rig onto the lights, fog, exposure and sun flare. */
  private applyLighting(): void {
    const l = this.environment.lighting();
    if (this.sunLight) {
      this.sunLight.color.copy(l.sunColor);
      this.sunLight.intensity = l.sunIntensity;
      this.sunLight.position.copy(this.environment.sunDirection).multiplyScalar(120);
    }
    if (this.hemisphere) {
      this.hemisphere.color.copy(l.hemisphereSky);
      this.hemisphere.groundColor.copy(l.hemisphereGround);
      this.hemisphere.intensity = l.hemisphereIntensity;
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.environment.fogColor);
      this.scene.fog.density = l.fogDensity;
    }
    this.scene.environmentIntensity = l.environmentIntensity;
    this.renderer.toneMappingExposure = l.exposure;
    if (this.flareCore) {
      this.flareCore.position.copy(this.environment.sunDirection).multiplyScalar(9000);
      this.flareCore.material.opacity = l.sunDisc;
    }
  }

  private buildLights(): void {
    this.hemisphere = new THREE.HemisphereLight(0xbfd8f5, 0x3b4a3a, 0.55);
    this.scene.add(this.hemisphere);
    const sun = new THREE.DirectionalLight(this.environment.sunColor, 2.4);
    this.sunLight = sun;
    sun.position.copy(this.environment.sunDirection).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const extent = 40;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 300;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  private syncEnemies(enemies: readonly Enemy[], simTime: number): void {
    const seen = new Set<number>();
    for (const enemy of enemies) {
      seen.add(enemy.id);
      let rig = this.enemies.get(enemy.id);
      if (!rig) {
        rig = makeEnemyRig(enemy);
        this.enemies.set(enemy.id, rig);
        this.dynamic.add(rig.group);
      }
      const { group } = rig;
      group.position.set(enemy.position.x, enemy.position.y, enemy.position.z);
      group.rotation.y = enemy.yaw;
      if (enemy.state === 'spawning') {
        const t = THREE.MathUtils.clamp(1 - (enemy.activeAt - simTime), 0, 1);
        group.scale.setScalar(0.1 + 0.9 * t);
        group.position.y = enemy.position.y + (1 - t) * 6;
      } else if (enemy.state === 'dead' && enemy.diedAt !== null) {
        const t = Math.min(1, (simTime - enemy.diedAt) / CORPSE_LINGER);
        group.scale.set(1 + t * 0.3, Math.max(0.02, 1 - t * t), 1 + t * 0.3);
        group.rotation.x = t * 0.6;
      } else {
        group.scale.setScalar(1);
      }
      rig.animate(enemy, simTime);
    }
    for (const [id, rig] of this.enemies) {
      if (seen.has(id)) continue;
      this.dynamic.remove(rig.group);
      this.enemies.delete(id);
    }
  }

  private syncBolts(state: GameState, now: number): void {
    const seen = new Set<number>();
    for (const bolt of state.bolts) {
      seen.add(bolt.id);
      let group = this.bolts.get(bolt.id);
      if (!group) {
        group = new THREE.Group();
        const core = new THREE.Mesh(this.boltGeometry, this.boltMaterial);
        core.rotation.x = Math.PI / 2;
        const light = new THREE.PointLight(0xc084fc, 6, 7, 1.6);
        group.add(core, light);
        this.bolts.set(bolt.id, group);
        this.dynamic.add(group);
      }
      group.position.set(bolt.position.x, bolt.position.y, bolt.position.z);
      group.lookAt(
        bolt.position.x + bolt.direction.x,
        bolt.position.y + bolt.direction.y,
        bolt.position.z + bolt.direction.z,
      );
      this.particles.burst(
        {
          at: bolt.position,
          count: 2,
          color: 0xc084fc,
          colorEnd: 0x4c1d95,
          speed: 0.6,
          life: 0.35,
          size: 9,
        },
        now,
      );
    }
    for (const [id, group] of this.bolts) {
      if (seen.has(id)) continue;
      this.particles.burst(
        {
          at: { x: group.position.x, y: group.position.y, z: group.position.z },
          count: 30,
          color: 0xe9d5ff,
          colorEnd: 0x7c3aed,
          speed: 4,
          life: 0.4,
          size: 8,
          gravity: 6,
        },
        now,
      );
      this.dynamic.remove(group);
      this.bolts.delete(id);
    }
  }

  private syncGrenades(state: GameState, now: number): void {
    const seen = new Set<number>();
    for (const g of state.grenades) {
      seen.add(g.id);
      let mesh = this.grenades.get(g.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.grenadeGeometry, this.grenadeMaterial);
        mesh.castShadow = true;
        this.grenades.set(g.id, mesh);
        this.dynamic.add(mesh);
      }
      mesh.position.set(g.position.x, g.position.y + 0.15, g.position.z);
      mesh.rotation.x += 0.2;
      this.particles.burst(
        {
          at: g.position,
          count: 1,
          color: 0xbef264,
          colorEnd: 0x365314,
          speed: 0.3,
          life: 0.5,
          size: 6,
        },
        now,
      );
    }
    for (const [id, mesh] of this.grenades) {
      if (seen.has(id)) continue;
      this.dynamic.remove(mesh);
      this.grenades.delete(id);
    }
  }

  private spawnExplosion(at: Vec3, now: number): void {
    // A readable pop, not a whiteout: the flash stays under the bloom threshold and the light
    // is gone in a quarter second, so the frame survives at night as well as by day. A blast
    // under the player's feet (a launcher round, a bad grenade) is scaled down with distance so
    // the point light does not blind the camera.
    const near = THREE.MathUtils.clamp(toVector(at).distanceTo(this.camera.position) / 6, 0.2, 1);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.55 * near,
    });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), flashMaterial);
    flash.position.copy(toVector(at));
    const light = new THREE.PointLight(0xffb347, 140 * near, GRENADE_BLAST_RADIUS * 3, 1.4);
    flash.add(light);
    this.addEffect(flash, now, 0.35, (t) => {
      flash.scale.setScalar(0.4 + t * 2);
      flashMaterial.opacity = 0.55 * near * (1 - t) ** 2;
      light.intensity = 140 * near * Math.max(0, 1 - t / (0.25 / 0.35));
    });
    const waveMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const wave = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), waveMaterial);
    wave.position.set(at.x, 0.15, at.z);
    wave.rotation.x = -Math.PI / 2;
    this.addEffect(wave, now, 0.5, (t) => {
      wave.scale.setScalar(1 + t * GRENADE_BLAST_RADIUS * 1.6);
      waveMaterial.opacity = 0.5 * (1 - t);
    });
    this.particles.burst(
      {
        at,
        count: 130,
        color: 0xffd27a,
        colorEnd: 0xff3d00,
        speed: 11,
        life: 0.8,
        size: 16,
        gravity: 3,
        drag: 2.5,
      },
      now,
    );
    this.particles.burst(
      {
        at,
        count: 160,
        color: 0x4a4a4a,
        colorEnd: 0x111111,
        speed: 7,
        life: 1.6,
        size: 22,
        gravity: 1,
        drag: 1.2,
      },
      now,
    );
    this.particles.burst(
      {
        at,
        count: 90,
        color: 0xffe08a,
        colorEnd: 0xff6a00,
        speed: 16,
        life: 1.4,
        size: 5,
        gravity: 14,
        drag: 0.4,
      },
      now,
    );
  }

  private spawnDeath(at: Vec3, now: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 6, 32), material);
    ring.position.copy(toVector(at));
    ring.rotation.x = Math.PI / 2;
    this.addEffect(ring, now, 0.4, (t) => {
      ring.scale.setScalar(1 + t * 3.5);
      material.opacity = 0.5 * (1 - t);
    });
    this.particles.burst(
      {
        at,
        count: 70,
        color: 0xffd166,
        colorEnd: 0xb45309,
        speed: 6,
        life: 0.9,
        size: 6,
        gravity: 7,
        drag: 1,
      },
      now,
    );
    this.particles.burst(
      { at, count: 16, color: 0xffe9b0, colorEnd: 0xffa040, speed: 2, life: 0.5, size: 4 },
      now,
    );
  }

  private addEffect(
    object: THREE.Object3D,
    bornAt: number,
    life: number,
    update: (t: number) => void,
  ): void {
    this.dynamic.add(object);
    this.effects.push({ object, bornAt, life, update });
  }

  private updateEffects(now: number): void {
    this.effects = this.effects.filter((effect) => {
      const t = (now - effect.bornAt) / effect.life;
      if (t >= 1) {
        this.dynamic.remove(effect.object);
        return false;
      }
      effect.update(t);
      return true;
    });
  }

  /**
   * Dynamic resolution: a rolling one-second average of frame time steps the pixel ratio
   * down when the GPU falls behind and back up when it has headroom, so the game holds its
   * frame rate on an integrated GPU without a settings menu.
   */
  private adaptResolution(frameDt: number): void {
    if (frameDt <= 0) return;
    this.frameTimes.push(frameDt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (this.frameTimes.length < 30) return;
    const now = performance.now();
    if (now - this.lastDprChange < 2000) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const max = Math.min(window.devicePixelRatio, 2);
    let next = this.pixelRatio;
    if (avg > 0.022 && this.pixelRatio > 0.75) next = Math.max(0.75, this.pixelRatio - 0.25);
    else if (avg < 0.012 && this.pixelRatio < max) next = Math.min(max, this.pixelRatio + 0.25);
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.lastDprChange = now;
      this.renderer.setPixelRatio(next);
      this.resize();
      this.frameTimes = [];
    }
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height);
  }
}
