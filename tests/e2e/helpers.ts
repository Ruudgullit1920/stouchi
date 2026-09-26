/* E2E plumbing: the test account's Supabase session, and cleanup of the rows
 * a run creates. Every label a test writes starts with RUN, so teardown only
 * ever touches this run's rows. Needs VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
 * TEST_USER_EMAIL and TEST_USER_PASSWORD in .env; without them the core specs skip. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export const HAS_ACCOUNT = Boolean(
  process.env.VITE_SUPABASE_URL &&
  process.env.VITE_SUPABASE_ANON_KEY &&
  process.env.TEST_USER_EMAIL &&
  process.env.TEST_USER_PASSWORD,
);
export const STORAGE_STATE = 'test-results/.auth/test-user.json';
export const RUN = `e2e-${Date.now().toString(36)}`;

/** Phase 6 (plan D10): a second test account, the test user's partner. */
export const HAS_PARTNER = Boolean(
  HAS_ACCOUNT && process.env.TEST_PARTNER_EMAIL && process.env.TEST_PARTNER_PASSWORD,
);

async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(process.env.VITE_SUPABASE_URL ?? '', process.env.VITE_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

export const testClient = (): Promise<SupabaseClient> =>
  signedIn(process.env.TEST_USER_EMAIL ?? '', process.env.TEST_USER_PASSWORD ?? '');

export const partnerClient = (): Promise<SupabaseClient> =>
  signedIn(process.env.TEST_PARTNER_EMAIL ?? '', process.env.TEST_PARTNER_PASSWORD ?? '');

/** Opens the app in `page` as `client`'s user, as auth.setup does for the test user. */
export async function signIn(page: Page, client: SupabaseClient): Promise<void> {
  const { data } = await client.auth.getSession();
  const ref = new URL(process.env.VITE_SUPABASE_URL ?? '').hostname.split('.')[0];
  await page.goto('/#/gallery');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${ref}-auth-token`, JSON.stringify(data.session)],
  );
  /* a later goto that only changes the hash doesn't reload: boot with the session now */
  await page.reload();
}

/** Neither test account in a household: a waiting invite is cancelled, a couple
 * is left. Run first and last, so a failed run never leaves them paired. */
export async function unpair(): Promise<void> {
  if (!HAS_PARTNER) return;
  for (const client of [await testClient(), await partnerClient()]) {
    const state: { data: unknown; error: Error | null } = await client.rpc('couple_state', { p_on: null });
    if (state.error) throw state.error;
    const status = (state.data as { status?: string } | null)?.status;
    const done =
      status === 'on'
        ? await client.rpc('couple_leave')
        : status === 'pending'
          ? await client.rpc('couple_cancel')
          : null;
    if (done?.error) throw done.error;
  }
}

/** Soft-delete every expense an E2E run created: labels starting with "e2e-",
 * and anything logged through the chat (the offline parser labels "Café"),
 * this run's and any a crashed earlier run left behind. */
export async function cleanUp(): Promise<void> {
  if (!HAS_ACCOUNT) return;
  await cleanUpFor(await testClient());
  if (HAS_PARTNER) await cleanUpFor(await partnerClient());
}

async function cleanUpFor(client: SupabaseClient): Promise<void> {
  const stamp = new Date().toISOString();
  await client.from('expenses').update({ deleted_at: stamp }).like('label', 'e2e-%').is('deleted_at', null);
  await client.from('expenses').update({ deleted_at: stamp }).eq('source', 'chat').is('deleted_at', null);
}

/** The onboarded profile the core specs expect (payday 1, 2 000 TND, 50/30/20,
 * no change pending). */
export async function restoreOnboarded(client?: SupabaseClient, firstName = 'Test'): Promise<void> {
  const c = client ?? (await testClient());
  const { data } = await c.auth.getUser();
  const { error } = await c.from('profiles').upsert({
    user_id: data.user?.id,
    first_name: firstName,
    salary_mil: 2_000_000,
    payday: 1,
    split_needs: 50,
    split_wants: 30,
    split_savings: 20,
    next_salary_mil: null,
    next_split_needs: null,
    next_split_wants: null,
    next_split_savings: null,
    next_from: null,
    onboarded_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Back to a first run: not onboarded, no active goal, no active bill. */
export async function resetOnboarding(): Promise<SupabaseClient> {
  const c = await testClient();
  const { data } = await c.auth.getUser();
  const id = data.user?.id ?? '';
  const stamp = new Date().toISOString();
  for (const q of [
    c.from('profiles').update({ onboarded_at: null }).eq('user_id', id),
    c.from('goals').update({ archived_at: stamp }).is('archived_at', null),
    c.from('bills').update({ active: false }).eq('active', true),
  ]) {
    const { error } = await q;
    if (error) throw error;
  }
  return c;
}

export async function blockingViolations(page: Page): Promise<string[]> {
  /* A screen still fading in blends its text with the background, which axe
     reads as low contrast: measure the settled screen. */
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        /* the illustrations float forever: only wait for the ones that end */
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** "1 234,5" (with any spaces) → millimes. */
export function readMil(text: string): number {
  const [whole, dec = ''] = text
    .replace(/[^\d,−-]/g, '')
    .replace('−', '-')
    .split(',');
  const sign = whole.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 1000 + Number(dec.padEnd(3, '0')));
}
