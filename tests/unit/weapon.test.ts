import { describe, expect, it } from 'vitest';
import { createRifle, isReloading, startReload, tickWeapon, tryFire } from '../../src/core/weapon';

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
});
