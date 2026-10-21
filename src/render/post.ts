import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Bloom tuning, chosen from measured frames (`docs/design-doc.md`, Presentation). Only the
 * radiance above the threshold blooms, with a quadratic knee that starts at 1.0 so lit albedo
 * never crosses it, and no pixel contributes more than the cap: the sky's sun disc is in the
 * hundreds in HDR and would otherwise flood the frame through the blur chain.
 */
export const BLOOM_STRENGTH = 0.15;
export const BLOOM_RADIUS = 0.25;
export const BLOOM_THRESHOLD = 1.3;
export const BLOOM_KNEE = 0.3;
export const BLOOM_CAP = 1.5;

/**
 * Prefilter for the bloom chain. `UnrealBloomPass` passes the whole texel through once it is
 * over the threshold, so a sun at 600 blooms six hundred times harder than a trim at 1.0.
 * This version keeps only the excess over the threshold, softened by a knee, and caps it.
 */
const BloomPrefilterShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold;
    uniform float uKnee;
    uniform float uCap;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float v = luminance(texel.rgb);
      // Quadratic knee from (threshold - knee) to (threshold + knee), linear above it.
      float soft = clamp(v - luminosityThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      float excess = min(max(soft, v - luminosityThreshold), uCap);
      gl_FragColor = vec4(texel.rgb * (excess / max(v, 1e-4)), 1.0);
    }
  `,
};

/**
 * Full-screen "feel" pass layered after bloom: vignette, chromatic aberration that grows with
 * damage, a hexagonal energy-shield flare from the screen edges on shield hits, and fine grain.
 */
const RingfallShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uShieldHit: { value: 0 },
    uShieldDown: { value: 0 },
    uDamage: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uShieldHit;
    uniform float uShieldDown;
    uniform float uDamage;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // Hexagonal cell distance, for the energy-shield lattice.
    float hexDist(vec2 p) {
      p = abs(p);
      return max(dot(p, normalize(vec2(1.0, 1.732))), p.x);
    }
    float hexPattern(vec2 uv, float scale) {
      vec2 r = vec2(1.0, 1.732);
      vec2 h = r * 0.5;
      vec2 a = mod(uv * scale, r) - h;
      vec2 b = mod(uv * scale - h, r) - h;
      vec2 g = dot(a, a) < dot(b, b) ? a : b;
      return hexDist(g);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centred = (uv - 0.5) * vec2(uAspect, 1.0);
      float r = length(centred);

      // Chromatic aberration scales with damage taken and with a dead shield.
      float ca = 0.002 + 0.012 * uDamage + 0.004 * uShieldDown;
      vec2 dir = normalize(centred + 1e-5) * r * ca;
      float red = texture2D(tDiffuse, uv + dir).r;
      float green = texture2D(tDiffuse, uv).g;
      float blue = texture2D(tDiffuse, uv - dir).b;
      vec3 color = vec3(red, green, blue);

      // Energy shield lattice flares in from the edges when a hit lands.
      float edge = smoothstep(0.35, 0.95, r);
      float hex = 1.0 - smoothstep(0.42, 0.5, hexPattern(uv * vec2(uAspect, 1.0), 14.0));
      float ripple = 0.5 + 0.5 * sin(r * 40.0 - uTime * 30.0);
      vec3 shieldColor = vec3(0.49, 0.83, 0.99);
      color += shieldColor * edge * uShieldHit * (0.35 + 0.65 * hex) * (0.6 + 0.4 * ripple);

      // Damage tint: desaturate and push red at the edges when the shield is down.
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(color, vec3(luma), 0.35 * uShieldDown);
      color += vec3(0.45, 0.05, 0.02) * edge * (0.8 * uDamage + 0.35 * uShieldDown * (0.5 + 0.5 * sin(uTime * 5.0)));

      // Vignette and grain.
      color *= 1.0 - 0.45 * smoothstep(0.45, 1.1, r);
      color += (hash(uv * 1000.0 + uTime) - 0.5) * 0.025;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class PostStack {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  /** The pixel ratio the composer's targets were last sized for. */
  private pixelRatio: number;
  private readonly bloom: UnrealBloomPass;
  private readonly feel: ShaderPass;
  private shieldHit = 0;
  private damage = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.pixelRatio = renderer.getPixelRatio();
    const size = renderer.getSize(new THREE.Vector2());
    // HDR + MSAA target: bloom thresholds on linear radiance, OutputPass tone-maps at the end.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // Threshold above 1.0 so only true emitters (trims, bolts, muzzle, explosions) bloom.
    this.bloom = new UnrealBloomPass(size, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    // The pass writes `tDiffuse` and `luminosityThreshold` into its own uniform objects every
    // frame; sharing those instances keeps the replacement prefilter fed.
    const highPass = this.bloom.highPassUniforms as Record<string, THREE.IUniform>;
    this.bloom.materialHighPassFilter = new THREE.ShaderMaterial({
      uniforms: { ...highPass, uKnee: { value: BLOOM_KNEE }, uCap: { value: BLOOM_CAP } },
      vertexShader: BloomPrefilterShader.vertexShader,
      fragmentShader: BloomPrefilterShader.fragmentShader,
    });
    this.composer.addPass(this.bloom);
    this.feel = new ShaderPass(RingfallShader);
    this.composer.addPass(this.feel);
    this.composer.addPass(new OutputPass());
  }

  private setUniform(name: string, value: number): void {
    const uniform = this.feel.material.uniforms[name];
    if (uniform) uniform.value = value;
  }

  setSize(width: number, height: number): void {
    // The composer copies the renderer's pixel ratio once, when it is built; the dynamic
    // resolution scaler changes it afterwards, so without this the scene pass, the HDR target
    // and the feel pass stayed at the page's native ratio whatever the scaler chose.
    const pixelRatio = this.renderer.getPixelRatio();
    if (pixelRatio !== this.pixelRatio) {
      this.pixelRatio = pixelRatio;
      this.composer.setPixelRatio(pixelRatio);
    }
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
    this.setUniform('uAspect', width / height);
  }

  /** Diagnostic: current values of every feel-pass uniform. */
  debugUniforms(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, uniform] of Object.entries(this.feel.material.uniforms)) {
      out[name] = name === 'tDiffuse' ? Boolean(uniform.value) : uniform.value;
    }
    return out;
  }

  onShieldHit(): void {
    this.shieldHit = 1;
  }

  onDamage(): void {
    this.damage = 1;
  }

  render(now: number, frameDt: number, shieldDown: boolean): void {
    this.shieldHit = Math.max(0, this.shieldHit - frameDt * 2.2);
    this.damage = Math.max(0, this.damage - frameDt * 3);
    this.setUniform('uTime', now);
    this.setUniform('uShieldHit', this.shieldHit);
    this.setUniform('uDamage', this.damage);
    this.setUniform('uShieldDown', shieldDown ? 1 : 0);
    this.composer.render();
  }
}
