import {
  ChevronLeft,
  Eye,
  Hourglass,
  House,
  Link2,
  Lock,
  Plus,
  Send,
  Target,
  Unlink,
  UserPlus,
  UserRound,
} from 'lucide-preact';
import { useState } from 'preact/hooks';
import { closeSheet, openSheet, showToast } from '../../app/ui';
import { CoupleError, type CoupleApi } from '../../data/couple';
import type { Store } from '../../data/store';
import { initials } from '../../shared/format';
import { t, type StringKey } from '../../shared/i18n/t';
import { activeGoal } from '../../shared/payday';
import { InviteSheet } from './InviteSheet';
import { JoinSheet } from './JoinSheet';
import { UnshareSheet } from './UnshareSheet';

export type CoupleActions = Pick<CoupleApi, 'invite' | 'cancel' | 'join' | 'leave'>;

type Props = {
  store: Store;
  /** null before the device has opened its data */
  api: CoupleActions | null;
  onBack: () => void;
};

const HOUR = 3_600_000;

/** Partager à deux (#/me/couple, prototype `renderCouple`): off, pending, on.
 * Each action needs the server, so offline they are disabled. The split is
 * always "selon les salaires" (plan D3). */
export function CoupleScreen({ store, api, onBack }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const p = store.profile.value;
  if (!p) return null;
  const state = store.household.value;
  const online = store.sync.value.online && api !== null;
  const me = initials(p.first_name) || '?';

  const run = async (action: (a: CoupleActions) => Promise<void>) => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      await action(api);
    } catch (err) {
      setError(err instanceof CoupleError ? err.key : 'couple.err.generic');
    } finally {
      setBusy(false);
    }
  };
  const showInvite = (code: string) =>
    openSheet(
      t('couple.invite'),
      <InviteSheet
        code={code}
        onDone={() => {
          closeSheet();
          showToast({ text: t('couple.sent.toast') });
        }}
      />,
    );
  const invite = () => run(async (a) => showInvite((await a.invite()).code));
  const cancel = () =>
    run(async (a) => {
      await a.cancel();
      showToast({ text: t('couple.cancelled') });
    });
  const join = () =>
    api &&
    openSheet(
      t('couple.join.title'),
      <JoinSheet
        join={api.join}
        onJoined={() => {
          closeSheet();
          showToast({ text: t('couple.on.title') });
        }}
      />,
    );
  const unshare = (name: string) =>
    api &&
    openSheet(
      t('couple.stop'),
      <UnshareSheet
        name={name}
        leave={api.leave}
        onDone={() => {
          closeSheet();
          showToast({ text: t('couple.stopped') });
        }}
        onCancel={closeSheet}
      />,
    );

  const off = !online || busy;
  const foot = (
    <>
      {error && (
        <p class="field-error" role="alert">
          {t(error)}
        </p>
      )}
      {!online && <p class="hint center">{t('couple.offline')}</p>}
    </>
  );

  let body;
  if (state?.status === 'on') {
    const name = state.partner.first_name;
    body = (
      <>
        <div class="duo" aria-hidden="true">
          <span class="av a">{me}</span>
          <span class="lnk">
            <Link2 />
          </span>
          <span class="av b">{initials(name) || '?'}</span>
        </div>
        <h2 class="ctitle">{t('couple.on.title')}</h2>
        <p class="lead center">{t('couple.on.lead', { name })}</p>
        <div class="sec">
          <h2>{t('couple.who')}</h2>
        </div>
        <div class="card">
          <b class="who">{t('couple.who.rule')}</b>
          <p class="hint">{t('couple.who.hint')}</p>
        </div>
        <button type="button" class="btn2 red stop" disabled={off} onClick={() => unshare(name)}>
          <Unlink aria-hidden="true" />
          {t('couple.stop')}
        </button>
        {foot}
        <p class="hint center">{t('couple.aam', { name })}</p>
      </>
    );
  } else {
    const pending = state?.status === 'pending' ? state : null;
    const goal = activeGoal(store.goals.value);
    const hours = pending?.invite
      ? Math.max(1, Math.ceil((Date.parse(pending.invite.expires_at) - Date.now()) / HOUR))
      : 0;
    body = (
      <>
        <div class={pending ? 'duo wait' : 'duo'} aria-hidden="true">
          <span class="av a">{me}</span>
          <span class="lnk">{pending ? <Hourglass /> : <Plus />}</span>
          <span class="av b">
            <UserRound />
          </span>
        </div>
        {pending ? (
          <div class="pendcard">
            <div class="ph">
              <i class="dot" aria-hidden="true" />
              {t(pending.invite ? 'couple.pending.title' : 'couple.pending.expiredTitle')}
            </div>
            {pending.invite ? (
              <p class="hint">
                {t('couple.pending.code')} <b class="num">{pending.invite.code}</b> ·{' '}
                {t('couple.pending.expires', { hours })} {t('couple.pending.then')}
              </p>
            ) : (
              <p class="hint">{t('couple.pending.expired')}</p>
            )}
            <div class="grid2">
              {pending.invite ? (
                <button
                  type="button"
                  class="btn2"
                  disabled={off}
                  onClick={() => pending.invite && showInvite(pending.invite.code)}
                >
                  <Send aria-hidden="true" />
                  {t('couple.resend')}
                </button>
              ) : (
                <button type="button" class="btn2" disabled={off} onClick={() => void invite()}>
                  <Send aria-hidden="true" />
                  {t('couple.newCode')}
                </button>
              )}
              <button type="button" class="btn2 red" disabled={off} onClick={() => void cancel()}>
                {t('couple.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 class="ctitle">{t('couple.off.title')}</h2>
            <p class="lead center">{t('couple.off.lead')}</p>
          </>
        )}
        <div class="card benefits">
          <Benefit
            icon={House}
            tone="need"
            title="couple.benefit.needs"
            sub={t('couple.benefit.needs.sub')}
          />
          <Benefit icon={Lock} tone="want" title="couple.benefit.wants" sub={t('couple.benefit.wants.sub')} />
          <Benefit
            icon={Target}
            tone="save"
            title="couple.benefit.goal"
            sub={goal ? t('couple.benefit.goal.named', { goal: goal.name }) : t('couple.benefit.goal.sub')}
          />
        </div>
        <div class="sharecols">
          <div>
            <h3>
              <Eye aria-hidden="true" />
              {t('couple.shared')}
            </h3>
            <ul>
              <li>{t('couple.shared.needs')}</li>
              <li>{t('couple.shared.bills')}</li>
              <li>{t('couple.shared.goal')}</li>
            </ul>
          </div>
          <div>
            <h3>
              <Lock aria-hidden="true" />
              {t('couple.private')}
            </h3>
            <ul>
              <li>{t('couple.private.wants')}</li>
              <li>{t('couple.private.salary')}</li>
              <li>{t('couple.private.chats')}</li>
            </ul>
          </div>
        </div>
        {!pending && (
          <>
            <button type="button" class="cta" disabled={off} onClick={() => void invite()}>
              <UserPlus aria-hidden="true" />
              {t('couple.invite')}
            </button>
            <button type="button" class="btn2" disabled={off} onClick={join}>
              {t('couple.join')}
            </button>
          </>
        )}
        {foot}
        <p class="hint center">{t('couple.foot')}</p>
      </>
    );
  }

  return (
    <div class="me couple">
      <header class="top">
        <button type="button" class="icon-btn line" aria-label={t('action.back')} onClick={onBack}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <h1 class="set-h1">{t('couple.title')}</h1>
        <span class="set-save" aria-hidden="true" />
      </header>
      {body}
    </div>
  );
}

function Benefit({
  icon: Icon,
  tone,
  title,
  sub,
}: {
  icon: typeof House;
  tone: 'need' | 'want' | 'save';
  title: StringKey;
  sub: string;
}) {
  return (
    <div class="benefit">
      <span class={`ic tone-${tone}`} aria-hidden="true">
        <Icon />
      </span>
      <div>
        <b>{t(title)}</b>
        <p>{sub}</p>
      </div>
    </div>
  );
}
