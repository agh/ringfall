import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/balance/**/*.test.ts'],
    // 'forks' is the default; measure before overriding it
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'lcov'],
      // A few points under the measured 99.6 / 100 / 95.9 / 99.6 (#51, T9), so a new core
      // module cannot land untested, while a handful of defensive branches may stay uncovered.
      thresholds: {
        lines: 97,
        functions: 97,
        branches: 90,
        statements: 97,
      },
    },
  },
});
