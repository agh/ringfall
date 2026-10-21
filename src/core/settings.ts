/**
 * Player settings kept on the player's own machine: mouse sensitivity, field of view, and the
 * two motion toggles the requirements promise. The module is pure over the same tiny storage
 * interface as `records.ts`, so it is unit-tested in Node and the browser hands it `localStorage`.
 * Missing, blocked, or corrupt storage yields the defaults rather than a throw.
 */
export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Settings {
  /** Multiplier on the base look sensitivity (0.0022 rad per pixel). */
  readonly sensitivity: number;
  /** Vertical field of view in degrees before the sprint widening. */
  readonly fov: number;
  /** Camera shake on explosions and hits; off sets the shake cap to zero. */
  readonly shake: boolean;
  /** Hex shield lattice and the HUD damage flash. */
  readonly flash: boolean;
}

export const SETTINGS_KEY = 'ringfall.settings.v1';

/** A well-formed record is under 100 bytes; anything larger is not ours and is not parsed. */
export const MAX_SETTINGS_BYTES = 1024;

export const SENSITIVITY_RANGE = { min: 0.5, max: 2, step: 0.05 } as const;
export const FOV_RANGE = { min: 70, max: 100, step: 1 } as const;

/** Today's behaviour: 0.0022 rad per pixel, a 78 degree lens, every effect on. */
export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 78,
  shake: true,
  flash: true,
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/**
 * Turns whatever came out of storage into valid settings. Unknown shapes yield the defaults;
 * known fields are clamped to their ranges and missing fields fall back one at a time, so an
 * older or hand-edited record keeps what it can.
 */
export const parseSettings = (value: unknown): Settings => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_SETTINGS;
  }
  const raw = value as Record<string, unknown>;
  return {
    sensitivity: clampNumber(
      raw.sensitivity,
      SENSITIVITY_RANGE.min,
      SENSITIVITY_RANGE.max,
      DEFAULT_SETTINGS.sensitivity,
    ),
    fov: clampNumber(raw.fov, FOV_RANGE.min, FOV_RANGE.max, DEFAULT_SETTINGS.fov),
    shake: asBoolean(raw.shake, DEFAULT_SETTINGS.shake),
    flash: asBoolean(raw.flash, DEFAULT_SETTINGS.flash),
  };
};

/** Reads settings; any missing, blocked, or corrupt storage yields the defaults. */
export const loadSettings = (store: SettingsStore | null): Settings => {
  if (!store) return DEFAULT_SETTINGS;
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SETTINGS_BYTES) {
      return DEFAULT_SETTINGS;
    }
    return parseSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/** Writes settings; storage failures are swallowed and the in-memory value still applies. */
export const saveSettings = (store: SettingsStore | null, settings: Settings): void => {
  if (!store) return;
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or a full quota: the setting still holds for this session.
  }
};
