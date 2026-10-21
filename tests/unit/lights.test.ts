import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEnemy } from '../../src/core/enemy';
import { makeEnemyRig } from '../../src/render/enemies';
import { LIGHT_POOL_SIZE, LightPool } from '../../src/render/lights';

/** Point lights reachable from `root`: what three.js would count when it keys a program. */
const countLights = (root: THREE.Object3D): number => {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof THREE.PointLight) n += 1;
  });
  return n;
};

describe('light pool', () => {
  it('keeps the scene light count fixed while lights are borrowed and returned', () => {
    const scene = new THREE.Scene();
    const pool = new LightPool();
    scene.add(pool.group);
    const dynamic = new THREE.Group();
    scene.add(dynamic);
    expect(countLights(scene)).toBe(LIGHT_POOL_SIZE);

    const holder = new THREE.Group();
    dynamic.add(holder);
    const light = pool.acquire(holder, 0xff0000, 5, 7, 1.5);
    expect(light).not.toBeNull();
    expect(light?.parent).toBe(holder);
    expect(light?.intensity).toBe(5);
    expect(light?.color.getHex()).toBe(0xff0000);
    expect(pool.inUse).toBe(1);
    expect(countLights(scene)).toBe(LIGHT_POOL_SIZE);

    pool.release(light);
    dynamic.remove(holder);
    expect(pool.inUse).toBe(0);
    expect(light?.parent).toBe(pool.group);
    expect(light?.intensity).toBe(0);
    expect(countLights(scene)).toBe(LIGHT_POOL_SIZE);
  });

  it('hands out nothing once empty and ignores a double release', () => {
    const pool = new LightPool(2);
    const a = pool.acquire(new THREE.Group(), 0xffffff, 1, 1);
    const b = pool.acquire(new THREE.Group(), 0xffffff, 1, 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(pool.acquire(new THREE.Group(), 0xffffff, 1, 1)).toBeNull();
    pool.release(a);
    pool.release(a);
    pool.release(null);
    expect(pool.inUse).toBe(1);
    expect(pool.acquire(new THREE.Group(), 0xffffff, 1, 1)).toBe(a);
  });

  it('enemy rigs borrow their light and give it back on dispose', () => {
    const pool = new LightPool(3);
    const rigs = (['skimmer', 'strider', 'watcher'] as const).map((kind, i) =>
      makeEnemyRig(createEnemy(i + 1, kind, { x: 0, y: 0, z: 0 }, 0), pool),
    );
    expect(pool.inUse).toBe(3);
    for (const rig of rigs) expect(countLights(rig.group)).toBe(1);
    for (const rig of rigs) rig.dispose();
    expect(pool.inUse).toBe(0);
    for (const rig of rigs) expect(countLights(rig.group)).toBe(0);
  });

  it('gives every strider its own eye, so one charging strider does not whiten the rest', () => {
    const pool = new LightPool();
    const eyeOf = (rig: ReturnType<typeof makeEnemyRig>): THREE.MeshBasicMaterial => {
      let found: THREE.MeshBasicMaterial | null = null;
      rig.group.traverse((o) => {
        if (
          o instanceof THREE.Mesh &&
          o.geometry instanceof THREE.PlaneGeometry &&
          o.material instanceof THREE.MeshBasicMaterial
        )
          found = o.material;
      });
      if (!found) throw new Error('no eye');
      return found;
    };
    const one = makeEnemyRig(createEnemy(1, 'strider', { x: 0, y: 0, z: 0 }, 0), pool);
    const two = makeEnemyRig(createEnemy(2, 'strider', { x: 0, y: 0, z: 0 }, 0), pool);
    const base = createEnemy(1, 'strider', { x: 0, y: 0, z: 0 }, 0);
    one.animate({ ...base, state: 'attack', nextAttackAt: 10.1 }, 10);
    two.animate({ ...base, id: 2, state: 'chase' }, 10);
    expect(eyeOf(one).color.getHex()).toBe(0xffffff);
    expect(eyeOf(two).color.getHex()).toBe(0xff4d5a);
    expect(eyeOf(one)).not.toBe(eyeOf(two));
  });
});
