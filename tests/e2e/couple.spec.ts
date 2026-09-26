/* Phase 6 couple mode on a real backend (plan Task 11): two browser contexts,
 * the test user (A, "Test") and the partner (B, "Amira"). Needs
 * TEST_PARTNER_EMAIL / TEST_PARTNER_PASSWORD in .env (plan D10), else it skips.
 * Both accounts are unpaired before and after the run. The preview server has
 * no /api/aam, so Aam Salah's answer is stubbed; couple_request, the partner's
 * notification and Accepter are real. */
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  cleanUp,
  HAS_PARTNER,
  partnerClient,
  readMil,
  restoreOnboarded,
  RUN,
  signIn,
  STORAGE_STATE,
  unpair,
} from './helpers';

test.skip(!HAS_PARTNER, 'no partner test account in .env (plan D10)');
test.describe.configure({ mode: 'serial' });

let ctxA: BrowserContext;
let ctxB: BrowserContext;
let a: Page;
let b: Page;

test.beforeAll(async ({ browser }, info) => {
  await unpair();
  await restoreOnboarded();
  const partner = await partnerClient();
  await restoreOnboarded(partner, 'Amira');
  const use = { ...info.project.use, baseURL: 'http://localhost:4173', serviceWorkers: 'block' as const };
  ctxA = await browser.newContext({ ...use, storageState: STORAGE_STATE });
  ctxB = await browser.newContext(use);
  a = await ctxA.newPage();
  b = await ctxB.newPage();
  await signIn(b, partner);
});

test.afterAll(async () => {
  await ctxA?.close();
  await ctxB?.close();
  await unpair();
  await cleanUp();
});

const coupleRow = (page: Page) => page.getByRole('button', { name: /Partager à deux/ });
const besoinsLeft = async (page: Page) =>
  readMil((await page.locator('.pot', { hasText: 'Besoins' }).locator('b.num').textContent()) ?? '');

/** Reloads until `check` passes: the other device's write reaches this one on its next pull. */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ intervals: [1_000, 2_000, 3_000], timeout: 30_000 });
}

async function logExpense(page: Page, keys: string, label: string, pot: 'Besoins' | 'Envies' = 'Besoins') {
  await page.goto('/#/budget');
  await page.getByRole('button', { name: 'Ajouter une dépense' }).click();
  await page.getByRole('button', { name: /Saisie manuelle/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Nouvelle dépense' });
  await sheet.getByRole('button', { name: new RegExp(`^${pot}`) }).click();
  for (const k of keys) await sheet.getByRole('button', { name: k, exact: true }).click();
  await sheet.getByLabel('Note').fill(label);
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(sheet).toBeHidden();
}

/** WebKit can lose a fill made just as a sheet opens (as in me.spec): fill
 * until the field shows the code, formatted in capitals. */
async function typeCode(join: Locator, code: string) {
  const field = join.getByLabel("Code d'invitation");
  await expect(async () => {
    await field.fill('');
    await field.fill(code);
    await expect(field).toHaveValue(code.toUpperCase(), { timeout: 500 });
  }).toPass();
}

/** The partner's row as the server holds it (B's own client, RLS applies). */
type ServerRow = {
  id: string;
  user_id: string;
  household_id: string | null;
  deleted_at: string | null;
} | null;
async function serverRow(label: string): Promise<ServerRow> {
  const client = await partnerClient();
  const answer: { data: unknown; error: Error | null } = await client
    .from('expenses')
    .select('id, user_id, household_id, deleted_at')
    .eq('label', label)
    .maybeSingle();
  if (answer.error) throw answer.error;
  return answer.data as ServerRow;
}

test('a wrong code says so; A invites, B joins with the code in lower case: both show Activé', async () => {
  const info = test.info();
  await b.goto('/#/me/couple');
  await b.getByRole('button', { name: "J'ai reçu un code" }).click();
  /* the sheet stays open: the real code goes into the same field */
  const join = b.getByRole('dialog', { name: 'Rejoindre un foyer' });
  await typeCode(join, 'STC-ZZZZZZ');
  await join.getByRole('button', { name: 'Rejoindre le foyer' }).click();
  await expect(join.getByRole('alert')).toHaveText(/Ce code ne marche pas/);

  await a.goto('/#/me/couple');
  await a.getByRole('button', { name: /Inviter mon partenaire/ }).click();
  const invite = a.getByRole('dialog', { name: 'Inviter mon partenaire' });
  const code = ((await invite.locator('.code').textContent()) ?? '').trim();
  expect(code, info.project.name).toMatch(/^STC-[A-Z0-9]{6}$/);
  await invite.getByRole('button', { name: "C'est envoyé" }).click();
  await expect(a.getByText('Invitation envoyée').first()).toBeVisible();

  await typeCode(join, code.toLowerCase());
  await join.getByRole('button', { name: 'Rejoindre le foyer' }).click();
  await expect(b.getByRole('heading', { name: 'Vous gérez le foyer à deux' })).toBeVisible();

  await b.goto('/#/me');
  await expect(coupleRow(b)).toContainText('Activé');
  await a.goto('/#/me');
  await eventually(a, () => expect(coupleRow(a)).toContainText('Activé', { timeout: 2_000 }));
});

test("B's Besoins expense moves A's shared Besoins and shows B's badge", async () => {
  const info = test.info();
  await a.goto('/#/budget');
  await expect(a.locator('.pot', { hasText: 'Commun' })).toBeVisible();
  const before = await besoinsLeft(a);
  const label = `${RUN}-${info.project.name}-needs`;
  await logExpense(b, '45', label);
  await eventually(a, async () => {
    expect(await besoinsLeft(a)).toBe(before - 45_000);
    const row = a.getByRole('button', { name: new RegExp(label) });
    await expect(row.getByRole('img', { name: 'Noté par Amira' })).toBeVisible({ timeout: 2_000 });
  });
});

test("B's Envies expense never reaches A", async () => {
  const info = test.info();
  const label = `${RUN}-${info.project.name}-wants`;
  await logExpense(b, '12', label, 'Envies');
  /* on the server first, private */
  await expect.poll(async () => (await serverRow(label))?.household_id, { timeout: 20_000 }).toBeNull();
  await a.goto('/#/history');
  await a.reload();
  await a.getByRole('searchbox', { name: 'Rechercher dans l’historique' }).fill(label);
  await expect(a.getByText(/Aucun résultat/)).toBeVisible();
});

test("Historique's Moi hides B's rows on A", async () => {
  const info = test.info();
  const label = `${RUN}-${info.project.name}-needs`;
  await a.goto('/#/history');
  await a.getByRole('searchbox', { name: 'Rechercher dans l’historique' }).fill(label);
  await expect(a.locator('mark', { hasText: label })).toBeVisible();
  /* the pills, not the tab bar's Moi */
  const who = a.getByRole('group', { name: 'Qui a noté' });
  await who.getByRole('button', { name: 'Moi', exact: true }).click();
  await expect(a.locator('mark', { hasText: label })).toHaveCount(0);
  await who.getByRole('button', { name: 'Tout', exact: true }).click();
});

test("A asks Aam Salah to delete B's expense: a request card, B accepts, it is gone for both", async () => {
  const info = test.info();
  const label = `${RUN}-${info.project.name}-needs`;
  const row = await serverRow(label);
  expect(row?.household_id).not.toBeNull();
  await a.route('**/api/aam', (route) =>
    route.fulfill({
      json: {
        reply: 'Je demande à Amira ?',
        actions: [
          { type: 'partner_request', kind: 'confirm', id: 'e1', ref: row?.id, change: { kind: 'delete' } },
        ],
        chips: [],
        lang: 'fr',
        nudgeKey: null,
      },
    }),
  );
  await a.goto('/#/budget');
  await a.getByRole('button', { name: 'Ajouter une dépense' }).click();
  await a.getByRole('button', { name: /Parler à Aam Salah/ }).click();
  const chat = a.getByRole('dialog', { name: 'Aam Salah' });
  const input = chat.getByRole('textbox', { name: 'Message pour Aam Salah' });
  await input.fill(`supprime ${label}`);
  await input.press('Enter');
  await expect(chat.getByText('Envoyer la demande à Amira ?')).toBeVisible();
  await chat.getByRole('button', { name: /^Oui/ }).click();
  await expect(chat.getByText(/Confirmé : demande envoyée à Amira/)).toBeVisible();

  await b.goto('/#/notifications');
  await eventually(b, () => expect(b.getByText(/Test propose de supprimer/)).toBeVisible({ timeout: 2_000 }));
  await b.getByRole('button', { name: 'Accepter' }).first().click();
  await expect(b.getByText('Supprimée, comme demandé.')).toBeVisible();
  await expect
    .poll(async () => (await serverRow(label))?.deleted_at ?? null, { timeout: 20_000 })
    .not.toBeNull();
  await a.goto('/#/budget');
  await eventually(a, () => expect(a.getByRole('button', { name: new RegExp(label) })).toHaveCount(0));
});

test('A stops sharing: both are solo again, and each keeps their own expenses', async () => {
  const info = test.info();
  await a.goto('/#/me/couple');
  await a.getByRole('button', { name: /Arrêter le partage/ }).click();
  const sheet = a.getByRole('dialog', { name: 'Arrêter le partage' });
  await sheet.getByRole('button', { name: /Arrêter le partage/ }).click();
  await expect(a.getByText('Partage arrêté')).toBeVisible();
  await a.goto('/#/me');
  await expect(coupleRow(a)).toContainText('Désactivé');
  await b.goto('/#/me');
  await eventually(b, () => expect(coupleRow(b)).toContainText('Désactivé', { timeout: 2_000 }));

  const wants = await serverRow(`${RUN}-${info.project.name}-wants`);
  expect(wants).toMatchObject({ household_id: null, deleted_at: null });
  await a.goto('/#/budget');
  await expect(a.locator('.pot', { hasText: 'Commun' })).toHaveCount(0);
  await expect(a.getByRole('img', { name: /Noté par/ })).toHaveCount(0);
});
