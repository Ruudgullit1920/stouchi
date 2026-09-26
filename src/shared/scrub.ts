/* What an error report may carry (spec §8.5, §8.7): enough to explain a crash,
 * nothing the user typed. Used by Sentry's beforeSend in the browser and in
 * /api/aam. Everything that can hold user text is dropped: request bodies,
 * headers, cookies and query strings, `extra`, breadcrumb messages and data,
 * user fields but the id. Free text that stays (our own messages, error
 * values) has its amounts, e-mails and tokens masked. A free-text label in an
 * error message can't be spotted, so our own throws never include one. */

export interface ReportEvent {
  message?: string;
  exception?: { values?: { type?: string; value?: string }[] };
  user?: { id?: string; [k: string]: unknown };
  request?: { url?: string; [k: string]: unknown };
  breadcrumbs?: { category?: string; [k: string]: unknown }[];
  extra?: unknown;
  tags?: Record<string, unknown>;
  [k: string]: unknown;
}

const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;
/* two digits or more: amounts, dates, phone numbers; "1 en attente" stays */
const DIGITS = /\d{2,}/g;

export const scrubText = (text: string): string =>
  text.replace(JWT, '[jwt]').replace(EMAIL, '[email]').replace(DIGITS, '#');

/** A URL without its query, before or after the hash (#/history?q=…). */
const bareUrl = (url: string): string => url.replace(/\?[^#]*/, '').replace(/(#[^?]*)\?.*$/, '$1');

export function scrub<E extends ReportEvent>(event: E): E {
  const out: E = { ...event };
  if (out.message) out.message = scrubText(out.message);
  if (out.exception?.values)
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => ({ ...v, value: v.value && scrubText(v.value) })),
    };
  out.user = out.user?.id ? { id: out.user.id } : undefined;
  out.request = out.request?.url ? { url: bareUrl(out.request.url) } : undefined;
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map((b) => ({ category: b.category }));
  delete out.extra;
  return out;
}
