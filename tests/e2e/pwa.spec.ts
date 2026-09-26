/* The offline shell (spec §8.3, Phase 7 Task 3): the service worker serves the
 * app with no network, and an expense logged offline survives a reload, then
 * syncs once. The E2E runs on a production build, so the worker is live. */
import { expect, test } from '@playwright/test';
import { cleanUp, HAS_ACCOUNT, logExpense, RUN, STORAGE_STATE } from './helpers';

test.skip(!HAS_ACCOUNT, 'no test account in .env');
/* the rest of the suite blocks workers (playwright.config.ts); this spec needs one */
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'allow' });
test.afterAll(cleanUp);
/* Playwright's WebKit can't reload offline through a service worker ("internal
   error"): the iPhone check is manual, in the launch smoke test (plan Task 10). */
test.skip(({ browserName }) => browserName === 'webkit', 'offline reload through a worker: Chromium only');

test('offline, a reload still opens the app; an expense logged offline survives it, then syncs', async ({
  page,
  context,
}, info) => {
  const label = `${RUN}-${info.project.name}-pwa`;
  await page.goto('/#/budget');
  await expect(page.locator('.hero')).toBeVisible();
  /* the worker has installed and claimed this page */
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.reload();
  await expect(page.locator('.hero')).toBeVisible();

  await logExpense(page, '8', label);
  await expect(page.getByText(label)).toBeVisible();
  await page.reload();
  await expect(page.getByText(label)).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/Hors ligne/)).toBeHidden();
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.getByText(label)).toHaveCount(1);
});
