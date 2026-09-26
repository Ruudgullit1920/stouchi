/* Web push, as the run sees it: a subscription, the payload the service worker
 * shows, and which answers mean the device is gone for good. Sending itself is
 * injected (web-push in the Edge Function), so this stays testable. */

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one payload to one device; resolves to the push service's HTTP status. */
export type SendPush = (sub: PushSub, payload: string) => Promise<number>;

/** What public/sw.js shows. The body is end-to-end encrypted by web push. */
export const payloadFor = (row: { id: string; title: string; body: string }): string =>
  JSON.stringify({ id: row.id, title: row.title, body: row.body });

/** 404 / 410: the subscription expired or was revoked — delete it. */
export const isExpired = (status: number): boolean => status === 404 || status === 410;

export const isDelivered = (status: number): boolean => status >= 200 && status < 300;
