/** Magazine-fed hitscan rifle. All timing is in simulation seconds. */
export interface Weapon {
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
}

export const createRifle = (): Weapon => ({
  magazine: 32,
  magazineSize: 32,
  reserve: 160,
  fireInterval: 0.1,
  reloadTime: 1.8,
  damage: 20,
  range: 120,
  nextShotAt: 0,
  reloadCompleteAt: null,
});

export type FireResult =
  | { readonly kind: 'fired'; readonly weapon: Weapon }
  | { readonly kind: 'empty'; readonly weapon: Weapon }
  | { readonly kind: 'cooling'; readonly weapon: Weapon };

export const tryFire = (w: Weapon, now: number): FireResult => {
  if (w.reloadCompleteAt !== null || now < w.nextShotAt) return { kind: 'cooling', weapon: w };
  if (w.magazine <= 0) return { kind: 'empty', weapon: { ...w, nextShotAt: now + 0.3 } };
  return {
    kind: 'fired',
    weapon: { ...w, magazine: w.magazine - 1, nextShotAt: now + w.fireInterval },
  };
};

export const startReload = (w: Weapon, now: number): Weapon => {
  if (w.reloadCompleteAt !== null || w.magazine >= w.magazineSize || w.reserve <= 0) return w;
  return { ...w, reloadCompleteAt: now + w.reloadTime };
};

export const tickWeapon = (w: Weapon, now: number): Weapon => {
  if (w.reloadCompleteAt === null || now < w.reloadCompleteAt) return w;
  const needed = w.magazineSize - w.magazine;
  const taken = Math.min(needed, w.reserve);
  return { ...w, magazine: w.magazine + taken, reserve: w.reserve - taken, reloadCompleteAt: null };
};

export const isReloading = (w: Weapon): boolean => w.reloadCompleteAt !== null;
