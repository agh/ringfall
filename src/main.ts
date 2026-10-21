import { AudioBank } from './audio/audio';
import { createGame, type GameState, stepGame } from './core/game';
import { createRng } from './core/rng';
import { Hud, summarize } from './hud/hud';
import { InputController } from './input/input';
import { SceneRenderer } from './render/scene';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

declare global {
  interface Window {
    /** Debug and test hook: read-only access to the live simulation. */
    ringfall?: {
      state: () => GameState;
      running: () => boolean;
    };
  }
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const main = (): void => {
  const canvas = byId<HTMLCanvasElement>('scene');
  const overlay = byId<HTMLDivElement>('overlay');
  const startButton = byId<HTMLButtonElement>('start');
  const tagline = byId<HTMLParagraphElement>('overlay-tagline');
  const stats = byId<HTMLParagraphElement>('overlay-stats');

  const renderer = new SceneRenderer(canvas);
  const hud = new Hud();
  const audio = new AudioBank();
  const input = new InputController(canvas);

  let game = createGame({ seed: Date.now() >>> 0 });
  let rng = createRng(game.nextId + 7);
  let running = false;
  let accumulator = 0;
  let last = performance.now();
  renderer.setArena(game.arena);

  window.ringfall = { state: () => game, running: () => running };

  const showOverlay = (finished: boolean): void => {
    running = false;
    hud.hide();
    overlay.hidden = false;
    if (finished) {
      const won = game.status === 'won';
      tagline.textContent = won
        ? 'The arena is quiet. The ring still turns.'
        : 'Shields down. Health gone. The ring does not care.';
      stats.textContent = summarize(game);
      stats.hidden = false;
      startButton.textContent = won ? 'Run it back' : 'Redeploy';
    }
    if (document.pointerLockElement) document.exitPointerLock();
  };

  const start = async (): Promise<void> => {
    audio.unlock();
    if (game.status !== 'playing') {
      game = createGame({ seed: Date.now() >>> 0 });
      rng = createRng(game.nextId + 7);
      renderer.setArena(game.arena);
    }
    input.reset();
    overlay.hidden = true;
    hud.show();
    running = true;
    accumulator = 0;
    last = performance.now();
    await input.lock();
  };

  startButton.addEventListener('click', () => void start());
  document.addEventListener('pointerlockchange', () => {
    // Esc releases the pointer; pause to the overlay so the player can recapture it.
    if (!input.locked && running && game.status === 'playing') showOverlay(false);
  });

  const frame = (now: number): void => {
    const frameDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (running) {
      accumulator += frameDt;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        game = stepGame(game, input.take(), FIXED_DT, rng);
        accumulator -= FIXED_DT;
        steps += 1;
        if (game.events.length > 0) {
          renderer.handle(game.events, now / 1000);
          hud.handle(game.events);
          audio.handle(game.events);
        }
        if (game.status !== 'playing') {
          window.setTimeout(() => showOverlay(true), 1600);
          running = false;
          break;
        }
      }
      hud.render(game);
    }
    renderer.render(game, now / 1000, frameDt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

main();
