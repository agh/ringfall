import { describe, expect, it } from 'vitest';
import { createEnemy } from '../../src/core/enemy';
import {
  createGame,
  type GameEvent,
  type GameState,
  IDLE_INPUT,
  type InputFrame,
  lookDirection,
  PLAYER_JUMP_SPEED,
  playerEye,
  STARTING_GRENADES,
  stepGame,
} from '../../src/core/game';
import { createRng } from '../../src/core/rng';
import { vec3 } from '../../src/core/vec3';
import { WAVE_COUNTDOWN } from '../../src/core/waves';

const DT = 1 / 60;

const run = (
  state: GameState,
  input: InputFrame,
  seconds: number,
  seed = 1,
): { state: GameState; events: GameEvent[] } => {
  const rng = createRng(seed);
  const events: GameEvent[] = [];
  let s = state;
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    s = stepGame(s, input, DT, rng);
    events.push(...s.events);
  }
  return { state: s, events };
};

/** A game whose arena has no cover, so movement tests are not blocked by random geometry. */
const openGame = (): GameState => {
  const g = createGame({ seed: 1 });
  return { ...g, arena: { ...g.arena, obstacles: [] } };
};

describe('game', () => {
  it('starts in a countdown with a full loadout', () => {
    const g = createGame({ seed: 3 });
    expect(g.status).toBe('playing');
    expect(g.wave.phase).toBe('countdown');
    expect(g.player.grenades).toBe(STARTING_GRENADES);
    expect(g.player.vitality.shield).toBe(100);
    expect(playerEye(g.player).y).toBeCloseTo(1.7);
    expect(lookDirection(g.player).z).toBeCloseTo(-1);
  });

  it('spawns the first wave after the countdown', () => {
    const { state, events } = run(createGame({ seed: 2 }), IDLE_INPUT, WAVE_COUNTDOWN + 0.1);
    expect(state.wave.phase).toBe('active');
    expect(state.enemies.length).toBe(3);
    expect(events.some((e) => e.type === 'waveStarted')).toBe(true);
  });

  it('moves the player with WASD-style input relative to yaw', () => {
    const { state } = run(openGame(), { ...IDLE_INPUT, forward: 1 }, 1);
    expect(state.player.position.z).toBeLessThan(-5);
    const turned = run(openGame(), { ...IDLE_INPUT, forward: 1, yaw: Math.PI / 2 }, 1).state;
    expect(turned.player.position.x).toBeLessThan(-5);
    const sprint = run(openGame(), { ...IDLE_INPUT, forward: 1, sprint: true }, 1).state;
    expect(sprint.player.position.z).toBeLessThan(state.player.position.z);
  });

  it('jumps and lands', () => {
    const rng = createRng(1);
    let s = stepGame(openGame(), { ...IDLE_INPUT, jump: true }, DT, rng);
    expect(s.player.onGround).toBe(false);
    expect(s.player.verticalVelocity).toBeCloseTo(PLAYER_JUMP_SPEED);
    for (let i = 0; i < 120; i += 1) s = stepGame(s, IDLE_INPUT, DT, rng);
    expect(s.player.onGround).toBe(true);
    expect(s.player.position.y).toBe(0);
  });

  it('shoots an enemy standing in front of the player', () => {
    const base = openGame();
    const enemy = { ...createEnemy(99, 'skimmer', vec3(0, 0, -8), 0), state: 'chase' as const };
    const armed: GameState = { ...base, enemies: [enemy], wave: { ...base.wave, phase: 'active' } };
    // Aim slightly down: the skimmer's centre sits below eye height.
    const pitch = Math.atan2(0.6 - 1.7, 8);
    const { state, events } = run(armed, { ...IDLE_INPUT, fire: true, pitch }, 0.5);
    const shots = events.filter((e) => e.type === 'shot');
    expect(shots.length).toBeGreaterThan(2);
    expect(shots.some((e) => e.type === 'shot' && e.hitEnemy)).toBe(true);
    expect(events.some((e) => e.type === 'enemyKilled')).toBe(true);
    expect(state.kills).toBe(1);
    expect(state.score).toBeGreaterThan(0);
    expect(state.player.weapon.magazine).toBeLessThan(32);
  });

  it('reports an empty magazine and reloads on request', () => {
    const base = openGame();
    const dry: GameState = {
      ...base,
      player: { ...base.player, weapon: { ...base.player.weapon, magazine: 0 } },
    };
    const empty = run(dry, { ...IDLE_INPUT, fire: true }, 0.1);
    expect(empty.events.some((e) => e.type === 'empty')).toBe(true);
    const reload = run(dry, { ...IDLE_INPUT, reload: true }, 2.5);
    expect(reload.events.filter((e) => e.type === 'reload')).toHaveLength(1);
    expect(reload.state.player.weapon.magazine).toBe(32);
  });

  it('throws a grenade that explodes and damages nearby enemies', () => {
    const base = openGame();
    const enemy = { ...createEnemy(5, 'strider', vec3(0, 0, -14), 0), state: 'attack' as const };
    const armed: GameState = {
      ...base,
      enemies: [enemy],
      wave: { ...base.wave, phase: 'active' },
      player: { ...base.player, pitch: 0.35 },
    };
    const rng = createRng(1);
    let s = stepGame(armed, { ...IDLE_INPUT, throwGrenade: true, pitch: 0.35 }, DT, rng);
    expect(s.player.grenades).toBe(STARTING_GRENADES - 1);
    expect(s.grenades).toHaveLength(1);
    const events: GameEvent[] = [];
    for (let i = 0; i < 60 * 3; i += 1) {
      s = stepGame(s, { ...IDLE_INPUT, pitch: 0.35 }, DT, rng);
      events.push(...s.events);
    }
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(s.grenades).toHaveLength(0);
    const target = s.enemies.find((e) => e.id === 5);
    expect(target === undefined || target.health < 120).toBe(true);
  });

  it('lets enemies hurt the player, break the shield, and eventually kill them', () => {
    const base = openGame();
    const enemies = Array.from({ length: 6 }, (_, i) =>
      createEnemy(10 + i, 'skimmer', vec3(0.5 * i, 0, -1.5), 0),
    );
    const swarmed: GameState = { ...base, enemies, wave: { ...base.wave, phase: 'active' } };
    const { state, events } = run(swarmed, IDLE_INPUT, 20);
    expect(events.some((e) => e.type === 'playerDamaged')).toBe(true);
    expect(events.some((e) => e.type === 'shieldBroken')).toBe(true);
    expect(events.some((e) => e.type === 'playerDied')).toBe(true);
    expect(state.status).toBe('dead');
    // A finished game is frozen.
    const frozen = stepGame(state, { ...IDLE_INPUT, forward: 1 }, DT, createRng(1));
    expect(frozen.player.position).toEqual(state.player.position);
    expect(frozen.events).toHaveLength(0);
  });

  it('spawns bolts from striders that can hit the player', () => {
    const base = openGame();
    const strider = { ...createEnemy(7, 'strider', vec3(0, 0, -10), 0), state: 'attack' as const };
    const armed: GameState = {
      ...base,
      enemies: [strider],
      wave: { ...base.wave, phase: 'active' },
    };
    const { events } = run(armed, IDLE_INPUT, 6);
    expect(events.some((e) => e.type === 'boltFired')).toBe(true);
    expect(events.some((e) => e.type === 'playerDamaged')).toBe(true);
  });

  it('clears a wave, awards the bonus, and advances', () => {
    const base = openGame();
    const started = run(base, IDLE_INPUT, WAVE_COUNTDOWN + 0.1).state;
    const cleared: GameState = {
      ...started,
      enemies: started.enemies.map((e) => ({ ...e, state: 'dead' as const, diedAt: started.time })),
    };
    const { state, events } = run(cleared, IDLE_INPUT, 6);
    expect(events.some((e) => e.type === 'waveCleared')).toBe(true);
    expect(state.wave.number).toBe(2);
    expect(state.score).toBeGreaterThanOrEqual(500);
    expect(state.enemies.length).toBeGreaterThan(0);
  });

  it('declares victory when the final wave is cleared', () => {
    const base = openGame();
    const final: GameState = {
      ...base,
      wave: { number: 8, phase: 'active', phaseEndsAt: 0 },
    };
    const { state, events } = run(final, IDLE_INPUT, 0.1);
    expect(state.status).toBe('won');
    expect(events.some((e) => e.type === 'victory')).toBe(true);
  });
});
