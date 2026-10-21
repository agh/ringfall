import { IDLE_INPUT, type InputFrame } from '../core/game';
import { clamp } from '../core/vec3';

const MAX_PITCH = Math.PI / 2 - 0.02;

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
  private sensitivity = 0.0022;
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
    try {
      const result: unknown = this.target.requestPointerLock();
      if (result instanceof Promise) await result;
      return true;
    } catch {
      return false;
    }
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
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
    if (!this.locked) return;
    if (e.button === 0) this.firing = true;
    if (e.button === 2) this.grenadeLatched = true;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.firing = false;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.locked || e.deltaY === 0) return;
    this.swapLatched = true;
  };

  private readonly releaseAll = (): void => {
    this.keys.clear();
    this.firing = false;
  };
}
