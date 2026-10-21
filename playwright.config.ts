import { defineConfig, devices } from '@playwright/test';

// Sandboxes with a preinstalled Chromium can point Playwright at it instead of downloading one.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // In CI the annotations go to the job and the HTML report to the failure artifact.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      // Software GL cost is per pixel: at 1280x720 a post-stack frame takes about a second, and
      // the first simulation step is five frames away, so the smoke tests ran 90 s each on the
      // runner. 640x360 keeps the same shaders, composer and HUD at a quarter of the fill.
      use: { ...devices['Desktop Chrome'], viewport: { width: 640, height: 360 } },
    },
  ],
  webServer: {
    command: 'pnpm vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
