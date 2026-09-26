/* Aam Salah's conversation on this device (plan Decisions): the last 50 turns,
 * the nudges already shown and the undo record, in IndexedDB under the user's
 * id. Never synced; cleared on sign-out and when another user takes the device.
 * After a reload, a card nobody answered comes back expired: its rows may have
 * moved, and Oui must not act on what the user saw yesterday. */
import type { LocalDb } from '../../data/localdb';
import type { ServerAction, UndoRecord } from './execute';

export const HISTORY_MAX = 50;
const NUDGES_KEPT = 50;

export type CardState = 'open' | 'yes' | 'no' | 'stale' | 'expired';
export interface Card {
  id: string;
  /** the prepared action (see execute.prepare) */
  action: ServerAction;
  state: CardState;
}

/** A direct action the app ran: the receipt, or the "Voir …" button for `open`. */
export interface DoneAction {
  action: ServerAction;
  summary: string;
}

export interface Turn {
  id: string;
  /** app: what the app did, sent to the model as "[app] …" */
  role: 'user' | 'assistant' | 'app';
  text: string;
  actions?: DoneAction[];
  cards?: Card[];
  chips?: string[];
  /** ISO instant */
  at: string;
}

export interface ChatSaved {
  turns: Turn[];
  nudgeSeen: string[];
  undo: UndoRecord | null;
}

const empty = (): ChatSaved => ({ turns: [], nudgeSeen: [], undo: null });

export async function loadChat(db: LocalDb, userId: string): Promise<ChatSaved> {
  const saved = (await db.get('chat', userId)) as ChatSaved | undefined;
  if (!saved) return empty();
  const expire = (c: Card): Card => (c.state === 'open' ? { ...c, state: 'expired' } : c);
  return {
    turns: saved.turns.map((t) => (t.cards ? { ...t, cards: t.cards.map(expire) } : t)),
    nudgeSeen: saved.nudgeSeen,
    undo: saved.undo,
  };
}

export async function saveChat(db: LocalDb, userId: string, chat: ChatSaved): Promise<void> {
  const kept: ChatSaved = {
    turns: chat.turns.slice(-HISTORY_MAX),
    nudgeSeen: chat.nudgeSeen.slice(-NUDGES_KEPT),
    undo: chat.undo,
  };
  await db.put('chat', kept, userId);
}

export async function clearChat(db: LocalDb): Promise<void> {
  await db.clear('chat');
}
