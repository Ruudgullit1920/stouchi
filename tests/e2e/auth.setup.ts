/* Signs the test account in once and saves the session for the core specs.
 * Also makes sure the account has an onboarded profile (payday 1, 2 000 TND),
 * so Budget has figures to show. */
import { expect, test as setup } from '@playwright/test';
import { HAS_ACCOUNT, restoreOnboarded, STORAGE_STATE, testClient } from './helpers';

setup('sign in the test account', async ({ page }) => {
  setup.skip(!HAS_ACCOUNT, 'no test account in .env');
  const client = await testClient();
  const { data } = await client.auth.getSession();
  const session = data.session;
  expect(session).not.toBeNull();
  if (!session) return;

  await restoreOnboarded(client);

  const ref = new URL(process.env.VITE_SUPABASE_URL ?? '').hostname.split('.')[0];
  await page.goto('/#/gallery');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${ref}-auth-token`, JSON.stringify(session)],
  );
  await page.context().storageState({ path: STORAGE_STATE });
});
