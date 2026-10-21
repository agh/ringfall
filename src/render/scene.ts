import * as THREE from 'three';
import { ENEMY_STATS, type Enemy } from '../core/enemy';
import { CORPSE_LINGER, type GameEvent, type GameState, playerEye } from '../core/game';
import { GRENADE_BLAST_RADIUS } from '../core/grenade';
import type { Vec3 } from '../core/vec3';
import type { Arena } from '../core/world';

const SKY = 0x0b1a2e;
const FOG_NEAR = 45;
const FOG_FAR = 170;

interface Effect {
  readonly object: THREE.Object3D;
  readonly bornAt: number;
  readonly life: number;
  readonly update: (t: number) => void;
}

const toVector = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);

const makeGroundTexture = (): THREE.Texture => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1b2a3a';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const p = (size / 4) * i;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

/** Owns the Three.js scene graph and mirrors immutable game state into it every frame. */
export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world = new THREE.Group();
  private readonly dynamic = new THREE.Group();
  private readonly viewmodel = new THREE.Group();
  private readonly muzzleLight: THREE.PointLight;
  private readonly enemies = new Map<number, THREE.Group>();
  private readonly bolts = new Map<number, THREE.Mesh>();
  private readonly grenades = new Map<number, THREE.Mesh>();
  private effects: Effect[] = [];
  private recoil = 0;
  private shake = 0;
  private arenaBuilt: Arena | null = null;

  private readonly enemyGeometry = {
    skimmer: new THREE.IcosahedronGeometry(0.55, 1),
    strider: new THREE.CapsuleGeometry(0.6, 1.4, 4, 12),
  } as const;
  private readonly boltGeometry = new THREE.SphereGeometry(0.18, 8, 8);
  private readonly grenadeGeometry = new THREE.SphereGeometry(0.15, 10, 10);
  private readonly boltMaterial = new THREE.MeshBasicMaterial({ color: 0xc084fc });
  private readonly grenadeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9acd32,
    emissive: 0x3f6212,
    roughness: 0.4,
  });

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 4000);
    this.camera.rotation.order = 'YXZ';
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR);
    this.scene.add(this.world, this.dynamic);
    this.muzzleLight = new THREE.PointLight(0xffe9a8, 0, 8);
    this.buildSky();
    this.buildLights();
    this.buildViewmodel();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** (Re)builds the static arena when a new game starts. */
  setArena(arena: Arena): void {
    if (this.arenaBuilt === arena) return;
    this.arenaBuilt = arena;
    this.world.clear();
    const size = arena.halfSize * 2;
    const groundTexture = makeGroundTexture();
    groundTexture.repeat.set(size / 4, size / 4);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.9, metalness: 0.1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.world.add(ground);

    // Faded outer field so the arena edge reads as a cliff rather than a hard cut.
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(arena.halfSize * 1.42, 400, 48),
      new THREE.MeshStandardMaterial({ color: 0x101c2a, roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.4;
    this.world.add(outer);

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x27405a,
      roughness: 0.6,
      metalness: 0.3,
      transparent: true,
      opacity: 0.35,
    });
    const wallGeometry = new THREE.BoxGeometry(size + 0.5, 3, 0.25);
    for (const [x, z, rot] of [
      [0, -arena.halfSize, 0],
      [0, arena.halfSize, 0],
      [-arena.halfSize, 0, Math.PI / 2],
      [arena.halfSize, 0, Math.PI / 2],
    ] as const) {
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(x, 1.5, z);
      wall.rotation.y = rot;
      this.world.add(wall);
    }

    const coverMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b5775,
      roughness: 0.55,
      metalness: 0.35,
    });
    const trimMaterial = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });
    for (const box of arena.obstacles) {
      const w = box.max.x - box.min.x;
      const h = box.max.y - box.min.y;
      const d = box.max.z - box.min.z;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), coverMaterial);
      mesh.position.set((box.min.x + box.max.x) / 2, h / 2, (box.min.z + box.max.z) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.world.add(mesh);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.06, d + 0.04), trimMaterial);
      trim.position.set(mesh.position.x, h, mesh.position.z);
      this.world.add(trim);
    }
  }

  handle(events: readonly GameEvent[], now: number): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          this.recoil = 1;
          this.muzzleLight.intensity = 40;
          this.spawnTracer(e.from, e.to, now);
          break;
        case 'explosion':
          this.spawnExplosion(e.at, now);
          this.shake = Math.max(this.shake, 0.6);
          break;
        case 'enemyKilled':
          this.spawnBurst(e.at, now);
          break;
        case 'playerDamaged':
          this.shake = Math.max(this.shake, 0.25);
          break;
      }
    }
  }

  render(state: GameState, now: number, frameDt: number): void {
    this.setArena(state.arena);
    this.syncEnemies(state.enemies, state.time);
    this.syncBolts(state);
    this.syncGrenades(state);
    this.updateEffects(now);

    const eye = playerEye(state.player);
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(state.player.pitch, state.player.yaw, 0);
    if (this.shake > 0) {
      this.camera.rotation.z = (Math.random() - 0.5) * 0.02 * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * 0.04 * this.shake;
      this.shake = Math.max(0, this.shake - frameDt * 2.5);
    }
    this.recoil = Math.max(0, this.recoil - frameDt * 12);
    this.viewmodel.position.z = -0.55 + this.recoil * 0.08;
    this.viewmodel.rotation.x = this.recoil * 0.06;
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - frameDt * 600);
    this.renderer.render(this.scene, this.camera);
  }

  private buildSky(): void {
    // The signature silhouette: a ringworld arc standing on the horizon, beyond the fog.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(900, 42, 10, 160),
      new THREE.MeshBasicMaterial({ color: 0x6c8fb3, fog: false }),
    );
    ring.position.set(0, 140, -1900);
    ring.rotation.y = 0.25;
    this.scene.add(ring);
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(900, 12, 6, 160),
      new THREE.MeshBasicMaterial({ color: 0x9fd8ff, fog: false }),
    );
    band.position.copy(ring.position);
    band.position.z -= 30;
    band.rotation.copy(ring.rotation);
    this.scene.add(band);

    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(380, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0x2a3e63, fog: false }),
    );
    planet.position.set(1300, 260, -2300);
    this.scene.add(planet);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(60, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff1c4, fog: false }),
    );
    sun.position.set(-1400, 900, -1800);
    this.scene.add(sun);

    const starGeometry = new THREE.BufferGeometry();
    const stars = new Float32Array(1200 * 3);
    for (let i = 0; i < 1200; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9 + 0.1);
      const r = 3200;
      stars[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      stars[i * 3 + 1] = r * Math.cos(phi);
      stars[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    this.scene.add(
      new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({ color: 0xdff6ff, size: 3, sizeAttenuation: false, fog: false }),
      ),
    );
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x1a2436, 1.3));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    // Light from behind-right of the spawn point so the cover faces the player sees are lit.
    sun.position.set(35, 60, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const extent = 36;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  private buildViewmodel(): void {
    const body = new THREE.MeshStandardMaterial({
      color: 0x5b6b7c,
      roughness: 0.5,
      metalness: 0.6,
    });
    const accent = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.5), body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 10), body);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.4);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.12), accent);
    sight.position.set(0, 0.085, -0.05);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), body);
    grip.position.set(0, -0.12, 0.1);
    grip.rotation.x = 0.25;
    this.viewmodel.add(receiver, barrel, sight, grip);
    this.viewmodel.position.set(0.28, -0.24, -0.55);
    this.muzzleLight.position.set(0, 0.03, -0.65);
    this.viewmodel.add(this.muzzleLight);
    this.camera.add(this.viewmodel);
    this.scene.add(this.camera);
  }

  private makeEnemy(enemy: Enemy): THREE.Group {
    const group = new THREE.Group();
    const stats = ENEMY_STATS[enemy.kind];
    const material = new THREE.MeshStandardMaterial({
      color: enemy.kind === 'skimmer' ? 0xb45309 : 0x7f1d1d,
      emissive: enemy.kind === 'skimmer' ? 0x7c2d12 : 0x450a0a,
      roughness: 0.4,
      metalness: 0.5,
    });
    const body = new THREE.Mesh(this.enemyGeometry[enemy.kind], material);
    body.castShadow = true;
    body.position.y = stats.height / 2;
    if (enemy.kind === 'skimmer') body.scale.set(1, 0.55, 1);
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(enemy.kind === 'skimmer' ? 0.14 : 0.2, 10, 10),
      new THREE.MeshBasicMaterial({ color: enemy.kind === 'skimmer' ? 0xfde68a : 0xf87171 }),
    );
    eye.position.set(
      0,
      stats.height * (enemy.kind === 'skimmer' ? 0.5 : 0.78),
      -stats.radius * 0.9,
    );
    const glow = new THREE.PointLight(enemy.kind === 'skimmer' ? 0xfbbf24 : 0xf87171, 1.2, 6);
    glow.position.copy(eye.position);
    group.add(body, eye, glow);
    return group;
  }

  private syncEnemies(enemies: readonly Enemy[], simTime: number): void {
    const seen = new Set<number>();
    for (const enemy of enemies) {
      seen.add(enemy.id);
      let group = this.enemies.get(enemy.id);
      if (!group) {
        group = this.makeEnemy(enemy);
        this.enemies.set(enemy.id, group);
        this.dynamic.add(group);
      }
      group.position.set(enemy.position.x, enemy.position.y, enemy.position.z);
      group.rotation.y = enemy.yaw;
      if (enemy.state === 'spawning') {
        const t = Math.max(0, Math.min(1, 1 - (enemy.activeAt - simTime)));
        group.scale.setScalar(0.1 + 0.9 * t);
        group.position.y = enemy.position.y + (1 - t) * 3;
      } else if (enemy.state === 'dead' && enemy.diedAt !== null) {
        const t = Math.min(1, (simTime - enemy.diedAt) / CORPSE_LINGER);
        group.scale.set(1 + t * 0.4, Math.max(0.02, 1 - t), 1 + t * 0.4);
      } else {
        group.scale.setScalar(1);
        if (enemy.kind === 'skimmer')
          group.position.y += 0.35 + Math.sin(simTime * 6 + enemy.id) * 0.12;
      }
    }
    for (const [id, group] of this.enemies) {
      if (seen.has(id)) continue;
      this.dynamic.remove(group);
      this.enemies.delete(id);
    }
  }

  private syncBolts(state: GameState): void {
    const seen = new Set<number>();
    for (const bolt of state.bolts) {
      seen.add(bolt.id);
      let mesh = this.bolts.get(bolt.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.boltGeometry, this.boltMaterial);
        this.bolts.set(bolt.id, mesh);
        this.dynamic.add(mesh);
      }
      mesh.position.set(bolt.position.x, bolt.position.y, bolt.position.z);
    }
    for (const [id, mesh] of this.bolts) {
      if (seen.has(id)) continue;
      this.dynamic.remove(mesh);
      this.bolts.delete(id);
    }
  }

  private syncGrenades(state: GameState): void {
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
    }
    for (const [id, mesh] of this.grenades) {
      if (seen.has(id)) continue;
      this.dynamic.remove(mesh);
      this.grenades.delete(id);
    }
  }

  private spawnTracer(from: Vec3, to: Vec3, now: number): void {
    // Start the tracer a little ahead of the muzzle so it does not cut across the viewmodel.
    const start = toVector(from).lerp(toVector(to), 0.03);
    const geometry = new THREE.BufferGeometry().setFromPoints([start, toVector(to)]);
    const material = new THREE.LineBasicMaterial({
      color: 0xfff3b0,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geometry, material);
    this.addEffect(line, now, 0.07, (t) => {
      material.opacity = 0.9 * (1 - t);
    });
    const impact = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 }),
    );
    impact.position.copy(toVector(to));
    this.addEffect(impact, now, 0.1, (t) => impact.scale.setScalar(1 + t * 2));
  }

  private spawnExplosion(at: Vec3, now: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.85,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material);
    sphere.position.copy(toVector(at));
    const light = new THREE.PointLight(0xffb347, 300, GRENADE_BLAST_RADIUS * 2.5);
    sphere.add(light);
    this.addEffect(sphere, now, 0.45, (t) => {
      sphere.scale.setScalar(0.3 + t * GRENADE_BLAST_RADIUS);
      material.opacity = 0.85 * (1 - t) ** 1.5;
      light.intensity = 300 * (1 - t);
    });
  }

  private spawnBurst(at: Vec3, now: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 1,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.08, 6, 24), material);
    ring.position.copy(toVector(at));
    ring.rotation.x = Math.PI / 2;
    this.addEffect(ring, now, 0.35, (t) => {
      ring.scale.setScalar(1 + t * 3);
      material.opacity = 1 - t;
    });
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

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
