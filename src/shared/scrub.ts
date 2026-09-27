/* What an error report may carry (spec §8.5, §8.7): enough to explain a crash,
 * nothing the user typed. scrubCapture() is PostHog's before_send in the
 * browser; /api/aam builds its reports from scrubText(). Everything that can hold user text is dropped: request bodies,
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

/** A PostHog event, as its before_send hook sees it. */
export interface CaptureEvent {
  event: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
  [k: string]: unknown;
}

/* what autocapture reads off the page: element text and attributes */
const PAGE_TEXT = /^\$(el_text|elements|elements_chain)$/;
const URL_KEY = /url|referrer/i;

function scrubProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (PAGE_TEXT.test(key)) continue;
    if (key === '$exception_list' && Array.isArray(value))
      out[key] = value.map((e: { value?: unknown }) => ({
        ...e,
        value: typeof e.value === 'string' ? scrubText(e.value) : e.value,
      }));
    else if (key.startsWith('$exception_') && Array.isArray(value))
      out[key] = (value as unknown[]).map((v) => (typeof v === 'string' ? scrubText(v) : v));
    else if (typeof value === 'string' && key.startsWith('$exception_')) out[key] = scrubText(value);
    else if (typeof value === 'string' && URL_KEY.test(key)) out[key] = bareUrl(value);
    else out[key] = value;
  }
  return out;
}

/** Person properties: PostHog's own ($…) only, so an e-mail never becomes one. */
const personProps = (props: Record<string, unknown>): Record<string, unknown> =>
  scrubProps(Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith('$'))));

/** PostHog's before_send: the same rules as scrub(), on PostHog's event shape. */
export function scrubCapture<E extends CaptureEvent>(event: E): E {
  const out: E = { ...event, properties: scrubProps(event.properties) };
  if (event.$set) out.$set = personProps(event.$set);
  if (event.$set_once) out.$set_once = personProps(event.$set_once);
  return out;
}
