import * as THREE from 'three';
import type { GameEvent, GameState } from '../core/game';
import type { Pickup } from '../core/pickups';
import type { Vec3 } from '../core/vec3';
import type { WeaponKind } from '../core/weapon';
import type { ParticleSystem } from './particles';
import { WEAPON_ACCENT } from './weapons';

/**
 * Weapon pickups on the arena floor. Each is a kind-coloured emblem floating over a post on a
 * Beacon base ring, with a billboard halo and a short column whose alpha fades to nothing by
 * `COLUMN_HEIGHT` up, so it reads from across the arena without a light of its own. No pickup
 * carries a `PointLight`: the scene's light count is the same before and after a spawn, so no
 * material is recompiled when one lands.
 * `sync` mirrors `state.pickups` every frame; `handle` plays the spawn and take flourishes.
 */

/** Seconds before `expiresAt` over which a pickup fades and shrinks. */
export const PICKUP_FADE = 3;
/** Height of the light column in metres; its alpha is zero at the top. */
export const COLUMN_HEIGHT = 2;
/** Column alpha at the floor; the gradient falls off with the square of the height. */
const COLUMN_OPACITY = 0.5;
/** Glow sprite diameter in metres: wide enough to be a few pixels at 40 m. */
const HALO_SIZE = 1.6;
const HALO_OPACITY = 0.55;
/** Emissive strength of the emblem in linear radiance; above the bloom threshold (1.25). */
const EMBLEM_GLOW = 2.4;
const BEACON = 0x7dd3fc;

const EMBLEM_ICOSAHEDRON = new THREE.IcosahedronGeometry(0.28, 0);
const EMBLEM_RING = new THREE.TorusGeometry(0.24, 0.07, 8, 24);
const POST = new THREE.CylinderGeometry(0.035, 0.05, 0.55, 8);
const BASE = new THREE.TorusGeometry(0.5, 0.03, 6, 32);
const COLUMN = new THREE.CylinderGeometry(0.09, 0.14, COLUMN_HEIGHT, 12, 1, true);
const FLASH_RING = new THREE.RingGeometry(0.8, 1, 48);

const postMaterial = new THREE.MeshStandardMaterial({
  color: 0x30455c,
  roughness: 0.5,
  metalness: 0.7,
});

/**
 * A radial falloff in a data texture rather than a canvas, so this module never touches the DOM.
 * Alpha is `(1 - r)^2`: soft at the rim, a small bright core, no hard disc edge.
 */
const makeHaloTexture = (): THREE.DataTexture => {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = (1 - r) * (1 - r);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
};
const HALO_TEXTURE = makeHaloTexture();

/** The column's vertex shader passes the cylinder's `uv.y` (0 at the floor, 1 at the top). */
const COLUMN_VERTEX = /* glsl */ `
  varying float vHeight;
  void main() {
    vHeight = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
/** Alpha gradient `(1 - h)^2`: half the opacity by a quarter of the height, zero at the top. */
const COLUMN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vHeight;
  void main() {
    float fade = (1.0 - vHeight) * (1.0 - vHeight);
    gl_FragColor = vec4(uColor, uOpacity * fade);
  }
`;

/**
 * A pickup's materials are its own (each fades on its own clock) and are kept, not disposed,
 * when it goes: none owns a texture of its own, and three.js deletes a shader program when the
 * last material on it is disposed, so taking the only pickup on the floor threw away four
 * programs (emblem, base, column, halo) that the next spawn compiled again, a hitch of several
 * frames. See the note on `Effect` in `weapons.ts`.
 */
interface Entry {
  readonly group: THREE.Group;
  readonly emblem: THREE.Mesh;
  readonly emblemMaterial: THREE.MeshStandardMaterial;
  readonly columnMaterial: THREE.ShaderMaterial;
  /** The column's `uOpacity` uniform, held directly so `animate` never looks it up by name. */
  readonly columnOpacity: THREE.IUniform<number>;
  readonly baseMaterial: THREE.MeshStandardMaterial;
  readonly haloMaterial: THREE.SpriteMaterial;
}

interface Effect {
  readonly object: THREE.Object3D;
  readonly bornAt: number;
  readonly life: number;
  readonly update: (t: number) => void;
  readonly dispose: () => void;
}

const buildEntry = (pickup: Pickup): Entry => {
  const colour = WEAPON_ACCENT[pickup.kind];
  const group = new THREE.Group();
  group.position.set(pickup.position.x, 0, pickup.position.z);

  const emblemMaterial = new THREE.MeshStandardMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: EMBLEM_GLOW,
    roughness: 0.3,
    metalness: 0.5,
    flatShading: true,
    transparent: true,
  });
  const emblem = new THREE.Mesh(
    pickup.kind === 'beam' ? EMBLEM_RING : EMBLEM_ICOSAHEDRON,
    emblemMaterial,
  );
  emblem.castShadow = true;
  emblem.position.y = 0.95;

  const post = new THREE.Mesh(POST, postMaterial);
  post.position.y = 0.3;
  post.castShadow = true;

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: BEACON,
    emissive: BEACON,
    emissiveIntensity: 1.4,
    transparent: true,
  });
  const base = new THREE.Mesh(BASE, baseMaterial);
  base.rotation.x = Math.PI / 2;
  base.position.y = 0.04;

  const columnOpacity: THREE.IUniform<number> = { value: COLUMN_OPACITY };
  const columnMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colour) },
      uOpacity: columnOpacity,
    },
    vertexShader: COLUMN_VERTEX,
    fragmentShader: COLUMN_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const column = new THREE.Mesh(COLUMN, columnMaterial);
  column.position.y = COLUMN_HEIGHT / 2;

  const haloMaterial = new THREE.SpriteMaterial({
    map: HALO_TEXTURE,
    color: colour,
    transparent: true,
    opacity: HALO_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.scale.setScalar(HALO_SIZE);
  halo.position.y = 0.95;

  group.add(emblem, post, base, column, halo);
  return {
    group,
    emblem,
    emblemMaterial,
    columnMaterial,
    columnOpacity,
    baseMaterial,
    haloMaterial,
  };
};

export class PickupMeshes {
  private readonly parent: THREE.Group;
  private readonly particles: ParticleSystem;
  private readonly entries = new Map<number, Entry>();
  private effects: Effect[] = [];

  constructor(parent: THREE.Group, particles: ParticleSystem) {
    this.parent = parent;
    this.particles = particles;
  }

  /** Mirrors `state.pickups`: creates, animates, fades and removes meshes. `now` is render seconds. */
  sync(state: GameState, now: number): void {
    const seen = new Set<number>();
    for (const pickup of state.pickups) {
      seen.add(pickup.id);
      let entry = this.entries.get(pickup.id);
      if (!entry) {
        entry = buildEntry(pickup);
        this.entries.set(pickup.id, entry);
        this.parent.add(entry.group);
      }
      this.animate(entry, pickup, state.time, now);
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.remove(id, entry);
    }
    this.tickEffects(now);
  }

  handle(events: readonly GameEvent[], now: number): void {
    for (const e of events) {
      if (e.type === 'pickupSpawned') this.flashRing(e.at, WEAPON_ACCENT[e.kind], now, 0.6);
      if (e.type === 'pickupTaken') this.onTaken(e.id, e.kind, now);
    }
  }

  private animate(entry: Entry, pickup: Pickup, simTime: number, now: number): void {
    const phase = pickup.id * 1.7;
    entry.emblem.position.y = 0.95 + Math.sin(now * 2.2 + phase) * 0.08;
    entry.emblem.rotation.y = now * 1.3 + phase;
    entry.emblem.rotation.x = pickup.kind === 'beam' ? Math.PI / 2 : 0.35;
    const life = THREE.MathUtils.clamp((pickup.expiresAt - simTime) / PICKUP_FADE, 0, 1);
    const scale = 0.3 + 0.7 * life;
    const pulse = 0.85 + Math.sin(now * 4 + phase) * 0.15;
    entry.emblem.scale.setScalar(scale);
    entry.emblemMaterial.opacity = life;
    entry.emblemMaterial.emissiveIntensity = EMBLEM_GLOW * pulse;
    entry.baseMaterial.opacity = life;
    entry.columnOpacity.value = COLUMN_OPACITY * life * pulse;
    entry.haloMaterial.opacity = HALO_OPACITY * life * pulse;
  }

  private onTaken(id: number, kind: WeaponKind, now: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const at: Vec3 = { x: entry.group.position.x, y: 0.9, z: entry.group.position.z };
    const colour = WEAPON_ACCENT[kind];
    // The player is inside two metres of a pickup when it is taken, so these motes sit on the
    // near fade; sizes under 1 keep each under the 64 px cap once they have flown clear of it.
    this.particles.burst(
      {
        at,
        count: 90,
        color: colour,
        colorEnd: 0xffffff,
        speed: 5,
        life: 0.7,
        size: 0.6,
        gravity: 5,
      },
      now,
    );
    this.particles.burst(
      { at, count: 30, color: 0xffffff, colorEnd: colour, speed: 1.5, life: 0.4, size: 0.9 },
      now,
    );
    this.flashRing(at, colour, now, 0.45);
    this.remove(id, entry);
  }

  /** A ground ring in `colour` that expands and fades: the spawn and take punctuation. */
  private flashRing(at: Vec3, colour: number, now: number, life: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(FLASH_RING, material);
    mesh.position.set(at.x, 0.12, at.z);
    mesh.rotation.x = -Math.PI / 2;
    this.parent.add(mesh);
    this.effects.push({
      object: mesh,
      bornAt: now,
      life,
      update: (t) => {
        mesh.scale.setScalar(0.5 + t * 3);
        material.opacity = 0.8 * (1 - t);
      },
      dispose: () => {},
    });
  }

  private remove(id: number, entry: Entry): void {
    this.parent.remove(entry.group);
    this.entries.delete(id);
  }

  private tickEffects(now: number): void {
    this.effects = this.effects.filter((effect) => {
      const t = (now - effect.bornAt) / effect.life;
      if (t >= 1) {
        this.parent.remove(effect.object);
        effect.dispose();
        return false;
      }
      effect.update(Math.max(0, t));
      return true;
    });
  }
}
