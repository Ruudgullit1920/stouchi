import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { canAskPush, pushSupported, remindLater, type PushApi } from '../../data/push';
import { t } from '../../shared/i18n/t';

export type { PushApi };

/** bumped when push is turned on or off here, so the card and the switch agree */
const changes = signal(0);

/** The opt-in card (spec §4.5): after the first week, never during onboarding. */
export function PushCard({ api }: { api: PushApi }) {
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  void changes.value; // re-read the permission after the switch is used
  if (hidden || !canAskPush(api.env())) return null;
  return (
    <div class="pushcard">
      <p class="pushcard__title">{t('notify.push.title')}</p>
      <p class="pushcard__body">{failed ? t('notify.push.failed') : t('notify.push.body')}</p>
      <div class="nact">
        <button
          type="button"
          class="nbtn"
          onClick={() => {
            void api.enable().then((r) => {
              changes.value++;
              if (r === 'error') setFailed(true);
              else setHidden(true);
            });
          }}
        >
          {t('notify.push.enable')}
        </button>
        <button
          type="button"
          class="nbtn ghost"
          onClick={() => {
            remindLater(Date.now());
            setHidden(true);
          }}
        >
          {t('notify.push.later')}
        </button>
      </div>
    </div>
  );
}

/** The on/off switch in the screen's footer, where push can work at all. */
export function PushSwitch({ api }: { api: PushApi }) {
  const env = api.env();
  const usable = pushSupported(env) && env.permission !== 'denied';
  const [on, setOn] = useState<boolean | null>(null);
  const changed = changes.value;
  useEffect(() => {
    if (usable) void api.isOn().then(setOn);
  }, [api, usable, changed]);
  if (!usable) return null;

  const toggle = async () => {
    if (on) await api.disable();
    else await api.enable();
    changes.value++;
  };
  return (
    <div class="pushswitch">
      <span id="pushswitch-label">{t('notify.push.switch')}</span>
      <button
        type="button"
        class={on ? 'sw on' : 'sw'}
        role="switch"
        aria-checked={on === true}
        aria-labelledby="pushswitch-label"
        disabled={on === null}
        onClick={() => void toggle()}
      />
    </div>
  );
}
