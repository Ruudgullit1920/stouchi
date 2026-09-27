/* Currency choice on a real backend (currency spec §6): onboarding in EUR,
 * Moi → Devise keeping the figures, and the nine flags served as SVG files.
 * Needs 20261002_currency.sql on stouchi-test. The account goes back to TND. */
import { expect, test, type Page } from '@playwright/test';
import {
  blockingViolations,
  HAS_ACCOUNT,
  readMil,
  resetOnboarding,
  restoreOnboarded,
  STORAGE_STATE,
} from './helpers';

test.skip(!HAS_ACCOUNT, 'no test account in .env');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: STORAGE_STATE });
test.afterAll(() => restoreOnboarded());

const cta = (page: Page) => page.locator('.su-cta');
const noViolations = async (page: Page) => expect(await blockingViolations(page)).toEqual([]);

test('onboarding in euros: the step, then the reveal and Budget in €', async ({ page }, info) => {
  await resetOnboarding();
  await page.goto('/');
  await page.getByLabel('Ton prénom').fill('Amel');
  await cta(page).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Ta devise' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(9);
  await page.getByRole('radio', { name: /Euro/ }).click();
  await expect(page.locator('.cur-example')).toContainText('€');
  await noViolations(page);
  await page.screenshot({ path: info.outputPath('currency-step.png'), fullPage: true });
  await cta(page).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Tu gagnes combien par mois ?' })).toBeVisible();
  await expect(page.locator('.amt-in')).toContainText('€');
  await page.getByLabel(/Salaire net/).fill('2000');
  await cta(page).click();
  await page.getByRole('button', { name: /^1er/ }).click();
  await cta(page).click();
  await cta(page).click(); // no bills
  await page.getByRole('button', { name: 'Voyage' }).click();
  await cta(page).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Voilà ton plan, Amel !' })).toBeVisible();
  await expect(page.locator('main')).toContainText('€');
  await expect(page.locator('main')).not.toContainText('TND');
  await page.getByRole('button', { name: 'Ouvrir mon budget' }).click();
  await expect(page.locator('.hero')).toContainText('€');
});

test('Moi → Devise: TND to EUR keeps the same figures with the new unit', async ({ page }) => {
  await restoreOnboarded();
  await page.goto('/#/budget');
  const hero = page.locator('.hero .big');
  await expect(page.locator('.hero')).toContainText('TND');
  const before = readMil((await hero.textContent()) ?? '');

  await page.goto('/#/me');
  await page.getByRole('button', { name: /Devise/ }).click();
  await expect(page.getByText('Tes montants ne sont pas convertis.')).toBeVisible();
  await page.getByRole('radio', { name: /Euro/ }).click();
  await noViolations(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('button', { name: /Devise/ })).toContainText('EUR');

  await page.goto('/#/budget');
  await expect(page.locator('.hero')).toContainText('€');
  expect(readMil((await hero.textContent()) ?? '')).toBe(before);
});

test('the nine flags are SVG files, not the app page', async ({ page, request }) => {
  await page.goto('/#/me');
  await page.getByRole('button', { name: /Devise/ }).click();
  const srcs = await page
    .locator('.cur__flag')
    .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
  expect(srcs).toHaveLength(9);
  for (const src of srcs) {
    const res = await request.get(src);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/svg+xml');
  }
});
