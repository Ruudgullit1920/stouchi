/* Currency choice (currency spec §4): profiles.currency, set_currency and the
 * host's currency copied by couple_join. Each test makes its own users. */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { ProfileRow } from '../../src/shared/schemas';
import { asUser, freshDb } from './harness';

let db: PGlite;
type Row = Record<string, unknown>;
const RLS = { code: '42501' };
const CHECK = { code: '23514' };

let next = 0x900;
async function user(profile: Row = {}): Promise<string> {
  const id = `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, '0')}`;
  await asOwner('insert into auth.users (id) values ($1)', [id]);
  const p = { user_id: id, first_name: 'X', salary_mil: 2_000_000, payday: 1, ...profile };
  const cols = Object.keys(p);
  await asOwner(
    `insert into public.profiles (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(p),
  );
  return id;
}
const asOwner = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows;
async function rpc(who: string | null, call: string, params: unknown[] = []): Promise<Row> {
  return (await asUser<Row>(db, who, `select public.${call} as r`, params))[0].r as Row;
}
const currency = async (who: string) =>
  (await asOwner('select currency from public.profiles where user_id = $1', [who]))[0].currency;
async function pair(host: string, joiner: string): Promise<Row> {
  const { code } = (await rpc(host, 'couple_invite()')) as { code: string };
  return rpc(joiner, 'couple_join($1)', [code]);
}

beforeAll(async () => {
  db = await freshDb();
});

describe('profiles.currency', () => {
  it('defaults to TND, and the row still parses', async () => {
    const a = await user();
    expect(await currency(a)).toBe('TND');
    const row = (await asOwner('select * from public.profiles where user_id = $1', [a]))[0];
    const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d);
    expect(
      ProfileRow.parse({ ...row, created_at: iso(row.created_at), updated_at: iso(row.updated_at) }).currency,
    ).toBe('TND');
  });

  it('refuses an unknown code', async () => {
    const a = await user();
    await expect(
      asOwner(`update public.profiles set currency = 'XXX' where user_id = $1`, [a]),
    ).rejects.toMatchObject(CHECK);
  });
});

describe('set_currency', () => {
  it('alone: updates only my profile', async () => {
    const a = await user();
    const other = await user();
    expect(await rpc(a, 'set_currency($1)', ['EUR'])).toEqual({});
    expect(await currency(a)).toBe('EUR');
    expect(await currency(other)).toBe('TND');
  });

  it('in a couple: updates me and my partner, nobody else', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    await pair(a, b);
    expect(await rpc(b, 'set_currency($1)', ['GBP'])).toEqual({});
    expect([await currency(a), await currency(b), await currency(c)]).toEqual(['GBP', 'GBP', 'TND']);
  });

  it('refuses an unknown code without touching anything', async () => {
    const a = await user();
    expect(await rpc(a, 'set_currency($1)', ['XXX'])).toEqual({ error: 'CURRENCY_INVALID' });
    expect(await rpc(a, 'set_currency($1)', [null])).toEqual({ error: 'CURRENCY_INVALID' });
    expect(await currency(a)).toBe('TND');
  });

  it('refuses anonymous callers', async () => {
    await expect(rpc(null, 'set_currency($1)', ['EUR'])).rejects.toMatchObject(RLS);
  });
});

describe('couple_join and the currency', () => {
  it("gives the joiner the host's currency and says so", async () => {
    const host = await user({ currency: 'EUR' });
    const joiner = await user();
    expect(await pair(host, joiner)).toEqual({ currency: 'EUR' });
    expect(await currency(joiner)).toBe('EUR');
    expect(await currency(host)).toBe('EUR');
  });

  it('says nothing when both already share it', async () => {
    const host = await user({ currency: 'MAD' });
    const joiner = await user({ currency: 'MAD' });
    expect(await pair(host, joiner)).toEqual({});
  });
});

describe('one currency per household, once onboarded (review Important 1)', () => {
  const onboarded = { onboarded_at: '2026-09-01T10:00:00+01:00' };
  const upsertMine = (who: string, currency: string) =>
    asUser(
      db,
      who,
      `insert into public.profiles (user_id, first_name, salary_mil, payday, onboarded_at, currency)
       values ($1, 'X', 2500000, 1, '2026-09-01T10:00:00+01:00', $2)
       on conflict (user_id) do update set salary_mil = excluded.salary_mil, currency = excluded.currency`,
      [who, currency],
    );

  it("a stale write of my whole profile keeps the partner's change", async () => {
    const a = await user(onboarded);
    const b = await user(onboarded);
    await pair(a, b);
    await rpc(a, 'set_currency($1)', ['EUR']);
    await upsertMine(b, 'TND');
    expect([await currency(a), await currency(b)]).toEqual(['EUR', 'EUR']);
    expect(
      (await asOwner('select salary_mil from public.profiles where user_id = $1', [b]))[0].salary_mil,
    ).toBe(2_500_000);
  });

  it('an onboarded user changes it only through set_currency', async () => {
    const a = await user(onboarded);
    await asUser(db, a, `update public.profiles set currency = 'GBP' where user_id = $1`, [a]);
    expect(await currency(a)).toBe('TND');
    await rpc(a, 'set_currency($1)', ['GBP']);
    expect(await currency(a)).toBe('GBP');
  });

  it("joining still takes the host's currency", async () => {
    const host = await user({ ...onboarded, currency: 'CHF' });
    const joiner = await user(onboarded);
    expect(await pair(host, joiner)).toEqual({ currency: 'CHF' });
    expect(await currency(joiner)).toBe('CHF');
  });

  it('during onboarding the profile write sets it', async () => {
    const a = await user();
    await upsertMine(a, 'MAD');
    expect(await currency(a)).toBe('MAD');
  });
});
