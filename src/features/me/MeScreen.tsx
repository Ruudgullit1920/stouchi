import {
  Bell,
  Calendar,
  ChartPie,
  ChevronRight,
  Download,
  EyeOff,
  LogOut,
  Receipt,
  Users,
  Wallet,
} from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ScreenProps } from '../../app/Shell';
import { back, navigate, route } from '../../app/router';
import { ChatHost } from '../../app/ChatHost';
import { closeSheet, openSheet } from '../../app/ui';
import { Button } from '../../design/components/Button';
import { coupleActions, deleteAccount, exportRows, pushApi, signOut, writeMine } from '../../data/app';
import type { Row } from '../../data/localdb';
import { billsDueTotal } from '../../shared/bills';
import { nextPayday, payPeriod, periodsSince, todayTunis } from '../../shared/dates';
import { initials, shortDate } from '../../shared/format';
import { goalView } from '../../shared/goal';
import { t } from '../../shared/i18n/t';
import { formatTnd } from '../../shared/money';
import { activeGoal } from '../../shared/payday';
import { currentPlan, pendingPlan } from '../../shared/plan';
import { sameSplit, splitText } from '../../shared/split';
import { HIDDEN, hideAmounts, toggleHideAmounts } from '../budget/hideAmounts';
import { PaydaySheet } from './PaydaySheet';
import { ProfileSheet } from './ProfileSheet';
import { SalarySheet } from './SalarySheet';
import { SettingRow, ToggleRow } from './SettingRow';
import { SplitScreen } from './SplitScreen';
import { BillsScreen } from './BillsScreen';
import { CoupleScreen } from './CoupleScreen';
import { DeleteSheet } from './DeleteSheet';
import { downloadCsv, ExportSheet } from './ExportSheet';
import { NotifSettings } from './NotifSettings';
import './me.css';

const writeProfile = (table: 'profiles', row: Row) => writeMine(table, row);
const writeBill = (table: 'bills', row: Row) => writeMine(table, row);
const writeReminder = (table: 'reminders', row: Row) => writeMine(table, row);
const openChat = () => openSheet(t('chat.title'), <ChatHost />, 'sheet--chat');

/** Moi (spec §3): the profile, the plan, Aam Salah's reminders and privacy.
 * Unsent writes are never lost by signing out, but the user is told first (spec §8.3). */
export function MeScreen({ store }: ScreenProps) {
  const [confirming, setConfirming] = useState(false);
  const confirm = useRef<HTMLDivElement>(null);
  const push = useMemo(pushApi, []);
  /* not memoised: the device's data may open after Moi does */
  const couple = coupleActions();
  useEffect(() => {
    if (confirming) confirm.current?.querySelector('button')?.focus();
  }, [confirming]);
  const { pending, failed } = store.sync.value;
  const p = store.profile.value;
  if (!p) return null;
  const sub = route.value.params.sub;
  if (sub === 'split') return <SplitScreen store={store} write={writeProfile} onBack={back} />;
  if (sub === 'bills') return <BillsScreen store={store} write={writeBill} onBack={back} />;
  if (sub === 'notifications')
    return <NotifSettings store={store} push={push} write={writeReminder} onAsk={openChat} onBack={back} />;
  if (sub === 'couple') return <CoupleScreen store={store} api={couple} onBack={back} />;

  const hidden = hideAmounts.value;
  const money = (mil: number, unit = true) => (hidden ? HIDDEN : formatTnd(mil, { unit }));
  const today = todayTunis();
  const plan = currentPlan(p);
  const next = pendingPlan(p);
  const salaryNext = next && next.salary_mil !== plan.salary_mil ? next : null;
  const splitNext = next && !sameSplit(next.split, plan.split) ? next : null;

  const goal = activeGoal(store.goals.value);
  const saved = goal ? goalView(goal, store.savingsMoves.value, 0, today).saved : 0;
  const tracked = periodsSince(p.onboarded_at?.slice(0, 10) ?? today, today, p.payday);
  const noted = store.expenses.value.filter((e) => e.deleted_at === null).length;
  const bills = store.bills.value.filter((b) => b.active);
  const reserved = billsDueTotal(bills, payPeriod(today, p.payday));
  const household = store.household.value;
  const status = household?.status ?? 'solo';
  const reminders = store.reminders.value.filter((r) => r.done_at === null && r.deleted_at === null).length;

  const editProfile = () =>
    openSheet(t('me.profile.title'), <ProfileSheet store={store} write={writeProfile} onDone={closeSheet} />);
  const editSalary = () =>
    openSheet(t('me.salary'), <SalarySheet store={store} write={writeProfile} onDone={closeSheet} />);
  const openExport = () =>
    openSheet(
      t('me.export'),
      <ExportSheet store={store} fetchRows={exportRows} download={downloadCsv} onDone={closeSheet} />,
    );
  const openDelete = () =>
    openSheet(
      t('me.delete'),
      <DeleteSheet store={store} remove={deleteAccount} onExport={openExport} onDeleted={leave} />,
    );
  const editPayday = () =>
    openSheet(t('me.payday'), <PaydaySheet store={store} write={writeProfile} onDone={closeSheet} />);

  return (
    <div class="me">
      <header class="top">
        <h1>{t('nav.me')}</h1>
      </header>

      <button type="button" class="me-card" onClick={editProfile}>
        <span class="avatar" aria-hidden="true">
          {initials(p.first_name) || '?'}
        </span>
        <span class="tx">
          <b>{p.first_name}</b>
          <small>{store.email.value}</small>
        </span>
        <ChevronRight class="chev" aria-hidden="true" />
      </button>
      <div class="me-stats" data-testid="me-stats">
        <div>
          <b class="num">{tracked}</b>
          <span>{t(tracked > 1 ? 'me.stats.months' : 'me.stats.month')}</span>
        </div>
        <div>
          <b class="num">{money(saved, false)}</b>
          <span>{t('me.stats.saved')}</span>
        </div>
        <div>
          <b class="num">{noted}</b>
          <span>{t(noted > 1 ? 'me.stats.expenses' : 'me.stats.expense')}</span>
        </div>
      </div>

      <div class="sec">
        <h2>{t('me.plan')}</h2>
      </div>
      <div class="list set">
        <SettingRow
          icon={Wallet}
          tone="save"
          title={t('me.salary')}
          sub={
            salaryNext
              ? t('me.pending', { value: money(salaryNext.salary_mil), date: shortDate(salaryNext.from) })
              : t('me.salary.sub')
          }
          pending={Boolean(salaryNext)}
          value={money(plan.salary_mil)}
          onClick={editSalary}
        />
        <SettingRow
          icon={ChartPie}
          tone="need"
          title={t('me.split')}
          sub={
            splitNext
              ? t('me.pending', { value: splitText(splitNext.split), date: shortDate(splitNext.from) })
              : t('me.split.sub')
          }
          pending={Boolean(splitNext)}
          value={splitText(plan.split)}
          onClick={() => navigate('#/me/split')}
        />
        <SettingRow
          icon={Receipt}
          tone="acc"
          title={t('me.bills')}
          sub={bills.length ? t('me.bills.sub', { amount: money(reserved) }) : t('me.bills.none')}
          value={String(bills.length)}
          onClick={() => navigate('#/me/bills')}
        />
        <SettingRow
          icon={Calendar}
          tone="want"
          title={t('me.payday')}
          sub={t('me.payday.sub', { date: shortDate(nextPayday(today, p.payday)) })}
          value={p.payday === 0 ? t('me.payday.end') : t('me.payday.day', { day: paydayDay(p.payday) })}
          onClick={editPayday}
        />
      </div>

      <div class="sec">
        <h2>{t('me.aam')}</h2>
      </div>
      <div class="list set">
        <SettingRow
          icon={Bell}
          tone="acc"
          title={t('me.notifications')}
          sub={
            reminders === 0
              ? t('me.reminders.none')
              : t(reminders > 1 ? 'me.reminders.many' : 'me.reminders.one', { n: reminders })
          }
          onClick={() => navigate('#/me/notifications')}
        />
      </div>

      <div class="sec">
        <h2>{t('me.privacy')}</h2>
      </div>
      <div class="list set">
        <ToggleRow
          icon={EyeOff}
          title={t('me.hide')}
          sub={t('me.hide.sub')}
          on={hidden}
          onToggle={toggleHideAmounts}
        />
        <SettingRow icon={Download} title={t('me.export')} sub={t('me.export.sub')} onClick={openExport} />
      </div>

      <div class="sec">
        <h2>{t('me.account')}</h2>
      </div>
      <div class="list set">
        <SettingRow
          icon={Users}
          title={t('couple.title')}
          sub={
            household?.status === 'on'
              ? t('couple.row.with', { name: household.partner.first_name })
              : t('couple.row.sub')
          }
          value={t(
            status === 'on'
              ? 'couple.row.on'
              : status === 'pending'
                ? 'couple.row.pending'
                : 'couple.row.off',
          )}
          onClick={() => navigate('#/me/couple')}
        />
      </div>

      {confirming ? (
        <div ref={confirm} class="confirm-card">
          <p role="alert">{t('me.signOut.pending')}</p>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            {t('me.signOut.cancel')}
          </Button>
          <Button onClick={() => void signOut()}>{t('me.signOut.confirm')}</Button>
        </div>
      ) : (
        <button
          type="button"
          class="logout"
          onClick={() => (pending + failed.length > 0 ? setConfirming(true) : void signOut())}
        >
          <LogOut aria-hidden="true" />
          {t('me.signOut')}
        </button>
      )}
      <p class="me-foot">
        {t('me.foot')}
        <br />
        <button type="button" onClick={openDelete}>
          {t('me.delete')}
        </button>
      </p>
    </div>
  );
}

/** After the account is gone: start over from Intro, with nothing of theirs left. */
const leave = () => {
  location.hash = '#/intro';
  location.reload();
};

const paydayDay = (d: number): string => (d === 1 ? t('setup.payday.first') : String(d));
