import * as THREE from 'three';
import type { Vec3 } from '../core/vec3';

/**
 * GPU particle pool. The CPU writes a particle's birth state once; the vertex shader integrates
 * position = start + velocity * t + 0.5 * gravity * t^2 every frame, so ten thousand particles
 * cost one draw call and zero per-frame JavaScript.
 */
export interface ParticleBurst {
  readonly at: Vec3;
  readonly count: number;
  readonly color: THREE.ColorRepresentation;
  readonly colorEnd?: THREE.ColorRepresentation;
  readonly speed: number;
  readonly spread?: number;
  readonly direction?: Vec3;
  readonly life: number;
  readonly size: number;
  readonly gravity?: number;
  readonly drag?: number;
  /**
   * Horizontal squash of the sprite, so a point renders as a vertical streak `stretch` times
   * taller than it is wide (rain). Stretched particles keep their size over their life.
   */
  readonly stretch?: number;
}

const VERTEX = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aVelocity;
  attribute vec3 aColor;
  attribute vec3 aColorEnd;
  attribute vec4 aParams; // birth, life, size, gravity
  attribute float aDrag;
  attribute float aStretch;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStretch;
  void main() {
    float age = uTime - aParams.x;
    float t = clamp(age / aParams.y, 0.0, 1.0);
    float drag = exp(-aDrag * age);
    vec3 pos = aStart + aVelocity * (aDrag > 0.0 ? (1.0 - drag) / aDrag : age)
      + vec3(0.0, -0.5 * aParams.w * age * age, 0.0);
    vColor = mix(aColor, aColorEnd, t);
    vAlpha = (1.0 - t) * (1.0 - t) * step(0.0, age) * (1.0 - step(1.0, t));
    vStretch = aStretch;
    float shrink = aStretch > 0.0 ? 1.0 : 1.0 - 0.6 * t;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    // A mote passing through the eye would otherwise cover the frame: fade anything inside
    // two metres and cap the sprite so a single point can never white out the screen.
    vAlpha *= smoothstep(0.5, 2.0, -mv.z);
    gl_PointSize = min(aParams.z * shrink * (300.0 / -mv.z), 64.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStretch;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    uv.x *= max(1.0, vStretch);
    float d = length(uv) * 2.0;
    float soft = smoothstep(1.0, 0.2, d);
    gl_FragColor = vec4(vColor * (1.0 + 1.2 * soft), soft * vAlpha);
  }
`;

export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private cursor = 0;
  private readonly start: Float32Array;
  private readonly velocity: Float32Array;
  private readonly color: Float32Array;
  private readonly colorEnd: Float32Array;
  private readonly params: Float32Array;
  private readonly drag: Float32Array;
  private readonly stretch: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private dirtyLo = Number.POSITIVE_INFINITY;
  private dirtyHi = 0;

  constructor(capacity = 12000) {
    this.capacity = capacity;
    this.start = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.colorEnd = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    this.drag = new Float32Array(capacity);
    this.stretch = new Float32Array(capacity);
    // Birth far in the past so untouched slots are invisible.
    for (let i = 0; i < capacity; i += 1) this.params[i * 4] = -1e9;
    const attr = (array: Float32Array, size: number): THREE.BufferAttribute => {
      const a = new THREE.BufferAttribute(array, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.geometry.setAttribute('position', attr(this.start, 3));
    this.geometry.setAttribute('aStart', attr(this.start, 3));
    this.geometry.setAttribute('aVelocity', attr(this.velocity, 3));
    this.geometry.setAttribute('aColor', attr(this.color, 3));
    this.geometry.setAttribute('aColorEnd', attr(this.colorEnd, 3));
    this.geometry.setAttribute('aParams', attr(this.params, 4));
    this.geometry.setAttribute('aDrag', attr(this.drag, 1));
    this.geometry.setAttribute('aStretch', attr(this.stretch, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  burst(b: ParticleBurst, now: number): void {
    const c0 = new THREE.Color(b.color);
    const c1 = new THREE.Color(b.colorEnd ?? b.color);
    const spread = b.spread ?? 1;
    const dir = b.direction
      ? new THREE.Vector3(b.direction.x, b.direction.y, b.direction.z).normalize()
      : null;
    for (let n = 0; n < b.count; n += 1) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      // Random direction in a cone (or sphere when no direction).
      const v = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      if (dir) v.multiplyScalar(spread).add(dir).normalize();
      const speed = b.speed * (0.4 + Math.random() * 0.9);
      this.start.set([b.at.x, b.at.y, b.at.z], i * 3);
      this.velocity.set([v.x * speed, v.y * speed, v.z * speed], i * 3);
      this.color.set([c0.r, c0.g, c0.b], i * 3);
      this.colorEnd.set([c1.r, c1.g, c1.b], i * 3);
      this.params.set(
        [
          now,
          b.life * (0.6 + Math.random() * 0.8),
          b.size * (0.6 + Math.random() * 0.8),
          b.gravity ?? 0,
        ],
        i * 4,
      );
      this.drag[i] = b.drag ?? 0;
      this.stretch[i] = b.stretch ?? 0;
      this.dirtyLo = Math.min(this.dirtyLo, i);
      this.dirtyHi = Math.max(this.dirtyHi, i);
    }
  }

  update(now: number): void {
    const time = this.material.uniforms.uTime;
    if (time) time.value = now;
    if (this.dirtyLo <= this.dirtyHi) {
      // Upload whole buffers: simpler than tracking ranges across the ring boundary, and cheap.
      for (const name of [
        'position',
        'aStart',
        'aVelocity',
        'aColor',
        'aColorEnd',
        'aParams',
        'aDrag',
        'aStretch',
      ]) {
        const attribute = this.geometry.getAttribute(name);
        if (attribute instanceof THREE.BufferAttribute) attribute.needsUpdate = true;
      }
      this.dirtyLo = Number.POSITIVE_INFINITY;
      this.dirtyHi = 0;
    }
  }
}
