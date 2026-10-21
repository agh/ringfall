import {
  type BarkLine,
  createEnemy,
  damageEnemy,
  ENEMY_STATS,
  type Enemy,
  type EnemyKind,
  enemyCenter,
  FLEE_RADIUS,
  pickBark,
  startFlee,
  type Tracking,
  temperamentFor,
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
import { hitscan, raySphere, type SphereTarget } from './raycast';
import { createRng, type Rng } from './rng';
import {
  add,
  clamp,
  directionFromAngles,
  distance,
  distanceXZ,
  scale,
  sub,
  type Vec3,
  vec3,
  ZERO,
} from './vec3';
import { applyDamage, createVitality, tickVitality, type Vitality } from './vitality';
import { createWaveState, tickWave, WAVE_BONUS, type WaveState, waveComposition } from './waves';
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
  SECRET_RADIUS,
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
/** Crouching lowers the eye by this much; the body and its collision are unchanged. */
export const CROUCH_EYE_DROP = 0.6;
/** Crouch starts within `TAUNT_WINDOW` seconds over a strider's grave that earn a bark. */
export const TAUNT_TOGGLES = 3;
export const TAUNT_WINDOW = 1.5;
/** Horizontal distance from where a strider fell that counts as standing over it. */
export const TAUNT_RADIUS = 2.5;
/** What a skimmer says to a crouch taunt; it rides `enemyBark` beside the rout lines. */
export const TAUNT_BARK = 'DISRESPECTFUL';
export type TauntLine = typeof TAUNT_BARK;
/** Points for shooting the arena's hidden switch. */
export const SECRET_SCORE = 1000;
const MAX_PITCH = Math.PI / 2 - 0.01;

export interface Player {
  readonly position: Vec3;
  readonly verticalVelocity: number;
  readonly onGround: boolean;
  /** Displacement over the last step divided by `dt`, in m/s; what the ambusher leads. */
  readonly velocity: Vec3;
  readonly crouching: boolean;
  /** Simulation times of the most recent crouch starts, newest last, for the taunt. */
  readonly crouchStarts: readonly number[];
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
  /** Held: lowers the eye by `CROUCH_EYE_DROP`. */
  readonly crouch: boolean;
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
  crouch: false,
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
  /**
   * An enemy broke and ran: it is now in state `flee`. Fired for every skimmer within
   * `FLEE_RADIUS` of a strider when it dies, after that strider's `enemyKilled` in the same step,
   * and again for a skimmer whose rout is refreshed by a second death. The enemy's `fleeUntil`
   * says when it ends; posture and sound layers key on `id` and `kind`.
   */
  | { readonly type: 'enemyFled'; readonly id: number; readonly kind: EnemyKind }
  /**
   * A fleeing enemy shouts `line`, one of `BARK_LINES`. Exactly one follows each `enemyFled`,
   * so a strider death with any skimmer in range barks at least once; the first bark of a rout
   * is always the first line. The label and the sound belong to the layers that consume this.
   */
  | { readonly type: 'enemyBark'; readonly id: number; readonly line: BarkLine | TauntLine }
  | { readonly type: 'playerDamaged'; readonly amount: number; readonly from: Vec3 | null }
  | { readonly type: 'shieldBroken' }
  | { readonly type: 'boltFired'; readonly id: number }
  | { readonly type: 'watcherCharging'; readonly id: number; readonly at: Vec3 }
  | {
      readonly type: 'watcherFired';
      readonly id: number;
      readonly from: Vec3;
      readonly to: Vec3;
      readonly hit: boolean;
    }
  | { readonly type: 'waveStarted'; readonly number: number }
  | { readonly type: 'waveCleared'; readonly number: number }
  | { readonly type: 'playerDied' }
  | { readonly type: 'victory' }
  | { readonly type: 'secretFound'; readonly at: Vec3; readonly score: number };

export type GameStatus = 'playing' | 'dead' | 'won';

export interface GameState {
  readonly time: number;
  readonly status: GameStatus;
  readonly arena: Arena;
  readonly player: Player;
  readonly enemies: readonly Enemy[];
  readonly bolts: readonly Bolt[];
  readonly grenades: readonly Grenade[];
  readonly pickups: readonly Pickup[];
  readonly wave: WaveState;
  readonly score: number;
  readonly kills: number;
  /** Where striders fell this game; a crouch taunt needs one underfoot. */
  readonly graves: readonly Vec3[];
  /** Hidden switches shot so far; the arena has one. */
  readonly secretsFound: number;
  readonly nextId: number;
  readonly events: readonly GameEvent[];
}

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
      velocity: ZERO,
      crouching: false,
      crouchStarts: [],
      yaw: 0,
      pitch: 0,
      vitality: createVitality(),
      weapon: rifle,
      weapons: [rifle, null],
      activeSlot: 0,
      grenades: STARTING_GRENADES,
    },
    enemies: [],
    bolts: [],
    grenades: [],
    pickups: [],
    wave: createWaveState(0),
    score: 0,
    kills: 0,
    graves: [],
    secretsFound: 0,
    nextId: 1,
    events: [],
  };
};

export const playerEye = (p: Player): Vec3 =>
  add(p.position, vec3(0, PLAYER_EYE_HEIGHT - (p.crouching ? CROUCH_EYE_DROP : 0), 0));
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
  pickups: Pickup[];
  wave: WaveState;
  score: number;
  kills: number;
  graves: Vec3[];
  secretsFound: number;
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

/** Every skimmer within `FLEE_RADIUS` of a fallen strider runs, and each one barks. */
const routSkimmers = (d: Draft, fallen: Enemy): void => {
  let first = true;
  d.enemies.forEach((e, i) => {
    if (e.kind !== 'skimmer' || distanceXZ(e.position, fallen.position) > FLEE_RADIUS) return;
    const fled = startFlee(e, d.time);
    if (fled === e) return;
    d.enemies[i] = fled;
    d.events.push({ type: 'enemyFled', id: e.id, kind: e.kind });
    d.events.push({ type: 'enemyBark', id: e.id, line: pickBark(d.rng, first) });
    first = false;
  });
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
    if (enemy.kind === 'strider') d.graves.push(enemy.position);
    d.events.push({ type: 'enemyKilled', id: enemy.id, at: enemyCenter(enemy), score });
    if (enemy.kind === 'strider') routSkimmers(d, enemy);
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
  const velocity = dt > 0 ? scale(sub(position, p.position), 1 / dt) : ZERO;
  const crouching = input.crouch;
  const crouchStarts =
    crouching && !p.crouching
      ? [...p.crouchStarts.filter((t) => d.time - t <= TAUNT_WINDOW), d.time]
      : p.crouchStarts;
  d.player = {
    ...p,
    position,
    verticalVelocity: vy,
    onGround,
    velocity,
    crouching,
    crouchStarts,
    yaw,
    pitch,
  };
};

/**
 * Three crouches inside the window while standing over a fallen strider: a surviving skimmer
 * (the nearest one) has something to say. The crouch history resets so one taunt is one bark.
 */
const stepTaunt = (d: Draft): void => {
  const p = d.player;
  if (p.crouchStarts.length < TAUNT_TOGGLES) return;
  const first = p.crouchStarts[p.crouchStarts.length - TAUNT_TOGGLES] ?? d.time;
  if (d.time - first > TAUNT_WINDOW) return;
  const overGrave = d.graves.some((g) => distanceXZ(g, p.position) <= TAUNT_RADIUS);
  if (!overGrave) return;
  let witness: Enemy | null = null;
  for (const e of d.enemies) {
    if (e.kind !== 'skimmer' || e.state === 'dead') continue;
    if (
      witness === null ||
      distanceXZ(e.position, p.position) < distanceXZ(witness.position, p.position)
    )
      witness = e;
  }
  d.player = { ...p, crouchStarts: [] };
  if (witness !== null) d.events.push({ type: 'enemyBark', id: witness.id, line: TAUNT_BARK });
};

/** A ray that reaches the glyph before anything else trips the arena's hidden switch, once. */
const shootSecret = (d: Draft, origin: Vec3, dir: Vec3, reach: number): void => {
  const secret = d.arena.secret;
  if (secret === null || d.secretsFound > 0) return;
  if (raySphere(origin, dir, secret.at, SECRET_RADIUS, reach) === null) return;
  d.secretsFound += 1;
  d.score += SECRET_SCORE;
  d.events.push({ type: 'secretFound', at: secret.at, score: SECRET_SCORE });
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
    shootSecret(d, origin, dir, beam.distance);
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
    shootSecret(d, origin, dir, hit.distance);
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
      // Spawning enemies are untouchable by rays and beams (liveTargets); blasts match that rule.
      if (e.state === 'dead' || e.state === 'spawning') return;
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
  const skimmers = d.enemies.filter((e) => e.kind === 'skimmer' && e.state !== 'dead');
  d.enemies = d.enemies.map((e) => {
    const tracking: Tracking = {
      velocity: d.player.velocity,
      yaw: d.player.yaw,
      pack: skimmers.filter((s) => s.id !== e.id).map((s) => s.position),
    };
    const { enemy, action } = updateEnemy(e, d.arena, feet, eye, dt, d.time, d.rng, tracking);
    if (action?.type === 'melee') hurtPlayer(d, action.damage, enemy.position);
    if (action?.type === 'bolt') {
      const id = d.nextId;
      d.nextId += 1;
      d.bolts.push(createBolt(id, action.origin, action.direction, action.damage, d.time));
      d.events.push({ type: 'boltFired', id });
    }
    if (action?.type === 'watcherCharge')
      d.events.push({ type: 'watcherCharging', id: enemy.id, at: action.at });
    if (action?.type === 'watcherBeam') {
      const { from, to, hit } = action;
      d.events.push({ type: 'watcherFired', id: enemy.id, from, to, hit });
      // The beam reuses the strider bolt sound until it has one of its own (issue #33 owns audio).
      d.events.push({ type: 'boltFired', id: enemy.id });
      if (hit) hurtPlayer(d, action.damage, from);
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
  let skimmers = 0;
  for (const kind of waveComposition(wave)) {
    const id = d.nextId;
    d.nextId += 1;
    const temperament = temperamentFor(skimmers);
    if (kind === 'skimmer') skimmers += 1;
    d.enemies.push(
      createEnemy(id, kind, findSpawnPoint(d.arena, d.rng, SPAWN_RING_RADIUS), d.time, temperament),
    );
  }
  d.events.push({ type: 'waveStarted', number: wave });
  if (wave >= WAVE_REWARD_FROM) {
    const kind = chooseKind(heldKinds(d.player.weapons), d.rng);
    if (kind !== null)
      spawnPickup(d, kind, rewardPosition(d.arena, d.player.position, d.player.yaw));
  }
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
  // Vitality runs before this stage: a blast or a bolt that kills the player in the same step
  // as the last enemy has already ended the run, and death is not overwritten by victory.
  if (transition === 'won' && d.status === 'playing') {
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
    pickups: [...state.pickups],
    graves: [...state.graves],
    events: [],
    rng,
  };
  d.time += dt;
  stepPlayerMovement(d, input, dt);
  stepTaunt(d);
  stepPickups(d);
  stepWeapon(d, input, dt);
  stepGrenades(d, input, dt);
  stepEnemies(d, dt);
  stepBolts(d, dt);
  stepWaves(d);
  d.player = { ...d.player, vitality: tickVitality(d.player.vitality, dt, d.time) };
  const { rng: _rng, ...rest } = d;
  return rest;
};
