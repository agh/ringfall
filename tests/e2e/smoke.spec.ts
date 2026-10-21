import { expect, test } from '@playwright/test';

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

    // The simulation must advance and the first wave must arrive.
    await page.waitForFunction(() => (window.ringfall?.state().time ?? 0) > 0.5);
    await page.waitForFunction(() => (window.ringfall?.state().enemies.length ?? 0) > 0, null, {
      timeout: 10_000,
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
    expect(snapshot.enemies).toBe(3);
    expect(snapshot.wavePhase).toBe('active');
    expect(pageErrors).toEqual([]);
  });

  test('keyboard input moves the player', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Deploy' }).click();
    await page.waitForFunction(() => (window.ringfall?.state().time ?? 0) > 0.2);
    const before = await page.evaluate(() => window.ringfall?.state().player.position.z ?? 0);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => window.ringfall?.state().player.position.z ?? 0);
    expect(after).toBeLessThan(before - 0.5);
  });
});
