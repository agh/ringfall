import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEnemy } from '../../src/core/enemy';
import {
  createGame,
  type GameEvent,
  type GameState,
  IDLE_INPUT,
  type InputFrame,
  playerCenter,
  stepGame,
  TABLEAU_DURATION,
} from '../../src/core/game';
import { createBolt } from '../../src/core/projectile';
import { createRng } from '../../src/core/rng';
import { add, vec3 } from '../../src/core/vec3';
import { FINAL_WAVE } from '../../src/core/waves';
import { InputController } from '../../src/input/input';

/**
 * Issue #97 pass C, merge seams: the victory tableau (#57) run together with the death path,
 * the fixed-step loop in `src/main.ts`, and the input lifecycle from the software review (#76).
 * The core cases build their state explicitly, as `game.test.ts` does, so a tuning change
 * cannot move a wall or a spawn into the scenario.
 */

const DT = 1 / 60;

const step = (state: GameState, input: InputFrame = IDLE_INPUT): GameState =>
  stepGame(state, input, DT, createRng(1));

const types = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);

/** An open arena on the final beat, with the player one hit from death. */
const lastStand = (enemies: GameState['enemies'], extra: Partial<GameState> = {}): GameState => {
  const g = createGame({ seed: 1 });
  return {
    ...g,
    arena: { ...g.arena, obstacles: [] },
    enemies,
    wave: { number: FINAL_WAVE, phase: 'active', phaseEndsAt: 0 },
    player: { ...g.player, vitality: { ...g.player.vitality, shield: 0, health: 1 } },
    ...extra,
  };
};

const leaderAt = (at: ReturnType<typeof vec3>, health: number) => ({
  ...createEnemy(50, 'strider', at, 0, { healthScale: 3, leader: true }),
  state: 'attack' as const,
  health,
});

/** A bolt `metres` in front of the player's centre, flying straight at it. */
const incomingBolt = (state: GameState, metres: number, damage: number) =>
  createBolt(1, add(playerCenter(state.player), vec3(0, 0, -metres)), vec3(0, 0, 1), damage, 0);

describe('seam 2: the tableau against the death path', () => {
  it('a bolt that lands in the step the leader falls kills the player: no victory, no tableau', () => {
    // The grenade sits on the leader, 12 m out; its 6 m blast cannot reach the player. The bolt
    // is 1 m from the player's centre and covers 0.37 m a step, so it lands in this same step.
    const base = lastStand([leaderAt(vec3(0, 0, -12), 1)]);
    const doomed: GameState = {
      ...base,
      grenades: [{ id: 99, position: vec3(0, 0, -12), velocity: vec3(0, 0, 0), explodeAt: 0 }],
      bolts: [incomingBolt(base, 1, 100)],
    };
    const next = step(doomed);
    expect(next.enemies.find((e) => e.id === 50)?.state).toBe('dead');
    expect(types(next.events)).toContain('playerDied');
    expect(types(next.events)).not.toContain('victory');
    expect(next.status).toBe('dead');
    expect(next.tableau).toBeNull();
    // Dead stays dead: a later step neither resurrects the run nor starts a tableau.
    const after = step(next);
    expect(after.status).toBe('dead');
    expect(after.tableau).toBeNull();
    expect(after.events).toEqual([]);
  });

  it('a blast that kills the leader and the player together is a death, not a win', () => {
    const base = lastStand([leaderAt(vec3(0, 0, -3), 1)]);
    const doomed: GameState = {
      ...base,
      grenades: [{ id: 99, position: vec3(0, 0, -2), velocity: vec3(0, 0, 0), explodeAt: 0 }],
    };
    const next = step(doomed);
    expect(next.enemies.find((e) => e.id === 50)?.state).toBe('dead');
    expect(types(next.events)).toContain('playerDied');
    expect(types(next.events)).not.toContain('victory');
    expect(next.status).toBe('dead');
    expect(next.tableau).toBeNull();
  });

  it('a bolt that lands one step after the leader fell is swallowed by the tableau', () => {
    // 1.6 m out: after one step the bolt is 1.23 m away (still flying), after two it is 0.87 m,
    // inside the 0.9 m hit sphere. The leader is already dead, so step one opens the tableau.
    const base = lastStand([{ ...leaderAt(vec3(0, 0, -12), 0), state: 'dead', diedAt: 0 }]);
    const primed: GameState = { ...base, bolts: [incomingBolt(base, 1.6, 100)] };
    const opened = step(primed);
    expect(types(opened.events)).toContain('victory');
    expect(opened.tableau).not.toBeNull();
    expect(opened.status).toBe('playing');
    expect(opened.bolts).toHaveLength(1);
    expect(types(opened.events)).not.toContain('playerDamaged');

    const landed = step(opened);
    // The bolt reached the player (it is consumed), and did nothing.
    expect(landed.bolts).toHaveLength(0);
    expect(types(landed.events)).not.toContain('playerDamaged');
    expect(types(landed.events)).not.toContain('playerDied');
    expect(landed.status).toBe('playing');
    expect(landed.player.vitality.health).toBe(1);
    expect(landed.tableau).toEqual(opened.tableau);
    expect(landed.tableau?.endsAt).toBeCloseTo((landed.tableau?.startedAt ?? 0) + TABLEAU_DURATION);
  });
});

describe('seam 2: the shell applies the tableau time scale', () => {
  // `src/main.ts` runs `main()` on import and needs a canvas, so the loop cannot be driven from
  // Node. This pins the wiring instead: the core's `timeScaleOf` must reach the accumulator.
  const mainSource = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');

  it('imports timeScaleOf from the core', () => {
    expect(mainSource).toMatch(/import \{[^}]*\btimeScaleOf\b[^}]*\} from '\.\/core\/game'/);
  });

  it('scales the accumulated frame time by timeScaleOf(game)', () => {
    const lines = mainSource.split('\n');
    const scaleLine = lines.find((l) => l.includes('timeScaleOf(game)'));
    expect(scaleLine, 'no line in src/main.ts applies timeScaleOf(game)').toBeDefined();
    const binding = /const (\w+) = timeScaleOf\(game\)/.exec(scaleLine ?? '')?.[1];
    expect(binding, 'timeScaleOf(game) is not bound to a frame time scale').toBeDefined();
    expect(lines.some((l) => l.includes(`accumulator += frameDt * ${binding}`))).toBe(true);
  });
});

describe('seam 5: the input controller through pause, resume and the settings panel', () => {
  type Listener = (e: unknown) => void;
  let listeners: Map<string, Listener[]>;
  let target: { requestPointerLock: () => void };
  let documentStub: {
    pointerLockElement: unknown;
    addEventListener: (type: string, fn: Listener) => void;
    exitPointerLock: () => void;
  };

  const fire = (type: string, event: unknown): void => {
    for (const fn of listeners.get(type) ?? []) fn(event);
  };
  const key = (code: string, repeat = false) => {
    const preventDefault = vi.fn();
    fire('keydown', { code, repeat, preventDefault });
    return preventDefault;
  };
  const keyUp = (code: string): void => fire('keyup', { code });
  const move = (movementX: number, movementY: number): void =>
    fire('mousemove', { movementX, movementY });
  const lock = (): void => {
    documentStub.pointerLockElement = target;
  };
  const unlock = (): void => {
    documentStub.pointerLockElement = null;
  };
  const controller = (): InputController => new InputController(target as unknown as HTMLElement);

  beforeEach(() => {
    listeners = new Map();
    const addEventListener = (type: string, fn: Listener): void => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    };
    target = { requestPointerLock: () => undefined };
    documentStub = { pointerLockElement: null, addEventListener, exitPointerLock: () => undefined };
    vi.stubGlobal('window', { addEventListener });
    vi.stubGlobal('document', documentStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records a one-shot key pressed on the title card, and release() drops it', () => {
    const input = controller();
    unlock();
    key('KeyR');
    key('KeyG');
    key('KeyQ');
    // Recorded even though the overlay owns the keyboard: the latch exists until a take().
    const latched = input.take();
    expect([latched.reload, latched.throwGrenade, latched.swapWeapon]).toEqual([true, true, true]);
    // Pressed again while adjusting a slider, then Resume: release() clears it before the step.
    key('KeyR');
    key('KeyG');
    key('KeyQ');
    input.release();
    const first = input.take();
    expect([first.reload, first.throwGrenade, first.swapWeapon]).toEqual([false, false, false]);
  });

  it('reset() starts a new game looking straight ahead with nothing held or latched', () => {
    const input = controller();
    lock();
    move(200, -50);
    key('KeyW');
    key('KeyG');
    fire('mousedown', { button: 0 });
    const before = input.take();
    expect(before.yaw).not.toBe(0);
    expect(before.pitch).not.toBe(0);
    key('KeyR');
    input.reset();
    const frame = input.take();
    expect(frame).toEqual({ ...IDLE_INPUT, yaw: 0, pitch: 0 });
  });

  it('release() keeps the look direction and drops held keys, fire and latches', () => {
    const input = controller();
    lock();
    move(200, -50);
    key('KeyW');
    key('ShiftLeft');
    key('KeyR');
    fire('mousedown', { button: 0 });
    fire('mousedown', { button: 2 });
    fire('wheel', { deltaY: 100 });
    const { yaw, pitch } = input.take();
    expect(yaw).toBeCloseTo(-200 * 0.0022);
    expect(pitch).toBeCloseTo(50 * 0.0022);
    key('KeyA');
    key('KeyQ');
    fire('mousedown', { button: 0 });
    input.release();
    expect(input.take()).toEqual({ ...IDLE_INPUT, yaw, pitch });
    // Nothing leaked into the step after the resume either.
    expect(input.take()).toEqual({ ...IDLE_INPUT, yaw, pitch });
  });

  it('setSensitivity(2) doubles the look per pixel; mouse travel is ignored when not locked', () => {
    const input = controller();
    unlock();
    move(100, 100);
    expect(input.take()).toMatchObject({ yaw: 0, pitch: 0 });
    lock();
    move(100, 0);
    expect(input.take().yaw).toBeCloseTo(-0.22);
    input.setSensitivity(2);
    move(100, 0);
    expect(input.take().yaw).toBeCloseTo(-0.22 - 0.44);
    input.setSensitivity(1);
    move(100, 0);
    expect(input.take().yaw).toBeCloseTo(-0.22 - 0.44 - 0.22);
  });

  it('a wheel notch latches a swap only while locked, and take() clears it', () => {
    const input = controller();
    unlock();
    fire('wheel', { deltaY: 120 });
    expect(input.take().swapWeapon).toBe(false);
    lock();
    fire('wheel', { deltaY: 0 });
    expect(input.take().swapWeapon).toBe(false);
    fire('wheel', { deltaY: -120 });
    expect(input.take().swapWeapon).toBe(true);
    expect(input.take().swapWeapon).toBe(false);
  });

  it('a right click latches a grenade only while locked; a blur drops everything', () => {
    const input = controller();
    unlock();
    fire('mousedown', { button: 2 });
    fire('mousedown', { button: 0 });
    expect(input.take()).toMatchObject({ throwGrenade: false, fire: false });
    lock();
    fire('mousedown', { button: 2 });
    fire('mousedown', { button: 0 });
    key('KeyW');
    expect(input.take()).toMatchObject({ throwGrenade: true, fire: true, forward: 1 });
    expect(input.take()).toMatchObject({ throwGrenade: false, fire: true, forward: 1 });
    fire('blur', {});
    expect(input.take()).toMatchObject({ throwGrenade: false, fire: false, forward: 0 });
  });

  it('ignores key repeats, releases on keyup, and claims Space and Tab only while locked', () => {
    const input = controller();
    unlock();
    expect(key('Space').mock.calls).toHaveLength(0);
    expect(key('Tab').mock.calls).toHaveLength(0);
    lock();
    expect(key('Space').mock.calls).toHaveLength(1);
    expect(key('Tab').mock.calls).toHaveLength(1);
    expect(input.take().jump).toBe(true);
    keyUp('Space');
    expect(input.take().jump).toBe(false);
    key('KeyR');
    input.take();
    key('KeyR', true);
    expect(input.take().reload).toBe(false);
  });
});
