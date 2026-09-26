/* Web push on this device (spec §4.5): when to offer it, turning it on and
 * off, and what the service worker tells the page. The subscription row is
 * written with the user's own session (RLS lets them insert and delete their
 * rows); the notify-run function reads it with the service key. */
import type { SupabaseClient } from '@supabase/supabase-js';

const DAY = 86_400_000;
const LATER_KEY = 'stouchi:push-later';
const DELETE_KEY = 'stouchi:push-delete';
/** onboarded this long before the card shows */
const WAIT_DAYS = 7;
/** "Plus tard" hides the card this long */
const LATER_DAYS = 30;

export interface PushEnv {
  now: Date;
  onboardedAt: string | null;
  /** null when the browser has no Notification API */
  permission: NotificationPermission | null;
  pushManager: boolean;
  ios: boolean;
  /** running as the installed app (Home Screen) */
  standalone: boolean;
  /** epoch ms of the last "Plus tard" on this device */
  laterAt: number | null;
}

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: the card may show again, nothing worse */
    }
  },
};

/** The card shows only after a week, while the permission is undecided, where
 * push can work (on iOS only in the installed app), and not after "Plus tard". */
export function canAskPush(e: PushEnv): boolean {
  if (!e.onboardedAt || e.permission !== 'default' || !e.pushManager) return false;
  if (e.ios && !e.standalone) return false;
  if (e.now.getTime() - Date.parse(e.onboardedAt) < WAIT_DAYS * DAY) return false;
  return e.laterAt === null || e.now.getTime() - e.laterAt >= LATER_DAYS * DAY;
}

/** Push can work here at all (the footer switch shows). */
export const pushSupported = (e: PushEnv): boolean =>
  e.permission !== null && e.pushManager && (!e.ios || e.standalone);

export function readPushEnv(onboardedAt: string | null, now = new Date()): PushEnv {
  const later = Number(storage.get(LATER_KEY));
  const ua = navigator.userAgent;
  return {
    now,
    onboardedAt,
    permission: typeof Notification === 'undefined' ? null : Notification.permission,
    pushManager: typeof PushManager !== 'undefined' && 'serviceWorker' in navigator,
    ios: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
    standalone:
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    laterAt: later > 0 ? later : null,
  };
}

export function remindLater(now = Date.now()): void {
  storage.set(LATER_KEY, String(now));
}

/* ── the subscription ── */

export interface PushRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushTable {
  /** insert, ignoring a row already there for this user and endpoint */
  add(row: PushRow): Promise<void>;
  remove(userId: string, endpoint: string): Promise<void>;
}

export function pushTable(client: SupabaseClient): PushTable {
  return {
    async add(row) {
      const { error } = await client
        .from('push_subscriptions')
        .upsert(row, { onConflict: 'user_id,endpoint', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    },
    async remove(userId, endpoint) {
      const { error } = await client
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId)
        .eq('endpoint', endpoint);
      if (error) throw new Error(error.message);
    },
  };
}

/** Push on this device, as the Notifications screen needs it. */
export interface PushApi {
  env(): PushEnv;
  isOn(): Promise<boolean>;
  enable(): Promise<'on' | 'denied' | 'error'>;
  disable(): Promise<void>;
}

export interface PushDeps {
  userId: string;
  vapidKey: string;
  /** null when no service worker is registered (dev, or not yet) */
  pushManager: () => Promise<PushManager | null>;
  requestPermission: () => Promise<NotificationPermission>;
  table: PushTable;
}

/** base64url VAPID public key → the bytes PushManager.subscribe wants */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(d: PushDeps): Promise<'on' | 'denied' | 'error'> {
  if ((await d.requestPermission()) !== 'granted') return 'denied';
  const manager = await d.pushManager();
  if (!manager) return 'error';
  let sub: PushSubscription;
  try {
    sub =
      (await manager.getSubscription()) ??
      (await manager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(d.vapidKey) }));
  } catch {
    /* the push service refused, or the key is bad: nothing was subscribed */
    return 'error';
  }
  const json = sub.toJSON();
  try {
    await d.table.add({
      user_id: d.userId,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    });
    return 'on';
  } catch {
    /* no row, no push: don't leave the device half subscribed */
    await sub.unsubscribe();
    return 'error';
  }
}

export async function isPushOn(d: Pick<PushDeps, 'pushManager'>): Promise<boolean> {
  const manager = await d.pushManager();
  return manager !== null && (await manager.getSubscription()) !== null;
}

/** Unsubscribe this device, then delete its row. The device unsubscribes even
 * offline; the delete then waits for the same user's next sign-in. */
export async function disablePush(d: Pick<PushDeps, 'userId' | 'pushManager' | 'table'>): Promise<void> {
  const sub = await (await d.pushManager())?.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  /* a failed unsubscribe still loses the row, so no push is sent here; the
     next owner's boot drops the device subscription (dropDevicePush) */
  await sub.unsubscribe().catch(() => false);
  try {
    await d.table.remove(d.userId, endpoint);
  } catch {
    storage.set(DELETE_KEY, JSON.stringify({ userId: d.userId, endpoint }));
  }
}

/** A different user is opening the app on this device (the last one's session
 * expired, or their sign-out couldn't unsubscribe): the device's subscription is
 * theirs, not this user's, so drop it. The new user's JWT can't delete the old
 * row; its endpoint now answers 410 and notify-run prunes it. */
export async function dropDevicePush(pushManager: PushDeps['pushManager']): Promise<void> {
  const sub = await (await pushManager())?.getSubscription();
  await sub?.unsubscribe().catch(() => false);
}

/** At sign-in: finish a delete that failed offline, if it was this user's. */
export async function retryPushDelete(table: PushTable, userId: string): Promise<void> {
  let pending: { userId?: string; endpoint?: string } = {};
  try {
    pending = JSON.parse(storage.get(DELETE_KEY) ?? '{}') as typeof pending;
  } catch {
    /* unreadable: nothing to retry */
  }
  if (pending.userId !== userId || !pending.endpoint) return;
  try {
    await table.remove(userId, pending.endpoint);
    storage.set(DELETE_KEY, null);
  } catch {
    /* still offline: next time */
  }
}

/* ── messages from public/sw.js ── */

export function listenToServiceWorker(
  sw: EventTarget,
  on: { notify: () => void; open: (id: string | null) => void },
): () => void {
  const handle = (e: Event) => {
    const msg = (e as MessageEvent).data as { type?: string; id?: unknown } | null;
    if (msg?.type === 'notify') on.notify();
    else if (msg?.type === 'open') on.open(typeof msg.id === 'string' ? msg.id : null);
  };
  sw.addEventListener('message', handle);
  return () => sw.removeEventListener('message', handle);
}
