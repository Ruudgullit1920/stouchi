/* The chat's lazy entry: loaded the first time + → "Parler à Aam Salah" is
 * tapped, so the rest of the app never downloads it. One conversation per
 * signed-in user, wired to the device's data and the session token. */
import { closeSheet } from '../../app/ui';
import { navigate } from '../../app/router';
import { coupleActions, data, pushNow, store } from '../../data/app';
import { pendingFor } from '../../data/outbox';
import { supabase } from '../../data/supabase';
import { callAam, type ApiResult } from './api';
import { createChat, type Chat } from './chat';
import { ChatSheet } from './ChatSheet';
import './chat.css';

/* where each `open` screen lives; notifications and settings are placeholders until Phase 4 */
const PATH: Record<string, string> = {
  budget: '#/budget',
  historique: '#/history',
  objectif: '#/goal',
  'pot:besoins': '#/pot/needs',
  'pot:envies': '#/pot/wants',
  'pot:epargne': '#/goal',
  notifications: '#/budget',
  reglages: '#/me',
};

let current: { userId: string; chat: Chat } | null = null;

async function withToken(req: Parameters<typeof callAam>[0]): Promise<ApiResult> {
  const { data: auth } = await supabase().auth.getSession();
  const token = auth.session?.access_token;
  return token ? callAam(req, token) : { ok: false, status: 401 };
}

function appChat(): Chat | null {
  const userId = store.userId.value;
  if (!data.db || !userId) return null;
  if (current?.userId !== userId) {
    const db = data.db;
    const chat = createChat({
      ctx: { db, store, couple: coupleActions() },
      api: withToken,
      flush: pushNow,
      pending: async () => (await pendingFor(db, userId)).filter((e) => e.status === 'pending').length,
      online: () => navigator.onLine && store.sync.value.online,
    });
    current = { userId, chat };
  }
  return current.chat;
}

export function ChatPanel() {
  const chat = appChat();
  if (!chat) return null;
  return (
    <ChatSheet
      chat={chat}
      store={store}
      onOpenScreen={(screen) => {
        closeSheet();
        navigate(PATH[screen] ?? '#/budget');
      }}
    />
  );
}
