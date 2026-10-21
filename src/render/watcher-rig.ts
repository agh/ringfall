import * as THREE from 'three';
import type { Enemy } from '../core/enemy';
import type { GameEvent } from '../core/game';
import type { Vec3 } from '../core/vec3';
import {
  WATCHER_BEAM_DURATION,
  WATCHER_STATS,
  watcherChargeProgress,
  watcherLens,
} from '../core/watcher';
import type { EnemyRig } from './enemies';

/**
 * The watcher rig: a tall, thin tripod with one Rose lens on top. The silhouette is vertical
 * and narrow (height over width above 2.5, see tests/unit/watcher-rig.test.ts) so it reads
 * against the strider's broader four-legged frame at 40 m. Telegraph: the lens brightens from
 * Rose to white and swells over the charge, visible from any angle because the lens is a sphere
 * above everything else on the rig; the aiming line is drawn by `WatcherBeamLayer`.
 */
/** Rose from the palette in docs/brand.md: the threat colour, so the lens is hostile at a glance. */
const ROSE = 0xfb7185;
const LENS_RADIUS = 0.22;
const LEG_SPREAD = 0.55;
const WATCHER_LEG = new THREE.CylinderGeometry(0.04, 0.07, WATCHER_STATS.height * 0.72, 6);
const WATCHER_MAST = new THREE.CylinderGeometry(0.06, 0.09, WATCHER_STATS.height * 0.3, 6);
const WATCHER_HEAD = new THREE.OctahedronGeometry(0.3, 0);
const WATCHER_LENS = new THREE.SphereGeometry(LENS_RADIUS, 14, 14);
const WATCHER_COLLAR = new THREE.TorusGeometry(0.28, 0.03, 6, 24);

// The strider's shell and joint values, so the two walkers read as one maker.
const watcherShell = new THREE.MeshStandardMaterial({
  color: 0x5b1a24,
  emissive: 0x1a0308,
  roughness: 0.5,
  metalness: 0.7,
  flatShading: true,
});
const watcherJoint = new THREE.MeshStandardMaterial({
  color: 0x2b2b33,
  roughness: 0.6,
  metalness: 0.8,
});
const collarMaterial = new THREE.MeshStandardMaterial({
  color: ROSE,
  emissive: ROSE,
  emissiveIntensity: 0.8,
  roughness: 0.4,
  metalness: 0.5,
});

const lensColor = new THREE.Color();
const rose = new THREE.Color(ROSE);
const white = new THREE.Color(0xffffff);

export const makeWatcherRig = (): EnemyRig => {
  const group = new THREE.Group();
  const { height } = WATCHER_STATS;
  const hip = new THREE.Group();
  hip.position.y = height * 0.62;
  const legs: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const leg = new THREE.Mesh(WATCHER_LEG, watcherJoint);
    leg.castShadow = true;
    leg.position.set(
      Math.cos(angle) * LEG_SPREAD * 0.5,
      -height * 0.26,
      Math.sin(angle) * LEG_SPREAD * 0.5,
    );
    leg.rotation.z = -Math.cos(angle) * 0.22;
    leg.rotation.x = Math.sin(angle) * 0.22;
    hip.add(leg);
    legs.push(leg);
  }
  const mast = new THREE.Mesh(WATCHER_MAST, watcherShell);
  mast.castShadow = true;
  mast.position.y = height * 0.13;
  const head = new THREE.Mesh(WATCHER_HEAD, watcherShell);
  head.castShadow = true;
  head.position.y = height * 0.28;
  head.scale.set(1, 1.3, 1);
  const collar = new THREE.Mesh(WATCHER_COLLAR, collarMaterial);
  collar.position.y = height * 0.2;
  collar.rotation.x = Math.PI / 2;
  const lensMaterial = new THREE.MeshBasicMaterial({ color: ROSE });
  const lens = new THREE.Mesh(WATCHER_LENS, lensMaterial);
  lens.position.y = height * 0.9 - hip.position.y;
  const light = new THREE.PointLight(ROSE, 2, 10, 1.5);
  light.position.copy(lens.position);
  hip.add(mast, head, collar, lens, light);
  group.add(hip);
  return {
    group,
    animate: (enemy, t) => {
      const charge = watcherChargeProgress(enemy, t);
      const walking = enemy.state === 'chase' ? 1 : 0;
      legs.forEach((leg, i) => {
        leg.rotation.y = Math.sin(t * 2.5 + i * 2.1) * 0.08 * walking;
      });
      hip.position.y = height * 0.62 + Math.sin(t * 1.5 + enemy.id) * 0.05;
      lensColor.copy(rose).lerp(white, charge);
      lensMaterial.color.copy(lensColor);
      light.color.copy(lensColor);
      light.intensity = 2 + charge * 10;
      lens.scale.setScalar(1 + charge * 1.2 + (charge > 0 ? Math.sin(t * 40) * 0.1 : 0));
    },
  };
};

interface LiveBeam {
  readonly line: THREE.Line;
  readonly until: number;
}

/**
 * World-space lines the rig cannot draw on its own: a thin aiming line from every charging
 * watcher's lens to the player's eye, and the beam itself for `WATCHER_BEAM_DURATION` after it
 * fires. Owned by the scene, which calls `handle` with events and `update` every frame.
 */
export class WatcherBeamLayer {
  readonly group = new THREE.Group();
  private readonly aimLines = new Map<number, THREE.Line>();
  private readonly beams: LiveBeam[] = [];
  private readonly aimMaterial = new THREE.LineBasicMaterial({
    color: ROSE,
    transparent: true,
    opacity: 0.55,
  });
  private readonly beamMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });

  handle(events: readonly GameEvent[], now: number): void {
    for (const e of events) {
      if (e.type !== 'watcherFired') continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(e.from.x, e.from.y, e.from.z),
        new THREE.Vector3(e.to.x, e.to.y, e.to.z),
      ]);
      const line = new THREE.Line(geometry, this.beamMaterial);
      this.group.add(line);
      this.beams.push({ line, until: now + WATCHER_BEAM_DURATION });
    }
  }

  update(enemies: readonly Enemy[], eye: Vec3, now: number): void {
    const seen = new Set<number>();
    for (const enemy of enemies) {
      if (enemy.kind !== 'watcher' || enemy.state !== 'attack') continue;
      seen.add(enemy.id);
      const from = watcherLens(enemy.position);
      const points = [
        new THREE.Vector3(from.x, from.y, from.z),
        new THREE.Vector3(eye.x, eye.y, eye.z),
      ];
      let line = this.aimLines.get(enemy.id);
      if (!line) {
        line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), this.aimMaterial);
        this.aimLines.set(enemy.id, line);
        this.group.add(line);
      } else {
        line.geometry.setFromPoints(points);
      }
    }
    for (const [id, line] of this.aimLines) {
      if (seen.has(id)) continue;
      this.group.remove(line);
      line.geometry.dispose();
      this.aimLines.delete(id);
    }
    for (let i = this.beams.length - 1; i >= 0; i -= 1) {
      const beam = this.beams[i];
      if (!beam || now < beam.until) continue;
      this.group.remove(beam.line);
      beam.line.geometry.dispose();
      this.beams.splice(i, 1);
    }
  }
}
