import { describe, expect, it } from 'vitest';
import { parseArgs, requireInt, requireSeed } from '../../scripts/lib/args.mjs';

describe('script argument parsing', () => {
  it('pairs flags with values and treats a following flag as a bare switch', () => {
    expect(parseArgs(['--seed', '7', '--out', 'x.mp4'])).toEqual({ seed: '7', out: 'x.mp4' });
    expect(parseArgs(['--out', '--seed', '7'])).toEqual({ out: 'true', seed: '7' });
    expect(parseArgs(['--force'])).toEqual({ force: 'true' });
  });

  it('rejects unknown flags when an allow-list is given', () => {
    expect(() => parseArgs(['--fsp', '24'], new Set(['fps']))).toThrow(/unknown flag --fsp/);
    expect(parseArgs(['--fps', '24'], new Set(['fps']))).toEqual({ fps: '24' });
  });

  it.each([
    'abc',
    '0',
    '-1',
    '1.5',
    '1e999',
    'Infinity',
    'NaN',
    '0x10',
    '4294967296',
    '0x10;rm -rf /',
  ])('refuses seed %j', (raw) => {
    expect(() => requireSeed(raw)).toThrow(/--seed must be an integer/);
  });

  it('accepts a decimal uint32 seed and falls back when absent', () => {
    expect(requireSeed('7')).toBe(7);
    expect(requireSeed('4294967295')).toBe(4294967295);
    expect(requireSeed(undefined)).toBe(7);
    expect(requireInt('fps', undefined, 30)).toBe(30);
    expect(() => requireInt('fps', '0', 30)).toThrow(/--fps/);
  });
});
