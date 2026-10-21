import { IDLE_INPUT, type InputFrame } from '../core/game';
import { clamp } from '../core/vec3';
import { accumulateWheel } from './wheel';

const MAX_PITCH = Math.PI / 2 - 0.02;
/** Radians of look per pixel of mouse travel at sensitivity 1 (docs/design-doc.md). */
const BASE_SENSITIVITY = 0.0022;

/**
 * Collects keyboard and mouse state between simulation steps. Held actions (move, fire, jump,
 * crouch) are read live; one-shot actions (reload, grenade, swap) are latched until the next
 * `take()`.
 */
export class InputController {
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private firing = false;
  private reloadLatched = false;
  private grenadeLatched = false;
  private swapLatched = false;
  private sensitivity = BASE_SENSITIVITY;
  /** Wheel travel carried towards the next swap notch (see wheel.ts). */
  private wheelDebt = 0;
  /** True from the first `lock()` until `reset()`: a click on the canvas may ask again. */
  private wantsLock = false;
  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** Requests pointer lock; resolves false where the browser refuses (headless, iframes). */
  async lock(): Promise<boolean> {
    this.wantsLock = true;
    try {
      const result: unknown = this.target.requestPointerLock();
      if (result instanceof Promise) await result;
      return true;
    } catch {
      return false;
    }
  }

  /** Settings panel: a multiplier on the base look sensitivity. */
  setSensitivity(scale: number): void {
    this.sensitivity = BASE_SENSITIVITY * scale;
  }

  /** New game: look straight ahead and drop every held or latched action. */
  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.wantsLock = false;
    this.releaseAll();
  }

  /** Resume after a pause: keep the look direction, drop every held or latched action. */
  release(): void {
    this.releaseAll();
  }

  /** Snapshot for one simulation step; clears latched one-shot actions. */
  take(): InputFrame {
    const frame: InputFrame = {
      ...IDLE_INPUT,
      forward: Number(this.down('KeyW', 'ArrowUp')) - Number(this.down('KeyS', 'ArrowDown')),
      strafe: Number(this.down('KeyD', 'ArrowRight')) - Number(this.down('KeyA', 'ArrowLeft')),
      jump: this.down('Space'),
      sprint: this.down('ShiftLeft', 'ShiftRight'),
      crouch: this.down('KeyC', 'ControlLeft', 'ControlRight'),
      fire: this.firing,
      reload: this.reloadLatched,
      throwGrenade: this.grenadeLatched,
      swapWeapon: this.swapLatched,
      yaw: this.yaw,
      pitch: this.pitch,
    };
    this.reloadLatched = false;
    this.grenadeLatched = false;
    this.swapLatched = false;
    return frame;
  }

  private down(...codes: readonly string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'KeyR') this.reloadLatched = true;
    if (e.code === 'KeyG') this.grenadeLatched = true;
    if (e.code === 'KeyQ') this.swapLatched = true;
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.yaw -= e.movementX * this.sensitivity;
    this.pitch = clamp(this.pitch - e.movementY * this.sensitivity, -MAX_PITCH, MAX_PITCH);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) {
      // A refused or lost lock (headless, an iframe without `allow`, the browser's cool-down
      // after Esc) left the game running without the mouse; a click on the canvas asks again.
      // The overlay sits over the canvas, so a click on the card never reaches here.
      if (this.wantsLock && e.target === this.target) void this.lock();
      return;
    }
    if (e.button === 0) this.firing = true;
    if (e.button === 2) this.grenadeLatched = true;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.firing = false;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.locked) {
      this.wheelDebt = 0;
      return;
    }
    const { debt, notches } = accumulateWheel(this.wheelDebt, e.deltaY, e.deltaMode);
    this.wheelDebt = debt;
    if (notches !== 0) this.swapLatched = true;
  };

  private readonly releaseAll = (): void => {
    this.keys.clear();
    this.firing = false;
    // A G or R pressed on the title screen, or a right click in the death window, must not
    // fire on the first step of the next game.
    this.reloadLatched = false;
    this.grenadeLatched = false;
    this.swapLatched = false;
    this.wheelDebt = 0;
  };
}
