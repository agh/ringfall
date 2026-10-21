import { expect, test } from '@playwright/test';

// Software GL (CI runners, sandboxes) renders the post stack at a few frames per second, and
// a two-core runner spends more than a minute compiling the shader set on the first frame
// after Deploy, so the first simulation step can be minutes away from the click.
const FIRST_FRAME_TIMEOUT = 240_000;
test.describe.configure({ timeout: 600_000 });

test.describe('Ringfall smoke', () => {
  // Every test fails on a page error or a console error, not only the first one.
  let pageErrors: string[] = [];
  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text());
    });
  });
  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test('loads the title screen and starts a game', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Ringfall');
    await expect(page.getByRole('heading', { name: 'RINGFALL' })).toBeVisible();
    await expect(page.locator('#hud')).toBeHidden();

    await page.getByRole('button', { name: 'Deploy' }).click();
    await expect(page.locator('#overlay')).toBeHidden();
    await expect(page.locator('#hud')).toBeVisible();
    await expect(page.locator('#hud-wave')).toContainText(/Wave 1/);

    // The simulation must advance. Wave spawning is covered headlessly in tests/unit; waiting
    // for it here would make the test a benchmark of the runner's GPU.
    await page.waitForFunction(() => (window.ringfall?.state().time ?? 0) > 0.5, null, {
      timeout: FIRST_FRAME_TIMEOUT,
    });
    const snapshot = await page.evaluate(() => {
      const s = window.ringfall?.state();
      return {
        time: s?.time ?? 0,
        status: s?.status ?? '',
        enemies: s?.enemies.length ?? 0,
        playerZ: s?.player.position.z ?? 0,
        wavePhase: s?.wave.phase ?? '',
      };
    });
    expect(snapshot.status).toBe('playing');
    expect(['countdown', 'active']).toContain(snapshot.wavePhase);
    expect(snapshot.time).toBeGreaterThan(0.5);
    // "Renders" means a live WebGL 2 context on the scene canvas, not only a DOM that updates.
    const hasContext = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#scene');
      return canvas?.getContext('webgl2') !== null;
    });
    expect(hasContext).toBe(true);
  });

  test('keyboard input moves the player', async ({ page }) => {
    // This test asserts input reaching the simulation, not the image; `?nopost` bypasses the
    // composer, which halves the frame cost on software GL. The first test keeps the post stack.
    await page.goto('/?nopost');
    await page.getByRole('button', { name: 'Deploy' }).click();
    await page.waitForFunction(() => (window.ringfall?.state().time ?? 0) > 0.2, null, {
      timeout: FIRST_FRAME_TIMEOUT,
    });
    const before = await page.evaluate(() => window.ringfall?.state().player.position.z ?? 0);
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      (z0) => (window.ringfall?.state().player.position.z ?? 0) < z0 - 0.5,
      before,
      { timeout: FIRST_FRAME_TIMEOUT },
    );
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => window.ringfall?.state().player.position.z ?? 0);
    expect(after).toBeLessThan(before - 0.5);
  });
});
