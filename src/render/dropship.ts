import * as THREE from 'three';
import type { GameEvent } from '../core/game';
import type { Vec3 } from '../core/vec3';
import { DROP_POD_LEAD } from '../core/waves';
import { ARENA_HALF_SIZE } from '../core/world';
import type { LightPool } from './lights';

/**
 * The dropship moment: a dark craft crosses the arena when a wave's first pod launches, and each
 * `dropPod` falls from its path to the pod's landing point over the lead the simulation gives it.
 * Presentation only: the simulation already placed and timed the enemy, this module draws how it
 * got there. Hostile palette per `docs/brand.md`: Hull body, Rose underlight, no Beacon anywhere.
 * The craft's and the pods' point lights come from the scene's `LightPool`, so a wave start
 * never changes the scene's light count (see `src/render/lights.ts`).
 */

/** Seconds the craft takes to cross from beyond one wall to beyond the other. */
export const CRAFT_FLIGHT_SECONDS = 4;
/** Altitude of the craft's path over the spawn ring, in metres. */
export const CRAFT_ALTITUDE = 14;
/** Metres beyond the arena wall where the craft enters and leaves. */
const CRAFT_OVERSHOOT = 12;
/** Seconds the landing dust ring takes to spread and fade. */
const DUST_SECONDS = 0.7;
/** Seconds a landed pod stays on the ground before it is removed. */
const POD_LINGER = 1.2;

/** `docs/brand.md` tokens written as literals because materials cannot read CSS variables. */
const HULL = 0x101f36;
const ROSE = 0xfb7185;
const SLATE = 0x8aa0b8;

const hullMaterial = new THREE.MeshStandardMaterial({
  color: HULL,
  emissive: 0x05090f,
  roughness: 0.55,
  metalness: 0.7,
  flatShading: true,
});
const roseGlow = new THREE.MeshBasicMaterial({ color: ROSE });
const podMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a1016,
  emissive: 0x2a0a10,
  roughness: 0.5,
  metalness: 0.6,
  flatShading: true,
});

const CRAFT_BODY = new THREE.BoxGeometry(9, 1.6, 4);
const CRAFT_PROW = new THREE.ConeGeometry(1.4, 4, 5);
const CRAFT_WING = new THREE.BoxGeometry(2.4, 0.3, 14);
const CRAFT_UNDERLIGHT = new THREE.PlaneGeometry(5, 1.2);
const POD_BODY = new THREE.CapsuleGeometry(0.45, 0.9, 4, 10);
const POD_BAND = new THREE.TorusGeometry(0.47, 0.05, 6, 24);
const DUST_RING = new THREE.TorusGeometry(1, 0.08, 6, 36);

interface Craft {
  readonly group: THREE.Group;
  readonly light: THREE.PointLight | null;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly startedAt: number;
}

interface Pod {
  readonly group: THREE.Group;
  readonly light: THREE.PointLight | null;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly launchedAt: number;
  readonly landsAt: number;
  landed: boolean;
}

interface Dust {
  readonly mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly startedAt: number;
}

const makeCraft = (): THREE.Group => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(CRAFT_BODY, hullMaterial);
  body.castShadow = true;
  const prow = new THREE.Mesh(CRAFT_PROW, hullMaterial);
  prow.rotation.x = -Math.PI / 2;
  prow.position.z = -6;
  const left = new THREE.Mesh(CRAFT_WING, hullMaterial);
  left.position.set(-5.2, 0.2, 1);
  left.rotation.z = 0.12;
  const right = new THREE.Mesh(CRAFT_WING, hullMaterial);
  right.position.set(5.2, 0.2, 1);
  right.rotation.z = -0.12;
  const underlight = new THREE.Mesh(CRAFT_UNDERLIGHT, roseGlow);
  underlight.rotation.x = Math.PI / 2;
  underlight.position.y = -0.81;
  group.add(body, prow, left, right, underlight);
  return group;
};

const makePod = (): THREE.Group => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(POD_BODY, podMaterial);
  body.castShadow = true;
  const band = new THREE.Mesh(POD_BAND, roseGlow);
  band.rotation.x = Math.PI / 2;
  band.position.y = -0.2;
  group.add(body, band);
  return group;
};

/**
 * The craft's chord: in over the wall behind the first pod, over that pod and the arena centre,
 * out past the far wall. Crossing the middle keeps it in view from anywhere on the floor.
 */
const craftChord = (at: Vec3): { from: THREE.Vector3; to: THREE.Vector3 } => {
  const radial = new THREE.Vector2(at.x, at.z);
  if (radial.lengthSq() < 1) radial.set(1, 0);
  radial.normalize();
  const reach = ARENA_HALF_SIZE + CRAFT_OVERSHOOT;
  const from = new THREE.Vector3(radial.x * reach, CRAFT_ALTITUDE, radial.y * reach);
  const to = new THREE.Vector3(-radial.x * reach, CRAFT_ALTITUDE, -radial.y * reach);
  return { from, to };
};

export class Dropship {
  private craft: Craft | null = null;
  private readonly pods: Pod[] = [];
  private readonly dust: Dust[] = [];

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly lights: LightPool,
  ) {}

  handle(events: readonly GameEvent[], now: number): void {
    for (const e of events) {
      if (e.type !== 'dropPod') continue;
      if (!this.craft) this.launchCraft(e.at, now);
      this.launchPod(e.at, now);
    }
  }

  update(now: number): void {
    this.updateCraft(now);
    this.updatePods(now);
    this.updateDust(now);
  }

  private launchCraft(at: Vec3, now: number): void {
    const { from, to } = craftChord(at);
    const group = makeCraft();
    group.position.copy(from);
    group.lookAt(to);
    this.parent.add(group);
    const light = this.lights.acquire(group, ROSE, 60, 30, 1.6);
    if (light) light.position.y = -1.2;
    this.craft = { group, light, from, to, startedAt: now };
  }

  private launchPod(at: Vec3, now: number): void {
    const group = makePod();
    const to = new THREE.Vector3(at.x, at.y, at.z);
    const from = new THREE.Vector3(at.x, CRAFT_ALTITUDE - 1.5, at.z);
    group.position.copy(from);
    this.parent.add(group);
    this.pods.push({
      group,
      light: this.lights.acquire(group, ROSE, 6, 8, 1.6),
      from,
      to,
      launchedAt: now,
      landsAt: now + DROP_POD_LEAD,
      landed: false,
    });
  }

  private updateCraft(now: number): void {
    const craft = this.craft;
    if (!craft) return;
    const t = (now - craft.startedAt) / CRAFT_FLIGHT_SECONDS;
    if (t >= 1) {
      this.lights.release(craft.light);
      this.parent.remove(craft.group);
      this.craft = null;
      return;
    }
    // Ease in and out so the craft hangs over the ring while the pods leave it.
    const eased = t * t * (3 - 2 * t);
    craft.group.position.lerpVectors(craft.from, craft.to, eased);
    // A shallow dip at mid-arc: the craft sinks toward the ring, then climbs out.
    craft.group.position.y = CRAFT_ALTITUDE - Math.sin(t * Math.PI) * 2.5;
    craft.group.rotation.z = Math.sin(t * Math.PI * 2) * 0.08;
  }

  private updatePods(now: number): void {
    for (let i = this.pods.length - 1; i >= 0; i -= 1) {
      const pod = this.pods[i];
      if (!pod) continue;
      const t = THREE.MathUtils.clamp((now - pod.launchedAt) / DROP_POD_LEAD, 0, 1);
      if (t < 1) {
        // Falls under gravity-like acceleration: slow off the rail, fast into the ground.
        const fall = t * t;
        pod.group.position.lerpVectors(pod.from, pod.to, fall);
        pod.group.position.y += 0.6 * (1 - fall);
        pod.group.rotation.y = t * 3;
        continue;
      }
      if (!pod.landed) {
        pod.landed = true;
        pod.group.position.copy(pod.to);
        pod.group.position.y += 0.6;
        this.spawnDust(pod.to, now);
      }
      // Sink into the ground after the enemy has stood up out of it.
      const since = now - pod.landsAt;
      pod.group.position.y = pod.to.y + 0.6 - since * 0.8;
      if (since > POD_LINGER) {
        this.lights.release(pod.light);
        this.parent.remove(pod.group);
        this.pods.splice(i, 1);
      }
    }
  }

  private spawnDust(at: THREE.Vector3, now: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: SLATE,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(DUST_RING, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(at.x, at.y + 0.08, at.z);
    this.parent.add(mesh);
    this.dust.push({ mesh, startedAt: now });
  }

  private updateDust(now: number): void {
    for (let i = this.dust.length - 1; i >= 0; i -= 1) {
      const dust = this.dust[i];
      if (!dust) continue;
      const t = (now - dust.startedAt) / DUST_SECONDS;
      if (t >= 1) {
        this.parent.remove(dust.mesh);
        dust.mesh.material.dispose();
        this.dust.splice(i, 1);
        continue;
      }
      const radius = 0.6 + t * 3.2;
      dust.mesh.scale.set(radius, radius, 1);
      dust.mesh.material.opacity = 0.8 * (1 - t) * (1 - t);
    }
  }
}
