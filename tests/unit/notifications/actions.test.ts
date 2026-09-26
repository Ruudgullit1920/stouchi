// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../../src/app/router';
import { sheet } from '../../../src/app/ui';
import { openLocal, type LocalDb } from '../../../src/data/localdb';
import { createStore, factsInput, type Store } from '../../../src/data/store';
import { useUser } from '../../../src/data/sync';
import { writeRow } from '../../../src/data/write';
import { nextSundayTen, runAction } from '../../../src/features/notifications/actions';
import { computeFacts } from '../../../src/shared/facts';
import type { Notification } from '../../../src/shared/schemas';
import { toast } from '../../../src/app/ui';
import {
  bill,
  coupleOn,
  debt,
  expense,
  notification,
  PARTNER,
  profile,
  SOLO,
  USER,
  uuidN,
} from '../fixtures';

let db: LocalDb;
let store: Store;
let n = 0;

/* Wednesday 23 Sept 2026, 09:00 Tunis */
const WED = new Date('2026-09-23T08:00:00Z');

const seedRow = async (row: Notification) => {
  await db.put('notifications', row, row.id);
  store.notifications.value = [row];
};

beforeEach(async () => {
  vi.useFakeTimers({ now: WED, toFake: ['Date'] });
  db = await openLocal(`actions-${++n}`);
  store = createStore();
  await useUser(db, store, USER);
  await writeRow(db, USER, 'profiles', profile(), store);
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

const ctx = () => ({ db, store });
const read = (id: string) => store.notifications.value.find((x) => x.id === id)?.read_at;

describe('nextSundayTen', () => {
  it('on a Wednesday → that Sunday at 10:00 Tunis; on a Sunday → the Sunday after', () => {
    expect(nextSundayTen(WED)).toBe('2026-09-27T09:00:00.000Z');
    expect(nextSundayTen(new Date('2026-09-27T20:00:00Z'))).toBe('2026-10-04T09:00:00.000Z');
    expect(nextSundayTen(new Date('2026-09-26T23:30:00Z'))).toBe('2026-10-04T09:00:00.000Z'); // already Sunday in Tunis
  });
});

describe('Marquer payée', () => {
  it('writes one expense and one bill_payments row; a second tap writes nothing', async () => {
    const b = bill({ day: 25 });
    await writeRow(db, USER, 'bills', b, store);
    const row = notification({ trigger: 'bill_due', action: { kind: 'pay_bill', ref: b.id } });
    await seedRow(row);

    await runAction(row, { kind: 'pay_bill', ref: b.id }, ctx());
    expect(store.expenses.value).toHaveLength(1);
    expect(store.expenses.value[0]).toMatchObject({
      category: 'factures',
      amount_mil: 80_000,
      bill_id: b.id,
    });
    expect(store.billPayments.value).toHaveLength(1);
    expect(store.actedOn.value[row.id]).toBe(
      "Payée aujourd'hui, c'est passé dans tes Besoins. Une de moins !",
    );
    expect(read(row.id)).not.toBeNull();

    await runAction(row, { kind: 'pay_bill', ref: b.id }, ctx());
    expect(store.expenses.value).toHaveLength(1);
    expect(store.billPayments.value).toHaveLength(1);
    expect(store.actedOn.value[row.id]).toBe('Déjà payée pour cette période.');
  });

  it('a row from last period pays nothing: this period’s bill stays due', async () => {
    const b = bill({ day: 25 });
    await writeRow(db, USER, 'bills', b, store);
    const row = notification({ trigger: 'bill_due', created_at: '2026-08-25T08:00:00+01:00' });
    await seedRow(row);
    await runAction(row, { kind: 'pay_bill', ref: b.id }, ctx());
    expect(store.expenses.value).toEqual([]);
    expect(store.billPayments.value).toEqual([]);
    expect(store.actedOn.value[row.id]).toBe(
      'Cette échéance est passée : la facture en cours est dans À venir.',
    );
    expect(read(row.id)).not.toBeNull();
  });

  it('the bill leaves À venir', async () => {
    const b = bill({ day: 25 });
    await writeRow(db, USER, 'bills', b, store);
    const row = notification({ trigger: 'bill_due' });
    await seedRow(row);
    const upcoming = () =>
      computeFacts(factsInput(store, profile(), '2026-09-23')).upcoming.filter((u) => u.id === b.id);
    expect(upcoming()).toHaveLength(1);
    await runAction(row, { kind: 'pay_bill', ref: b.id }, ctx());
    expect(upcoming()).toHaveLength(0);
  });
});

describe('C’est réglé', () => {
  it('sets settled_at and the debt leaves À venir', async () => {
    const d = debt({ due_on: '2026-09-28' });
    await writeRow(db, USER, 'debts', d, store);
    const row = notification({ trigger: 'owed_to_me', action: { kind: 'remind_debt', ref: d.id } });
    await seedRow(row);
    await runAction(row, { kind: 'settle_debt', ref: d.id }, ctx());
    expect(store.debts.value[0].settled_at).not.toBeNull();
    expect(computeFacts(factsInput(store, profile(), '2026-09-23')).upcoming).toEqual([]);
    expect(store.actedOn.value[row.id]).toBe("Réglé, je l'ai retiré de ta liste.");
    expect(read(row.id)).not.toBeNull();
  });

  it('a debt already settled or deleted gets no write and a “déjà réglé” line', async () => {
    const d = debt({ deleted_at: '2026-09-20T10:00:00+01:00' });
    await writeRow(db, USER, 'debts', d, store);
    const row = notification({ trigger: 'owed_to_me' });
    await seedRow(row);
    const before = (await db.getAll('outbox')).length;
    await runAction(row, { kind: 'settle_debt', ref: d.id }, ctx());
    expect(store.debts.value[0].settled_at).toBeNull();
    expect(store.actedOn.value[row.id]).toBe('Déjà réglé.');
    /* only the read_at patch went into the outbox */
    expect((await db.getAll('outbox')).length).toBe(before + 1);
  });
});

describe('Rappelle-moi', () => {
  it('adds a reminder for Sunday 10:00 to chase the person, once', async () => {
    const d = debt({ direction: 'owed_to_me', person: 'Ahmed', amount_mil: 40_000 });
    await writeRow(db, USER, 'debts', d, store);
    const row = notification({ trigger: 'owed_to_me' });
    await seedRow(row);
    await runAction(row, { kind: 'remind_debt', ref: d.id }, ctx());
    await runAction(row, { kind: 'remind_debt', ref: d.id }, ctx());
    expect(store.reminders.value).toHaveLength(1);
    expect(store.reminders.value[0]).toMatchObject({
      text: 'Relancer Ahmed pour les 40 TND',
      remind_at: '2026-09-27T09:00:00.000Z',
      done_at: null,
    });
    expect(store.actedOn.value[row.id]).toBe("C'est noté, je te le rappelle dimanche.");
  });
});

describe('open actions', () => {
  it('navigate, mark the row read, and leave its buttons', async () => {
    const row = notification();
    await seedRow(row);
    await runAction(row, { kind: 'open_pot', ref: 'wants' }, ctx());
    expect(route.value).toEqual({ name: 'pot', params: { pot: 'wants' } });
    expect(read(row.id)).not.toBeNull();
    expect(store.actedOn.value[row.id]).toBeUndefined();

    await runAction(row, { kind: 'open_goal' }, ctx());
    expect(route.value.name).toBe('goal');
    await runAction(row, { kind: 'open_history' }, ctx());
    expect(route.value).toEqual({ name: 'history', params: {} });
    await runAction(row, { kind: 'open_category', ref: 'resto' }, ctx());
    expect(route.value).toEqual({ name: 'history', params: { category: 'resto' } });
  });

  it('log_expense opens the keypad', async () => {
    const row = notification({ trigger: 'quiet_week' });
    await seedRow(row);
    sheet.value = null;
    await runAction(row, { kind: 'log_expense' }, ctx());
    expect(sheet.peek()?.title).toBe('Nouvelle dépense');
  });
});

describe('after a reload', () => {
  it('the acted-on rows keep their done line', async () => {
    const d = debt();
    await writeRow(db, USER, 'debts', d, store);
    const row = notification({ trigger: 'owed_to_me' });
    await seedRow(row);
    await runAction(row, { kind: 'settle_debt', ref: d.id }, ctx());
    const again = createStore();
    await useUser(db, again, USER);
    expect(again.actedOn.value[row.id]).toBe("Réglé, je l'ai retiré de ta liste.");
  });
});

describe('partner_request (plan D7, Task 9)', () => {
  const H = '00000000-0000-4000-8000-000000000099';
  const request = (ref: string, change: unknown) =>
    notification({
      trigger: 'partner_request',
      title: '',
      body: '',
      action: { kind: 'partner_request', ref, from: PARTNER, change } as Notification['action'],
    });
  const mine = async (patch: Partial<Parameters<typeof expense>[0]> = {}) => {
    const e = expense({ household_id: H, label: 'Carrefour', amount_mil: 45_000, ...patch });
    await writeRow(db, USER, 'expenses', e, store);
    return e;
  };
  const done = (id: string) => store.actedOn.value[id];
  const live = (id: string) => store.expenses.value.find((x) => x.id === id);
  beforeEach(() => {
    store.household.value = coupleOn();
  });

  describe('a request that is no longer current changes nothing (M3)', () => {
    const STALE = "Cette demande n'est plus à jour.";
    const accept = async (e: { id: string }) => {
      const row = request(e.id, { kind: 'edit', fields: { amount_mil: 40_000 } });
      await seedRow(row);
      await runAction(row, row.action!, ctx(), 'accept');
      return row;
    };

    it('after I stopped sharing', async () => {
      const e = await mine();
      store.household.value = SOLO;
      const row = await accept(e);
      expect(live(e.id)?.amount_mil).toBe(45_000);
      expect(done(row.id)).toBe(STALE);
      expect(read(row.id)).not.toBeNull();
    });

    it('when the expense is not shared (logged before the join)', async () => {
      store.household.value = SOLO;
      const e = await mine({ household_id: null });
      store.household.value = coupleOn();
      const row = await accept(e);
      expect(live(e.id)?.amount_mil).toBe(45_000);
      expect(done(row.id)).toBe(STALE);
    });

    it('when the expense was edited after the request', async () => {
      const e = await mine({ updated_at: '2026-09-21T10:00:00+01:00' });
      const row = await accept(e);
      expect(live(e.id)?.amount_mil).toBe(45_000);
      expect(done(row.id)).toBe(STALE);
    });
  });

  it('a category-only change moves the expense to that category’s pot (M4)', async () => {
    const e = await mine();
    const row = request(e.id, { kind: 'edit', fields: { category: 'cafe' } });
    await seedRow(row);
    await runAction(row, row.action!, ctx(), 'accept');
    /* a shared row moved to Envies goes private under a new id (plan D7) */
    const now = store.expenses.value.filter((x) => x.label === 'Carrefour' && x.deleted_at === null);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ category: 'cafe', pot: 'wants', household_id: null });
  });

  it('Accepter a delete: soft-deleted, with an undo toast, and marked read', async () => {
    const e = await mine();
    const row = request(e.id, { kind: 'delete' });
    await seedRow(row);
    await runAction(row, row.action!, ctx(), 'accept');
    expect(live(e.id)?.deleted_at).not.toBeNull();
    expect(read(row.id)).not.toBeNull();
    expect(done(row.id)).toBe('Supprimée, comme demandé.');
    expect(toast.value?.actionLabel).toBe('Annuler');
    toast.value?.onAction?.();
    await vi.waitFor(() => expect(live(e.id)?.deleted_at).toBeNull());
  });

  it('Accepter an edit applies the change', async () => {
    const e = await mine();
    const row = request(e.id, { kind: 'edit', fields: { amount_mil: 40_000, label: 'Carrefour Market' } });
    await seedRow(row);
    await runAction(row, row.action!, ctx(), 'accept');
    expect(live(e.id)).toMatchObject({ amount_mil: 40_000, label: 'Carrefour Market' });
    expect(done(row.id)).toBe('Corrigée, comme demandé.');
  });

  it('a malformed change is refused and changes nothing', async () => {
    const e = await mine();
    const row = request(e.id, { kind: 'edit', fields: { amount_mil: -5 } });
    await seedRow(row);
    await runAction(row, row.action!, ctx(), 'accept');
    expect(live(e.id)?.amount_mil).toBe(45_000);
    expect(done(row.id)).toBe("Cette demande n'est pas valable.");
    expect(read(row.id)).not.toBeNull();
  });

  it('a gone expense only says so', async () => {
    const row = request(uuidN(4242), { kind: 'delete' });
    await seedRow(row);
    await runAction(row, row.action!, ctx(), 'accept');
    expect(done(row.id)).toBe("Cette dépense n'existe plus.");
    expect(read(row.id)).not.toBeNull();
  });

  it("an expense that isn't mine is never changed from a request", async () => {
    const e = await mine({ user_id: PARTNER });
    const row = request(e.id, { kind: 'delete' });
    await seedRow(row);
    await runAction(row, row.action!, ctx(), 'accept');
    expect(live(e.id)?.deleted_at ?? null).toBeNull();
  });

  it('Refuser only marks it read', async () => {
    const e = await mine();
    const row = request(e.id, { kind: 'delete' });
    await seedRow(row);
    await runAction(row, row.action!, ctx(), 'refuse');
    expect(live(e.id)?.deleted_at).toBeNull();
    expect(read(row.id)).not.toBeNull();
    expect(done(row.id)).toBe('Demande refusée.');
  });
});
