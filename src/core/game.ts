import {
  createEnemy,
  damageEnemy,
  ENEMY_STATS,
  type Enemy,
  enemyCenter,
  updateEnemy,
} from './enemy';
import {
  blastDamage,
  GRENADE_BLAST_RADIUS,
  type Grenade,
  stepGrenade,
  throwGrenade,
} from './grenade';
import { type Bolt, createBolt, stepBolt } from './projectile';
import { hitscan } from './raycast';
import { createRng, type Rng } from './rng';
import { add, clamp, directionFromAngles, distance, scale, type Vec3, vec3 } from './vec3';
import { applyDamage, createVitality, tickVitality, type Vitality } from './vitality';
import { createWaveState, tickWave, WAVE_BONUS, type WaveState, waveComposition } from './waves';
import { createRifle, startReload, tickWeapon, tryFire, type Weapon } from './weapon';
import {
  type Arena,
  findSpawnPoint,
  generateArena,
  groundHeightAt,
  moveWithCollision,
} from './world';

export const PLAYER_EYE_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_SPEED = 6;
export const PLAYER_SPRINT_SPEED = 9;
export const PLAYER_JUMP_SPEED = 6;
export const GRAVITY = 18;
export const STARTING_GRENADES = 4;
export const SPAWN_RING_RADIUS = 26;
export const CORPSE_LINGER = 1.2;
const MAX_PITCH = Math.PI / 2 - 0.01;

export interface Player {
  readonly position: Vec3;
  readonly verticalVelocity: number;
  readonly onGround: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly vitality: Vitality;
  readonly weapon: Weapon;
  readonly grenades: number;
}

export interface InputFrame {
  /** -1 (back) to 1 (forward). */
  readonly forward: number;
  /** -1 (left) to 1 (right). */
  readonly strafe: number;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly fire: boolean;
  readonly reload: boolean;
  readonly throwGrenade: boolean;
  /** Absolute look angles in radians. */
  readonly yaw: number;
  readonly pitch: number;
}

export const IDLE_INPUT: InputFrame = {
  forward: 0,
  strafe: 0,
  jump: false,
  sprint: false,
  fire: false,
  reload: false,
  throwGrenade: false,
  yaw: 0,
  pitch: 0,
};

export type GameEvent =
  | { readonly type: 'shot'; readonly from: Vec3; readonly to: Vec3; readonly hitEnemy: boolean }
  | { readonly type: 'empty' }
  | { readonly type: 'reload' }
  | { readonly type: 'grenadeThrown'; readonly id: number }
  | { readonly type: 'explosion'; readonly at: Vec3 }
  | { readonly type: 'enemyKilled'; readonly id: number; readonly at: Vec3; readonly score: number }
  | { readonly type: 'playerDamaged'; readonly amount: number; readonly from: Vec3 | null }
  | { readonly type: 'shieldBroken' }
  | { readonly type: 'boltFired'; readonly id: number }
  | { readonly type: 'waveStarted'; readonly number: number }
  | { readonly type: 'waveCleared'; readonly number: number }
  | { readonly type: 'playerDied' }
  | { readonly type: 'victory' };

export type GameStatus = 'playing' | 'dead' | 'won';

export interface GameState {
  readonly time: number;
  readonly status: GameStatus;
  readonly arena: Arena;
  readonly player: Player;
  readonly enemies: readonly Enemy[];
  readonly bolts: readonly Bolt[];
  readonly grenades: readonly Grenade[];
  readonly wave: WaveState;
  readonly score: number;
  readonly kills: number;
  readonly nextId: number;
  readonly events: readonly GameEvent[];
}

export interface GameConfig {
  readonly seed: number;
}

export const createGame = (config: GameConfig = { seed: 1 }): GameState => {
  const rng = createRng(config.seed);
  return {
    time: 0,
    status: 'playing',
    arena: generateArena(rng),
    player: {
      position: vec3(0, 0, 0),
      verticalVelocity: 0,
      onGround: true,
      yaw: 0,
      pitch: 0,
      vitality: createVitality(),
      weapon: createRifle(),
      grenades: STARTING_GRENADES,
    },
    enemies: [],
    bolts: [],
    grenades: [],
    wave: createWaveState(0),
    score: 0,
    kills: 0,
    nextId: 1,
    events: [],
  };
};

export const playerEye = (p: Player): Vec3 => add(p.position, vec3(0, PLAYER_EYE_HEIGHT, 0));
export const playerCenter = (p: Player): Vec3 => add(p.position, vec3(0, PLAYER_HEIGHT / 2, 0));
export const lookDirection = (p: Player): Vec3 => directionFromAngles(p.yaw, p.pitch);

/** Mutable scratch used while stepping; converted back to an immutable GameState at the end. */
interface Draft {
  time: number;
  status: GameStatus;
  arena: Arena;
  player: Player;
  enemies: Enemy[];
  bolts: Bolt[];
  grenades: Grenade[];
  wave: WaveState;
  score: number;
  kills: number;
  nextId: number;
  events: GameEvent[];
  rng: Rng;
}

const hurtPlayer = (d: Draft, amount: number, from: Vec3 | null): void => {
  if (d.status !== 'playing') return;
  const outcome = applyDamage(d.player.vitality, amount, d.time);
  d.player = { ...d.player, vitality: outcome.vitality };
  d.events.push({ type: 'playerDamaged', amount, from });
  if (outcome.shieldBroken) d.events.push({ type: 'shieldBroken' });
  if (outcome.died) {
    d.status = 'dead';
    d.events.push({ type: 'playerDied' });
  }
};

const hurtEnemy = (d: Draft, index: number, amount: number): void => {
  const enemy = d.enemies[index];
  if (!enemy) return;
  const outcome = damageEnemy(enemy, amount, d.time);
  d.enemies[index] = outcome.enemy;
  if (outcome.killed) {
    const score = ENEMY_STATS[enemy.kind].score;
    d.score += score;
    d.kills += 1;
    d.events.push({ type: 'enemyKilled', id: enemy.id, at: enemyCenter(enemy), score });
  }
};

const stepPlayerMovement = (d: Draft, input: InputFrame, dt: number): void => {
  const p = d.player;
  const yaw = input.yaw;
  const pitch = clamp(input.pitch, -MAX_PITCH, MAX_PITCH);
  const forward = vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = vec3(Math.cos(yaw), 0, -Math.sin(yaw));
  const wish = add(scale(forward, input.forward), scale(right, input.strafe));
  const wishLen = Math.hypot(wish.x, wish.z);
  const speed = input.sprint && input.forward > 0 ? PLAYER_SPRINT_SPEED : PLAYER_SPEED;
  const horizontal = wishLen > 1e-6 ? scale(wish, (speed * dt) / wishLen) : vec3();

  let vy = p.verticalVelocity - GRAVITY * dt;
  if (input.jump && p.onGround) vy = PLAYER_JUMP_SPEED;

  const moved = moveWithCollision(
    d.arena,
    p.position,
    PLAYER_RADIUS,
    PLAYER_HEIGHT,
    vec3(horizontal.x, vy * dt, horizontal.z),
  );
  const ground = groundHeightAt(d.arena, moved, PLAYER_RADIUS);
  let position = moved;
  let onGround = false;
  if (vy <= 0 && moved.y <= ground + 1e-6) {
    position = vec3(moved.x, ground, moved.z);
    vy = 0;
    onGround = true;
  }
  d.player = { ...p, position, verticalVelocity: vy, onGround, yaw, pitch };
};

const stepWeapon = (d: Draft, input: InputFrame): void => {
  d.player = { ...d.player, weapon: tickWeapon(d.player.weapon, d.time) };
  if (input.reload) {
    const reloaded = startReload(d.player.weapon, d.time);
    if (reloaded !== d.player.weapon) {
      d.player = { ...d.player, weapon: reloaded };
      d.events.push({ type: 'reload' });
    }
  }
  if (!input.fire) return;
  const result = tryFire(d.player.weapon, d.time);
  d.player = { ...d.player, weapon: result.weapon };
  if (result.kind === 'empty') d.events.push({ type: 'empty' });
  if (result.kind !== 'fired') return;

  const origin = playerEye(d.player);
  const moving = input.forward !== 0 || input.strafe !== 0;
  const spread = moving ? 0.012 : 0.004;
  const dir = directionFromAngles(
    d.player.yaw + d.rng.range(-spread, spread),
    d.player.pitch + d.rng.range(-spread, spread),
  );
  const targets = d.enemies
    .filter((e) => e.state !== 'dead' && e.state !== 'spawning')
    .map((e) => ({ id: e.id, center: enemyCenter(e), radius: ENEMY_STATS[e.kind].radius }));
  const hit = hitscan(origin, dir, targets, d.arena.obstacles, d.player.weapon.range);
  const to = add(origin, scale(dir, hit.distance));
  d.events.push({ type: 'shot', from: origin, to, hitEnemy: hit.targetId !== null });
  if (hit.targetId !== null) {
    const index = d.enemies.findIndex((e) => e.id === hit.targetId);
    hurtEnemy(d, index, d.player.weapon.damage);
  }
};

const stepGrenades = (d: Draft, input: InputFrame, dt: number): void => {
  if (input.throwGrenade && d.player.grenades > 0) {
    const id = d.nextId;
    d.nextId += 1;
    const origin = add(playerEye(d.player), scale(lookDirection(d.player), 0.6));
    d.grenades.push(throwGrenade(id, origin, lookDirection(d.player), d.time));
    d.player = { ...d.player, grenades: d.player.grenades - 1 };
    d.events.push({ type: 'grenadeThrown', id });
  }
  const remaining: Grenade[] = [];
  for (const g of d.grenades) {
    if (d.time < g.explodeAt) {
      remaining.push(stepGrenade(g, d.arena, dt));
      continue;
    }
    d.events.push({ type: 'explosion', at: g.position });
    d.enemies.forEach((e, i) => {
      if (e.state === 'dead') return;
      const dmg = blastDamage(distance(enemyCenter(e), g.position));
      if (dmg > 0) hurtEnemy(d, i, dmg);
    });
    const selfDistance = distance(playerCenter(d.player), g.position);
    if (selfDistance < GRENADE_BLAST_RADIUS)
      hurtPlayer(d, blastDamage(selfDistance) * 0.5, g.position);
  }
  d.grenades = remaining;
};

const stepEnemies = (d: Draft, dt: number): void => {
  const feet = d.player.position;
  const eye = playerEye(d.player);
  d.enemies = d.enemies.map((e) => {
    const { enemy, action } = updateEnemy(e, d.arena, feet, eye, dt, d.time, d.rng);
    if (action?.type === 'melee') hurtPlayer(d, action.damage, enemy.position);
    if (action?.type === 'bolt') {
      const id = d.nextId;
      d.nextId += 1;
      d.bolts.push(createBolt(id, action.origin, action.direction, action.damage, d.time));
      d.events.push({ type: 'boltFired', id });
    }
    return enemy;
  });
  d.enemies = d.enemies.filter(
    (e) => e.state !== 'dead' || e.diedAt === null || d.time - e.diedAt < CORPSE_LINGER,
  );
};

const stepBolts = (d: Draft, dt: number): void => {
  const center = playerCenter(d.player);
  const next: Bolt[] = [];
  for (const bolt of d.bolts) {
    const step = stepBolt(bolt, d.arena, center, PLAYER_RADIUS + 0.5, dt, d.time);
    if (step.kind === 'flying') next.push(step.bolt);
    if (step.kind === 'hitPlayer') hurtPlayer(d, bolt.damage, bolt.position);
  }
  d.bolts = next;
};

const spawnWave = (d: Draft, wave: number): void => {
  for (const kind of waveComposition(wave)) {
    const id = d.nextId;
    d.nextId += 1;
    d.enemies.push(
      createEnemy(id, kind, findSpawnPoint(d.arena, d.rng, SPAWN_RING_RADIUS), d.time),
    );
  }
  d.events.push({ type: 'waveStarted', number: wave });
};

const stepWaves = (d: Draft): void => {
  const alive = d.enemies.filter((e) => e.state !== 'dead').length;
  const previousPhase = d.wave.phase;
  const { wave, transition } = tickWave(d.wave, alive, d.time);
  d.wave = wave;
  if (transition === 'spawn') spawnWave(d, wave.number);
  if (previousPhase === 'active' && wave.phase === 'cleared') {
    d.score += WAVE_BONUS;
    d.events.push({ type: 'waveCleared', number: wave.number });
  }
  if (transition === 'won') {
    d.score += WAVE_BONUS;
    d.status = 'won';
    d.events.push({ type: 'victory' });
  }
};

/**
 * Advances the whole simulation by `dt` seconds. Pure with respect to `state`; the returned
 * state carries the events produced during this step for the renderer and audio layers.
 */
export const stepGame = (state: GameState, input: InputFrame, dt: number, rng: Rng): GameState => {
  if (state.status !== 'playing') return { ...state, events: [] };
  const d: Draft = {
    ...state,
    enemies: [...state.enemies],
    bolts: [...state.bolts],
    grenades: [...state.grenades],
    events: [],
    rng,
  };
  d.time += dt;
  stepPlayerMovement(d, input, dt);
  stepWeapon(d, input);
  stepGrenades(d, input, dt);
  stepEnemies(d, dt);
  stepBolts(d, dt);
  stepWaves(d);
  d.player = { ...d.player, vitality: tickVitality(d.player.vitality, dt, d.time) };
  const { rng: _rng, ...rest } = d;
  return rest;
};
