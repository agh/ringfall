import { ENEMY_STATS } from '../core/enemy';
import type { GameEvent, GameState } from '../core/game';
import { FINAL_WAVE } from '../core/waves';
import { isReloading } from '../core/weapon';

const RADAR_RANGE = 28;

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing HUD element #${id}`);
  return el as T;
};

/** DOM-driven heads-up display: vitals, ammo, wave, messages, and a motion tracker. */
export class Hud {
  private readonly root = byId<HTMLDivElement>('hud');
  private readonly wave = byId<HTMLDivElement>('hud-wave');
  private readonly score = byId<HTMLDivElement>('hud-score');
  private readonly shieldFill = byId<HTMLDivElement>('shield-fill');
  private readonly healthFill = byId<HTMLDivElement>('health-fill');
  private readonly ammoMag = byId<HTMLDivElement>('ammo-mag');
  private readonly ammoReserve = byId<HTMLDivElement>('ammo-reserve');
  private readonly grenades = byId<HTMLDivElement>('grenades');
  private readonly message = byId<HTMLDivElement>('hud-message');
  private readonly hitmarker = byId<HTMLDivElement>('hitmarker');
  private readonly damage = byId<HTMLDivElement>('damage-flash');
  private readonly lowShield = byId<HTMLDivElement>('low-shield');
  private readonly radar = byId<HTMLCanvasElement>('radar');
  private messageTimer: number | null = null;
  private hitTimer: number | null = null;
  private damageTimer: number | null = null;

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.clearMessage();
  }

  handle(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          if (e.hitEnemy) this.flash(this.hitmarker, 90, 'hit');
          break;
        case 'enemyKilled':
          this.flash(this.hitmarker, 160, 'hit');
          break;
        case 'playerDamaged':
          this.flash(this.damage, 60, 'damage');
          break;
        case 'waveStarted':
          this.announce(e.number === FINAL_WAVE ? 'Final wave' : `Wave ${e.number}`, 1800);
          break;
        case 'waveCleared':
          this.announce('Wave cleared', 1600);
          break;
        case 'shieldBroken':
          this.announce('Shield down', 900);
          break;
      }
    }
  }

  render(state: GameState): void {
    const { player } = state;
    this.wave.textContent =
      state.wave.phase === 'countdown'
        ? `Wave ${state.wave.number} in ${Math.ceil(state.wave.phaseEndsAt - state.time)}`
        : `Wave ${state.wave.number} · ${state.enemies.filter((e) => e.state !== 'dead').length} left`;
    this.score.textContent = state.score.toString().padStart(6, '0');
    const v = player.vitality;
    this.shieldFill.style.transform = `scaleX(${v.shield / v.maxShield})`;
    this.healthFill.style.transform = `scaleX(${v.health / v.maxHealth})`;
    this.lowShield.classList.toggle('is-active', v.shield <= 0 && state.status === 'playing');
    const w = player.weapon;
    this.ammoMag.textContent = isReloading(w) ? '--' : w.magazine.toString();
    this.ammoMag.classList.toggle('is-low', w.magazine <= 6 && !isReloading(w));
    this.ammoReserve.textContent = `/ ${w.reserve}`;
    if (this.grenades.childElementCount !== player.grenades) {
      this.grenades.replaceChildren(
        ...Array.from({ length: player.grenades }, () => document.createElement('i')),
      );
    }
    this.drawRadar(state);
  }

  private drawRadar(state: GameState): void {
    const ctx = this.radar.getContext('2d');
    if (!ctx) return;
    const size = this.radar.width;
    const half = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.25)';
    ctx.lineWidth = 1;
    for (const r of [0.33, 0.66, 1]) {
      ctx.beginPath();
      ctx.arc(half, half, half * r - 1, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(half, size);
    ctx.moveTo(0, half);
    ctx.lineTo(size, half);
    ctx.stroke();

    const { yaw } = state.player;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    for (const enemy of state.enemies) {
      if (enemy.state === 'dead') continue;
      const dx = enemy.position.x - state.player.position.x;
      const dz = enemy.position.z - state.player.position.z;
      const forward = dx * fx + dz * fz;
      const right = dx * rx + dz * rz;
      const dist = Math.hypot(forward, right);
      if (dist > RADAR_RANGE) continue;
      const px = half + (right / RADAR_RANGE) * half;
      const py = half - (forward / RADAR_RANGE) * half;
      ctx.fillStyle = enemy.state === 'spawning' ? 'rgba(248,113,113,0.4)' : '#f87171';
      ctx.beginPath();
      ctx.arc(px, py, enemy.kind === 'strider' ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const bolt of state.bolts) {
      const dx = bolt.position.x - state.player.position.x;
      const dz = bolt.position.z - state.player.position.z;
      const forward = dx * fx + dz * fz;
      const right = dx * rx + dz * rz;
      if (Math.hypot(forward, right) > RADAR_RANGE) continue;
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(
        half + (right / RADAR_RANGE) * half - 1,
        half - (forward / RADAR_RANGE) * half - 1,
        2,
        2,
      );
    }
    ctx.fillStyle = '#dff6ff';
    ctx.beginPath();
    ctx.moveTo(half, half - 6);
    ctx.lineTo(half - 4, half + 4);
    ctx.lineTo(half + 4, half + 4);
    ctx.closePath();
    ctx.fill();
  }

  private announce(text: string, ms: number): void {
    this.message.textContent = text;
    this.message.classList.add('is-visible');
    if (this.messageTimer !== null) window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => this.clearMessage(), ms);
  }

  private clearMessage(): void {
    this.message.classList.remove('is-visible');
    this.messageTimer = null;
  }

  private flash(el: HTMLElement, ms: number, kind: 'hit' | 'damage'): void {
    el.classList.add('is-active');
    const existing = kind === 'hit' ? this.hitTimer : this.damageTimer;
    if (existing !== null) window.clearTimeout(existing);
    const timer = window.setTimeout(() => el.classList.remove('is-active'), ms);
    if (kind === 'hit') this.hitTimer = timer;
    else this.damageTimer = timer;
  }
}

/** Exposed for the end-of-game card. */
export const summarize = (state: GameState): string => {
  const kinds = Object.keys(ENEMY_STATS).length;
  return `Score ${state.score} · ${state.kills} kills across ${kinds} enemy types · reached wave ${state.wave.number}`;
};
