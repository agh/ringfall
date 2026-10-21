import { expect, test } from '@playwright/test';

// Software GL (CI runners, sandboxes) renders the post stack at a few frames per second.
test.describe.configure({ timeout: 120_000 });

test.describe('Ringfall smoke', () => {
  test('loads the title screen and starts a game', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text());
    });

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
      timeout: 60_000,
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
    expect(pageErrors).toEqual([]);
  });

  test('keyboard input moves the player', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Deploy' }).click();
    await page.waitForFunction(() => (window.ringfall?.state().time ?? 0) > 0.2, null, {
      timeout: 60_000,
    });
    const before = await page.evaluate(() => window.ringfall?.state().player.position.z ?? 0);
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      (z0) => (window.ringfall?.state().player.position.z ?? 0) < z0 - 0.5,
      before,
      { timeout: 60_000 },
    );
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => window.ringfall?.state().player.position.z ?? 0);
    expect(after).toBeLessThan(before - 0.5);
  });
});
