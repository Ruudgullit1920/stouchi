/* Phase 3: Aam Salah's chat on a real backend (plan Task 10). The model's
 * answers aren't deterministic, so each test stubs /api/aam with canned replies;
 * everything the app does with them (the local repos, the outbox, sync) is real. */
import { expect, test, type Page } from '@playwright/test';
import { blockingViolations, cleanUp, HAS_ACCOUNT, readMil, RUN, STORAGE_STATE, testClient } from './helpers';

test.skip(!HAS_ACCOUNT, 'no test account in .env');
test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: 'serial' });
test.afterAll(cleanUp);

type Reply = { status?: number; body: Record<string, unknown> };
const reply = (fields: Record<string, unknown>): Reply => ({
  body: { reply: 'Noté.', actions: [], chips: [], lang: 'fr', nudgeKey: null, ...fields },
});

/** Canned /api/aam answers, in order; every request past the list gets a plain reply. */
async function stub(page: Page, replies: Reply[]) {
  const queue = [...replies];
  await page.route('**/api/aam', (route) => {
    const r = queue.shift() ?? reply({});
    return route.fulfill({
      status: r.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(r.body),
    });
  });
}

const tunisDay = (offset = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(
    new Date(Date.now() + offset * 864e5),
  );
const reste = async (page: Page) => readMil((await page.locator('.hero .big').textContent()) ?? '');

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

async function openChat(page: Page) {
  await page.getByRole('button', { name: 'Ajouter une dépense' }).click();
  await page.getByRole('button', { name: /Parler à Aam Salah/ }).click();
  const chat = page.getByRole('dialog', { name: 'Aam Salah' });
  await expect(chat.getByRole('textbox', { name: 'Message pour Aam Salah' })).toBeVisible();
  return chat;
}

async function say(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message pour Aam Salah' });
  await input.fill(text);
  await input.press('Enter');
}

/** A keypad expense, and its id from the device's copy. */
async function logByKeypad(page: Page, keys: string, label: string): Promise<string> {
  await page.getByRole('button', { name: 'Ajouter une dépense' }).click();
  await page.getByRole('button', { name: /Saisie manuelle/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Nouvelle dépense' });
  for (const k of keys) await sheet.getByRole('button', { name: k, exact: true }).click();
  await sheet.getByLabel('Note').fill(label);
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(sheet).toBeHidden();
  return page.evaluate(async (wanted) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('stouchi');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(new Error('the device database did not open'));
    });
    const rows = await new Promise<{ id: string; label: string }[]>((resolve) => {
      const req = db.transaction('expenses').objectStore('expenses').getAll();
      req.onsuccess = () => resolve(req.result as { id: string; label: string }[]);
    });
    db.close();
    return rows.find((r) => r.label === wanted)?.id ?? '';
  }, label);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/budget');
  /* the first pull from the free test project can take a while */
  await expect(page.locator('.hero')).toBeVisible({ timeout: 15_000 });
});

test('"50 courses hier" → receipt, Reste drops by 50; Annuler brings it back', async ({ page }, info) => {
  const label = `${RUN}-${info.project.name}-chat`;
  /* payday is the 1st: on the 1st, "hier" is last period, so the stub logs today */
  const date = tunisDay().endsWith('-01') ? tunisDay() : tunisDay(-1);
  await stub(page, [
    reply({
      actions: [
        { type: 'add_expense', kind: 'direct', amount: 50, category: 'courses', pot: 'besoins', label, date },
      ],
    }),
  ]);
  /* the first pull must have landed before Reste is read */
  await page.waitForLoadState('networkidle');
  const before = await settledReste(page);
  const chat = await openChat(page);
  expect(await blockingViolations(page)).toEqual([]);
  await say(page, '50 courses hier');
  await expect(chat.locator('.receipt', { hasText: label })).toBeVisible();
  await expect.poll(() => reste(page)).toBe(before - 50_000);
  expect(await blockingViolations(page)).toEqual([]);

  await chat.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(chat.getByText(/^Annulé : /)).toBeVisible();
  await expect.poll(() => reste(page)).toBe(before);
});

test('edit card → Oui changes the row; delete card → Non leaves it', async ({ page }, info) => {
  const label = `${RUN}-${info.project.name}-card`;
  const id = await logByKeypad(page, '12', label);
  expect(id).not.toBe('');
  await stub(page, [
    reply({
      reply: 'Je corrige ?',
      actions: [{ type: 'edit_expense', kind: 'confirm', id: 'e1234', ref: id, changes: { amount: 21 } }],
    }),
    reply({
      reply: 'Je supprime ?',
      actions: [{ type: 'delete_expense', kind: 'confirm', id: 'e1234', ref: id }],
    }),
  ]);
  const chat = await openChat(page);
  await say(page, "c'était 21");
  await expect(chat.locator('.msg.him', { hasText: 'Je corrige ?' })).toBeVisible();
  await chat.getByRole('button', { name: /^Oui/ }).click();
  await expect(chat.getByText("C'est fait")).toBeVisible();
  await say(page, 'supprime-le');
  await expect(chat.locator('.msg.him', { hasText: 'Je supprime ?' })).toBeVisible();
  await chat.getByRole('button', { name: /^Non/ }).click();
  await expect(chat.getByText(/je ne touche à rien/)).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  /* the keypad's "Dépense enregistrée" toast may still cover the tab bar */
  await page.keyboard.press('Escape');
  await page.goto('/#/history');
  await expect(page.locator('.ledger-row', { hasText: label })).toContainText('21');
});

test('offline: the chat opens a first time, "30 café" is noted, "annule" undoes it, "30 café" again syncs once back online', async ({
  page,
  context,
}) => {
  const since = new Date().toISOString();
  await stub(page, []);
  /* the chat chunk was fetched after sign-in: it opens with no network */
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const chat = await openChat(page);
  await say(page, '30 café');
  /* WebKit under Playwright's emulated offline stalls the first IndexedDB read
     after going offline by ~6 s (measured in the shared expenses repo; the
     keypad path is the same): the first write gets a longer wait */
  await expect(chat.locator('.receipt', { hasText: 'Café' })).toBeVisible({ timeout: 15_000 });
  await say(page, 'annule');
  await expect(chat.getByText(/^Annulé : Café/)).toBeVisible();
  await say(page, '30 café');
  await expect(chat.getByText(/hors ligne/).last()).toBeVisible();
  await expect(chat.locator('.receipt', { hasText: 'Café' })).toHaveCount(2);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const client = await testClient();
  await expect
    .poll(
      async () => {
        const { data } = await client
          .from('expenses')
          .select('id')
          .eq('source', 'chat')
          .eq('amount_mil', 30_000)
          .gte('created_at', since)
          .is('deleted_at', null);
        return data?.length ?? 0;
      },
      { timeout: 15_000 },
    )
    .toBe(1);
});

test('a 503 from the server: the local parser answers, no error screen', async ({ page }) => {
  await stub(page, [{ status: 503, body: { error: 'Aam Salah est indisponible pour le moment.' } }]);
  const chat = await openChat(page);
  await say(page, '12 taxi');
  await expect(chat.getByText(/hors ligne/).last()).toBeVisible();
  await expect(chat.locator('.receipt', { hasText: 'Transport' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réessayer' })).toHaveCount(0);
});

test('reload: the thread comes back', async ({ page }, info) => {
  const text = `${RUN}-${info.project.name}-bonjour`;
  await stub(page, [reply({ reply: 'Ahla ! Je suis là.' })]);
  const before = await openChat(page);
  await say(page, text);
  /* the reply is also in the (hidden) live region: look at the bubble */
  await expect(before.locator('.msg.him', { hasText: 'Ahla ! Je suis là.' })).toBeVisible();
  /* idle means saved */
  await expect(before.getByRole('button', { name: 'Envoyer' })).toBeEnabled();
  await page.reload();
  await expect(page.locator('.hero')).toBeVisible({ timeout: 15_000 });
  const chat = await openChat(page);
  await expect(chat.locator('.msg.me', { hasText: text })).toBeVisible();
  await expect(chat.locator('.msg.him', { hasText: 'Ahla ! Je suis là.' })).toBeVisible();
});
