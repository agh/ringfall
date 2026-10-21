import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/core/vec3';
import {
  beamHits,
  createRifle,
  createWeapon,
  effectiveFireInterval,
  FALLOFF_FLOOR,
  isReloading,
  MINIGUN_IDLE_RATE,
  pelletDamage,
  startReload,
  stepTrigger,
  tickWeapon,
  totalAmmo,
  tryFire,
  WEAPON_KINDS,
  WEAPON_SPECS,
  type Weapon,
  weaponSpec,
} from '../../src/core/weapon';
import { aabbFromCenter } from '../../src/core/world';

const DT = 1 / 60;

/** Holds or releases the trigger for `seconds`, stepping the weapon at 60 Hz. */
const hold = (w: Weapon, fire: boolean, seconds: number, from = 0): Weapon => {
  let weapon = w;
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    weapon = stepTrigger(weapon, fire, DT, from + (i + 1) * DT).weapon;
  }
  return weapon;
};

describe('weapon', () => {
  it('fires, enforces the fire interval, and empties', () => {
    let w = createRifle();
    const first = tryFire(w, 0);
    expect(first.kind).toBe('fired');
    w = first.weapon;
    expect(w.magazine).toBe(31);
    expect(tryFire(w, 0.05).kind).toBe('cooling');
    w = { ...w, magazine: 0 };
    const empty = tryFire(w, 1);
    expect(empty.kind).toBe('empty');
    expect(tryFire(empty.weapon, 1.1).kind).toBe('cooling');
  });

  it('reloads from reserve after the reload time', () => {
    let w = { ...createRifle(), magazine: 2 };
    w = startReload(w, 0);
    expect(isReloading(w)).toBe(true);
    expect(tryFire(w, 0.5).kind).toBe('cooling');
    expect(tickWeapon(w, 1)).toBe(w);
    w = tickWeapon(w, 2);
    expect(w.magazine).toBe(32);
    expect(w.reserve).toBe(130);
    expect(isReloading(w)).toBe(false);
  });

  it('refuses pointless reloads and caps at the remaining reserve', () => {
    const full = createRifle();
    expect(startReload(full, 0)).toBe(full);
    const dry = { ...createRifle(), magazine: 0, reserve: 0 };
    expect(startReload(dry, 0)).toBe(dry);
    let low = { ...createRifle(), magazine: 0, reserve: 5 };
    low = tickWeapon(startReload(low, 0), 10);
    expect(low.magazine).toBe(5);
    expect(low.reserve).toBe(0);
    const twice = startReload(startReload(createRifle(), 0), 0);
    expect(isReloading(twice)).toBe(false);
  });

  it('creates every kind from its spec, with the rifle unchanged', () => {
    for (const kind of WEAPON_KINDS) {
      const w = createWeapon(kind);
      const spec = WEAPON_SPECS[kind];
      expect(w.kind).toBe(kind);
      expect(w.magazine).toBe(spec.magazineSize);
      expect(w.reserve).toBe(spec.reserve);
      expect(w.damage).toBe(spec.damage);
      expect(w.range).toBe(spec.range);
      expect(w.charge).toBe(0);
      expect(w.spin).toBe(0);
      expect(w.lastFire).toBe(false);
      expect(weaponSpec(w)).toBe(spec);
      expect(totalAmmo(w)).toBe(spec.magazineSize + spec.reserve);
    }
    expect(createRifle()).toEqual(createWeapon('rifle'));
    expect(WEAPON_SPECS.rifle).toMatchObject({
      magazineSize: 32,
      reserve: 160,
      fireInterval: 0.1,
      damage: 20,
      range: 120,
    });
  });

  it('laser: pinpoint standing, a hair of spread moving, moderate damage', () => {
    const spec = WEAPON_SPECS.laser;
    expect(spec.spreadStanding).toBe(0);
    expect(spec.spreadMoving).toBe(0.004);
    expect(spec.damage).toBe(45);
    expect(spec.pellets).toBe(1);
    expect(pelletDamage(spec, 150)).toBe(45);
    const trigger = stepTrigger(createWeapon('laser'), true, DT, DT);
    expect(trigger.pull).toBe(true);
    expect(trigger.weapon.charge).toBe(0);
  });

  it('scatter: eight pellets whose damage falls off from 6 m to 20 % at 14 m', () => {
    const spec = WEAPON_SPECS.scatter;
    expect(spec.pellets).toBe(8);
    expect(pelletDamage(spec, 0)).toBe(14);
    expect(pelletDamage(spec, 6)).toBe(14);
    expect(pelletDamage(spec, 10)).toBeCloseTo(14 * (1 - 0.5 * (1 - FALLOFF_FLOOR)));
    expect(pelletDamage(spec, 14)).toBeCloseTo(14 * FALLOFF_FLOOR);
    expect(pelletDamage(spec, 30)).toBeCloseTo(14 * FALLOFF_FLOOR);
  });

  it('beam: charges while held, fires on release once full, and not before', () => {
    const beam = createWeapon('beam');
    const first = stepTrigger(beam, true, DT, DT);
    expect(first.chargeStarted).toBe(true);
    expect(first.pull).toBe(false);
    expect(first.weapon.charge).toBeCloseTo(DT / 0.8);
    const half = hold(beam, true, 0.4);
    expect(half.charge).toBeGreaterThan(0.4);
    expect(half.charge).toBeLessThan(0.6);
    const early = stepTrigger(half, false, DT, 1);
    expect(early.released).toBe(true);
    expect(early.pull).toBe(false);
    expect(early.charge).toBeCloseTo(half.charge);
    expect(early.weapon.charge).toBe(0);

    const full = hold(beam, true, 1);
    expect(full.charge).toBe(1);
    const release = stepTrigger(full, false, DT, 2);
    expect(release.released).toBe(true);
    expect(release.pull).toBe(true);
    expect(release.charge).toBe(1);
    const fired = tryFire(release.weapon, 2);
    expect(fired.kind).toBe('fired');
    expect(fired.weapon.magazine).toBe(3);
    // Cooling after a shot: holding the trigger again builds no charge until 1.2 s pass.
    const cooling = hold(fired.weapon, true, 0.5, 2);
    expect(cooling.charge).toBe(0);
    const again = hold(fired.weapon, true, 2, 2);
    expect(again.charge).toBe(1);
  });

  it('beam: a dry trigger still clicks, and a reload drops the charge', () => {
    const dry = { ...createWeapon('beam'), magazine: 0 };
    const pulled = stepTrigger(dry, true, DT, 1);
    expect(pulled.pull).toBe(true);
    expect(pulled.weapon.charge).toBe(0);
    expect(tryFire(pulled.weapon, 1).kind).toBe('empty');
    const charged = { ...hold(createWeapon('beam'), true, 0.5), magazine: 2 };
    expect(startReload(charged, 1).charge).toBe(0);
    expect(hold(startReload(charged, 1), true, 0.5, 1).charge).toBe(0);
  });

  it('beam: the ray penetrates every sphere up to the first wall', () => {
    const origin = vec3(0, 1, 0);
    const dir = vec3(0, 0, -1);
    const targets = [
      { id: 3, center: vec3(0, 1, -12), radius: 0.8 },
      { id: 1, center: vec3(0, 1, -4), radius: 0.5 },
      { id: 2, center: vec3(0, 1, -8), radius: 0.5 },
      { id: 4, center: vec3(0, 1, -30), radius: 0.8 },
      { id: 5, center: vec3(3, 1, -6), radius: 0.5 },
    ];
    const wall = aabbFromCenter(0, -20, 4, 3, 1);
    const hit = beamHits(origin, dir, targets, [wall], 100);
    expect(hit.targetIds).toEqual([1, 2, 3]);
    expect(hit.distance).toBeCloseTo(19.5);
    const open = beamHits(origin, dir, targets, [], 100);
    expect(open.targetIds).toEqual([1, 2, 3, 4]);
    expect(open.distance).toBe(100);
  });

  it('minigun: spins up over half a second to its full rate and winds down when released', () => {
    const gun = createWeapon('minigun');
    expect(WEAPON_SPECS.minigun.reserve).toBe(0);
    expect(effectiveFireInterval(gun)).toBeCloseTo(0.045 / MINIGUN_IDLE_RATE);
    const quarter = hold(gun, true, 0.25);
    expect(quarter.spin).toBeCloseTo(0.5);
    expect(effectiveFireInterval(quarter)).toBeGreaterThan(0.045);
    expect(effectiveFireInterval(quarter)).toBeLessThan(0.045 / MINIGUN_IDLE_RATE);
    const full = hold(gun, true, 0.6);
    expect(full.spin).toBe(1);
    expect(effectiveFireInterval(full)).toBeCloseTo(0.045);
    expect(stepTrigger(full, true, DT, 1).pull).toBe(true);
    const wound = hold(full, false, 0.3, 1);
    expect(wound.spin).toBeCloseTo(0.4);
    expect(wound.charge).toBe(0);
    const fired = tryFire(full, 1);
    expect(fired.kind).toBe('fired');
    expect(fired.weapon.nextShotAt).toBeCloseTo(1.045);
    expect(startReload({ ...gun, magazine: 0 }, 1).reloadCompleteAt).toBeNull();
  });

  it('rifle: the trigger has no charge or spin to track', () => {
    const w = hold(createRifle(), true, 0.5);
    expect(w.charge).toBe(0);
    expect(w.spin).toBe(0);
    expect(w.lastFire).toBe(true);
    expect(effectiveFireInterval(w)).toBe(0.1);
  });
});
