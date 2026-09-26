/* Phase 5 Objectif on a real backend: Verser and its undo, a target lowered
 * below what is saved, and hidden amounts. The spec brings its own goal and
 * takes it away again, with its deposits. */
import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { blockingViolations, HAS_ACCOUNT, restoreOnboarded, STORAGE_STATE, testClient } from './helpers';

test.skip(!HAS_ACCOUNT, 'no test account in .env');
test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: 'serial' });

const NAME = 'E2E voyage';
let client: SupabaseClient;
let goalId = '';

test.beforeAll(async () => {
  client = await testClient();
  await restoreOnboarded(client);
  const { data: auth } = await client.auth.getUser();
  await client.from('goals').update({ archived_at: new Date().toISOString() }).is('archived_at', null);
  const { data, error } = await client
    .from('goals')
    .insert({ user_id: auth.user?.id, name: NAME, icon: 'plane', target_mil: 3_000_000 })
    .select('id')
    .single<{ id: string }>();
  if (error) throw error;
  goalId = data.id;
});

test.afterAll(async () => {
  await client.from('savings_moves').delete().eq('goal_id', goalId);
  await client.from('goals').update({ archived_at: new Date().toISOString() }).eq('id', goalId);
});

const card = (page: Page) => page.locator('.goal-card');

test.beforeEach(async ({ page }) => {
  await page.goto('/#/goal');
  /* the first pull reads goals after the expenses: give it time */
  await expect(card(page)).toContainText(NAME, { timeout: 20_000 });
});

async function verser(page: Page, amount: string) {
  await page.locator('.goal-verser').click();
  const sheet = page.getByRole('dialog', { name: 'Verser dans l’objectif' });
  await sheet.getByLabel('Montant à verser').fill(amount);
  await sheet.getByRole('button', { name: 'Verser' }).click();
  await expect(sheet).toBeHidden();
}

test('Verser 100: the card and the list update, then undo', async ({ page }) => {
  await expect(card(page).locator('.goal-card__saved')).toHaveText(/^0\s*TND$/);
  expect(await blockingViolations(page)).toEqual([]);
  await verser(page, '100');
  await expect(card(page).locator('.goal-card__saved')).toHaveText(/^100\s*TND$/);
  await expect(page.locator('.sec', { hasText: 'Versements' })).toContainText('1 ·');
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(card(page).locator('.goal-card__saved')).toHaveText(/^0\s*TND$/);
  await expect(page.locator('.sec', { hasText: 'Versements' })).not.toContainText('1 ·');
});

test('a target below what is saved shows the reached state', async ({ page }) => {
  await verser(page, '50');
  await expect(card(page).locator('.goal-card__saved')).toHaveText(/^50\s*TND$/);
  await card(page).click();
  const sheet = page.getByRole('dialog', { name: 'Modifier l’objectif' });
  await sheet.getByLabel('Il te faut combien ? (TND)').fill('20');
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(sheet).toBeHidden();
  await expect(card(page).locator('.goal-card__pct')).toHaveText('100 %');
  await expect(card(page)).toContainText('Atteint, mabrouk !');
  await expect(page.locator('.goal-whatif')).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);
});

test('hidden amounts mask the goal card', async ({ page }) => {
  await page.goto('/#/me');
  await page.getByRole('switch', { name: 'Masquer les montants' }).click();
  await page.goto('/#/goal');
  await expect(card(page).locator('.goal-card__saved')).toContainText('•••');
  await expect(card(page).locator('.goal-card__target')).toContainText('•••');
});
