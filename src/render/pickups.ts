import * as THREE from 'three';
import type { GameEvent, GameState } from '../core/game';
import type { Pickup } from '../core/pickups';
import type { Vec3 } from '../core/vec3';
import type { WeaponKind } from '../core/weapon';
import type { ParticleSystem } from './particles';
import { WEAPON_ACCENT } from './weapons';

/**
 * Weapon pickups on the arena floor. Each is a kind-coloured emblem floating over a post on a
 * Beacon base ring, with a soft light and a 3 m light column so it reads from across the arena.
 * `sync` mirrors `state.pickups` every frame; `handle` plays the spawn and take flourishes.
 */

/** Seconds before `expiresAt` over which a pickup fades and shrinks. */
export const PICKUP_FADE = 3;
/** Height of the light column in metres. */
const COLUMN_HEIGHT = 3;
const COLUMN_OPACITY = 0.16;
const LIGHT_INTENSITY = 4;
const BEACON = 0x7dd3fc;

const EMBLEM_ICOSAHEDRON = new THREE.IcosahedronGeometry(0.28, 0);
const EMBLEM_RING = new THREE.TorusGeometry(0.24, 0.07, 8, 24);
const POST = new THREE.CylinderGeometry(0.035, 0.05, 0.55, 8);
const BASE = new THREE.TorusGeometry(0.5, 0.03, 6, 32);
const COLUMN = new THREE.CylinderGeometry(0.07, 0.07, COLUMN_HEIGHT, 12, 1, true);
const FLASH_RING = new THREE.RingGeometry(0.8, 1, 48);

const postMaterial = new THREE.MeshStandardMaterial({
  color: 0x30455c,
  roughness: 0.5,
  metalness: 0.7,
});

interface Entry {
  readonly group: THREE.Group;
  readonly emblem: THREE.Mesh;
  readonly emblemMaterial: THREE.MeshStandardMaterial;
  readonly columnMaterial: THREE.MeshBasicMaterial;
  readonly baseMaterial: THREE.MeshStandardMaterial;
  readonly light: THREE.PointLight;
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
    emissiveIntensity: 1.6,
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

  const columnMaterial = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: COLUMN_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const column = new THREE.Mesh(COLUMN, columnMaterial);
  column.position.y = COLUMN_HEIGHT / 2;

  const light = new THREE.PointLight(colour, LIGHT_INTENSITY, 6, 1.6);
  light.position.y = 0.9;

  group.add(emblem, post, base, column, light);
  return { group, emblem, emblemMaterial, columnMaterial, baseMaterial, light };
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
    entry.emblem.scale.setScalar(scale);
    entry.emblemMaterial.opacity = life;
    entry.baseMaterial.opacity = life;
    entry.columnMaterial.opacity = COLUMN_OPACITY * life;
    entry.light.intensity = LIGHT_INTENSITY * life * (0.85 + Math.sin(now * 4 + phase) * 0.15);
  }

  private onTaken(id: number, kind: WeaponKind, now: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const at: Vec3 = { x: entry.group.position.x, y: 0.9, z: entry.group.position.z };
    const colour = WEAPON_ACCENT[kind];
    this.particles.burst(
      {
        at,
        count: 90,
        color: colour,
        colorEnd: 0xffffff,
        speed: 5,
        life: 0.7,
        size: 9,
        gravity: 5,
      },
      now,
    );
    this.particles.burst(
      { at, count: 30, color: 0xffffff, colorEnd: colour, speed: 1.5, life: 0.4, size: 16 },
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
      dispose: () => material.dispose(),
    });
  }

  private remove(id: number, entry: Entry): void {
    this.parent.remove(entry.group);
    entry.emblemMaterial.dispose();
    entry.columnMaterial.dispose();
    entry.baseMaterial.dispose();
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
