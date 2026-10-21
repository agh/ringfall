import * as THREE from 'three';
import type { Vec3 } from '../core/vec3';
import { renderRandom } from './random';

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
  /**
   * How the sprite is drawn. `spark` (default) is an additive glow that shrinks over its life;
   * `smoke` is an alpha-blended soft puff that grows and can darken what is behind it; `shard`
   * is a hard-edged alpha-blended chip that tumbles and fades only at the end of its life.
   */
  readonly shape?: ParticleShape;
}

export type ParticleShape = 'spark' | 'smoke' | 'shard';

const SHAPE_INDEX: Readonly<Record<ParticleShape, number>> = { spark: 0, smoke: 1, shard: 2 };

/** The birth position rides the built-in `position` attribute; the shader integrates from it. */
const VERTEX = /* glsl */ `
  attribute vec3 aVelocity;
  attribute vec3 aColor;
  attribute vec3 aColorEnd;
  attribute vec4 aParams; // birth, life, size, gravity
  attribute float aDrag;
  attribute float aStretch;
  attribute float aShape;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStretch;
  varying float vShape;
  varying float vSeed;
  void main() {
    float age = uTime - aParams.x;
    float t = clamp(age / aParams.y, 0.0, 1.0);
    float drag = exp(-aDrag * age);
    vec3 pos = position + aVelocity * (aDrag > 0.0 ? (1.0 - drag) / aDrag : age)
      + vec3(0.0, -0.5 * aParams.w * age * age, 0.0);
    vColor = mix(aColor, aColorEnd, t);
    float alive = step(0.0, age) * (1.0 - step(1.0, t));
    // Sparks fade from birth; smoke blooms in over the first tenth of its life and thins
    // out; a shard stays solid and only fades over its last third.
    float fade = aShape < 0.5
      ? (1.0 - t) * (1.0 - t)
      : (aShape < 1.5 ? smoothstep(0.0, 0.1, t) * (1.0 - t) * 0.6 : 1.0 - smoothstep(0.66, 1.0, t));
    vAlpha = fade * alive;
    vStretch = aStretch;
    vShape = aShape;
    vSeed = fract(aParams.y * 13.37 + aParams.x * 0.173);
    float shrink = aStretch > 0.0 ? 1.0 : 1.0 - 0.6 * t;
    float scale = aShape < 0.5 ? shrink : (aShape < 1.5 ? 0.6 + 1.6 * t : 1.0);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    // A mote passing through the eye would otherwise cover the frame: fade anything inside
    // two metres and cap the sprite so a single point can never white out the screen.
    vAlpha *= smoothstep(0.5, 2.0, -mv.z);
    gl_PointSize = min(aParams.z * scale * (300.0 / -mv.z), 64.0);
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * Output is premultiplied: the material blends ONE, ONE_MINUS_SRC_ALPHA, so a fragment with
 * alpha 0 adds to the frame (the spark glow, byte-for-byte the former additive look) and a
 * fragment with alpha a lays its colour over the frame (smoke and shards can darken it).
 */
const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStretch;
  varying float vShape;
  varying float vSeed;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    if (vShape < 0.5) {
      uv.x *= max(1.0, vStretch);
      float d = length(uv) * 2.0;
      float soft = smoothstep(1.0, 0.2, d);
      gl_FragColor = vec4(vColor * (1.0 + 1.2 * soft) * soft * vAlpha, 0.0);
    } else if (vShape < 1.5) {
      // A puff: a soft disc broken up by a cheap per-sprite noise so a column of them does
      // not read as a stack of circles.
      float d = length(uv) * 2.0;
      float grain = 0.7 + 0.3 * hash(floor((uv + vSeed) * 6.0));
      float a = smoothstep(1.0, 0.15, d) * grain * vAlpha;
      gl_FragColor = vec4(vColor * a, a);
    } else {
      // A chip: a rotated diamond with a hard edge, lit on one side.
      float angle = vSeed * 6.2832;
      vec2 r = vec2(uv.x * cos(angle) - uv.y * sin(angle), uv.x * sin(angle) + uv.y * cos(angle));
      float inside = step(abs(r.x) * 1.6 + abs(r.y) * 2.6, 0.5);
      float a = inside * vAlpha;
      vec3 lit = vColor * (0.6 + 0.8 * step(0.0, r.x + r.y));
      gl_FragColor = vec4(lit * a, a);
    }
  }
`;

/** Scratch objects for `burst`: a burst of forty allocates nothing per particle. */
const scratchColor = new THREE.Color();
const scratchColorEnd = new THREE.Color();
const scratchDir = new THREE.Vector3();
const scratchVelocity = new THREE.Vector3();

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
  private readonly shape: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  /** First slot written since the last upload, and how many followed it around the ring. */
  private dirtyStart = 0;
  private dirtyCount = 0;

  constructor(capacity = 12000) {
    this.capacity = capacity;
    this.start = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.colorEnd = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    this.drag = new Float32Array(capacity);
    this.stretch = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    // Birth far in the past so untouched slots are invisible.
    for (let i = 0; i < capacity; i += 1) this.params[i * 4] = -1e9;
    const attr = (array: Float32Array, size: number): THREE.BufferAttribute => {
      const a = new THREE.BufferAttribute(array, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.geometry.setAttribute('position', attr(this.start, 3));
    this.geometry.setAttribute('aVelocity', attr(this.velocity, 3));
    this.geometry.setAttribute('aColor', attr(this.color, 3));
    this.geometry.setAttribute('aColorEnd', attr(this.colorEnd, 3));
    this.geometry.setAttribute('aParams', attr(this.params, 4));
    this.geometry.setAttribute('aDrag', attr(this.drag, 1));
    this.geometry.setAttribute('aStretch', attr(this.stretch, 1));
    this.geometry.setAttribute('aShape', attr(this.shape, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      // Premultiplied alpha: see FRAGMENT.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  burst(b: ParticleBurst, now: number): void {
    const c0 = scratchColor.set(b.color);
    const c1 = scratchColorEnd.set(b.colorEnd ?? b.color);
    const spread = b.spread ?? 1;
    const dir = b.direction
      ? scratchDir.set(b.direction.x, b.direction.y, b.direction.z).normalize()
      : null;
    const gravity = b.gravity ?? 0;
    const drag = b.drag ?? 0;
    const stretch = b.stretch ?? 0;
    const shape = SHAPE_INDEX[b.shape ?? 'spark'];
    const v = scratchVelocity;
    for (let n = 0; n < b.count; n += 1) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      if (this.dirtyCount === 0) this.dirtyStart = i;
      this.dirtyCount = Math.min(this.capacity, this.dirtyCount + 1);
      // Random direction in a cone (or sphere when no direction).
      v.set(renderRandom() - 0.5, renderRandom() - 0.5, renderRandom() - 0.5).normalize();
      if (dir) v.multiplyScalar(spread).add(dir).normalize();
      const speed = b.speed * (0.4 + renderRandom() * 0.9);
      const o3 = i * 3;
      const o4 = i * 4;
      this.start[o3] = b.at.x;
      this.start[o3 + 1] = b.at.y;
      this.start[o3 + 2] = b.at.z;
      this.velocity[o3] = v.x * speed;
      this.velocity[o3 + 1] = v.y * speed;
      this.velocity[o3 + 2] = v.z * speed;
      this.color[o3] = c0.r;
      this.color[o3 + 1] = c0.g;
      this.color[o3 + 2] = c0.b;
      this.colorEnd[o3] = c1.r;
      this.colorEnd[o3 + 1] = c1.g;
      this.colorEnd[o3 + 2] = c1.b;
      this.params[o4] = now;
      this.params[o4 + 1] = b.life * (0.6 + renderRandom() * 0.8);
      this.params[o4 + 2] = b.size * (0.6 + renderRandom() * 0.8);
      this.params[o4 + 3] = gravity;
      this.drag[i] = drag;
      this.stretch[i] = stretch;
      this.shape[i] = shape;
    }
  }

  update(now: number): void {
    const time = this.material.uniforms.uTime;
    if (time) time.value = now;
    if (this.dirtyCount === 0) return;
    // Only the slots born since the last upload go to the GPU: one range, or two when the ring
    // wrapped, or the whole buffer when a frame wrote more than the pool holds.
    const whole = this.dirtyCount >= this.capacity;
    const first = this.dirtyStart;
    const firstCount = Math.min(this.dirtyCount, this.capacity - first);
    const wrapped = this.dirtyCount - firstCount;
    for (const attribute of Object.values(this.geometry.attributes)) {
      if (!(attribute instanceof THREE.BufferAttribute)) continue;
      attribute.clearUpdateRanges();
      if (!whole) {
        const size = attribute.itemSize;
        attribute.addUpdateRange(first * size, firstCount * size);
        if (wrapped > 0) attribute.addUpdateRange(0, wrapped * size);
      }
      attribute.needsUpdate = true;
    }
    this.dirtyCount = 0;
  }
}
