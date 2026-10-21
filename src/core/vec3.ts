/** Minimal immutable 3D vector helpers. Kept renderer-free so the core stays testable in Node. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const ZERO: Vec3 = vec3();

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** Horizontal (XZ-plane) distance, used for ranges that ignore height. */
export const distanceXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

export const normalize = (a: Vec3): Vec3 => {
  const len = length(a);
  return len > 1e-9 ? scale(a, 1 / len) : ZERO;
};

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** Forward unit vector for a yaw (radians, 0 = -Z) and pitch (radians, +up). */
export const directionFromAngles = (yaw: number, pitch: number): Vec3 => {
  const cp = Math.cos(pitch);
  return vec3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
};

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
