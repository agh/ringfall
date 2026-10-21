import { type GameEvent, type GameState, TAUNT_BARK } from '../core/game';
import type { Vec3 } from '../core/vec3';
import { FINAL_WAVE } from '../core/waves';
import { isReloading, WEAPON_SPECS, type Weapon, weaponSpec } from '../core/weapon';
import { ARENA_SECTOR } from '../core/world';

/** More pips than this and the magazine reads as a bar. */
const MAX_PIPS = 40;

const RADAR_RANGE = 28;

/** Minimum gap between full-screen damage flashes: under three per second. */
const DAMAGE_FLASH_INTERVAL_MS = 340;

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing HUD element #${id}`);
  return el as T;
};

/** Keeps a canvas's backing store matched to its CSS size and the device pixel ratio. */
const fitCanvas = (
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { ctx, w, h };
};

/**
 * Visor-style heads-up display: a shield arc with health beneath it, a sweep tracker with
 * heading, a compass strip, magazine pips, damage-direction segments, and announcements.
 * Everything is sized in viewport units by the stylesheet; canvases follow the device pixel ratio.
 */
export class Hud {
  private readonly root = byId<HTMLElement>('hud');
  private readonly sector = byId<HTMLDivElement>('hud-sector');
  private readonly wave = byId<HTMLDivElement>('hud-wave');
  private readonly waveSub = byId<HTMLDivElement>('hud-wave-sub');
  private readonly score = byId<HTMLDivElement>('hud-score');
  private readonly kills = byId<HTMLDivElement>('hud-kills');
  private readonly vitals = this.root.querySelector<HTMLDivElement>('.hud__vitals');
  private readonly shieldArc = document.getElementById('shield-arc') as SVGPathElement | null;
  private readonly healthArc = document.getElementById('health-arc') as SVGPathElement | null;
  private readonly shieldValue = byId<HTMLSpanElement>('shield-value');
  private readonly shieldLabel = byId<HTMLSpanElement>('shield-label');
  private readonly ammo = this.root.querySelector<HTMLDivElement>('.hud__ammo') ?? this.root;
  private readonly ammoMag = byId<HTMLDivElement>('ammo-mag');
  private readonly ammoReserve = byId<HTMLDivElement>('ammo-reserve');
  private readonly ammoName = byId<HTMLDivElement>('ammo-name');
  private readonly charge = byId<HTMLDivElement>('charge');
  private readonly magazine = byId<HTMLDivElement>('magazine');
  private readonly offhand = byId<HTMLDivElement>('offhand');
  private magazineLayout = '';
  private readonly grenades = byId<HTMLDivElement>('grenades');
  private readonly message = byId<HTMLDivElement>('hud-message');
  private readonly reticle = byId<HTMLDivElement>('reticle');
  private readonly hitmarker = byId<HTMLDivElement>('hitmarker');
  private readonly damageRing = byId<HTMLDivElement>('damage-ring');
  private readonly damage = byId<HTMLDivElement>('damage-flash');
  private readonly lowShield = byId<HTMLDivElement>('low-shield');
  private readonly radar = byId<HTMLCanvasElement>('radar');
  private readonly compass = byId<HTMLCanvasElement>('compass');
  private messageTimer: number | null = null;
  private hitTimer: number | null = null;
  private damageTimer: number | null = null;
  private lastDamageFlash = 0;
  private reticleTimer: number | null = null;
  private lastShield = 100;
  private emptyAnnounced = false;
  private sweep = 0;
  private pendingDamage: Vec3[] = [];

  constructor() {
    this.sector.textContent = `Sector ${ARENA_SECTOR}`;
  }

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
          this.kickReticle(1.25);
          // A plain hit never cuts a live kill marker short.
          if (e.hitEnemy && !this.hitmarker.classList.contains('is-kill'))
            this.flash(this.hitmarker, 110, 'hit');
          break;
        case 'enemyKilled':
          this.hitmarker.classList.add('is-kill');
          this.flash(this.hitmarker, 300, 'hit');
          this.kickReticle(0.85);
          break;
        case 'weaponSwapped':
          this.ammo.classList.remove('is-drawing');
          void this.ammo.offsetWidth;
          this.ammo.classList.add('is-drawing');
          break;
        case 'playerDamaged': {
          // The full-screen flash is capped below three a second (WCAG 2.3.1); a barrage reads
          // as a held glow, and the per-hit direction segment still fires every time.
          const now = performance.now();
          if (now - this.lastDamageFlash >= DAMAGE_FLASH_INTERVAL_MS) {
            this.lastDamageFlash = now;
            this.flash(this.damage, 70, 'damage');
          }
          if (e.from) this.pendingDamage.push(e.from);
          break;
        }
        case 'waveStarted':
          this.announce(e.number === FINAL_WAVE ? 'Final wave' : `Wave ${e.number}`, 1800);
          break;
        case 'waveCleared':
          this.announce('Wave cleared', 1600);
          break;
        case 'shieldBroken':
          // The break is an event, not just a state: the vignette hits once, past the rate cap.
          this.lastDamageFlash = performance.now();
          this.flash(this.damage, 220, 'damage');
          this.announce('Shield down', 900);
          break;
        case 'pickupTaken':
          this.announce(WEAPON_SPECS[e.kind].name, 900);
          break;
        case 'victory':
          this.announce('Chapter 1 complete', 4000);
          break;
        case 'playerDied':
          this.announce('Down', 1600);
          break;
        case 'enemyBark':
          // Rout barks are the renderer's to label over each skimmer; the taunt answers the player.
          if (e.line === TAUNT_BARK) this.announce(e.line, 1400);
          break;
        case 'secretFound':
          this.announce(`Secret found +${e.score}`, 1800);
          break;
      }
    }
  }

  render(state: GameState): void {
    const { player } = state;
    const alive = state.enemies.filter((e) => e.state !== 'dead').length;
    this.wave.textContent = `Wave ${state.wave.number}`;
    this.waveSub.textContent =
      state.wave.phase === 'countdown'
        ? `Contact in ${Math.ceil(state.wave.phaseEndsAt - state.time)}`
        : state.wave.phase === 'active'
          ? `${alive} hostile${alive === 1 ? '' : 's'}`
          : 'Clear';
    // The countdown is the first thing the player should see, so it takes the centre line.
    if (state.wave.phase === 'countdown') {
      const left = Math.ceil(state.wave.phaseEndsAt - state.time);
      if (this.message.textContent !== `Contact in ${left}`)
        this.announce(`Contact in ${left}`, 1100);
    }
    this.score.textContent = state.score.toString().padStart(6, '0');
    this.kills.textContent = `${state.kills} down`;

    const v = player.vitality;
    const shieldFrac = v.shield / v.maxShield;
    if (this.shieldArc) this.shieldArc.style.strokeDasharray = `${shieldFrac * 100} 100`;
    if (this.healthArc)
      this.healthArc.style.strokeDasharray = `${(v.health / v.maxHealth) * 100} 100`;
    this.shieldValue.textContent = Math.round(v.shield).toString();
    const recharging = v.shield > this.lastShield + 1e-6 && v.shield < v.maxShield;
    const down = v.shield <= 0 && state.status === 'playing';
    this.vitals?.classList.toggle('is-recharging', recharging);
    this.vitals?.classList.toggle('is-down', down);
    this.shieldLabel.textContent = down ? 'Shield down' : recharging ? 'Recharging' : 'Shield';
    this.lastShield = v.shield;
    this.lowShield.classList.toggle('is-active', down);

    this.renderWeapon(player.weapon, player.weapons[player.activeSlot === 0 ? 1 : 0]);
    if (this.grenades.childElementCount !== player.grenades) {
      this.grenades.setAttribute('aria-label', `Grenades: ${player.grenades}`);
      this.grenades.replaceChildren(
        ...Array.from({ length: player.grenades }, () => document.createElement('i')),
      );
    }

    this.flushDamageIndicators(state);
    this.drawRadar(state);
    this.drawCompass(state);
  }

  private renderAmmo(w: Weapon, name: string): void {
    const reloading = isReloading(w);
    const lowAt = Math.max(1, Math.round(w.magazineSize * 0.2));
    const low = w.magazine <= lowAt && !reloading;
    // Low ammo is a word as well as a colour; an empty magazine says which key reloads, once.
    this.ammoName.textContent = low ? `${name} · Low` : name;
    this.ammoMag.textContent = reloading ? '--' : w.magazine.toString();
    this.ammoMag.classList.toggle('is-low', low);
    const empty = w.magazine === 0 && !reloading;
    if (empty && !this.emptyAnnounced) this.announce('Reload · R', 1200);
    this.emptyAnnounced = empty;
    this.ammoReserve.textContent = `/ ${w.reserve}`;
  }

  private renderWeapon(w: Weapon, offhand: Weapon | null): void {
    const spec = weaponSpec(w);
    this.renderAmmo(w, spec.name);

    // Charge (beam) and spin (minigun) share one bar; it only shows while something is building.
    const level = spec.chargeTime > 0 ? w.charge : spec.spinUp > 0 ? w.spin : 0;
    this.charge.classList.toggle('is-active', level > 0);
    this.charge.classList.toggle('is-ready', level >= 1);
    this.charge.style.setProperty('--charge', level.toFixed(3));
    const chargeNow = level.toFixed(2);
    if (this.charge.getAttribute('aria-valuenow') !== chargeNow) {
      this.charge.setAttribute('aria-valuenow', chargeNow);
    }

    const bar = w.magazineSize > MAX_PIPS;
    const layout = bar ? 'bar' : `pips:${w.magazineSize}`;
    if (this.magazineLayout !== layout) {
      this.magazineLayout = layout;
      this.magazine.classList.toggle('is-bar', bar);
      this.magazine.replaceChildren(
        ...Array.from({ length: bar ? 1 : w.magazineSize }, () => document.createElement('i')),
      );
    }
    if (bar) {
      this.magazine.style.setProperty('--fill', (w.magazine / w.magazineSize).toFixed(3));
    } else {
      const pips = this.magazine.children;
      for (let i = 0; i < pips.length; i += 1) {
        pips[i]?.classList.toggle('is-spent', i >= w.magazine);
      }
    }

    this.offhand.classList.toggle('is-empty', offhand === null);
    this.offhand.textContent = offhand
      ? `${WEAPON_SPECS[offhand.kind].name} ${offhand.magazine} / ${offhand.reserve}`
      : 'No sidearm';
  }

  private flushDamageIndicators(state: GameState): void {
    if (this.pendingDamage.length === 0) return;
    const { yaw } = state.player;
    const p = state.player.position;
    for (const from of this.pendingDamage) {
      // Bearing of the source relative to where the player is looking; 0 = ahead.
      const dx = from.x - p.x;
      const dz = from.z - p.z;
      const bearing = Math.atan2(-dx, -dz) - yaw;
      const seg = document.createElement('div');
      seg.className = 'hud__damage-seg';
      seg.style.transform = `rotate(${(-bearing * 180) / Math.PI}deg)`;
      this.damageRing.appendChild(seg);
      window.setTimeout(() => seg.remove(), 950);
    }
    this.pendingDamage = [];
  }

  private drawRadar(state: GameState): void {
    const fit = fitCanvas(this.radar);
    if (!fit) return;
    const { ctx, w, h } = fit;
    const half = w / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(half, h / 2);

    // Rings and cross-hairs.
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.22)';
    ctx.lineWidth = Math.max(1, w / 180);
    for (const r of [0.33, 0.66, 0.98]) {
      ctx.beginPath();
      ctx.arc(0, 0, half * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(half, 0);
    ctx.moveTo(0, -half);
    ctx.lineTo(0, half);
    ctx.stroke();

    // Sweep: a fading wedge that rotates once every two seconds.
    this.sweep = (this.sweep + 0.045) % (Math.PI * 2);
    const sweepGrad = ctx.createConicGradient(this.sweep - Math.PI / 2, 0, 0);
    sweepGrad.addColorStop(0, 'rgba(125, 211, 252, 0.35)');
    sweepGrad.addColorStop(0.18, 'rgba(125, 211, 252, 0)');
    sweepGrad.addColorStop(1, 'rgba(125, 211, 252, 0)');
    ctx.fillStyle = sweepGrad;
    ctx.beginPath();
    ctx.arc(0, 0, half * 0.98, 0, Math.PI * 2);
    ctx.fill();

    const { yaw } = state.player;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const project = (pos: Vec3): [number, number, number] => {
      const dx = pos.x - state.player.position.x;
      const dz = pos.z - state.player.position.z;
      const forward = dx * fx + dz * fz;
      const right = dx * rx + dz * rz;
      return [
        (right / RADAR_RANGE) * half,
        -(forward / RADAR_RANGE) * half,
        Math.hypot(forward, right),
      ];
    };

    for (const enemy of state.enemies) {
      if (enemy.state === 'dead') continue;
      const [px, py, dist] = project(enemy.position);
      if (dist > RADAR_RANGE) continue;
      const big = enemy.kind !== 'skimmer';
      const r = (big ? 5 : 3.5) * (w / 150);
      ctx.fillStyle = enemy.state === 'spawning' ? 'rgba(251, 113, 133, 0.4)' : '#fb7185';
      ctx.shadowColor = '#fb7185';
      ctx.shadowBlur = big ? 10 : 6;
      ctx.beginPath();
      if (big) {
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r, py + r);
        ctx.lineTo(px - r, py + r);
        ctx.closePath();
      } else {
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    for (const bolt of state.bolts) {
      const [px, py, dist] = project(bolt.position);
      if (dist > RADAR_RANGE) continue;
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }
    for (const g of state.grenades) {
      const [px, py, dist] = project(g.position);
      if (dist > RADAR_RANGE) continue;
      ctx.fillStyle = '#a3e635';
      ctx.beginPath();
      ctx.arc(px, py, 2.5 * (w / 150), 0, Math.PI * 2);
      ctx.fill();
    }

    // The player: a chevron pointing up (forward).
    const s = 5 * (w / 150);
    ctx.fillStyle = '#e8e4d8';
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.2);
    ctx.lineTo(-s * 0.8, s * 0.8);
    ctx.lineTo(0, s * 0.3);
    ctx.lineTo(s * 0.8, s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawCompass(state: GameState): void {
    const fit = fitCanvas(this.compass);
    if (!fit) return;
    const { ctx, w, h } = fit;
    ctx.clearRect(0, 0, w, h);
    const headingDeg = ((-state.player.yaw * 180) / Math.PI + 360) % 360;
    const pxPerDeg = w / 120; // the strip shows 120 degrees of arc
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.font = `600 ${Math.max(Math.round(14 * dpr), Math.round(h * 0.42))}px "Chakra Petch", "Rajdhani", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Marks live on fixed world bearings; the fractional heading only slides them.
    const base = Math.round(headingDeg / 5) * 5;
    for (let d = -70; d <= 70; d += 5) {
      const deg = (((base + d) % 360) + 360) % 360;
      const x = w / 2 + (base + d - headingDeg) * pxPerDeg;
      const major = deg % 90 === 0;
      const mid = deg % 45 === 0;
      ctx.strokeStyle = major ? '#e8e4d8' : mid ? '#b8d8ea' : 'rgba(138, 160, 184, 0.55)';
      ctx.lineWidth = (major ? 2 : 1) * Math.max(1, w / 460);
      const tick = major ? h * 0.42 : mid ? h * 0.3 : h * 0.18;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - tick);
      ctx.stroke();
      if (major || mid) {
        const label =
          { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[deg] ??
          '';
        ctx.fillStyle = major ? '#e8e4d8' : '#b8d8ea';
        ctx.fillText(label, x, 0);
      }
    }
    // Enemy bearings as small Rose marks along the strip.
    const p = state.player.position;
    ctx.fillStyle = '#fb7185';
    for (const enemy of state.enemies) {
      if (enemy.state === 'dead') continue;
      const bearing =
        ((Math.atan2(-(enemy.position.x - p.x), -(enemy.position.z - p.z)) - state.player.yaw) *
          180) /
        Math.PI;
      const rel = ((((bearing + 180) % 360) + 360) % 360) - 180;
      if (Math.abs(rel) > 60) continue;
      const x = w / 2 - rel * pxPerDeg;
      ctx.beginPath();
      ctx.moveTo(x, h * 0.55);
      ctx.lineTo(x - h * 0.12, h * 0.8);
      ctx.lineTo(x + h * 0.12, h * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    // Centre caret.
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.lineTo(w / 2 - h * 0.15, h * 0.72);
    ctx.lineTo(w / 2 + h * 0.15, h * 0.72);
    ctx.closePath();
    ctx.fill();
  }

  private kickReticle(scale: number): void {
    this.reticle.style.setProperty('--reticle-scale', scale.toString());
    if (this.reticleTimer !== null) window.clearTimeout(this.reticleTimer);
    this.reticleTimer = window.setTimeout(
      () => this.reticle.style.setProperty('--reticle-scale', '1'),
      60,
    );
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
    const timer = window.setTimeout(() => {
      el.classList.remove('is-active');
      if (kind === 'hit') el.classList.remove('is-kill');
    }, ms);
    if (kind === 'hit') this.hitTimer = timer;
    else this.damageTimer = timer;
  }
}

/** Exposed for the end-of-game card. */
export const summarize = (state: GameState): string => {
  const secrets = state.arena.secret === null ? 0 : 1;
  return `${state.kills} kills · wave ${state.wave.number} of ${FINAL_WAVE} · ${state.secretsFound} of ${secrets} secrets found.`;
};
