import * as THREE from 'three';
import { ENEMY_STATS, type Enemy } from '../core/enemy';
import { makeWatcherRig } from './watcher-rig';

/** Composite enemy rigs. Emissive parts are tuned to catch bloom so enemies read at range. */
export interface EnemyRig {
  readonly group: THREE.Group;
  readonly animate: (enemy: Enemy, simTime: number) => void;
}

const SKIMMER_BODY = new THREE.OctahedronGeometry(0.55, 1);
const SKIMMER_RING = new THREE.TorusGeometry(0.78, 0.045, 6, 36);
const SKIMMER_CORE = new THREE.SphereGeometry(0.18, 12, 12);
const STRIDER_TORSO = new THREE.CapsuleGeometry(0.55, 1.0, 6, 16);
const STRIDER_HEAD = new THREE.ConeGeometry(0.35, 0.6, 6);
const STRIDER_LEG = new THREE.CylinderGeometry(0.07, 0.11, 1.5, 6);
const STRIDER_CANNON = new THREE.CylinderGeometry(0.1, 0.14, 0.9, 8);
const STRIDER_EYE = new THREE.PlaneGeometry(0.5, 0.08);

const skimmerShell = new THREE.MeshStandardMaterial({
  color: 0x9a4b1c,
  emissive: 0x2a0c02,
  roughness: 0.35,
  metalness: 0.75,
  flatShading: true,
});
const skimmerGlow = new THREE.MeshBasicMaterial({ color: 0xffb347 });
const skimmerRing = new THREE.MeshStandardMaterial({
  color: 0xffc46b,
  emissive: 0xff8c1a,
  emissiveIntensity: 1.6,
  roughness: 0.3,
  metalness: 0.6,
});
const striderShell = new THREE.MeshStandardMaterial({
  color: 0x5b1a24,
  emissive: 0x1a0308,
  roughness: 0.45,
  metalness: 0.65,
  flatShading: true,
});
const striderEye = new THREE.MeshBasicMaterial({ color: 0xff4d5a, side: THREE.DoubleSide });
const striderJoint = new THREE.MeshStandardMaterial({
  color: 0x2b2b33,
  roughness: 0.6,
  metalness: 0.8,
});

const makeSkimmer = (): EnemyRig => {
  const group = new THREE.Group();
  const stats = ENEMY_STATS.skimmer;
  const body = new THREE.Mesh(SKIMMER_BODY, skimmerShell);
  body.scale.set(1, 0.5, 1);
  body.castShadow = true;
  const ring = new THREE.Mesh(SKIMMER_RING, skimmerRing);
  ring.rotation.x = Math.PI / 2;
  const core = new THREE.Mesh(SKIMMER_CORE, skimmerGlow);
  core.position.z = -0.42;
  const light = new THREE.PointLight(0xffa040, 2.5, 7, 1.5);
  light.position.set(0, 0, -0.5);
  const lift = new THREE.Group();
  lift.position.y = stats.height / 2;
  lift.add(body, ring, core, light);
  group.add(lift);
  return {
    group,
    animate: (enemy, t) => {
      ring.rotation.z = t * 4 + enemy.id;
      ring.rotation.x = Math.PI / 2 + Math.sin(t * 3 + enemy.id) * 0.25;
      lift.position.y = stats.height / 2 + 0.35 + Math.sin(t * 6 + enemy.id) * 0.14;
      lift.rotation.z = Math.sin(t * 5 + enemy.id) * 0.08;
      core.scale.setScalar(enemy.state === 'attack' ? 1.6 + Math.sin(t * 30) * 0.3 : 1);
    },
  };
};

const makeStrider = (): EnemyRig => {
  const group = new THREE.Group();
  const stats = ENEMY_STATS.strider;
  const hip = new THREE.Group();
  hip.position.y = stats.height * 0.62;
  const torso = new THREE.Mesh(STRIDER_TORSO, striderShell);
  torso.castShadow = true;
  torso.rotation.z = Math.PI / 2;
  torso.scale.set(0.8, 1, 0.8);
  const head = new THREE.Mesh(STRIDER_HEAD, striderShell);
  head.position.set(0, 0.55, -0.35);
  head.rotation.x = -Math.PI / 2;
  const eye = new THREE.Mesh(STRIDER_EYE, striderEye);
  eye.position.set(0, 0.48, -0.66);
  const cannon = new THREE.Mesh(STRIDER_CANNON, striderJoint);
  cannon.position.set(0.55, 0.45, -0.2);
  cannon.rotation.x = Math.PI / 2;
  const muzzle = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xc084fc }),
  );
  muzzle.position.set(0.55, 0.45, -0.68);
  const light = new THREE.PointLight(0xff4d5a, 2, 8, 1.5);
  light.position.copy(eye.position);
  hip.add(torso, head, eye, cannon, muzzle, light);
  const legs: THREE.Mesh[] = [];
  for (const [angle, side] of [
    [-0.5, 1],
    [0.5, 1],
    [-0.5, -1],
    [0.5, -1],
  ] as const) {
    const leg = new THREE.Mesh(STRIDER_LEG, striderJoint);
    leg.castShadow = true;
    leg.position.set(side * 0.5, -0.75, angle);
    leg.rotation.z = side * 0.35;
    leg.rotation.x = angle * 0.5;
    hip.add(leg);
    legs.push(leg);
  }
  group.add(hip);
  return {
    group,
    animate: (enemy, t) => {
      const walking = enemy.state === 'chase' ? 1 : 0.15;
      legs.forEach((leg, i) => {
        leg.rotation.x = (i % 2 === 0 ? 0.25 : -0.25) + Math.sin(t * 7 + i * 1.7) * 0.35 * walking;
      });
      hip.position.y = stats.height * 0.62 + Math.abs(Math.sin(t * 7)) * 0.08 * walking;
      hip.rotation.z = Math.sin(t * 3.5) * 0.04 * walking;
      const charging = enemy.state === 'attack' && enemy.nextAttackAt - t < 0.35;
      muzzle.scale.setScalar(charging ? 1.8 + Math.sin(t * 40) * 0.4 : 1);
      striderEye.color.setHex(charging ? 0xffffff : 0xff4d5a);
    },
  };
};

export const makeEnemyRig = (enemy: Enemy): EnemyRig => {
  if (enemy.kind === 'watcher') return makeWatcherRig();
  return enemy.kind === 'skimmer' ? makeSkimmer() : makeStrider();
};
