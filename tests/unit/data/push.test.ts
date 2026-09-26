// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canAskPush,
  disablePush,
  dropDevicePush,
  enablePush,
  isPushOn,
  listenToServiceWorker,
  remindLater,
  retryPushDelete,
  type PushDeps,
  type PushEnv,
  type PushTable,
} from '../../../src/data/push';
import { USER, uuidN } from '../fixtures';

const B = uuidN(2);
const DAY = 86_400_000;
const NOW = new Date('2026-09-24T10:00:00+01:00');

const env = (e: Partial<PushEnv> = {}): PushEnv => ({
  now: NOW,
  onboardedAt: new Date(NOW.getTime() - 8 * DAY).toISOString(),
  permission: 'default',
  pushManager: true,
  ios: false,
  standalone: false,
  laterAt: null,
  ...e,
});

describe('canAskPush', () => {
  it('waits for the first 7 days', () => {
    expect(canAskPush(env({ onboardedAt: new Date(NOW.getTime() - 7 * DAY + 60_000).toISOString() }))).toBe(
      false,
    );
    expect(canAskPush(env({ onboardedAt: new Date(NOW.getTime() - 7 * DAY).toISOString() }))).toBe(true);
    expect(canAskPush(env({ onboardedAt: null }))).toBe(false);
  });

  it('never asks once the permission is decided, or without PushManager', () => {
    expect(canAskPush(env({ permission: 'denied' }))).toBe(false);
    expect(canAskPush(env({ permission: 'granted' }))).toBe(false);
    expect(canAskPush(env({ permission: null }))).toBe(false);
    expect(canAskPush(env({ pushManager: false }))).toBe(false);
  });

  it('on iOS, only in the installed app', () => {
    expect(canAskPush(env({ ios: true, standalone: false }))).toBe(false);
    expect(canAskPush(env({ ios: true, standalone: true }))).toBe(true);
  });

  it('“Plus tard” hides it for 30 days', () => {
    expect(canAskPush(env({ laterAt: NOW.getTime() - 29 * DAY }))).toBe(false);
    expect(canAskPush(env({ laterAt: NOW.getTime() - 30 * DAY }))).toBe(true);
  });

  it('remindLater stores the time on this device', () => {
    remindLater(NOW.getTime());
    expect(localStorage.getItem('stouchi:push-later')).toBe(String(NOW.getTime()));
  });
});

/* ── fakes: the browser's push manager and the push_subscriptions table ── */
class FakeSub {
  unsubscribed = false;
  constructor(
    readonly endpoint: string,
    private readonly manager: FakeManager,
  ) {}
  toJSON() {
    return { endpoint: this.endpoint, keys: { p256dh: 'p256', auth: 'auth' } };
  }
  unsubscribe() {
    this.unsubscribed = true;
    this.manager.current = null;
    return Promise.resolve(true);
  }
}
class FakeManager {
  current: FakeSub | null = null;
  subscribes: unknown[] = [];
  getSubscription() {
    return Promise.resolve(this.current);
  }
  subscribe(options: unknown) {
    this.subscribes.push(options);
    this.current ??= new FakeSub('https://push.example/device-1', this);
    return Promise.resolve(this.current);
  }
}
class FakeTable implements PushTable {
  rows = new Map<string, { user_id: string; endpoint: string; p256dh: string; auth: string }>();
  failNext = 0;
  add(row: { user_id: string; endpoint: string; p256dh: string; auth: string }) {
    if (this.failNext-- > 0) return Promise.reject(new Error('network'));
    this.rows.set(`${row.user_id}|${row.endpoint}`, row);
    return Promise.resolve();
  }
  remove(userId: string, endpoint: string) {
    if (this.failNext-- > 0) return Promise.reject(new Error('network'));
    this.rows.delete(`${userId}|${endpoint}`);
    return Promise.resolve();
  }
}

let manager: FakeManager;
let table: FakeTable;
const deps = (userId = USER, permission: NotificationPermission = 'granted'): PushDeps => ({
  userId,
  vapidKey: 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  pushManager: () => Promise.resolve(manager as unknown as PushManager),
  requestPermission: () => Promise.resolve(permission),
  table,
});

beforeEach(() => {
  localStorage.clear();
  manager = new FakeManager();
  table = new FakeTable();
});
afterEach(() => vi.restoreAllMocks());

describe('enablePush', () => {
  it('subscribes with the VAPID key and inserts one row', async () => {
    expect(await enablePush(deps())).toBe('on');
    expect(manager.subscribes).toHaveLength(1);
    expect(manager.subscribes[0]).toMatchObject({ userVisibleOnly: true });
    expect([...table.rows.values()]).toEqual([
      { user_id: USER, endpoint: 'https://push.example/device-1', p256dh: 'p256', auth: 'auth' },
    ]);
    expect(await isPushOn(deps())).toBe(true);
  });

  it('enabling twice keeps one row', async () => {
    await enablePush(deps());
    await enablePush(deps());
    expect(table.rows.size).toBe(1);
  });

  it('a refused permission subscribes nothing', async () => {
    expect(await enablePush(deps(USER, 'denied'))).toBe('denied');
    expect(manager.subscribes).toEqual([]);
    expect(table.rows.size).toBe(0);
  });

  it('a subscribe that throws (bad key, AbortError) is an error, not a crash', async () => {
    manager.subscribe = () => Promise.reject(new DOMException('push service', 'AbortError'));
    expect(await enablePush(deps())).toBe('error');
    expect(table.rows.size).toBe(0);
  });

  it('a failed insert undoes the device subscription', async () => {
    table.failNext = 1;
    expect(await enablePush(deps())).toBe('error');
    expect(manager.current).toBeNull();
  });
});

describe('disablePush and sign-out (Review Focus 5)', () => {
  it('unsubscribes the device and deletes its row', async () => {
    await enablePush(deps());
    await disablePush(deps());
    expect(manager.current).toBeNull();
    expect(table.rows.size).toBe(0);
    expect(await isPushOn(deps())).toBe(false);
  });

  it('user B signing in after A has no subscription until they opt in', async () => {
    await enablePush(deps(USER));
    await disablePush(deps(USER)); // A signs out
    expect(await manager.getSubscription()).toBeNull();
    expect(await isPushOn(deps(B))).toBe(false);
    expect([...table.rows.values()].some((r) => r.user_id === USER)).toBe(false);
  });

  it('offline: the device unsubscribes anyway and the delete waits for the same user', async () => {
    await enablePush(deps(USER));
    table.failNext = 1;
    await disablePush(deps(USER));
    expect(manager.current).toBeNull();
    expect(table.rows.size).toBe(1);

    await retryPushDelete(table, B); // someone else signs in: not theirs to delete
    expect(table.rows.size).toBe(1);
    await retryPushDelete(table, USER);
    expect(table.rows.size).toBe(0);
    await retryPushDelete(table, USER);
    expect(localStorage.getItem('stouchi:push-delete')).toBeNull();
  });

  it('a session that expired: the next user’s sign-in drops the device’s subscription', async () => {
    await enablePush(deps(USER));
    await dropDevicePush(deps(B).pushManager);
    expect(manager.current).toBeNull();
    expect(await isPushOn(deps(B))).toBe(false);
    await dropDevicePush(deps(B).pushManager); // nothing left: no error
  });

  it('an unsubscribe that fails still deletes the row', async () => {
    await enablePush(deps());
    const sub = manager.current as FakeSub;
    sub.unsubscribe = () => Promise.reject(new Error('push service'));
    await disablePush(deps());
    expect(table.rows.size).toBe(0);
  });

  it('with nothing subscribed, disabling does nothing', async () => {
    await disablePush(deps());
    expect(table.rows.size).toBe(0);
  });
});

describe('listenToServiceWorker', () => {
  it('pulls on notify and opens on click', () => {
    const sw = new EventTarget();
    const notify = vi.fn();
    const open = vi.fn();
    const stop = listenToServiceWorker(sw, { notify, open });
    sw.dispatchEvent(new MessageEvent('message', { data: { type: 'notify', id: 'x' } }));
    sw.dispatchEvent(new MessageEvent('message', { data: { type: 'open', id: 'y' } }));
    sw.dispatchEvent(new MessageEvent('message', { data: 'junk' }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('y');
    stop();
    sw.dispatchEvent(new MessageEvent('message', { data: { type: 'notify' } }));
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
