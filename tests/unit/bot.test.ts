import { describe, expect, it } from 'vitest';
import { createBotMemory, decideBot, RECKLESS_BOT, STEADY_BOT } from '../../src/core/bot';
import { createEnemy, type EnemyKind } from '../../src/core/enemy';
import { createGame, type GameState } from '../../src/core/game';
import { createPickup } from '../../src/core/pickups';
import { runPlaytest, summarize } from '../../src/core/playtest';
import { createRng } from '../../src/core/rng';
import { vec3 } from '../../src/core/vec3';
import { createWeapon, type Weapon, type WeaponKind } from '../../src/core/weapon';

const DT = 1 / 60;

const awake = (id: number, kind: EnemyKind, z: number) => ({
  ...createEnemy(id, kind, vec3(0, 0, z), 0),
  state: (kind === 'skimmer' ? 'chase' : 'attack') as 'chase' | 'attack',
});

/** An open arena, the bot holding `active` with `holster` in the other slot, enemies awake. */
const scene = (
  active: Weapon,
  holster: Weapon | null,
  enemies: ReturnType<typeof awake>[],
  time = 10,
): GameState => {
  const g = createGame({ seed: 1 });
  return {
    ...g,
    time,
    arena: { ...g.arena, obstacles: [] },
    enemies,
    wave: { ...g.wave, phase: 'active' },
    player: { ...g.player, weapon: active, weapons: [active, holster], activeSlot: 0 },
  };
};

/** Memory already aimed at a target centre `y` high and `dist` ahead. */
const aimedAt = (y: number, dist: number) => ({
  ...createBotMemory(),
  pitch: Math.atan2(y - 1.7, dist),
});

const decide = (state: GameState, memory = createBotMemory()) =>
  decideBot(state, memory, STEADY_BOT, DT, createRng(4)).input;

/**
 * These are floors that prove the bot is a working, deterministic player, not balance targets.
 * The balance numbers themselves come from `pnpm balance` (tests/balance/report.test.ts).
 */
describe('playtest bot', () => {
  it('is deterministic for a seed', () => {
    const a = runPlaytest({ seed: 11, maxSeconds: 60 });
    const b = runPlaytest({ seed: 11, maxSeconds: 60 });
    expect(a).toEqual(b);
  });

  it('clears the first wave on most seeds and lands at least a quarter of its shots overall', () => {
    const results = Array.from({ length: 8 }, (_, i) =>
      runPlaytest({ seed: 200 + i, maxSeconds: 150 }),
    );
    const cleared = results.filter((r) => r.waveClearTimes.length >= 1).length;
    const summary = summarize(results);
    expect(cleared).toBeGreaterThanOrEqual(5);
    expect(summary.accuracy).toBeGreaterThan(0.25);
    expect(results.reduce((a, r) => a + r.kills, 0)).toBeGreaterThanOrEqual(8 * 3);
  });

  it('reports a balance summary across seeds', () => {
    const results = Array.from({ length: 6 }, (_, i) =>
      runPlaytest({ seed: 100 + i, maxSeconds: 240 }),
    );
    const summary = summarize(results);
    expect(summary.games).toBe(6);
    expect(summary.meanWavesCleared).toBeGreaterThanOrEqual(1);
    expect(summary.meanWaveClearTimes.length).toBeGreaterThanOrEqual(1);
  });

  it('runs both profiles to completion on the same seeds and reports them separately', () => {
    const seeds = [21, 22, 23, 24];
    const steady = summarize(
      seeds.map((seed) => runPlaytest({ seed, profile: STEADY_BOT, maxSeconds: 300 })),
    );
    const reckless = summarize(
      seeds.map((seed) => runPlaytest({ seed, profile: RECKLESS_BOT, maxSeconds: 300 })),
    );
    expect(steady.games).toBe(4);
    expect(reckless.games).toBe(4);
    // The profiles differ in at least one measured dimension; which one is a balance question
    // for the report, not a correctness assertion.
    expect(
      steady.meanShieldBreaks !== reckless.meanShieldBreaks ||
        steady.meanSeconds !== reckless.meanSeconds ||
        steady.accuracy !== reckless.accuracy,
    ).toBe(true);
  });

  describe('weapon handling', () => {
    it('holds the beam trigger until charged, then releases on a settled aim', () => {
      const charging = scene(createWeapon('beam'), null, [awake(1, 'strider', -10)]);
      expect(decide(charging, aimedAt(1.3, 10)).fire).toBe(true);
      const charged = { ...createWeapon('beam'), charge: 1 };
      expect(decide(scene(charged, null, [awake(1, 'strider', -10)]), aimedAt(1.3, 10)).fire).toBe(
        false,
      );
      // Still charged but the aim is a long way off: keep holding.
      const off = { ...aimedAt(1.3, 10), yaw: 1 };
      expect(decide(scene(charged, null, [awake(1, 'strider', -10)]), off).fire).toBe(true);
    });

    it('closes to ten metres before firing the scatter gun', () => {
      const far = scene(createWeapon('scatter'), null, [awake(1, 'skimmer', -15)]);
      const farInput = decide(far, aimedAt(0.6, 15));
      expect(farInput.fire).toBe(false);
      expect(farInput.forward).toBe(1);
      const near = scene(createWeapon('scatter'), null, [awake(1, 'skimmer', -7)]);
      expect(decide(near, aimedAt(0.6, 7)).fire).toBe(true);
    });

    it('fires the launcher at striders and clusters in its band, not at a lone close skimmer', () => {
      const launcher = createWeapon('launcher');
      expect(decide(scene(launcher, null, [awake(1, 'strider', -12)]), aimedAt(1.3, 12)).fire).toBe(
        true,
      );
      expect(decide(scene(launcher, null, [awake(1, 'strider', -5)]), aimedAt(1.3, 5)).fire).toBe(
        false,
      );
      expect(decide(scene(launcher, null, [awake(1, 'skimmer', -12)]), aimedAt(0.6, 12)).fire).toBe(
        false,
      );
      const pack = [awake(1, 'skimmer', -12), awake(2, 'skimmer', -13)];
      expect(decide(scene(launcher, null, pack), aimedAt(0.6, 12)).fire).toBe(true);
    });

    it('fires the minigun with a loose aim and the rifle with a tight one', () => {
      const target = [awake(1, 'skimmer', -10)];
      // One step of turning (0.076 rad at 260 deg/s) leaves about 0.064 rad of error.
      const loose = { ...aimedAt(0.6, 10), yaw: 0.14 };
      expect(decide(scene(createWeapon('minigun'), null, target), loose).fire).toBe(true);
      expect(decide(scene(createWeapon('rifle'), null, target), loose).fire).toBe(false);
      expect(decide(scene(createWeapon('rifle'), null, target), aimedAt(0.6, 10)).fire).toBe(true);
      expect(decide(scene({ ...createWeapon('rifle'), magazine: 0 }, null, target)).fire).toBe(
        false,
      );
    });

    it('swaps to a loaded holster when dry, or to a heavy weapon when a strider shows', () => {
      const dry = { ...createWeapon('rifle'), magazine: 0, reserve: 0 };
      const swapTo = (holster: Weapon | null, kind: EnemyKind, active = dry): boolean =>
        decide(scene(active, holster, [awake(1, kind, -12)]), aimedAt(1.3, 12)).swapWeapon;
      expect(swapTo(createWeapon('laser'), 'skimmer')).toBe(true);
      expect(swapTo({ ...createWeapon('laser'), magazine: 0, reserve: 0 }, 'skimmer')).toBe(false);
      expect(swapTo(null, 'skimmer')).toBe(false);
      expect(swapTo(createWeapon('beam'), 'strider', createWeapon('rifle'))).toBe(true);
      expect(swapTo(createWeapon('laser'), 'strider', createWeapon('rifle'))).toBe(false);
      expect(swapTo(createWeapon('beam'), 'skimmer', createWeapon('rifle'))).toBe(false);
      // A heavy weapon facing a skimmer up close goes back to the sidearm.
      const close = scene(createWeapon('launcher'), createWeapon('rifle'), [
        awake(1, 'skimmer', -4),
      ]);
      expect(decide(close, aimedAt(0.6, 4)).swapWeapon).toBe(true);
      // And never twice within the cooldown.
      const recent = { ...aimedAt(1.3, 12), lastSwapAt: 9.8 };
      expect(
        decideBot(
          scene(dry, createWeapon('laser'), [awake(1, 'skimmer', -12)]),
          recent,
          STEADY_BOT,
          DT,
          createRng(4),
        ).input.swapWeapon,
      ).toBe(false);
    });

    it('walks to a nearby pickup when nothing is in sight', () => {
      const quiet = scene(createWeapon('rifle'), null, []);
      const pickup = createPickup(9, 'laser' as WeaponKind, vec3(-6, 0, 0), 10);
      const input = decide({ ...quiet, pickups: [pickup] });
      expect(input.forward).toBe(1);
      expect(input.strafe).toBe(0);
      expect(input.fire).toBe(false);
      expect(decide(quiet).forward).toBe(0);
    });
  });
});
