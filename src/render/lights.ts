import * as THREE from 'three';

/**
 * A fixed pool of point lights. three.js keys every lit material's shader program on the
 * number of lights in the scene, so a light added for a bolt or an explosion and removed a
 * quarter second later recompiles every lit material twice: a hitch each time, on every kill
 * and every shot. The pool puts `LIGHT_POOL_SIZE` lights in the scene before the first frame
 * and never changes that number. A borrowed light is parented under the thing it lights and
 * brightened; a returned one goes dark and back under the pool's own group. When every light
 * is out, the caller lights nothing rather than growing the count.
 *
 * The cost is the other way round from before: every lit fragment loops over the pool's full
 * size on every frame, even on the title card. Twelve covers the largest beat (six skimmers,
 * three striders) with two bolts in flight, and is below the fifteen or so that software GL in
 * CI already met at the peak of a wave.
 */
export const LIGHT_POOL_SIZE = 12;

export class LightPool {
  /** Holds the idle lights; add it to the scene once. */
  readonly group = new THREE.Group();
  private readonly idle: THREE.PointLight[] = [];
  private readonly lent = new Set<THREE.PointLight>();

  constructor(size = LIGHT_POOL_SIZE) {
    for (let i = 0; i < size; i += 1) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      this.group.add(light);
      this.idle.push(light);
    }
  }

  /** Lights lent out right now; the rest are dark under `group`. */
  get inUse(): number {
    return this.lent.size;
  }

  /**
   * Borrows a light, set up like `new PointLight(color, intensity, distance, decay)` at the
   * origin of `parent`, or returns null when the pool is empty.
   */
  acquire(
    parent: THREE.Object3D,
    color: THREE.ColorRepresentation,
    intensity: number,
    distance: number,
    decay = 1.5,
  ): THREE.PointLight | null {
    const light = this.idle.pop();
    if (!light) return null;
    light.color.set(color);
    light.intensity = intensity;
    light.distance = distance;
    light.decay = decay;
    light.position.set(0, 0, 0);
    parent.add(light);
    this.lent.add(light);
    return light;
  }

  /** Returns a light to the pool; a null or an already-returned light is a no-op. */
  release(light: THREE.PointLight | null): void {
    if (!light || !this.lent.delete(light)) return;
    light.intensity = 0;
    this.group.add(light);
    this.idle.push(light);
  }
}
