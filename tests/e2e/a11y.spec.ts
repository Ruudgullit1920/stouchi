/* Accessibility on every screen (spec §5.6, §8.6, Phase 7 Task 4): no serious
 * or critical axe violation, on the settled screen. The other specs check the
 * screens their flows pass through; this one sweeps them all in one place,
 * sub-screens and sheets included. */
import { expect, test, type Page } from '@playwright/test';
import { blockingViolations, HAS_ACCOUNT, STORAGE_STATE } from './helpers';

test.skip(!HAS_ACCOUNT, 'no test account in .env');
test.use({ storageState: STORAGE_STATE });

const SCREENS = [
  '#/budget',
  '#/pot/needs',
  '#/pot/wants',
  '#/history',
  '#/goal',
  '#/notifications',
  '#/me',
  '#/me/split',
  '#/me/bills',
  '#/me/notifications',
  '#/me/couple',
];

async function settled(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.locator('main h1').first()).toBeVisible();
  /* no skeleton left: the data has landed */
  await expect(page.locator('main .skeleton')).toHaveCount(0, { timeout: 15_000 });
}

for (const hash of SCREENS)
  test(`${hash} has no serious or critical violation`, async ({ page }) => {
    await settled(page, hash);
    expect(await blockingViolations(page)).toEqual([]);
  });

test('Historique with search results', async ({ page }) => {
  await settled(page, '#/history');
  await page.getByRole('searchbox').fill('a');
  /* results, or the empty state when the test account has nothing to match */
  await expect(page.locator('.sgroup, .state').first()).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test('the add sheet, keypad and form', async ({ page }) => {
  await settled(page, '#/budget');
  await page.getByRole('button', { name: 'Ajouter une dépense' }).click();
  await page.getByRole('button', { name: /Saisie manuelle/ }).click();
  await expect(page.getByRole('dialog', { name: 'Nouvelle dépense' })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test('the chat sheet', async ({ page }) => {
  await settled(page, '#/budget');
  await page.getByRole('button', { name: 'Ajouter une dépense' }).click();
  await page
    .getByRole('button', { name: /Aam Salah/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Aam Salah' })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});
