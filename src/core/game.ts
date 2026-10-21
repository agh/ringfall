import {
  createEnemy,
  damageEnemy,
  ENEMY_STATS,
  type Enemy,
  type EnemyKind,
  enemyCenter,
  hasFled,
  startFleeing,
  updateEnemy,
} from './enemy';
import {
  blastDamage,
  blastRadiusOf,
  type Grenade,
  launchRound,
  maxDamageOf,
  stepGrenade,
  throwGrenade,
} from './grenade';
import {
  chooseKind,
  createPickup,
  expirePickups,
  heldKinds,
  type Pickup,
  pickupInReach,
  rewardPosition,
  rollDrop,
  type SlotIndex,
  takeWeapon,
  WAVE_REWARD_FROM,
  type WeaponSlots,
} from './pickups';
import { type Bolt, createBolt, stepBolt } from './projectile';
import { hitscan, type SphereTarget } from './raycast';
import { createRng, type Rng } from './rng';
import { add, clamp, directionFromAngles, distance, scale, type Vec3, vec3 } from './vec3';
import { applyDamage, createVitality, tickVitality, type Vitality } from './vitality';
import {
  createWaveState,
  DROP_POD_LEAD,
  tickWave,
  WAVE_BONUS,
  type WaveBeat,
  type WaveSpawn,
  type WaveState,
  waveBeat,
} from './waves';
import {
  beamHits,
  createRifle,
  pelletDamage,
  startReload,
  stepTrigger,
  tickWeapon,
  tryFire,
  type Weapon,
  type WeaponKind,
  weaponSpec,
} from './weapon';
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
/** Simulation seconds the victory tableau holds before the run is `won`: survivors flee. */
export const TABLEAU_DURATION = 5;
/** The tableau opens in slow motion: this time scale for `TABLEAU_SLOW_SECONDS` of wall clock. */
export const TABLEAU_TIME_SCALE = 0.2;
export const TABLEAU_SLOW_SECONDS = 1.5;
const MAX_PITCH = Math.PI / 2 - 0.01;

export interface Player {
  readonly position: Vec3;
  readonly verticalVelocity: number;
  readonly onGround: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly vitality: Vitality;
  /** The active weapon. Always equal to `weapons[activeSlot]`; both are updated every step. */
  readonly weapon: Weapon;
  /** Two-slot inventory: the rifle starts in slot 0 and pickups fill or replace slots. */
  readonly weapons: WeaponSlots;
  readonly activeSlot: SlotIndex;
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
  /** Edge-triggered: swap to the other weapon slot this step. */
  readonly swapWeapon: boolean;
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
  swapWeapon: false,
  yaw: 0,
  pitch: 0,
};

export type GameEvent =
  | {
      readonly type: 'shot';
      readonly from: Vec3;
      readonly to: Vec3;
      readonly hitEnemy: boolean;
      readonly kind: WeaponKind;
      readonly pellets: number;
    }
  | { readonly type: 'empty' }
  | { readonly type: 'reload' }
  | { readonly type: 'grenadeThrown'; readonly id: number }
  | { readonly type: 'launcherFired'; readonly id: number }
  | { readonly type: 'weaponSwapped'; readonly kind: WeaponKind; readonly slot: SlotIndex }
  | { readonly type: 'chargeStarted'; readonly kind: WeaponKind }
  | { readonly type: 'chargeReleased'; readonly kind: WeaponKind; readonly charge: number }
  | { readonly type: 'beamFired'; readonly from: Vec3; readonly to: Vec3; readonly hits: number }
  | {
      readonly type: 'pickupSpawned';
      readonly id: number;
      readonly kind: WeaponKind;
      readonly at: Vec3;
    }
  | {
      readonly type: 'pickupTaken';
      readonly id: number;
      readonly kind: WeaponKind;
      readonly slot: SlotIndex;
    }
  | { readonly type: 'pickupExpired'; readonly id: number }
  | { readonly type: 'explosion'; readonly at: Vec3 }
  | { readonly type: 'enemyKilled'; readonly id: number; readonly at: Vec3; readonly score: number }
  | { readonly type: 'playerDamaged'; readonly amount: number; readonly from: Vec3 | null }
  | { readonly type: 'shieldBroken' }
  | { readonly type: 'boltFired'; readonly id: number }
  | { readonly type: 'waveStarted'; readonly number: number; readonly name: string }
  /** A pod is inbound: the enemy with this `id` lands at `at` and goes active at `activeAt`. */
  | {
      readonly type: 'dropPod';
      readonly id: number;
      readonly kind: EnemyKind;
      readonly at: Vec3;
      readonly activeAt: number;
      readonly leader: boolean;
    }
  | { readonly type: 'waveCleared'; readonly number: number }
  | { readonly type: 'playerDied' }
  /** The final leader has fallen; the tableau begins. The status turns `won` when it ends. */
  | { readonly type: 'victory'; readonly kills: number; readonly shieldBreaks: number };

export type GameStatus = 'playing' | 'dead' | 'won';

/** An enemy whose drop pod has been scheduled but has not launched yet. */
export interface PendingSpawn {
  readonly id: number;
  readonly spawn: WaveSpawn;
  readonly at: Vec3;
  /** Simulation time the pod launches: the enemy appears and `dropPod` fires. */
  readonly dropAt: number;
}

/** The end of the run: input is frozen, the player is safe, and the survivors flee. */
export interface Tableau {
  readonly startedAt: number;
  readonly endsAt: number;
}

export interface GameState {
  readonly time: number;
  readonly status: GameStatus;
  readonly arena: Arena;
  readonly player: Player;
  readonly enemies: readonly Enemy[];
  readonly pendingSpawns: readonly PendingSpawn[];
  readonly bolts: readonly Bolt[];
  readonly grenades: readonly Grenade[];
  readonly pickups: readonly Pickup[];
  readonly wave: WaveState;
  readonly tableau: Tableau | null;
  readonly score: number;
  readonly kills: number;
  readonly shieldBreaks: number;
  readonly nextId: number;
  readonly events: readonly GameEvent[];
}

/** Simulation speed the presentation should run at: slow motion as the tableau opens, else 1. */
export const timeScaleOf = (state: GameState): number => {
  if (state.tableau === null) return 1;
  const slowUntil = state.tableau.startedAt + TABLEAU_SLOW_SECONDS * TABLEAU_TIME_SCALE;
  return state.time < slowUntil ? TABLEAU_TIME_SCALE : 1;
};

export interface GameConfig {
  readonly seed: number;
}

export const createGame = (config: GameConfig = { seed: 1 }): GameState => {
  const rng = createRng(config.seed);
  const rifle = createRifle();
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
      weapon: rifle,
      weapons: [rifle, null],
      activeSlot: 0,
      grenades: STARTING_GRENADES,
    },
    enemies: [],
    pendingSpawns: [],
    bolts: [],
    grenades: [],
    pickups: [],
    wave: createWaveState(0),
    tableau: null,
    score: 0,
    kills: 0,
    shieldBreaks: 0,
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
  pendingSpawns: PendingSpawn[];
  bolts: Bolt[];
  grenades: Grenade[];
  pickups: Pickup[];
  wave: WaveState;
  tableau: Tableau | null;
  score: number;
  kills: number;
  shieldBreaks: number;
  nextId: number;
  events: GameEvent[];
  rng: Rng;
}

const withSlot = (slots: WeaponSlots, slot: SlotIndex, w: Weapon): WeaponSlots =>
  slot === 0 ? [w, slots[1]] : [slots[0], w];

/** Writes `weapon` into the player as the active weapon and into its slot. */
const holdWeapon = (p: Player, weapon: Weapon, slots: WeaponSlots, slot: SlotIndex): Player => ({
  ...p,
  weapon,
  weapons: withSlot(slots, slot, weapon),
  activeSlot: slot,
});

const spawnPickup = (d: Draft, kind: WeaponKind, at: Vec3): void => {
  const id = d.nextId;
  d.nextId += 1;
  const pickup = createPickup(id, kind, at, d.time);
  d.pickups.push(pickup);
  d.events.push({ type: 'pickupSpawned', id, kind, at: pickup.position });
};

const hurtPlayer = (d: Draft, amount: number, from: Vec3 | null): void => {
  if (d.status !== 'playing' || d.tableau !== null) return;
  const outcome = applyDamage(d.player.vitality, amount, d.time);
  d.player = { ...d.player, vitality: outcome.vitality };
  d.events.push({ type: 'playerDamaged', amount, from });
  if (outcome.shieldBroken) {
    d.shieldBreaks += 1;
    d.events.push({ type: 'shieldBroken' });
  }
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
    const drop = rollDrop(enemy.kind, heldKinds(d.player.weapons), d.rng);
    if (drop !== null) spawnPickup(d, drop, enemy.position);
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

const liveTargets = (d: Draft): SphereTarget[] =>
  d.enemies
    .filter((e) => e.state !== 'dead' && e.state !== 'spawning')
    .map((e) => ({ id: e.id, center: enemyCenter(e), radius: ENEMY_STATS[e.kind].radius }));

const hurtEnemyById = (d: Draft, id: number, amount: number): void => {
  hurtEnemy(
    d,
    d.enemies.findIndex((e) => e.id === id),
    amount,
  );
};

/** One trigger pull of the active weapon: rays for hitscan kinds, a round for the launcher. */
const fireWeapon = (d: Draft, w: Weapon, input: InputFrame): void => {
  const spec = weaponSpec(w);
  const origin = playerEye(d.player);
  const moving = input.forward !== 0 || input.strafe !== 0;
  const spread = moving ? spec.spreadMoving : spec.spreadStanding;
  const aim = (): Vec3 =>
    directionFromAngles(
      d.player.yaw + d.rng.range(-spread, spread),
      d.player.pitch + d.rng.range(-spread, spread),
    );

  if (spec.projectile) {
    const id = d.nextId;
    d.nextId += 1;
    const dir = aim();
    d.grenades.push(launchRound(id, add(origin, scale(dir, 0.6)), dir, d.time));
    d.events.push({ type: 'launcherFired', id });
    return;
  }

  const targets = liveTargets(d);
  if (spec.chargeTime > 0) {
    const dir = aim();
    const beam = beamHits(origin, dir, targets, d.arena.obstacles, spec.range);
    const to = add(origin, scale(dir, beam.distance));
    for (const id of beam.targetIds) hurtEnemyById(d, id, spec.damage);
    d.events.push({
      type: 'shot',
      from: origin,
      to,
      hitEnemy: beam.targetIds.length > 0,
      kind: w.kind,
      pellets: 1,
    });
    d.events.push({ type: 'beamFired', from: origin, to, hits: beam.targetIds.length });
    return;
  }

  let hitAny = false;
  let to = origin;
  for (let i = 0; i < spec.pellets; i += 1) {
    const dir = aim();
    const hit = hitscan(origin, dir, targets, d.arena.obstacles, spec.range);
    if (i === 0) to = add(origin, scale(dir, hit.distance));
    if (hit.targetId === null) continue;
    hitAny = true;
    hurtEnemyById(d, hit.targetId, pelletDamage(spec, hit.distance));
  }
  d.events.push({
    type: 'shot',
    from: origin,
    to,
    hitEnemy: hitAny,
    kind: w.kind,
    pellets: spec.pellets,
  });
};

/** Parks the active weapon (charge and spin drop) and draws the other slot. */
const swapSlots = (d: Draft, input: InputFrame): void => {
  const p = d.player;
  if (!input.swapWeapon || p.weapons[1] === null) return;
  const parked: Weapon = { ...p.weapon, charge: 0, spin: 0, lastFire: false };
  const slots = withSlot(p.weapons, p.activeSlot, parked);
  const slot: SlotIndex = p.activeSlot === 0 ? 1 : 0;
  const drawn: Weapon = { ...(slots[slot] ?? slots[0]), lastFire: input.fire };
  d.player = holdWeapon(p, drawn, slots, slot);
  d.events.push({ type: 'weaponSwapped', kind: drawn.kind, slot });
};

const stepWeapon = (d: Draft, input: InputFrame, dt: number): void => {
  // `player.weapon` is the field existing code edits, so it wins over the slot on entry.
  d.player = holdWeapon(d.player, d.player.weapon, d.player.weapons, d.player.activeSlot);
  swapSlots(d, input);
  const slots = d.player.weapons;
  const slot = d.player.activeSlot;
  let w = tickWeapon(d.player.weapon, d.time);
  if (input.reload) {
    const reloaded = startReload(w, d.time);
    if (reloaded !== w) {
      w = reloaded;
      d.events.push({ type: 'reload' });
    }
  }
  const trigger = stepTrigger(w, input.fire, dt, d.time);
  w = trigger.weapon;
  if (trigger.chargeStarted) d.events.push({ type: 'chargeStarted', kind: w.kind });
  if (trigger.released && weaponSpec(w).chargeTime > 0)
    d.events.push({ type: 'chargeReleased', kind: w.kind, charge: trigger.charge });
  if (trigger.pull) {
    const result = tryFire(w, d.time);
    w = result.weapon;
    if (result.kind === 'empty') d.events.push({ type: 'empty' });
    if (result.kind === 'fired') {
      d.player = holdWeapon(d.player, w, slots, slot);
      fireWeapon(d, w, input);
    }
  }
  d.player = holdWeapon(d.player, w, slots, slot);
};

const stepPickups = (d: Draft): void => {
  const { kept, expired } = expirePickups(d.pickups, d.time);
  for (const p of expired) d.events.push({ type: 'pickupExpired', id: p.id });
  d.pickups = [...kept];
  const reach = pickupInReach(d.pickups, d.player.position);
  if (reach === null) return;
  const slots = withSlot(d.player.weapons, d.player.activeSlot, d.player.weapon);
  const taken = takeWeapon(slots, d.player.activeSlot, reach.kind);
  const drawn = taken.slots[taken.activeSlot] ?? taken.slots[0];
  d.player = holdWeapon(d.player, drawn, taken.slots, taken.activeSlot);
  d.pickups = d.pickups.filter((p) => p.id !== reach.id);
  d.events.push({ type: 'pickupTaken', id: reach.id, kind: reach.kind, slot: taken.slot });
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
    const radius = blastRadiusOf(g);
    const maxDamage = maxDamageOf(g);
    d.enemies.forEach((e, i) => {
      if (e.state === 'dead') return;
      const dmg = blastDamage(distance(enemyCenter(e), g.position), radius, maxDamage);
      if (dmg > 0) hurtEnemy(d, i, dmg);
    });
    const selfDistance = distance(playerCenter(d.player), g.position);
    if (selfDistance < radius)
      hurtPlayer(d, blastDamage(selfDistance, radius, maxDamage) * 0.5, g.position);
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
    (e) =>
      !hasFled(e, d.arena) &&
      (e.state !== 'dead' || e.diedAt === null || d.time - e.diedAt < CORPSE_LINGER),
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

/** Schedules the wave's drop pods: ids and landing points are fixed now, pods launch on time. */
const spawnWave = (d: Draft, wave: number): void => {
  const beat = waveBeat(wave);
  for (const spawn of beat.spawns) {
    const id = d.nextId;
    d.nextId += 1;
    d.pendingSpawns.push({
      id,
      spawn,
      at: findSpawnPoint(d.arena, d.rng, SPAWN_RING_RADIUS),
      dropAt: d.time + spawn.delay,
    });
  }
  d.events.push({ type: 'waveStarted', number: wave, name: beat.name });
  if (wave >= WAVE_REWARD_FROM) {
    const kind = chooseKind(heldKinds(d.player.weapons), d.rng);
    if (kind !== null)
      spawnPickup(d, kind, rewardPosition(d.arena, d.player.position, d.player.yaw));
  }
};

/** Launches the pods whose time has come: the enemy exists from here, active `DROP_POD_LEAD` later. */
const stepPendingSpawns = (d: Draft): void => {
  const waiting: PendingSpawn[] = [];
  for (const pending of d.pendingSpawns) {
    if (d.time < pending.dropAt) {
      waiting.push(pending);
      continue;
    }
    const { id, spawn, at } = pending;
    const enemy = createEnemy(id, spawn.kind, at, d.time, {
      spawnDelay: DROP_POD_LEAD,
      healthScale: spawn.healthScale,
      leader: spawn.leader,
    });
    d.enemies.push(enemy);
    d.events.push({
      type: 'dropPod',
      id,
      kind: spawn.kind,
      at,
      activeAt: enemy.activeAt,
      leader: spawn.leader,
    });
  }
  d.pendingSpawns = waiting;
};

/** Enemies still standing between the player and the end of the wave, pods included. */
const holdouts = (d: Draft, beat: WaveBeat): number => {
  const counts = beat.ending === 'leaderDown' ? (leader: boolean) => leader : () => true;
  const standing = d.enemies.filter((e) => e.state !== 'dead' && counts(e.leader)).length;
  return standing + d.pendingSpawns.filter((p) => counts(p.spawn.leader)).length;
};

const stepWaves = (d: Draft): void => {
  const previousPhase = d.wave.phase;
  const { wave, transition } = tickWave(d.wave, holdouts(d, waveBeat(d.wave.number)), d.time);
  d.wave = wave;
  if (transition === 'spawn') spawnWave(d, wave.number);
  if (previousPhase === 'active' && wave.phase === 'cleared') {
    d.score += WAVE_BONUS;
    d.events.push({ type: 'waveCleared', number: wave.number });
  }
  if (transition === 'won') {
    d.score += WAVE_BONUS;
    d.tableau = { startedAt: d.time, endsAt: d.time + TABLEAU_DURATION };
    d.pendingSpawns = [];
    d.enemies = d.enemies.map(startFleeing);
    d.events.push({ type: 'victory', kills: d.kills, shieldBreaks: d.shieldBreaks });
  }
};

/** The tableau holds the player still and safe until it ends; then the run is won. */
const stepTableau = (d: Draft): void => {
  if (d.tableau === null || d.time < d.tableau.endsAt) return;
  d.status = 'won';
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
    pendingSpawns: [...state.pendingSpawns],
    bolts: [...state.bolts],
    grenades: [...state.grenades],
    pickups: [...state.pickups],
    events: [],
    rng,
  };
  d.time += dt;
  // During the tableau the player stands where the leader fell; only the look angles are kept.
  const frame: InputFrame =
    d.tableau === null ? input : { ...IDLE_INPUT, yaw: d.player.yaw, pitch: d.player.pitch };
  stepPlayerMovement(d, frame, dt);
  stepPickups(d);
  stepWeapon(d, frame, dt);
  stepGrenades(d, frame, dt);
  stepPendingSpawns(d);
  stepEnemies(d, dt);
  stepBolts(d, dt);
  stepWaves(d);
  stepTableau(d);
  d.player = { ...d.player, vitality: tickVitality(d.player.vitality, dt, d.time) };
  const { rng: _rng, ...rest } = d;
  return rest;
};
