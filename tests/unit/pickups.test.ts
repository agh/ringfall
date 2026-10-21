import { describe, expect, it } from 'vitest';
import {
  chooseKind,
  createPickup,
  expirePickups,
  heldKinds,
  PICKUP_DROP_CHANCE,
  PICKUP_KINDS,
  PICKUP_LIFETIME,
  PICKUP_RADIUS,
  pickupInReach,
  rewardPosition,
  rollDrop,
  takeWeapon,
  WAVE_REWARD_DISTANCE,
  type WeaponSlots,
} from '../../src/core/pickups';
import { createRng } from '../../src/core/rng';
import { vec3 } from '../../src/core/vec3';
import { createWeapon } from '../../src/core/weapon';
import { type Arena, aabbFromCenter } from '../../src/core/world';

describe('pickups', () => {
  it('vends only kinds the player does not hold, and never the rifle', () => {
    const rng = createRng(5);
    for (let i = 0; i < 50; i += 1) {
      const kind = chooseKind(['rifle', 'beam'], rng);
      expect(kind).not.toBe('rifle');
      expect(kind).not.toBe('beam');
      expect(PICKUP_KINDS).toContain(kind);
    }
    expect(chooseKind([...PICKUP_KINDS], rng)).toBeNull();
    expect(heldKinds([createWeapon('rifle'), null])).toEqual(['rifle']);
    expect(heldKinds([createWeapon('rifle'), createWeapon('laser')])).toEqual(['rifle', 'laser']);
  });

  it('drops at the per-kind rate with a seeded rng, deterministically', () => {
    const trials = 4000;
    const rate = (enemy: 'skimmer' | 'strider', seed: number): number => {
      const rng = createRng(seed);
      let drops = 0;
      for (let i = 0; i < trials; i += 1) {
        if (rollDrop(enemy, ['rifle'], rng) !== null) drops += 1;
      }
      return drops / trials;
    };
    expect(Math.abs(rate('skimmer', 1) - PICKUP_DROP_CHANCE.skimmer)).toBeLessThan(0.03);
    expect(Math.abs(rate('strider', 1) - PICKUP_DROP_CHANCE.strider)).toBeLessThan(0.03);
    expect(rate('strider', 9)).toBe(rate('strider', 9));
    // Holding every vendable kind means a successful roll still yields nothing.
    const rng = createRng(3);
    const none = Array.from({ length: 100 }, () => rollDrop('strider', [...PICKUP_KINDS], rng));
    expect(none.every((k) => k === null)).toBe(true);
  });

  it('lies on the floor for its lifetime and then expires', () => {
    const p = createPickup(7, 'laser', vec3(3, 1.2, -4), 10);
    expect(p.position).toEqual(vec3(3, 0, -4));
    expect(p.expiresAt).toBe(10 + PICKUP_LIFETIME);
    const later = createPickup(8, 'beam', vec3(), 25);
    const { kept, expired } = expirePickups([p, later], 10 + PICKUP_LIFETIME);
    expect(expired.map((x) => x.id)).toEqual([7]);
    expect(kept.map((x) => x.id)).toEqual([8]);
  });

  it('is taken by walking within reach, nearest first', () => {
    const near = createPickup(1, 'laser', vec3(0, 0, -1), 0);
    const nearer = createPickup(2, 'beam', vec3(0.5, 0, 0), 0);
    const far = createPickup(3, 'scatter', vec3(0, 0, -PICKUP_RADIUS - 0.01), 0);
    expect(pickupInReach([near, nearer, far], vec3())?.id).toBe(2);
    expect(pickupInReach([far], vec3())).toBeNull();
    expect(pickupInReach([], vec3())).toBeNull();
  });

  it('fills an empty slot, then replaces the active weapon', () => {
    const rifle = createWeapon('rifle');
    const filled = takeWeapon([rifle, null], 0, 'laser');
    expect(filled.slot).toBe(1);
    expect(filled.activeSlot).toBe(1);
    expect(filled.slots[0]).toBe(rifle);
    expect(filled.slots[1]?.kind).toBe('laser');

    const replaced = takeWeapon(filled.slots, 1, 'beam');
    expect(replaced.slot).toBe(1);
    expect(replaced.slots[0]).toBe(rifle);
    expect(replaced.slots[1]?.kind).toBe('beam');

    const both: WeaponSlots = [rifle, createWeapon('scatter')];
    const swapped = takeWeapon(both, 0, 'minigun');
    expect(swapped.slot).toBe(0);
    expect(swapped.slots[0].kind).toBe('minigun');
    expect(swapped.slots[1]?.kind).toBe('scatter');
    expect(swapped.activeSlot).toBe(0);
  });

  it('places the wave reward ahead of the player, pulling back from cover and the edge', () => {
    const open: Arena = { halfSize: 30, obstacles: [] };
    const ahead = rewardPosition(open, vec3(0, 0, 0), 0);
    expect(ahead.x).toBeCloseTo(0);
    expect(ahead.z).toBeCloseTo(-WAVE_REWARD_DISTANCE);
    const turned = rewardPosition(open, vec3(1, 0, 1), Math.PI / 2);
    expect(turned.x).toBeCloseTo(1 - WAVE_REWARD_DISTANCE);
    expect(turned.z).toBeCloseTo(1);

    const covered: Arena = { halfSize: 30, obstacles: [aabbFromCenter(0, -6, 2, 3, 2)] };
    const pulled = rewardPosition(covered, vec3(), 0);
    expect(pulled.z).toBeCloseTo(-WAVE_REWARD_DISTANCE / 2);

    const edge = rewardPosition(open, vec3(0, 0, -28), 0);
    expect(edge).toEqual(vec3(0, 0, -28));
  });
});
