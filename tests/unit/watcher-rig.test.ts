import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEnemy } from '../../src/core/enemy';
import { WATCHER_STATS } from '../../src/core/watcher';
import { makeEnemyRig } from '../../src/render/enemies';
import { makeWatcherRig } from '../../src/render/watcher-rig';

/** Height over the wider of the two horizontal extents, from the rig's world bounding box. */
const aspect = (group: THREE.Group): { ratio: number; height: number; width: number } => {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const width = Math.max(size.x, size.z);
  return { ratio: size.y / width, height: size.y, width };
};

/**
 * Vertical field of view of the game camera in radians (BASE_FOV in src/render/scene.ts) and
 * the reference viewport, for the readability-at-range figure the issue asks about.
 */
const VERTICAL_FOV = (78 * Math.PI) / 180;
const VIEWPORT_HEIGHT = 720;
const pixelsTall = (metres: number, range: number): number =>
  (2 * Math.atan(metres / 2 / range) * VIEWPORT_HEIGHT) / VERTICAL_FOV;

describe('watcher rig', () => {
  it('is a tall, narrow silhouette that reads against the strider by aspect ratio alone', () => {
    const watcher = aspect(makeWatcherRig().group);
    const strider = aspect(makeEnemyRig(createEnemy(1, 'strider', { x: 0, y: 0, z: 0 }, 0)).group);
    const skimmer = aspect(makeEnemyRig(createEnemy(2, 'skimmer', { x: 0, y: 0, z: 0 }, 0)).group);
    expect(watcher.height).toBeCloseTo(WATCHER_STATS.height, 0);
    expect(watcher.ratio).toBeGreaterThanOrEqual(2.5);
    expect(watcher.ratio).toBeGreaterThan(strider.ratio * 1.5);
    expect(skimmer.ratio).toBeLessThan(1);
    // At 40 m on a 720 px tall viewport the rig spans well over the 24 px the brand doc treats
    // as the floor for a readable silhouette.
    expect(pixelsTall(watcher.height, 40)).toBeGreaterThan(24);
  });

  it('telegraphs the charge on the lens from any angle: colour moves from Rose to white', () => {
    const rig = makeWatcherRig();
    const base = createEnemy(3, 'watcher', { x: 0, y: 0, z: -28 }, 0);
    const lens = rig.group.getObjectByProperty('type', 'Mesh');
    expect(lens).toBeDefined();
    const materials = (): THREE.MeshBasicMaterial[] => {
      const found: THREE.MeshBasicMaterial[] = [];
      rig.group.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial)
          found.push(o.material);
      });
      return found;
    };
    rig.animate({ ...base, state: 'chase' }, 10);
    const idle = materials()[0]?.color.clone();
    rig.animate({ ...base, state: 'attack', nextAttackAt: 10 }, 10);
    const charged = materials()[0]?.color.clone();
    expect(idle?.getHex()).toBe(0xfb7185);
    expect(charged?.getHex()).toBe(0xffffff);
  });
});
