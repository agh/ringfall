import { expect, test } from '@playwright/test';
import { TABLEAU_DURATION } from '../../src/core/game';

// Software GL (CI runners, sandboxes) renders the post stack at a few frames per second, and this
// spec renders once per `advance` call for about ninety simulation seconds.
test.describe.configure({ timeout: 180_000 });

/** Seed 7 is the demo seed; the steady bot wins it at t = 89.6 s (headless playtest, 400 s cap). */
const DEMO_SEED = 7;
const CAP_SECONDS = 400;

interface Snapshot {
  readonly time: number;
  readonly status: string;
  readonly wave: number;
  readonly tableau: { readonly startedAt: number; readonly endsAt: number } | null;
}

test.describe('Ringfall coherence: the tableau through the shell', () => {
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

  test('the capture hook steps through the tableau to won and never arms the end card', async ({
    page,
  }) => {
    await page.goto(`/?record&bot&seed=${DEMO_SEED}`);
    await page.waitForFunction(() => Boolean(window.ringfallCapture), null, { timeout: 60_000 });
    await page.evaluate(() => window.ringfallCapture?.start());
    await expect(page.locator('#overlay')).toBeHidden();
    await expect(page.locator('#hud')).toBeVisible();

    // One render per call: ten-second chunks until the final wave, then one-second chunks so
    // the tableau is observed while it still holds.
    const advance = (steps: number): Promise<Snapshot> =>
      page.evaluate((n) => {
        window.ringfallCapture?.advance(n);
        const s = window.ringfall?.state();
        if (!s) throw new Error('no state');
        return { time: s.time, status: s.status, wave: s.wave.number, tableau: s.tableau };
      }, steps);

    let s = await advance(0);
    while (s.tableau === null && s.status === 'playing' && s.time < CAP_SECONDS) {
      s = await advance(s.wave < 5 ? 600 : 60);
    }
    expect(
      s.tableau,
      `no tableau by t = ${s.time.toFixed(1)} s (status ${s.status})`,
    ).not.toBeNull();
    // The tableau holds: the status is still 'playing', the card is not up, the HUD is.
    expect(s.status).toBe('playing');
    const startedAt = s.tableau?.startedAt ?? 0;
    const endsAt = s.tableau?.endsAt ?? 0;
    expect(endsAt - startedAt).toBeCloseTo(TABLEAU_DURATION, 5);
    expect(s.time).toBeLessThan(endsAt);
    await expect(page.locator('#overlay')).toBeHidden();
    await expect(page.locator('#hud')).toBeVisible();

    // Stepping inside the tableau keeps it; stepping past `endsAt` ends the run as won.
    const remaining = Math.ceil((endsAt - s.time) * 60);
    if (remaining > 60) {
      s = await advance(30);
      expect(s.status).toBe('playing');
      expect(s.tableau).toEqual({ startedAt, endsAt });
    }
    s = await advance(Math.ceil((endsAt - s.time) * 60) + 1);
    expect(s.status).toBe('won');
    expect(s.time).toBeGreaterThanOrEqual(endsAt);

    // The animation loop is suspended under `?record`, so the four-second card timer is never
    // armed: the recorder keeps the scene and HUD, and a further advance is a no-op in sim time.
    await page.waitForTimeout(4500);
    await expect(page.locator('#overlay')).toBeHidden();
    await expect(page.locator('#overlay-result')).toBeHidden();
    await expect(page.locator('#hud')).toBeVisible();
    const after = await advance(60);
    expect(after.status).toBe('won');
    expect(after.time).toBe(s.time);
  });
});
