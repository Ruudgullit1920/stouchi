import { BellRing, ChevronLeft, Clock, MessageCircle, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import type { Row } from '../../data/localdb';
import { pushSupported, type PushApi } from '../../data/push';
import type { Store } from '../../data/store';
import { todayTunis } from '../../shared/dates';
import { shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import type { Reminder } from '../../shared/schemas';

const CLOCK = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Tunis',
});

type Props = {
  store: Store;
  /** null where push isn't set up for this app (no key, no service worker) */
  push: PushApi | null;
  write: (table: 'reminders', row: Row) => Promise<void>;
  /** opens Aam Salah's chat */
  onAsk: () => void;
  onBack: () => void;
};

/** Notifications et rappels (#/me/notifications): push on this phone, and the
 * reminders Aam Salah will send. Here the user asks for push, so the switch is
 * not held back for the first week the way the opt-in card is. */
export function NotifSettings({ store, push, write, onAsk, onBack }: Props) {
  const reminders = store.reminders.value
    .filter((r) => r.done_at === null && r.deleted_at === null)
    .sort((a, b) => Date.parse(a.remind_at) - Date.parse(b.remind_at));

  const remove = async (r: Reminder) => {
    const now = new Date().toISOString();
    await write('reminders', { ...r, deleted_at: now, updated_at: now });
    showToast({
      text: t('me.reminders.deleted'),
      action: {
        label: t('action.undo'),
        run: () => void write('reminders', { ...r, deleted_at: null, updated_at: new Date().toISOString() }),
      },
    });
  };

  return (
    <div class="me">
      <header class="top">
        <button type="button" class="icon-btn" aria-label={t('action.back')} onClick={onBack}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <h1 class="set-h1">{t('me.notif.title')}</h1>
        <span class="set-save" aria-hidden="true" />
      </header>
      <p class="lead">{t('me.notif.lead')}</p>

      <div class="list set">
        <PushRow push={push} />
      </div>

      <div class="sec">
        <h2>{t('me.reminders.title')}</h2>
        {reminders.length > 0 && <span class="meta">{reminders.length}</span>}
      </div>
      {reminders.length > 0 ? (
        <ul class="list set rem">
          {reminders.map((r) => {
            const at = new Date(r.remind_at);
            return (
              <li key={r.id} class="srow">
                <span class="ic tone-plain" aria-hidden="true">
                  <Clock />
                </span>
                <span class="tx">
                  <span class="t">{r.text}</span>
                  <span class="s">
                    {t('me.reminders.when', { date: shortDate(todayTunis(at)), time: CLOCK.format(at) })}
                  </span>
                </span>
                <button
                  type="button"
                  class="del"
                  aria-label={t('me.reminders.delete', { text: r.text })}
                  onClick={() => void remove(r)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div class="card rem-empty">
          <p>{t('me.reminders.empty')}</p>
        </div>
      )}
      <button type="button" class="addrow" onClick={onAsk}>
        <MessageCircle size={18} aria-hidden="true" />
        {t('me.reminders.ask')}
      </button>
    </div>
  );
}

/** Why push can't be switched on here, or null when it can. */
function blocker(push: PushApi | null): string | null {
  if (!push) return t('me.notif.push.unsupported');
  const env = push.env();
  if (env.permission === 'denied') return t('me.notif.push.blocked');
  if (pushSupported(env)) return null;
  /* Safari tabs on iPhone expose no push at all: installing the app does */
  return env.ios && !env.standalone ? t('me.notif.push.ios') : t('me.notif.push.unsupported');
}

function PushRow({ push }: { push: PushApi | null }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const why = note ?? blocker(push);
  const usable = push !== null && blocker(push) === null;
  useEffect(() => {
    if (usable) void push.isOn().then(setOn);
  }, [push, usable]);

  const toggle = async () => {
    if (!push || busy) return;
    setBusy(true);
    if (on) {
      await push.disable();
      setOn(false);
    } else {
      const r = await push.enable();
      setOn(r === 'on');
      setNote(r === 'denied' ? t('me.notif.push.blocked') : r === 'error' ? t('notify.push.failed') : null);
    }
    setBusy(false);
  };

  return (
    <div class="srow tg">
      <span class="ic tone-acc">
        <BellRing aria-hidden="true" />
      </span>
      <span class="tx">
        <span class="t" id="me-push-label">
          {t('notify.push.switch')}
        </span>
        <span class="s">{why ?? t('me.notif.push.sub')}</span>
      </span>
      <button
        type="button"
        class={on ? 'sw on' : 'sw'}
        role="switch"
        aria-checked={on === true}
        aria-labelledby="me-push-label"
        disabled={!usable || on === null || busy}
        onClick={() => void toggle()}
      />
    </div>
  );
}
