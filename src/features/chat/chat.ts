/* Aam Salah's conversation state (plan Task 8). One send:
 *   1. the user's turn is shown;
 *   2. the outbox is flushed, waiting at most 2 s, so the carnet the server
 *      builds already holds what was just logged (Review Focus 1);
 *   3. with writes still pending, or offline, the local parser answers;
 *   4. otherwise the last 12 turns go to /api/aam, with the nudges already
 *      seen and the last action (so "annule" targets the right row).
 * Direct actions run at once (Annuler chip when undoable); confirm actions
 * become cards and run only on Oui. What the app did is told to the model in
 * "[app] …" turns. A server error or time-out falls back to the parser; a 429
 * or 409 shows the server's French line instead. */
import { signal } from '@preact/signals';
import { todayTunis } from '../../shared/dates';
import { t, type StringKey } from '../../shared/i18n/t';
import { isUndo, parseLocal } from '../../shared/localParser';
import { formatTnd, MIL_PER_TND, type Mil } from '../../shared/money';
import type { AamRequest, AamReply, ApiResult } from './api';
import {
  execute,
  prepare,
  undoLast,
  type ExecCtx,
  type ExecResult,
  type ServerAction,
  type UndoRecord,
} from './execute';
import { loadChat, saveChat, type Card, type CardState, type DoneAction, type Turn } from './history';

export interface ChatDeps {
  ctx: ExecCtx;
  api: (req: AamRequest) => Promise<ApiResult>;
  /** push the outbox to the server now */
  flush: () => Promise<void>;
  /** writes still waiting in the outbox (read from the outbox itself: the sync
   * loop may be the one that sends them, while our flush waits its turn) */
  pending: () => Promise<number>;
  online: () => boolean;
}

export const FLUSH_WAIT_MS = 2_000;
const POLL_MS = 100;
const SENT_TURNS = 12;
const CHIPS = 3;
/* the server's answer is final for these: falling back to the parser would hide it */
const SHOWN_AS_IS = new Set([409, 429]);

export function createChat(deps: ChatDeps) {
  const { ctx } = deps;
  const userId = ctx.store.userId.value;
  if (!userId) throw new Error('no user on this device');
  const turns = signal<Turn[]>([]);
  const busy = signal(false);
  /** the last answer came from the local parser */
  const offline = signal(false);
  let nudgeSeen: string[] = [];
  let undo: UndoRecord | null = null;
  /** "50" offline: the amount waits for what it was for */
  let pendingAmount: Mil | null = null;

  const ready = loadChat(ctx.db, userId).then((saved) => {
    turns.value = [...saved.turns, ...turns.value];
    nudgeSeen = saved.nudgeSeen;
    undo = saved.undo;
  });
  const save = () => saveChat(ctx.db, userId, { turns: turns.value, nudgeSeen, undo });
  const newId = () => (ctx.uuid ?? (() => crypto.randomUUID()))();
  const push = (turn: Omit<Turn, 'id' | 'at'>) => {
    turns.value = [...turns.value, { ...turn, id: newId(), at: new Date().toISOString() }];
  };
  const say = (text: string, more: Partial<Turn> = {}) => push({ role: 'assistant', text, ...more });
  const tell = (text: string, more: Partial<Turn> = {}) => push({ role: 'app', text, ...more });
  const updateCard = (id: string, change: (c: Card) => Card) => {
    turns.value = turns.value.map((turn) =>
      turn.cards?.some((c) => c.id === id)
        ? { ...turn, cards: turn.cards.map((c) => (c.id === id ? change(c) : c)) }
        : turn,
    );
  };
  const setCard = (id: string, state: CardState) => updateCard(id, (c) => ({ ...c, state }));
  const findCard = (id: string) => turns.value.flatMap((turn) => turn.cards ?? []).find((c) => c.id === id);
  const failed = (r: Extract<ExecResult, { ok: false }>) =>
    r.reason === 'couple' ? t(r.key) : t(r.reason === 'stale' ? 'chat.app.stale' : 'chat.app.invalid');

  /** Flush the outbox, waiting at most 2 s: true as soon as nothing is left to send. */
  async function flushed(): Promise<boolean> {
    let done = false;
    void deps
      .flush()
      .catch(() => undefined)
      .finally(() => (done = true));
    for (let waited = 0; ; waited += POLL_MS) {
      if ((await deps.pending()) === 0) return true;
      if (done || waited >= FLUSH_WAIT_MS) return false;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  const messages = (): AamRequest['messages'] =>
    turns.value
      .slice(-SENT_TURNS)
      .map((turn) =>
        turn.role === 'app'
          ? { role: 'user', content: `[app] ${turn.text}` }
          : { role: turn.role, content: turn.text },
      );

  async function undoText(): Promise<string> {
    const what = undo ? await undoLast(undo, ctx) : null;
    undo = null;
    return what ? t('chat.app.undone', { what }) : t('chat.app.nothingToUndo');
  }

  async function answer(body: AamReply): Promise<void> {
    const done: DoneAction[] = [];
    const cards: Card[] = [];
    const after: string[] = [];
    let undoable = false;
    for (const a of body.actions) {
      if (a.kind === 'confirm') {
        const ready = await prepare(a, ctx);
        cards.push({ id: ready.newId ?? newId(), action: ready, state: 'open' });
      } else if (a.type === 'open') {
        done.push({ action: a, summary: '' });
      } else if (a.type === 'undo') {
        after.push(await undoText());
      } else {
        const r = await execute(a, ctx);
        if (!r.ok) {
          after.push(failed(r));
          continue;
        }
        done.push({ action: a, summary: r.summary });
        undo = r.undo;
        undoable ||= r.undo !== null;
      }
    }
    if (body.nudgeKey && !nudgeSeen.includes(body.nudgeKey)) nudgeSeen = [...nudgeSeen, body.nudgeKey];
    const chips = body.chips.slice(0, CHIPS);
    say(body.reply, {
      ...(done.length && { actions: done }),
      ...(cards.length && { cards }),
      chips: cards.length ? [] : undoable ? [t('chat.chip.undo'), ...chips] : chips,
    });
    for (const text of after) tell(text);
  }

  /** The offline Aam Salah: expenses only, asking instead of guessing. */
  async function local(text: string): Promise<void> {
    offline.value = true;
    /* the undo record names the exact row: no model needed (Review Focus 1) */
    if (isUndo(text)) return tell(await undoText());
    const today = todayTunis();
    let parsed = parseLocal(text, today);
    if ('ask' in parsed && parsed.ask === 'amount' && pendingAmount !== null)
      parsed = parseLocal(`${pendingAmount / MIL_PER_TND} ${text}`, today);
    pendingAmount = null;
    if ('action' in parsed) {
      const action: ServerAction = { ...parsed.action };
      const r = await execute(action, ctx);
      if (!r.ok) return say(t('chat.offline.failed'));
      undo = r.undo;
      say(t('chat.offline.noted', { what: r.summary }), {
        actions: [{ action, summary: r.summary }],
        chips: [t('chat.chip.undo')],
      });
    } else if ('ask' in parsed && parsed.ask === 'what' && parsed.amount !== undefined) {
      pendingAmount = parsed.amount;
      say(t('chat.offline.what', { amount: formatTnd(parsed.amount) }));
    } else {
      say(t('ask' in parsed ? 'chat.offline.amount' : 'chat.offline.unknown'));
    }
  }

  async function send(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    await ready;
    push({ role: 'user', text });
    busy.value = true;
    try {
      /* offline, nothing can flush: answer at once */
      if (!deps.online() || !(await flushed())) return await local(text);
      const res = await deps.api({
        messages: messages(),
        nudgeSeen: [...nudgeSeen],
        ...(undo && { lastAction: { type: undo.type, ref: undo.ref, at: undo.at } }),
      });
      if (res.ok) {
        offline.value = false;
        pendingAmount = null;
        await answer(res.body);
      } else if (SHOWN_AS_IS.has(res.status)) {
        say(res.error ?? t('aam.error.down'));
      } else {
        await local(text);
      }
    } finally {
      /* saved first: once the chat is idle, a reload keeps this turn */
      await save();
      busy.value = false;
    }
  }

  async function answerCard(cardId: string, yes: boolean): Promise<void> {
    const card = findCard(cardId);
    /* a card runs once: answered, expired or unknown cards do nothing */
    if (!card || card.state !== 'open') return;
    setCard(cardId, yes ? 'yes' : 'no');
    if (!yes) {
      const key = `chat.refused.${card.action.type}`;
      tell(
        t('chat.app.refused', {
          what: t((Object.hasOwn(REFUSED, key) ? key : 'chat.refused.other') as StringKey),
        }),
      );
    } else {
      const r = await execute(card.action, ctx);
      if (r.ok) {
        undo = r.undo;
        tell(t('chat.app.confirmed', { what: r.summary }), { chips: r.undo ? [t('chat.chip.undo')] : [] });
      } else {
        setCard(cardId, 'stale');
        tell(failed(r));
      }
    }
    await save();
  }

  async function undoChip(): Promise<void> {
    await ready;
    tell(await undoText());
    await save();
  }

  const tapChip = (text: string) => (text === t('chat.chip.undo') ? undoChip() : send(text));

  /** The income card's Épargne / Ce mois switch: where the money goes, until Oui or Non. */
  function switchIncome(cardId: string, to: 'epargne' | 'envies'): void {
    const card = findCard(cardId);
    if (!card || card.state !== 'open' || card.action.type !== 'add_income') return;
    updateCard(cardId, (c) => ({ ...c, action: { ...c.action, to } }));
  }

  return {
    turns,
    busy,
    offline,
    ready,
    send,
    answerCard,
    tapChip,
    undoChip,
    switchIncome,
    nudgeSeen: () => [...nudgeSeen],
    undoRecord: () => undo,
  };
}
export type Chat = ReturnType<typeof createChat>;

/* the confirm types with their own "not done" line */
const REFUSED: Record<string, true> = Object.fromEntries(
  [
    'edit_expense',
    'delete_expense',
    'savings_deposit',
    'savings_withdraw',
    'add_income',
    'add_bill',
    'pay_bill',
    'settle_debt',
    'update_goal',
  ].map((type) => [`chat.refused.${type}`, true]),
);
