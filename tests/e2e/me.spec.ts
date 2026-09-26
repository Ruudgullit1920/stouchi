/* Phase 5 Moi on a real backend: a salary change for the next payday, a split
 * changed now, a fixed bill, notifications, export, and the delete sheet (only
 * up to the hold: never run it on the shared test user). */
import { expect, test, type Page } from '@playwright/test';
import { blockingViolations, HAS_ACCOUNT, restoreOnboarded, RUN, STORAGE_STATE, testClient } from './helpers';

test.skip(!HAS_ACCOUNT, 'no test account in .env');
test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => restoreOnboarded());
test.afterAll(async () => {
  const client = await testClient();
  await restoreOnboarded(client);
  await client.from('bills').update({ active: false }).like('label', 'e2e-%').eq('active', true);
});

const pots = (page: Page) => page.locator('.pots');

async function openBudget(page: Page) {
  await page.goto('/#/budget');
  await expect(pots(page)).toContainText('50 %');
}

test('Moi and its settings pass the accessibility check', async ({ page }) => {
  await page.goto('/#/me');
  await expect(page.getByRole('heading', { name: 'Moi' })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await page.goto('/#/me/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Notifications sur ce téléphone' })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test('a salary for the next payday leaves Budget as it is, and Moi shows it pending', async ({ page }) => {
  await openBudget(page);
  const before = await pots(page).textContent();
  await page.goto('/#/me');
  await page.getByRole('button', { name: /Salaire mensuel/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Salaire mensuel' });
  /* WebKit: a fill right after the sheet opens can be lost, and a fill types
     after the "2 000" already there: empty it and fill until it holds */
  const input = sheet.getByLabel('Salaire mensuel');
  await expect(async () => {
    await input.fill('');
    await input.fill('2500');
    await expect(input).toHaveValue(/^2\D?500$/, { timeout: 500 });
  }).toPass();
  await sheet.getByRole('button', { name: /^Au / }).click();
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: /Salaire mensuel/ })).toContainText(
    /Passe à 2\D?500\D+TND le/,
  );
  await page.goto('/#/budget');
  await expect(pots(page)).toContainText('50 %');
  expect(await pots(page).textContent()).toBe(before);
});

test('a split changed now moves the Budget pots', async ({ page }) => {
  await page.goto('/#/me/split');
  await page.getByRole('button', { name: /Si ton loyer est élevé/ }).click();
  await expect(page.getByRole('button', { name: 'Dès ce mois' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByRole('heading', { name: 'Répartition' })).toBeHidden();
  await page.goto('/#/budget');
  await expect(pots(page).locator('.pot').first()).toContainText('60 %');
  await expect(pots(page).locator('.pot').nth(1)).toContainText('20 %');
});

test('a new bill shows in À venir, and goes once deactivated', async ({ page }, info) => {
  const label = `${RUN}-${info.project.name}-bill`;
  await page.clock.install({ time: new Date('2026-09-10T10:00:00+01:00') });
  await page.goto('/#/me/bills');
  await page.getByRole('button', { name: /Ajouter une facture/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Nouvelle facture' });
  await sheet.getByLabel('Montant de la facture').fill('45');
  await sheet.locator('.daystrip').getByRole('button', { name: '20', exact: true }).click();
  /* WebKit: see the salary test */
  const name = sheet.getByLabel('Nom');
  await expect(async () => {
    await name.fill(label);
    await expect(name).toHaveValue(label, { timeout: 500 });
  }).toPass();
  await sheet.getByRole('button', { name: 'Ajouter la facture' }).click();
  await expect(sheet).toBeHidden();

  const due = page.locator('.ledger-row__title', { hasText: label });
  await page.goto('/#/budget');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(due).toBeVisible();

  await page.goto('/#/me/bills');
  await page.getByRole('button', { name: new RegExp(label) }).click();
  const edit = page.getByRole('dialog', { name: 'Modifier la facture' });
  await edit.getByRole('button', { name: 'Supprimer la facture' }).click();
  await edit.getByRole('button', { name: 'Toucher encore pour supprimer' }).click();
  await expect(edit).toBeHidden();
  await page.goto('/#/budget');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(due).toHaveCount(0);
});

test('export downloads a CSV', async ({ page }) => {
  await page.goto('/#/me');
  await page.getByRole('button', { name: /Exporter mes données/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Exporter mes données' });
  await sheet.getByRole('button', { name: 'Ce mois' }).click();
  const go = sheet.getByRole('button', { name: 'Exporter' });
  await expect(go).toBeEnabled();
  await expect(sheet.getByTestId('export-sum')).toContainText('ligne');
  expect(await blockingViolations(page)).toEqual([]);
  const download = page.waitForEvent('download');
  await go.click();
  expect((await download).suggestedFilename()).toMatch(/^stouchi-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('the delete sheet asks for a hold (not run on the shared user)', async ({ page }) => {
  await page.goto('/#/me');
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
  const sheet = page.getByRole('dialog', { name: 'Supprimer mon compte' });
  await expect(sheet.getByRole('heading', { name: 'Supprimer ton compte ?' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Maintenir pour supprimer' })).toBeEnabled();
  expect(await blockingViolations(page)).toEqual([]);
});
