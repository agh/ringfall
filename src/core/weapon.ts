import { rayAabb, raySphere, type SphereTarget } from './raycast';
import type { Vec3 } from './vec3';
import type { Aabb } from './world';

/**
 * Six weapons share one runtime shape. Each kind's distinct rule (pellets, falloff, charge,
 * spin-up, projectile) is data in `WEAPON_SPECS`; `game.ts` reads the spec when it fires.
 * All timing is in simulation seconds, all distances in metres.
 */
export type WeaponKind = 'rifle' | 'laser' | 'scatter' | 'beam' | 'launcher' | 'minigun';

export const WEAPON_KINDS: readonly WeaponKind[] = [
  'rifle',
  'laser',
  'scatter',
  'beam',
  'launcher',
  'minigun',
];

export interface WeaponSpec {
  readonly name: string;
  readonly kind: WeaponKind;
  readonly magazineSize: number;
  readonly reserve: number;
  readonly fireInterval: number;
  readonly reloadTime: number;
  /** Per shot, or per pellet for the scatter gun. */
  readonly damage: number;
  readonly range: number;
  readonly spreadStanding: number;
  readonly spreadMoving: number;
  readonly pellets: number;
  /** Pellet damage is full up to `falloffStart` and `FALLOFF_FLOOR` of full at `falloffEnd`. */
  readonly falloffStart: number;
  readonly falloffEnd: number;
  /** Seconds the trigger must be held before a release fires; 0 for trigger-pull weapons. */
  readonly chargeTime: number;
  /** Seconds of held trigger before the weapon reaches its full fire rate; 0 for none. */
  readonly spinUp: number;
  /** True when a shot launches a round (grenade ballistics) instead of casting a ray. */
  readonly projectile: boolean;
}

/** Damage multiplier at and beyond `falloffEnd`. */
export const FALLOFF_FLOOR = 0.2;
/** Fraction of the full fire rate a minigun manages at zero spin. */
export const MINIGUN_IDLE_RATE = 0.25;
/** Seconds a dry trigger pull locks the weapon before it clicks again. */
export const EMPTY_CLICK_INTERVAL = 0.3;

export const WEAPON_SPECS: Readonly<Record<WeaponKind, WeaponSpec>> = {
  rifle: {
    name: 'Rifle',
    kind: 'rifle',
    magazineSize: 32,
    reserve: 160,
    fireInterval: 0.1,
    reloadTime: 1.8,
    damage: 20,
    range: 120,
    spreadStanding: 0.004,
    spreadMoving: 0.012,
    pellets: 1,
    falloffStart: 120,
    falloffEnd: 120,
    chargeTime: 0,
    spinUp: 0,
    projectile: false,
  },
  laser: {
    name: 'Laser',
    kind: 'laser',
    magazineSize: 12,
    reserve: 60,
    fireInterval: 0.35,
    reloadTime: 2,
    damage: 45,
    range: 160,
    spreadStanding: 0,
    spreadMoving: 0.004,
    pellets: 1,
    falloffStart: 160,
    falloffEnd: 160,
    chargeTime: 0,
    spinUp: 0,
    projectile: false,
  },
  scatter: {
    name: 'Scatter',
    kind: 'scatter',
    magazineSize: 6,
    reserve: 36,
    fireInterval: 0.6,
    reloadTime: 2.4,
    damage: 14,
    range: 30,
    spreadStanding: 0.09,
    spreadMoving: 0.09,
    pellets: 8,
    falloffStart: 6,
    falloffEnd: 14,
    chargeTime: 0,
    spinUp: 0,
    projectile: false,
  },
  beam: {
    name: 'Beam',
    kind: 'beam',
    magazineSize: 4,
    reserve: 16,
    fireInterval: 1.2,
    reloadTime: 2.6,
    damage: 160,
    range: 100,
    spreadStanding: 0,
    spreadMoving: 0.002,
    pellets: 1,
    falloffStart: 100,
    falloffEnd: 100,
    chargeTime: 0.8,
    spinUp: 0,
    projectile: false,
  },
  launcher: {
    name: 'Launcher',
    kind: 'launcher',
    magazineSize: 3,
    reserve: 12,
    fireInterval: 0.9,
    reloadTime: 2.8,
    damage: 110,
    range: 60,
    spreadStanding: 0,
    spreadMoving: 0.006,
    pellets: 1,
    falloffStart: 60,
    falloffEnd: 60,
    chargeTime: 0,
    spinUp: 0,
    projectile: true,
  },
  minigun: {
    name: 'Minigun',
    kind: 'minigun',
    magazineSize: 120,
    reserve: 0,
    fireInterval: 0.045,
    reloadTime: 0,
    damage: 9,
    range: 90,
    spreadStanding: 0.03,
    spreadMoving: 0.03,
    pellets: 1,
    falloffStart: 90,
    falloffEnd: 90,
    chargeTime: 0,
    spinUp: 0.5,
    projectile: false,
  },
};

/** Runtime state of one held weapon. Timing fields are copied from the spec for convenience. */
export interface Weapon {
  readonly kind: WeaponKind;
  readonly magazine: number;
  readonly magazineSize: number;
  readonly reserve: number;
  readonly fireInterval: number;
  readonly reloadTime: number;
  readonly damage: number;
  readonly range: number;
  readonly nextShotAt: number;
  /** Simulation time at which the current reload completes, or null when not reloading. */
  readonly reloadCompleteAt: number | null;
  /** 0 to 1 while the trigger is held on a charged weapon (beam). */
  readonly charge: number;
  /** 0 to 1 spin-up of a minigun; decays when the trigger is released. */
  readonly spin: number;
  /** Trigger state at the previous step, so a release can be detected. */
  readonly lastFire: boolean;
}

export const createWeapon = (kind: WeaponKind): Weapon => {
  const spec = WEAPON_SPECS[kind];
  return {
    kind,
    magazine: spec.magazineSize,
    magazineSize: spec.magazineSize,
    reserve: spec.reserve,
    fireInterval: spec.fireInterval,
    reloadTime: spec.reloadTime,
    damage: spec.damage,
    range: spec.range,
    nextShotAt: 0,
    reloadCompleteAt: null,
    charge: 0,
    spin: 0,
    lastFire: false,
  };
};

export const createRifle = (): Weapon => createWeapon('rifle');

export const weaponSpec = (w: Weapon): WeaponSpec => WEAPON_SPECS[w.kind];

/** Shots plus reserve: zero means the weapon is dead weight. */
export const totalAmmo = (w: Weapon): number => w.magazine + w.reserve;

/** Seconds between shots right now; a minigun fires slowly until it has spun up. */
export const effectiveFireInterval = (w: Weapon): number => {
  if (weaponSpec(w).spinUp <= 0) return w.fireInterval;
  return w.fireInterval / (MINIGUN_IDLE_RATE + (1 - MINIGUN_IDLE_RATE) * w.spin);
};

export type FireResult =
  | { readonly kind: 'fired'; readonly weapon: Weapon }
  | { readonly kind: 'empty'; readonly weapon: Weapon }
  | { readonly kind: 'cooling'; readonly weapon: Weapon };

export const tryFire = (w: Weapon, now: number): FireResult => {
  if (w.reloadCompleteAt !== null || now < w.nextShotAt) return { kind: 'cooling', weapon: w };
  if (w.magazine <= 0)
    return { kind: 'empty', weapon: { ...w, nextShotAt: now + EMPTY_CLICK_INTERVAL } };
  return {
    kind: 'fired',
    weapon: { ...w, magazine: w.magazine - 1, nextShotAt: now + effectiveFireInterval(w) },
  };
};

export const startReload = (w: Weapon, now: number): Weapon => {
  if (w.reloadCompleteAt !== null || w.magazine >= w.magazineSize || w.reserve <= 0) return w;
  return { ...w, reloadCompleteAt: now + w.reloadTime, charge: 0 };
};

export const tickWeapon = (w: Weapon, now: number): Weapon => {
  if (w.reloadCompleteAt === null || now < w.reloadCompleteAt) return w;
  const needed = w.magazineSize - w.magazine;
  const taken = Math.min(needed, w.reserve);
  return { ...w, magazine: w.magazine + taken, reserve: w.reserve - taken, reloadCompleteAt: null };
};

export const isReloading = (w: Weapon): boolean => w.reloadCompleteAt !== null;

export interface TriggerResult {
  readonly weapon: Weapon;
  /** The charge just started building from zero this step. */
  readonly chargeStarted: boolean;
  /** The trigger went from held to released this step; `charge` is the level it was let go at. */
  readonly released: boolean;
  readonly charge: number;
  /** True when this step should attempt a shot through `tryFire`. */
  readonly pull: boolean;
}

/**
 * Advances charge and spin for a held or released trigger. A charged weapon fires on release
 * once fully charged; everything else fires while the trigger is held. A dry charged weapon
 * still reports a pull so the player hears the empty click.
 */
export const stepTrigger = (w: Weapon, fire: boolean, dt: number, now: number): TriggerResult => {
  const spec = weaponSpec(w);
  const released = w.lastFire && !fire;
  const charge = stepCharge(w, spec, fire, dt, now);
  const spin =
    spec.spinUp > 0 ? Math.max(0, Math.min(1, w.spin + (fire ? dt : -dt) / spec.spinUp)) : w.spin;
  const pull =
    spec.chargeTime > 0 ? (released && w.charge >= 1) || (fire && w.magazine <= 0) : fire;
  return {
    weapon: { ...w, charge, spin, lastFire: fire },
    chargeStarted: w.charge === 0 && charge > 0,
    released,
    charge: released ? w.charge : charge,
    pull,
  };
};

/** Charge builds while the trigger is held on a ready weapon and drops to zero when released. */
const stepCharge = (
  w: Weapon,
  spec: WeaponSpec,
  fire: boolean,
  dt: number,
  now: number,
): number => {
  if (spec.chargeTime <= 0) return w.charge;
  if (!fire) return 0;
  const ready = !isReloading(w) && w.magazine > 0 && now >= w.nextShotAt;
  return ready ? Math.min(1, w.charge + dt / spec.chargeTime) : w.charge;
};

/** Damage of one pellet at `distance`, after the spec's linear falloff. */
export const pelletDamage = (spec: WeaponSpec, distance: number): number => {
  if (distance <= spec.falloffStart) return spec.damage;
  if (distance >= spec.falloffEnd) return spec.damage * FALLOFF_FLOOR;
  const t = (distance - spec.falloffStart) / (spec.falloffEnd - spec.falloffStart);
  return spec.damage * (1 - t * (1 - FALLOFF_FLOOR));
};

export interface BeamResult {
  /** Where the beam stops: the first cover block or `maxDist`. */
  readonly distance: number;
  /** Every sphere the beam passes through before it stops, nearest first. */
  readonly targetIds: readonly number[];
}

/** A penetrating ray: cover stops it, enemies do not. */
export const beamHits = (
  origin: Vec3,
  dir: Vec3,
  targets: readonly SphereTarget[],
  obstacles: readonly Aabb[],
  maxDist: number,
): BeamResult => {
  let distance = maxDist;
  for (const box of obstacles) {
    const t = rayAabb(origin, dir, box, distance);
    if (t !== null && t < distance) distance = t;
  }
  const hits: { id: number; t: number }[] = [];
  for (const target of targets) {
    const t = raySphere(origin, dir, target.center, target.radius, distance);
    if (t !== null) hits.push({ id: target.id, t });
  }
  hits.sort((a, b) => a.t - b.t);
  return { distance, targetIds: hits.map((h) => h.id) };
};
