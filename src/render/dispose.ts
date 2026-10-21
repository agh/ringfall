import type * as THREE from 'three';

/**
 * Frees the GPU resources under an object before it is dropped. three.js only releases buffers
 * and textures on `dispose()`; `Group.clear()` and `remove()` detach children and free nothing,
 * so a rebuilt arena or an expired effect leaks for the life of the tab without this.
 */
export const disposeTree = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const materials = mesh.material === undefined ? [] : [mesh.material].flat();
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (
          typeof value === 'object' &&
          value !== null &&
          (value as Partial<THREE.Texture>).isTexture === true
        ) {
          (value as THREE.Texture).dispose();
        }
      }
      material.dispose();
    }
  });
};
