import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  FOV_RANGE,
  loadSettings,
  parseSettings,
  SENSITIVITY_RANGE,
  SETTINGS_KEY,
  type SettingsStore,
  saveSettings,
} from '../../src/core/settings';

const memoryStore = (
  seed: Record<string, string> = {},
): SettingsStore & { data: Record<string, string> } => {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};

describe('settings', () => {
  it('defaults match the behaviour before the panel existed', () => {
    expect(DEFAULT_SETTINGS).toEqual({ sensitivity: 1, fov: 78, shake: true, flash: true });
    expect(DEFAULT_SETTINGS.sensitivity).toBeGreaterThanOrEqual(SENSITIVITY_RANGE.min);
    expect(DEFAULT_SETTINGS.sensitivity).toBeLessThanOrEqual(SENSITIVITY_RANGE.max);
    expect(DEFAULT_SETTINGS.fov).toBeGreaterThanOrEqual(FOV_RANGE.min);
    expect(DEFAULT_SETTINGS.fov).toBeLessThanOrEqual(FOV_RANGE.max);
  });

  it('parses nothing, garbage, and wrong shapes to the defaults', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('fov=90')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([90, true])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and repairs each bad one on its own', () => {
    expect(parseSettings({ sensitivity: 1.5, fov: 90, shake: false, flash: false })).toEqual({
      sensitivity: 1.5,
      fov: 90,
      shake: false,
      flash: false,
    });
    expect(parseSettings({ sensitivity: 'fast', fov: 90 })).toEqual({
      ...DEFAULT_SETTINGS,
      fov: 90,
    });
    expect(parseSettings({ shake: 0, flash: 'no' })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ fov: Number.NaN, sensitivity: Number.POSITIVE_INFINITY })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('clamps sensitivity to 0.5..2 and field of view to 70..100', () => {
    expect(parseSettings({ sensitivity: 0.1 }).sensitivity).toBe(SENSITIVITY_RANGE.min);
    expect(parseSettings({ sensitivity: 9 }).sensitivity).toBe(SENSITIVITY_RANGE.max);
    expect(parseSettings({ fov: 10 }).fov).toBe(FOV_RANGE.min);
    expect(parseSettings({ fov: 170 }).fov).toBe(FOV_RANGE.max);
  });

  it('loads defaults without storage, with empty storage, and with corrupt storage', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStore({ [SETTINGS_KEY]: '{not json' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStore({ [SETTINGS_KEY]: '"fov"' }))).toEqual(DEFAULT_SETTINGS);
    const blocked: SettingsStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(loadSettings(blocked)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through storage under the versioned key', () => {
    const store = memoryStore();
    const chosen = { sensitivity: 0.75, fov: 95, shake: false, flash: true };
    saveSettings(store, chosen);
    expect(Object.keys(store.data)).toEqual([SETTINGS_KEY]);
    expect(loadSettings(store)).toEqual(chosen);
  });

  it('survives storage that throws on write and a missing store', () => {
    const store: SettingsStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveSettings(store, DEFAULT_SETTINGS)).not.toThrow();
    expect(() => saveSettings(null, DEFAULT_SETTINGS)).not.toThrow();
  });
});
