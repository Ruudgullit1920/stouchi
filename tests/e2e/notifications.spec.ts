/* Phase 4 on a real backend: the bell, the Notifications screen, one-tap
 * actions and the push opt-in. Only the service role can insert notifications,
 * so their REST calls are stubbed (and PATCH bodies recorded); the profile's
 * onboarded_at is rewritten on the way in; the browser's push plumbing is faked
 * in an init script. Marquer payée writes a real expense to stouchi-test. */
import { expect, test, type Page } from '@playwright/test';
import {
  blockingViolations,
  cleanUp,
  HAS_ACCOUNT,
  restoreOnboarded,
  RUN,
  STORAGE_STATE,
  testClient,
} from './helpers';

test.skip(!HAS_ACCOUNT, 'no test account in .env');
test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
let userId = '';
let billId = '';
let billLabel = '';

/* one bill per device: the two projects share the test account */
// eslint-disable-next-line no-empty-pattern
test.beforeAll(async ({}, info) => {
  billLabel = `${RUN}-${info.project.name}-facture`;
  const c = await testClient();
  await restoreOnboarded(c);
  userId = (await c.auth.getUser()).data.user?.id ?? '';
  const { data, error } = await c
    .from('bills')
    .insert({ label: billLabel, amount_mil: 30_000, frequency: 'monthly', day: 28, starts_on: '2026-01-01' })
    .select('id')
    .single();
  if (error) throw error;
  billId = data.id as string;
});

test.afterAll(async () => {
  const c = await testClient();
  await c.from('bills').update({ active: false }).like('label', 'e2e-%');
  await cleanUp();
});

interface Stub {
  patches: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
}

/** Three rows from Aam Salah, the profile onboarded `days` ago, and a push-capable browser. */
async function stub(page: Page, { days = 30 } = {}): Promise<Stub> {
  const now = Date.now();
  const at = (ms: number) => new Date(now - ms).toISOString();
  const server = new Map(
    [
      {
        id: '00000000-0000-4000-8000-00000000e2e1',
        trigger: 'pot_over',
        title: 'Envies dépassées',
        body: 'Tu as dépassé les Envies de 15 TND.',
        action: { kind: 'open_pot', ref: 'wants' },
        created_at: at(60_000),
      },
      {
        id: '00000000-0000-4000-8000-00000000e2e2',
        trigger: 'bill_due',
        title: `${billLabel} à payer`,
        body: '30 TND, un geste et elle est marquée payée.',
        action: { kind: 'pay_bill', ref: billId },
        created_at: at(120_000),
      },
      {
        id: '00000000-0000-4000-8000-00000000e2e3',
        trigger: 'weekly_recap',
        title: 'Ta semaine en bref',
        body: '175 TND dépensés en 7 jours.',
        action: { kind: 'open_history' },
        created_at: at(3 * DAY),
      },
    ].map((r) => [r.id, { ...r, user_id: userId, dedupe_key: r.id, read_at: null as string | null }]),
  );
  const s: Stub = { patches: [], subscriptions: [] };

  await page.route('**/rest/v1/notifications*', async (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as Record<string, unknown>;
      s.patches.push(body);
      const id = new URL(req.url()).searchParams.get('id')?.replace(/^eq\./, '') ?? '';
      const row = server.get(id);
      if (row) server.set(id, { ...row, ...(body as { read_at: string }) });
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: [...server.values()] });
  });
  await page.route('**/rest/v1/profiles*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    try {
      const res = await route.fetch();
      const rows = (await res.json()) as { onboarded_at: string | null }[];
      for (const r of rows) r.onboarded_at = at(days * DAY);
      await route.fulfill({ response: res, json: rows });
    } catch {
      /* the page navigated away mid-request: nothing left to answer */
    }
  });
  await page.route('**/rest/v1/push_subscriptions*', async (route) => {
    s.subscriptions.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 201 });
  });
  await page.addInitScript(() => {
    const endpoint = 'https://push.example.test/e2e';
    let current: unknown = null;
    const sub = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: 'p256', auth: 'auth' } }),
      unsubscribe: () => {
        current = null;
        return Promise.resolve(true);
      },
    };
    const reg = {
      pushManager: {
        getSubscription: () => Promise.resolve(current),
        subscribe: () => Promise.resolve((current = sub)),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: () => Promise.resolve(reg),
        getRegistration: () => Promise.resolve(reg),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    let permission = 'default';
    const w = window as unknown as Record<string, unknown>;
    w.PushManager ??= function PushManager() {};
    w.Notification = {
      get permission() {
        return permission;
      },
      requestPermission: () => Promise.resolve((permission = 'granted')),
    };
  });
  return s;
}

const bell = (page: Page) => page.locator('.bell');
/* the first sync pulls every table before the notifications */
const ARRIVE = { timeout: 25_000 };
const aVenir = (page: Page) => page.locator('.sec:has(> h2:text-is("À venir")) + .list');

test('the bell shows unread rows; reading them sends only read_at', async ({ page }) => {
  const s = await stub(page);
  await page.goto('/#/budget');
  await expect(page.getByRole('button', { name: 'Notifications, 3 non lues' })).toBeVisible(ARRIVE);
  await expect(page.locator('.bdot')).toBeVisible();

  await bell(page).click();
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cette semaine' })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  await page.getByRole('button', { name: /Ta semaine en bref/ }).click();
  await expect.poll(() => s.patches.length).toBe(1);
  expect(Object.keys(s.patches[0])).toEqual(['read_at']);

  await page.getByRole('button', { name: 'Tout lire' }).click();
  await expect(page.getByRole('button', { name: 'Tout lire' })).toBeDisabled();
  await expect.poll(() => s.patches.length).toBe(3);
  expect(s.patches.every((p) => Object.keys(p).join() === 'read_at')).toBe(true);
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.locator('.bdot')).toBeHidden();
});

test('Voir Envies opens the Envies ledger; Marquer payée pays the bill', async ({ page }) => {
  await stub(page);
  await page.goto('/#/budget');
  await expect(aVenir(page).getByText(billLabel)).toBeVisible(ARRIVE);
  await bell(page).click();
  await page.getByRole('button', { name: 'Voir Envies' }).click();
  await expect(page).toHaveURL(/#\/pot\/wants$/);

  await page.goto('/#/notifications');
  await page.getByRole('button', { name: 'Marquer payée' }).click();
  await expect(
    page.getByText("Payée aujourd'hui, c'est passé dans tes Besoins. Une de moins !"),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marquer payée' })).toHaveCount(0);
  await page.goto('/#/budget');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(aVenir(page).getByText(billLabel)).toHaveCount(0);
});

test('a user onboarded 8 days ago gets the push card, and Activer subscribes', async ({ page }) => {
  const s = await stub(page, { days: 8 });
  await page.goto('/#/notifications');
  await page.getByRole('button', { name: 'Activer' }).click(ARRIVE);
  await expect(page.getByRole('button', { name: 'Activer' })).toHaveCount(0);
  await expect.poll(() => s.subscriptions.length).toBe(1);
  expect(s.subscriptions[0]).toMatchObject({ user_id: userId, endpoint: 'https://push.example.test/e2e' });
  await expect(page.getByRole('switch', { name: 'Notifications sur ce téléphone' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('onboarded 2 days ago: no push card', async ({ page }) => {
  await stub(page, { days: 2 });
  await page.goto('/#/notifications');
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible(ARRIVE);
  await expect(page.getByRole('button', { name: 'Activer' })).toHaveCount(0);
});

test('the bell rings when rows arrive', async ({ page }) => {
  await stub(page);
  await page.goto('/#/budget');
  await expect(bell(page)).toHaveClass(/ring/, ARRIVE);
});

test('under reduced motion the bell does not ring', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stub(page);
  await page.goto('/#/budget');
  await expect(page.getByRole('button', { name: 'Notifications, 3 non lues' })).toBeVisible(ARRIVE);
  await expect(bell(page)).not.toHaveClass(/ring/);
});
