/**
 * Wheel travel folded into weapon-swap notches. A mouse wheel sends one event of about a
 * hundred pixels per notch; a trackpad sends the same notch as a run of small events, and the
 * old one-swap-per-event rule toggled the slot once per event, so a single flick swapped four
 * times. Travel accumulates until it reaches a notch; a change of direction drops the remainder.
 */

/** Pixels of wheel travel that make one notch: what Chrome reports for one click of a mouse wheel. */
export const WHEEL_NOTCH = 100;
/** `deltaMode` 1 is lines (Firefox: three per click) and 2 is pages; both fold to pixels first. */
const LINE_PIXELS = 34;
const PAGE_PIXELS = 400;

export interface WheelDebt {
  /** Travel carried over, in pixels, towards the next notch. */
  readonly debt: number;
  /** -1, 0 or 1: at most one swap per event, whatever its size, and the travel restarts after it. */
  readonly notches: -1 | 0 | 1;
}

export const wheelPixels = (deltaY: number, deltaMode: number): number =>
  deltaMode === 1 ? deltaY * LINE_PIXELS : deltaMode === 2 ? deltaY * PAGE_PIXELS : deltaY;

export const accumulateWheel = (debt: number, deltaY: number, deltaMode = 0): WheelDebt => {
  const delta = wheelPixels(deltaY, deltaMode);
  if (delta === 0) return { debt, notches: 0 };
  const carried = Math.sign(delta) === Math.sign(debt) ? debt : 0;
  const total = carried + delta;
  if (Math.abs(total) < WHEEL_NOTCH) return { debt: total, notches: 0 };
  return { debt: 0, notches: total > 0 ? 1 : -1 };
};
