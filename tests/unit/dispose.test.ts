import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { disposeTree } from '../../src/render/dispose';

/** Counts `dispose` events, which is the signal three.js uses to free GPU memory. */
const disposed = (target: THREE.EventDispatcher<{ dispose: object }>): { count: number } => {
  const box = { count: 0 };
  target.addEventListener('dispose', () => {
    box.count += 1;
  });
  return box;
};

describe('disposeTree', () => {
  it('disposes every geometry, material and texture under a group, once', () => {
    const map = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const normalMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ map, normalMap }),
    );
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const nested = new THREE.Group();
    nested.add(box);
    const light = new THREE.PointLight();
    const root = new THREE.Group();
    root.add(ground, nested, light);

    const counters = [
      ground.geometry,
      ground.material,
      map,
      normalMap,
      box.geometry,
      box.material as THREE.Material,
    ].map(disposed);

    disposeTree(root);

    expect(counters.map((c) => c.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('handles an array of materials and objects with none', () => {
    const a = new THREE.MeshBasicMaterial();
    const b = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [a, b]);
    const [ca, cb] = [disposed(a), disposed(b)];
    const root = new THREE.Group();
    root.add(mesh, new THREE.Group());
    expect(() => disposeTree(root)).not.toThrow();
    expect([ca.count, cb.count]).toEqual([1, 1]);
  });
});
