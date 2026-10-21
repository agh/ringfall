import { AudioBank } from './audio/audio';
import { renderScore } from './audio/offline';
import { type BotMemory, createBotMemory, decideBot, STEADY_BOT } from './core/bot';
import { createGame, type GameState, stepGame } from './core/game';
import { describeComparison, recordRound } from './core/records';
import { createRng, parseSeed } from './core/rng';
import { loadSettings, type Settings, saveSettings } from './core/settings';
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
    };
    /** Diagnostics for the renderer: post-process uniforms and draw statistics. */
    ringfallDebug?: {
      uniforms: () => Record<string, unknown>;
      info: () => unknown;
      lights: () => { inUse: number };
    };
    /**
     * Recording hook (`?record&bot&seed=N`): the animation loop is suspended and each call steps
     * the deterministic simulation and renders exactly once, so a recorder can pull frames at
     * any speed and reassemble them at 60 Hz.
     */
    ringfallCapture?: {
      start: () => Promise<void>;
      advance: (steps: number) => void;
      /** Renders the soundtrack for the same seed offline; returns base64 WAV. */
      score: (seconds: number, leadIn: number) => Promise<string>;
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

  // Settings live only in this browser; storage may be blocked, and that is fine.
  let settingsStore: Storage | null = null;
  try {
    settingsStore = window.localStorage;
  } catch {
    settingsStore = null;
  }
  let settings: Settings = loadSettings(settingsStore);
  const applySettings = (): void => {
    input.setSensitivity(settings.sensitivity);
    renderer.setBaseFov(settings.fov);
    renderer.setShakeEnabled(settings.shake);
    renderer.setFlashEnabled(settings.flash);
    document.body.classList.toggle('settings-no-flash', !settings.flash);
  };
  const bindRange = (id: string, key: 'sensitivity' | 'fov', show: (v: number) => string) => {
    const el = byId<HTMLInputElement>(`setting-${id}`);
    const out = byId<HTMLOutputElement>(`setting-${id}-value`);
    el.value = String(settings[key]);
    out.textContent = show(settings[key]);
    el.addEventListener('input', () => {
      settings = { ...settings, [key]: Number(el.value) };
      out.textContent = show(settings[key]);
      applySettings();
      saveSettings(settingsStore, settings);
    });
  };
  const bindToggle = (id: string, key: 'shake' | 'flash') => {
    const el = byId<HTMLInputElement>(`setting-${id}`);
    const out = byId<HTMLSpanElement>(`setting-${id}-value`);
    el.checked = settings[key];
    out.textContent = settings[key] ? 'On' : 'Off';
    el.addEventListener('change', () => {
      settings = { ...settings, [key]: el.checked };
      out.textContent = settings[key] ? 'On' : 'Off';
      applySettings();
      saveSettings(settingsStore, settings);
    });
  };
  bindRange('sensitivity', 'sensitivity', (v) => `${v.toFixed(2)}×`);
  bindRange('fov', 'fov', (v) => `${Math.round(v)}°`);
  bindToggle('shake', 'shake');
  bindToggle('flash', 'flash');
  applySettings();

  const params = new URLSearchParams(window.location.search);
  // `?seed=` is untrusted input: only a decimal uint32 is honoured, anything else is the clock.
  const seed = parseSeed(params.get('seed'), Date.now() >>> 0);
  const botMode = params.has('bot');
  const recordMode = params.has('record');
  let game = createGame({ seed });
  let rng = createRng(seed ^ 0x9e3779b9);
  let botRng = createRng(seed ^ 0x7f4a7c15);
  let botMemory: BotMemory = createBotMemory();
  let running = false;
  let accumulator = 0;
  let last = performance.now();
  renderer.setArena(game.arena);

  window.ringfall = { state: () => game };

  const showOverlay = (finished: boolean): void => {
    running = false;
    audio.silence();
    audio.setMusic('title');
    hud.hide();
    overlay.hidden = false;
    if (finished) {
      const won = game.status === 'won';
      tagline.textContent = won
        ? 'The arena is quiet. The ring still turns.'
        : 'Shields down. Health gone. The ring does not care.';
      const round = {
        score: game.score,
        wave: game.wave.number,
        kills: game.kills,
        won,
        at: new Date().toISOString(),
      };
      // Personal bests live only in this browser; storage may be blocked, and that is fine.
      let storage: Storage | null = null;
      try {
        storage = window.localStorage;
      } catch {
        storage = null;
      }
      const comparison = recordRound(storage, round);
      stats.textContent = `${summarize(game)} ${describeComparison(round, comparison)}`;
      stats.hidden = false;
      startButton.textContent = won ? 'Run it back' : 'Redeploy';
    } else {
      // A pause, not an ending: the card must not keep the previous round's death copy.
      tagline.textContent = 'Paused. Esc released the mouse; click to take it back.';
      stats.hidden = true;
      startButton.textContent = 'Resume';
    }
    if (document.pointerLockElement) document.exitPointerLock();
  };

  const requestFullscreen = (): void => {
    const root = document.documentElement;
    if (document.fullscreenElement || !root.requestFullscreen) return;
    root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
      // Refused (iframe without allow, or no gesture): the game still runs in the tab.
    });
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else requestFullscreen();
  });

  /** Seconds of hit-stop remaining; the loop runs the sim at 5% speed while it is positive. */
  let hitStop = 0;

  const start = async (): Promise<void> => {
    audio.unlock();
    if (!recordMode) requestFullscreen();
    if (game.status !== 'playing') {
      const next = Date.now() >>> 0;
      game = createGame({ seed: next });
      rng = createRng(next ^ 0x9e3779b9);
      botRng = createRng(next ^ 0x7f4a7c15);
      botMemory = createBotMemory();
      renderer.setArena(game.arena);
      input.reset();
    } else {
      // Resuming after Esc: `reset()` here snapped the camera to yaw 0 on every resume.
      input.release();
    }
    hitStop = 0;
    overlay.hidden = true;
    if (!params.has('nohud')) hud.show(); // `?nohud`: dev flag, keeps the HUD hidden for clean hero captures.
    running = true;
    audio.setMusic('calm');
    accumulator = 0;
    last = performance.now();
    await input.lock();
  };

  startButton.addEventListener('click', () => void start());
  // The score needs a user gesture; the first click anywhere on the title screen wakes it.
  overlay.addEventListener('pointerdown', () => {
    audio.unlock();
    audio.setMusic('title');
  });
  document.addEventListener('pointerlockchange', () => {
    // Esc releases the pointer; pause to the overlay so the player can recapture it.
    if (!input.locked && running && game.status === 'playing') showOverlay(false);
  });

  /** One simulation step from either the human or the bot, plus event fan-out. */
  const simulate = (now: number): void => {
    let input = input_take();
    if (botMode) {
      const decision = decideBot(game, botMemory, STEADY_BOT, FIXED_DT, botRng);
      botMemory = decision.memory;
      input = decision.input;
    }
    game = stepGame(game, input, FIXED_DT, rng);
    if (game.events.length > 0) {
      renderer.handle(game.events, now / 1000);
      hud.handle(game.events);
      audio.handle(game.events);
      for (const e of game.events) {
        if (e.type === 'shieldBroken') hitStop = Math.max(hitStop, 0.12);
        if (e.type === 'enemyKilled') hitStop = Math.max(hitStop, e.score >= 300 ? 0.09 : 0.05);
      }
    }
    audio.setMusic(game.wave.phase === 'active' && game.enemies.length > 0 ? 'combat' : 'calm');
  };
  const input_take = (): ReturnType<InputController['take']> => input.take();

  if (recordMode) {
    let captureClock = 0;
    window.ringfallCapture = {
      start: async () => {
        await start();
        running = false;
      },
      advance: (steps) => {
        for (let i = 0; i < steps; i += 1) {
          captureClock += FIXED_DT * 1000;
          simulate(captureClock);
          if (game.status !== 'playing') break;
        }
        hud.render(game);
        renderer.render(game, captureClock / 1000, FIXED_DT * steps);
      },
      score: (seconds, leadIn) => renderScore({ seed, seconds, leadIn }),
    };
  }

  let lastIdleRender = 0;
  const frame = (now: number): void => {
    // rAF timestamps can trail performance.now() right after start(); never let dt go negative.
    const frameDt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    // The title overlay blurs the scene, so idle frames only need a slow refresh. This keeps
    // the GPU (and software GL in CI) free for the click that starts the game.
    if (!running && !recordMode) {
      if (now - lastIdleRender > 250) {
        lastIdleRender = now;
        renderer.render(game, now / 1000, frameDt);
      }
      requestAnimationFrame(frame);
      return;
    }
    if (running) {
      // Hit-stop: time slows to a crawl for a few frames on a kill or a shield break.
      if (hitStop > 0) {
        hitStop = Math.max(0, hitStop - frameDt);
        accumulator += frameDt * 0.05;
      } else {
        accumulator += frameDt;
      }
      // Anything past the per-frame cap is dropped, not deferred: a deferred backlog would
      // fast-forward the game at five steps a frame once the frame rate recovers.
      accumulator = Math.min(accumulator, FIXED_DT * MAX_STEPS_PER_FRAME);
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        simulate(now);
        accumulator -= FIXED_DT;
        steps += 1;
        if (game.status !== 'playing') {
          window.setTimeout(() => showOverlay(true), 1600);
          running = false;
          break;
        }
      }
      hud.render(game);
    }
    if (!recordMode) renderer.render(game, now / 1000, frameDt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

main();
