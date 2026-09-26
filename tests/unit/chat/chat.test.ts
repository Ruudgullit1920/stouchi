import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, AamRequest } from '../../../src/features/chat/api';
import { createChat, type ChatDeps } from '../../../src/features/chat/chat';
import type { ServerAction } from '../../../src/features/chat/execute';
import { clearChat, HISTORY_MAX, loadChat, saveChat } from '../../../src/features/chat/history';
import { openLocal, rowKey, type LocalDb, type Row, type Table } from '../../../src/data/localdb';
import { applyRows, createStore, type Store } from '../../../src/data/store';
import { useUser } from '../../../src/data/sync';
import { expense, profile, USER, uuidN } from '../fixtures';

const OTHER = '00000000-0000-4000-8000-000000000002';
let db: LocalDb;
let store: Store;
let n = 0;
let ids = 0;
let calls: AamRequest[];

const ok = (body: Partial<Extract<ApiResult, { ok: true }>['body']> = {}): ApiResult => ({
  ok: true,
  body: { reply: 'Voilà.', actions: [], chips: [], lang: 'fr', nudgeKey: null, ...body },
});
const cafe: ServerAction = {
  type: 'add_expense',
  kind: 'direct',
  amount: 4.5,
  category: 'cafe',
  pot: 'envies',
  label: 'Café',
  date: '2026-09-10',
};

async function seed(table: Table, row: Row) {
  await db.put(table, row, rowKey(table, row));
  applyRows(store, table, [row]);
}
function chatWith(
  replies: ApiResult[] | ((req: AamRequest) => Promise<ApiResult>),
  deps: Partial<ChatDeps> = {},
) {
  const queue = Array.isArray(replies) ? [...replies] : null;
  return createChat({
    ctx: { db, store, uuid: () => uuidN(9000 + ++ids) },
    api: async (req) => {
      calls.push(req);
      return queue ? (queue.shift() ?? ok()) : (replies as (r: AamRequest) => Promise<ApiResult>)(req);
    },
    /* a flush that reaches the server: nothing left to send */
    flush: () => {
      store.sync.value = { ...store.sync.value, pending: 0 };
      return Promise.resolve();
    },
    pending: () => Promise.resolve(store.sync.value.pending),
    online: () => true,
    ...deps,
  });
}
const last = (chat: ReturnType<typeof chatWith>) => chat.turns.value[chat.turns.value.length - 1];

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  db = await openLocal(`chat-${++n}`);
  store = createStore();
  await useUser(db, store, USER);
  await seed('profiles', profile());
  calls = [];
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe('send', () => {
  it('posts the conversation, runs a direct action at once with an Annuler chip', async () => {
    const chat = chatWith([ok({ reply: 'Noté.', actions: [cafe], chips: ['Il me reste combien ?'] })]);
    await chat.ready;
    await chat.send('4,5 café');
    expect(calls[0].messages).toEqual([{ role: 'user', content: '4,5 café' }]);
    expect(store.expenses.value[0]).toMatchObject({ amount_mil: 4_500, source: 'chat' });
    expect(last(chat)).toMatchObject({
      role: 'assistant',
      text: 'Noté.',
      chips: ['Annuler', 'Il me reste combien ?'],
    });
    expect(last(chat).actions?.[0].summary).toContain('Café');
  });

  it('sends the last 12 turns, [app] turns as the user with the prefix, plus nudgeSeen and lastAction', async () => {
    const chat = chatWith([ok({ actions: [cafe], nudgeKey: 'pot80:2026-09-01:wants' })]);
    await chat.ready;
    await chat.send('4,5 café');
    await chat.undoChip();
    for (let i = 0; i < 6; i++) await chat.send(`q${i}`);
    const req = calls[calls.length - 1];
    expect(req.messages).toHaveLength(12);
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'q5' });
    expect(req.nudgeSeen).toEqual(['pot80:2026-09-01:wants']);
    const withApp = calls[1].messages;
    expect(withApp).toContainEqual({
      role: 'user',
      content: expect.stringMatching(/^\[app\] Annulé : /) as string,
    });
    expect(calls[1].lastAction).toBeUndefined();
  });

  it('Review Focus 1: with a write just logged, the request waits for the outbox flush', async () => {
    let release!: () => void;
    const flushed = new Promise<void>((r) => (release = r)).then(() => {
      store.sync.value = { ...store.sync.value, pending: 0 };
    });
    store.sync.value = { ...store.sync.value, pending: 1 };
    const chat = chatWith([ok()], { flush: () => flushed });
    await chat.ready;
    const sending = chat.send('annule');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    release();
    await sending;
    expect(calls).toHaveLength(1);
  });

  it('Review Focus 1: writes still pending after the flush → the local parser answers, no request', async () => {
    store.sync.value = { ...store.sync.value, pending: 1 };
    const chat = chatWith([ok()], { flush: () => Promise.reject(new Error('offline')) });
    await chat.ready;
    await chat.send('30 café');
    expect(calls).toHaveLength(0);
    expect(store.expenses.value[0]).toMatchObject({ amount_mil: 30_000, category: 'cafe' });
    expect(chat.offline.value).toBe(true);
    expect(last(chat).text).toMatch(/hors ligne/);
  });

  it('goes out as soon as the outbox is empty, even while the flush is still busy', async () => {
    let left = 1;
    setTimeout(() => (left = 0), 100);
    const chat = chatWith([ok()], {
      flush: () => new Promise(() => {}),
      pending: () => Promise.resolve(left),
    });
    await chat.ready;
    const t0 = performance.now();
    await chat.send('il me reste combien ?');
    expect(calls).toHaveLength(1);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });

  it('a flush that never ends is cut at 2 s', async () => {
    vi.useFakeTimers({
      now: new Date('2026-09-10T09:00:00Z'),
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    store.sync.value = { ...store.sync.value, pending: 1 };
    const chat = chatWith([ok()], { flush: () => new Promise(() => {}) });
    await chat.ready;
    const sending = chat.send('30 café');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(store.expenses.value).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await sending;
    expect(calls).toHaveLength(0);
    expect(store.expenses.value).toHaveLength(1);
  });

  it('offline: the local parser answers without a request', async () => {
    const flush = vi.fn(() => Promise.resolve());
    const chat = chatWith([ok()], { online: () => false, flush });
    await chat.ready;
    await chat.send('50');
    expect(calls).toHaveLength(0);
    expect(flush).not.toHaveBeenCalled();
    expect(last(chat).text).toMatch(/pour quoi/);
    await chat.send('courses');
    expect(store.expenses.value[0]).toMatchObject({ amount_mil: 50_000, category: 'courses' });
  });

  it('a 503 or a timeout falls back to the local parser with the offline line', async () => {
    const chat = chatWith([
      { ok: false, status: 503 },
      { ok: false, status: 0 },
    ]);
    await chat.ready;
    await chat.send('30 café');
    await chat.send('bonjour');
    expect(store.expenses.value).toHaveLength(1);
    expect(last(chat).text).toMatch(/hors ligne/);
  });

  it('a 429 shows its French line and does not fall back to the parser', async () => {
    const chat = chatWith([{ ok: false, status: 429, error: 'Doucement !' }]);
    await chat.ready;
    await chat.send('30 café');
    expect(last(chat)).toMatchObject({ role: 'assistant', text: 'Doucement !' });
    expect(store.expenses.value).toHaveLength(0);
    expect(chat.offline.value).toBe(false);
  });

  it('is saved before it stops being busy (a reload right after the reply keeps it)', async () => {
    const chat = chatWith([ok({ reply: 'Ahla !' })]);
    await chat.ready;
    const idle: { saved?: Promise<number> } = {};
    chat.busy.subscribe((busy) => {
      if (!busy && chat.turns.value.length) idle.saved ??= loadChat(db, USER).then((c) => c.turns.length);
    });
    await chat.send('salut');
    expect(await idle.saved).toBe(2);
  });

  it('stores nudgeKey once', async () => {
    const chat = chatWith([ok({ nudgeKey: 'k1' }), ok({ nudgeKey: 'k1' })]);
    await chat.ready;
    await chat.send('a');
    await chat.send('b');
    expect(chat.nudgeSeen()).toEqual(['k1']);
  });
});

describe('confirm cards', () => {
  const edit = (ref: string): ServerAction => ({
    type: 'edit_expense',
    kind: 'confirm',
    id: 'e1',
    ref,
    changes: { amount: 21 },
  });

  it('a reply with confirm actions has cards and no chips', async () => {
    const e = expense({ amount_mil: 12_000 });
    await seed('expenses', e);
    const chat = chatWith([ok({ actions: [edit(e.id)], chips: ['Oui', 'Non'] })]);
    await chat.ready;
    await chat.send('le café c’était 21');
    expect(last(chat).chips).toEqual([]);
    expect(last(chat).cards).toEqual([expect.objectContaining({ state: 'open' })]);
    expect(store.expenses.value[0].amount_mil).toBe(12_000);
  });

  it('Oui runs it once and tells Aam Salah; a second Oui does nothing', async () => {
    const e = expense({ amount_mil: 12_000 });
    await seed('expenses', e);
    const chat = chatWith([ok({ actions: [edit(e.id)] })]);
    await chat.ready;
    await chat.send('corrige');
    const card = last(chat).cards![0];
    await Promise.all([chat.answerCard(card.id, true), chat.answerCard(card.id, true)]);
    expect(store.expenses.value[0].amount_mil).toBe(21_000);
    const appTurns = chat.turns.value.filter((t) => t.role === 'app');
    expect(appTurns).toHaveLength(1);
    expect(appTurns[0].text).toMatch(/^Confirmé : .*12 → 21/);
    expect(chat.turns.value.flatMap((t) => t.cards ?? [])[0].state).toBe('yes');
  });

  it('Non leaves the row and says what was not done', async () => {
    const e = expense();
    await seed('expenses', e);
    const chat = chatWith([
      ok({ actions: [{ type: 'delete_expense', kind: 'confirm', id: 'e1', ref: e.id }] }),
    ]);
    await chat.ready;
    await chat.send('supprime');
    await chat.answerCard(last(chat).cards![0].id, false);
    expect(store.expenses.value[0].deleted_at).toBeNull();
    expect(last(chat)).toMatchObject({ role: 'app', text: "Refusé : la suppression n'a pas été faite." });
  });

  it('a row changed since the card was shown: "Pas fait : la ligne a changé."', async () => {
    const e = expense();
    await seed('expenses', e);
    const chat = chatWith([ok({ actions: [edit(e.id)] })]);
    await chat.ready;
    await chat.send('corrige');
    await seed('expenses', { ...e, label: 'ailleurs', updated_at: '2026-09-10T08:00:00+01:00' });
    await chat.answerCard(last(chat).cards![0].id, true);
    expect(last(chat)).toMatchObject({ role: 'app', text: 'Pas fait : la ligne a changé.' });
    expect(store.expenses.value[0].amount_mil).toBe(e.amount_mil);
  });

  it('the income card’s switch changes where the money goes, until it is answered', async () => {
    const income: ServerAction = {
      type: 'add_income',
      kind: 'confirm',
      amount: 150,
      to: 'epargne',
      label: 'Prime',
    };
    const chat = chatWith([ok({ actions: [income] })]);
    await chat.ready;
    await chat.send('prime de 150');
    const id = last(chat).cards![0].id;
    chat.switchIncome(id, 'envies');
    await chat.answerCard(id, true);
    expect(store.incomes.value[0]).toMatchObject({ amount_mil: 150_000, pot: 'wants' });
    chat.switchIncome(id, 'epargne');
    expect(chat.turns.value.flatMap((t) => t.cards ?? [])[0].action.to).toBe('envies');
  });
});

describe('undo', () => {
  it('the Annuler chip reverts the last action and says so', async () => {
    const chat = chatWith([ok({ actions: [cafe] })]);
    await chat.ready;
    await chat.send('4,5 café');
    await chat.tapChip('Annuler');
    expect(store.expenses.value[0].deleted_at).not.toBeNull();
    expect(last(chat)).toMatchObject({
      role: 'app',
      text: expect.stringMatching(/^Annulé : Café/) as string,
    });
    expect(chat.undoRecord()).toBeNull();
  });

  it('the model’s undo with no record gives "Rien à annuler."', async () => {
    const chat = chatWith([ok({ actions: [{ type: 'undo', kind: 'direct' }] })]);
    await chat.ready;
    await chat.send('annule');
    expect(last(chat)).toMatchObject({ role: 'app', text: 'Rien à annuler.' });
  });

  it('Review Focus 1: "annule" right after an offline add undoes that expense', async () => {
    const e = expense();
    await seed('expenses', e);
    let online = false;
    const chat = chatWith([ok({ actions: [{ type: 'undo', kind: 'direct' }] })], { online: () => online });
    await chat.ready;
    await chat.send('50 courses');
    online = true;
    await chat.send('annule');
    expect(calls[0].lastAction).toMatchObject({ type: 'add_expense' });
    const added = store.expenses.value.find((x) => x.id !== e.id)!;
    expect(added.deleted_at).not.toBeNull();
    expect(store.expenses.value.find((x) => x.id === e.id)!.deleted_at).toBeNull();
  });

  it('Review Focus 1: "annule" typed offline undoes the expense just noted', async () => {
    const e = expense();
    await seed('expenses', e);
    const chat = chatWith([], { online: () => false });
    await chat.ready;
    await chat.send('50 courses');
    await chat.send('Annule !');
    expect(calls).toHaveLength(0);
    const added = store.expenses.value.find((x) => x.id !== e.id)!;
    expect(added.deleted_at).not.toBeNull();
    expect(store.expenses.value.find((x) => x.id === e.id)!.deleted_at).toBeNull();
    expect(last(chat)).toMatchObject({ role: 'app', text: expect.stringMatching(/^Annulé : /) as string });
    await chat.send('annule');
    expect(last(chat)).toMatchObject({ role: 'app', text: 'Rien à annuler.' });
  });

  it('tapping another chip sends it', async () => {
    const chat = chatWith([ok(), ok()]);
    await chat.ready;
    await chat.tapChip('Il me reste combien ?');
    expect(calls[0].messages.at(-1)).toEqual({ role: 'user', content: 'Il me reste combien ?' });
  });
});

describe('history', () => {
  it('survives a reload, capped at 50 turns; an unanswered card comes back expired', async () => {
    const e = expense();
    await seed('expenses', e);
    const chat = chatWith(() => Promise.resolve(ok()));
    await chat.ready;
    for (let i = 0; i < 30; i++) await chat.send(`m${i}`);
    const withCard = chatWith([
      ok({ actions: [{ type: 'delete_expense', kind: 'confirm', id: 'e1', ref: e.id }] }),
    ]);
    await withCard.ready;
    await withCard.send('supprime');
    const again = chatWith([]);
    await again.ready;
    expect(again.turns.value).toHaveLength(HISTORY_MAX);
    expect(again.turns.value.at(-1)!.cards![0].state).toBe('expired');
    await again.answerCard(again.turns.value.at(-1)!.cards![0].id, true);
    expect(store.expenses.value[0].deleted_at).toBeNull();
  });

  it('Review Focus 5: another user never sees the first one’s history, nudges or undo record', async () => {
    const a = chatWith([ok({ actions: [cafe], nudgeKey: 'k1' })]);
    await a.ready;
    await a.send('4,5 café');
    await useUser(db, store, OTHER);
    await seed('profiles', profile({ user_id: OTHER }));
    const b = chatWith([ok({ actions: [{ type: 'undo', kind: 'direct' }] })]);
    await b.ready;
    expect(b.turns.value).toEqual([]);
    expect(b.nudgeSeen()).toEqual([]);
    expect(b.undoRecord()).toBeNull();
    await b.send('annule');
    expect(calls[1].lastAction).toBeUndefined();
    expect(calls[1].nudgeSeen).toEqual([]);
  });

  it('sign-out clears every user’s chat', async () => {
    await saveChat(db, USER, {
      turns: [{ id: 't', role: 'user', text: 'x', at: '' }],
      nudgeSeen: ['k'],
      undo: null,
    });
    await clearChat(db);
    expect(await loadChat(db, USER)).toEqual({ turns: [], nudgeSeen: [], undo: null });
  });
});

describe('partner request card (plan D7)', () => {
  it('Oui sends the request once, even tapped twice; offline it says so', async () => {
    const AMIRA = '00000000-0000-4000-8000-000000000002';
    const e = expense({
      user_id: AMIRA,
      household_id: '00000000-0000-4000-8000-000000000099',
      label: 'Aziza',
    });
    await seed('expenses', e);
    store.household.value = {
      household_id: '00000000-0000-4000-8000-000000000099',
      status: 'on',
      invite: null,
      partner: { user_id: AMIRA, first_name: 'Amira', needs_mil: 900_000 },
    };
    const request = vi.fn().mockResolvedValue(undefined);
    const action: ServerAction = {
      type: 'partner_request',
      kind: 'confirm',
      id: 'e1',
      ref: e.id,
      change: { kind: 'delete' },
    };
    const chat = createChat({
      ctx: { db, store, uuid: () => uuidN(9000 + ++ids), couple: { request } },
      api: () => Promise.resolve(ok({ actions: [action] })),
      flush: () => Promise.resolve(),
      pending: () => Promise.resolve(0),
      online: () => true,
    });
    await chat.ready;
    await chat.send('supprime Aziza');
    const card = last(chat).cards![0];
    await Promise.all([chat.answerCard(card.id, true), chat.answerCard(card.id, true)]);
    expect(request).toHaveBeenCalledOnce();
    expect(last(chat).text).toMatch(/Amira/);

    request.mockRejectedValue(
      new (await import('../../../src/data/couple')).CoupleError('couple.err.offline'),
    );
    await chat.send('encore');
    await chat.answerCard(last(chat).cards![0].id, true);
    expect(last(chat).text).toMatch(/Pas de connexion/);
  });
});
