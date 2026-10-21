import * as THREE from 'three';
import { createGame, type GameEvent, type GameState } from '../src/core/game';
import { createPickup } from '../src/core/pickups';
import { createWeapon, WEAPON_KINDS, type WeaponKind } from '../src/core/weapon';
import { ParticleSystem } from '../src/render/particles';
import { PickupMeshes } from '../src/render/pickups';
import { WeaponViewmodels } from '../src/render/weapons';

declare global {
  interface Window {
    __smoke?: Record<string, unknown>;
  }
}

const log: string[] = [];
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
try {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.08, 1000);
  camera.position.set(0, 1.7, 0);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1));
  const particles = new ParticleSystem();
  scene.add(particles.points);
  const dynamic = new THREE.Group();
  scene.add(dynamic);

  const weapons = new WeaponViewmodels(camera, particles);
  scene.add(weapons.effects);
  const pickups = new PickupMeshes(dynamic, particles);

  let state: GameState = createGame({ seed: 3 });
  const withWeapon = (s: GameState, kind: WeaponKind, patch = {}): GameState => ({
    ...s,
    player: { ...s.player, weapon: { ...createWeapon(kind), ...patch } },
  });
  const from = { x: 0, y: 1.7, z: 0 };
  const to = { x: 2, y: 1.2, z: -30 };
  let now = 0;
  const frame = (): void => {
    now += 1 / 60;
    weapons.update(now, state);
    pickups.sync(state, now);
    particles.update(now);
    camera.rotation.y += 0.01;
    renderer.render(scene, camera);
  };

  for (const kind of WEAPON_KINDS) {
    state = withWeapon(state, kind, { charge: 0.5, spin: 0.7, magazine: 1 });
    weapons.setActive(kind, now);
    const events: GameEvent[] = [
      { type: 'shot', from, to, hitEnemy: true, kind, pellets: kind === 'scatter' ? 8 : 1 },
      { type: 'weaponSwapped', kind, slot: 0 },
    ];
    if (kind === 'beam') {
      events.push({ type: 'chargeStarted', kind }, { type: 'beamFired', from, to, hits: 3 });
    }
    if (kind === 'launcher') events.push({ type: 'launcherFired', id: 9 });
    weapons.handle(events, now, camera);
    for (let i = 0; i < 25; i += 1) frame();
    if (kind === 'beam') weapons.handle([{ type: 'chargeReleased', kind, charge: 1 }], now, camera);
    const m = weapons.muzzleWorldPosition();
    log.push(`${kind}: muzzle ${m.x.toFixed(2)},${m.y.toFixed(2)},${m.z.toFixed(2)} recoil ${weapons.recoilRequest} effects ${weapons.effects.children.length}`);
    weapons.recoilRequest = 0;
  }
  // Let every effect expire.
  for (let i = 0; i < 40; i += 1) frame();
  log.push(`effects after expiry: ${weapons.effects.children.length}`);

  // Pickups: spawn five, fade one, take one, expire one.
  const list = WEAPON_KINDS.filter((k) => k !== 'rifle').map((k, i) =>
    createPickup(10 + i, k, { x: i * 3 - 6, y: 0, z: -8 }, state.time),
  );
  state = { ...state, pickups: list };
  pickups.handle(list.map((p) => ({ type: 'pickupSpawned' as const, id: p.id, kind: p.kind, at: p.position })), now);
  for (let i = 0; i < 10; i += 1) frame();
  log.push(`pickup groups: ${dynamic.children.length}`);
  state = { ...state, time: list[0]!.expiresAt - 1 };
  for (let i = 0; i < 5; i += 1) frame();
  pickups.handle([{ type: 'pickupTaken', id: 11, kind: 'scatter', slot: 1 }], now);
  state = { ...state, pickups: list.filter((p) => p.id !== 11 && p.id !== 12) };
  for (let i = 0; i < 60; i += 1) frame();
  log.push(`pickup groups after take/expire: ${dynamic.children.length}`);
  log.push(`draw calls: ${renderer.info.render.calls}`);
} catch (e) {
  errors.push(String(e instanceof Error ? e.stack : e));
}
window.__smoke = { log, errors };
