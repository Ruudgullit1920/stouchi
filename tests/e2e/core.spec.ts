/* Phase 1 flows on a real backend (spec §8.6): log, edit, delete + undo,
 * search, month switch, and an offline log that syncs later. */
import { expect, test, type Page } from '@playwright/test';
import { blockingViolations, cleanUp, HAS_ACCOUNT, readMil, RUN, STORAGE_STATE } from './helpers';

test.skip(!HAS_ACCOUNT, 'no test account in .env');
test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: 'serial' });
test.afterAll(cleanUp);

const reste = async (page: Page) => readMil((await page.locator('.hero .big').textContent()) ?? '');

/** Reste once the first pull has landed and the rolling number has stopped. */
async function settledReste(page: Page): Promise<number> {
  let last = NaN;
  await expect
    .poll(
      async () => {
        const prev = last;
        last = await reste(page);
        return last === prev;
      },
      { intervals: [700] },
    )
    .toBe(true);
  return last;
}

async function logExpense(page: Page, keys: string, label: string) {
  await page.getByRole('button', { name: 'Ajouter une dépense' }).click();
  await page.getByRole('button', { name: /Saisie manuelle/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Nouvelle dépense' });
  for (const k of keys)
    await sheet.getByRole('button', { name: k === ',' ? 'Virgule' : k, exact: true }).click();
  await sheet.getByLabel('Note').fill(label);
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(sheet).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/budget');
  await expect(page.locator('.hero')).toBeVisible();
});

test('log an expense by keypad: Reste drops by the amount', async ({ page }, info) => {
  const label = `${RUN}-${info.project.name}-add`;
  const before = await settledReste(page);
  await logExpense(page, '12', label);
  await expect(page.getByText('Dépense enregistrée')).toBeVisible();
  await expect(page.getByText(label)).toBeVisible();
  await expect.poll(() => reste(page)).toBe(before - 12_000);
  expect(await blockingViolations(page)).toEqual([]);
});

test('edit an expense', async ({ page }, info) => {
  const label = `${RUN}-${info.project.name}-edit`;
  await logExpense(page, '7', label);
  await page.getByText(label).click();
  const sheet = page.getByRole('dialog', { name: 'Dépense' });
  await expect(sheet).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await sheet.getByLabel('Note').fill(`${label}-v2`);
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(`${label}-v2`)).toBeVisible();
});

test('delete an expense, then undo', async ({ page }, info) => {
  const label = `${RUN}-${info.project.name}-del`;
  await logExpense(page, '3', label);
  await page.getByText(label).click();
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await page.getByRole('button', { name: 'Oui, supprimer' }).click();
  await expect(page.getByText(label)).toBeHidden();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByText(label)).toBeVisible();
});

test('search finds a logged expense', async ({ page }, info) => {
  const label = `${RUN}-${info.project.name}-find`;
  await logExpense(page, '5', label);
  await page.getByRole('button', { name: 'Historique' }).click();
  await page.getByRole('searchbox', { name: 'Rechercher dans l’historique' }).fill(label);
  await expect(page.locator('mark', { hasText: label })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test('switch months in the pot ledger and in Historique', async ({ page }) => {
  await page.locator('.pot').first().click();
  const heading = page.locator('.monthnav__label');
  const current = await heading.textContent();
  await page.getByRole('button', { name: 'Période précédente' }).click();
  await expect(heading).not.toHaveText(current ?? '');
  expect(await blockingViolations(page)).toEqual([]);

  await page.getByRole('button', { name: 'Historique' }).click();
  const selected = page.getByRole('option', { selected: true });
  const month = await selected.getAttribute('aria-label');
  await selected.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('option', { selected: true })).not.toHaveAttribute('aria-label', month ?? '');
  expect(await blockingViolations(page)).toEqual([]);
});

test('log offline: shows at once, syncs when back online', async ({ page, context }, info) => {
  const label = `${RUN}-${info.project.name}-offline`;
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await logExpense(page, '9', label);
  await expect(page.getByText(label)).toBeVisible();
  await expect(page.getByText(/Hors ligne/)).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/Hors ligne/)).toBeHidden();
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.getByText(label)).toBeVisible();
});
