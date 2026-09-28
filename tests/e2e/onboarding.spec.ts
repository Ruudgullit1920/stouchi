/* Phase 2 on a real backend (spec §8.6): intro → login → setup → reveal →
 * Budget, resuming setup after a reload, the login's inline check, and the
 * payday deposit at 08:00. Each test puts the shared account back as the core
 * specs expect it. */
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
test.afterAll(() => restoreOnboarded());

const noViolations = async (page: Page) => expect(await blockingViolations(page)).toEqual([]);
const cta = (page: Page) => page.locator('.su-cta');

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('intro → Passer → login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('C’est noté');
    await noViolations(page);
    await page.getByRole('button', { name: 'Passer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /enfin tranquille/ })).toBeVisible();
    await noViolations(page);
  });

  test('login flags an incomplete e-mail', async ({ page }) => {
    await page.goto('/#/login');
    await page.getByLabel('Adresse e-mail').fill('sofien@');
    await page.getByLabel('Mot de passe', { exact: true }).fill('secret1');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toHaveText('Cette adresse e-mail ne semble pas complète.');
    await noViolations(page);
  });
});

test.describe('signed in', () => {
  test.use({ storageState: STORAGE_STATE });

  test('six questions, the reveal, then Budget with the expected Reste', async ({ page }) => {
    const client = await resetOnboarding();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Comment tu t’appelles ?' })).toBeVisible();
    await noViolations(page);
    await page.getByLabel('Ton prénom').fill('Amel');
    await cta(page).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Ta devise' })).toBeVisible();
    await page.getByRole('radio', { name: /Dinar tunisien/ }).click();
    await noViolations(page);
    await cta(page).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Tu gagnes combien par mois ?' })).toBeVisible();
    await page.getByLabel(/Salaire net/).fill('2000');
    await noViolations(page);
    await cta(page).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Ton jour de paie ?' })).toBeVisible();
    await page.getByRole('button', { name: /^1er/ }).click();
    await noViolations(page);
    await cta(page).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Tes factures fixes ?' })).toBeVisible();
    await noViolations(page);
    await expect(cta(page)).toHaveText('Je n’ai pas de factures fixes');
    await cta(page).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Ton objectif d’épargne ?' })).toBeVisible();
    await page.getByRole('button', { name: 'Voyage' }).click();
    await noViolations(page);
    await cta(page).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Voilà ton plan, Amel !' })).toBeVisible();
    await noViolations(page);
    await page.getByRole('button', { name: 'Ouvrir mon budget' }).click();

    /* Reste = Besoins + Envies of 2 000 TND, less this month's expenses (payday 1) */
    const monthStart = `${new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' }).slice(0, 8)}01`;
    const { data } = await client
      .from('expenses')
      .select('amount_mil')
      .is('deleted_at', null)
      .gte('spent_on', monthStart);
    const spent = (data ?? []).reduce((s, e: { amount_mil: number }) => s + e.amount_mil, 0);
    await expect
      .poll(async () => readMil((await page.locator('.hero .big').textContent()) ?? ''))
      /* the hero is cut to the tenth of a dinar */
      .toBe(Math.floor((1_600_000 - spent) / 100) * 100);
    await noViolations(page);
    await expect
      .poll(async () => {
        const { data: row } = await client
          .from('profiles')
          .select('onboarded_at')
          .single<{ onboarded_at: string | null }>();
        return row?.onboarded_at ?? null;
      })
      .not.toBeNull();
  });

  test('a reload at step 4 resumes there with the earlier answers', async ({ page }) => {
    await resetOnboarding();
    await page.goto('/');
    await page.getByLabel('Ton prénom').fill('Amel');
    await cta(page).click();
    await page.getByRole('radio', { name: /Dinar tunisien/ }).click();
    await cta(page).click();
    await page.getByLabel(/Salaire net/).fill('2500');
    await cta(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ton jour de paie ?' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Ton jour de paie ?' })).toBeVisible();
    await page.getByRole('button', { name: 'Retour' }).click();
    await expect(page.getByLabel(/Salaire net/)).toHaveValue('2500');
    await page.getByRole('button', { name: 'Retour' }).click();
    await expect(page.getByRole('radio', { name: /Dinar tunisien/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Retour' }).click();
    await expect(page.getByLabel('Ton prénom')).toHaveValue('Amel');
  });

  test('payday at 08:01 writes one deposit, and a reload writes none', async ({ page }) => {
    const client = await resetOnboarding();
    const { data: me } = await client.auth.getUser();
    const userId = me.user?.id ?? '';
    await client.from('profiles').upsert({
      user_id: userId,
      first_name: 'Test',
      salary_mil: 2_000_000,
      payday: 1,
      split_needs: 50,
      split_wants: 30,
      split_savings: 20,
      onboarded_at: '2026-08-15T10:00:00+01:00',
    });
    const { data: goal, error } = await client
      .from('goals')
      .insert({ user_id: userId, name: 'E2E paie', icon: 'plane', target_mil: 3_000_000 })
      .select('id')
      .single();
    expect(error).toBeNull();
    await client.from('savings_moves').delete().eq('kind', 'payday');
    const paydayMoves = async () =>
      (await client.from('savings_moves').select('id, occurred_on, amount_mil').eq('kind', 'payday')).data ??
      [];

    let posts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/rest/v1/savings_moves')) posts++;
    });
    await page.clock.install({ time: new Date('2026-09-01T08:01:00+01:00') });
    await page.goto('/');
    await expect(page.locator('.hero')).toBeVisible();
    await expect
      .poll(paydayMoves, { timeout: 15_000 })
      .toEqual([expect.objectContaining({ occurred_on: '2026-09-01', amount_mil: 400_000 })]);
    const firstRun = posts;
    expect(firstRun).toBeGreaterThan(0);

    await page.reload();
    await expect(page.locator('.hero')).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(posts).toBe(firstRun);
    expect(await paydayMoves()).toHaveLength(1);
    await client
      .from('goals')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', goal?.id ?? '');
  });
});
