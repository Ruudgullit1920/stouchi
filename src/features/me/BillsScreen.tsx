import { ChevronLeft, ChevronRight, Plus, Receipt } from 'lucide-preact';
import { closeSheet, openSheet } from '../../app/ui';
import { Icon3D, billI3d } from '../../design/i3d';
import type { Row } from '../../data/localdb';
import { factsInput, type Store } from '../../data/store';
import { billStatus, billsDueTotal, billsMeter, type BillStatus } from '../../shared/bills';
import { todayTunis } from '../../shared/dates';
import { computeFacts } from '../../shared/facts';
import { shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { formatMoney } from '../../shared/money';
import type { Bill } from '../../shared/schemas';
import { HIDDEN, hideAmounts } from '../budget/hideAmounts';
import { BillSheet, dayText } from './BillSheet';

const SOON_DAYS = 5;

type Props = {
  store: Store;
  write: (table: 'bills', row: Row) => Promise<void>;
  onBack: () => void;
};

/** Factures fixes (#/me/bills): what the bills put aside in Besoins, and each bill. */
export function BillsScreen({ store, write, onBack }: Props) {
  const p = store.profile.value;
  if (!p) return null;
  const today = todayTunis();
  const facts = computeFacts(factsInput(store, p, today));
  const bills = store.bills.value.filter((b) => b.active).sort((a, b) => a.day - b.day);
  const reserved = billsDueTotal(bills, facts.period);
  const needs = facts.pots.needs.budget;
  const meter = billsMeter(reserved, needs);
  const money = (m: number, unit = true) => (hideAmounts.value ? HIDDEN : formatMoney(m, { unit }));

  const edit = (bill?: Bill) =>
    openSheet(
      t(bill ? 'me.bill.edit' : 'me.bill.new'),
      <BillSheet store={store} bill={bill} write={write} onDone={closeSheet} />,
    );

  return (
    <div class="me">
      <header class="top">
        <button type="button" class="icon-btn" aria-label={t('action.back')} onClick={onBack}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <h1 class="set-h1">{t('me.bills')}</h1>
        <span class="set-save" aria-hidden="true" />
      </header>

      {bills.length === 0 ? (
        <>
          <div class="empty-st">
            <div class="big-ic tone-acc" aria-hidden="true">
              <Receipt />
            </div>
            <b>{t('me.bills.empty.title')}</b>
            <p>{t('me.bills.empty.body')}</p>
          </div>
          <button type="button" class="cta" onClick={() => edit()}>
            <Plus size={18} aria-hidden="true" />
            {t('me.bills.add')}
          </button>
        </>
      ) : (
        <>
          <div class="card bsum">
            <div class="label">{t('me.bills.reserved')}</div>
            <div class="big num">
              {money(reserved, false)}
              <span class="unit">{t('unit.money')}</span>
            </div>
            <div class={meter.level === 'ok' ? 'meter' : 'meter warn'} data-testid="bills-meter">
              <div class="mh">
                <span>{t('me.bills.inNeeds')}</span>
                <span class="num">{meter.pct} %</span>
              </div>
              <div class="mt" aria-hidden="true">
                <i style={{ width: `${Math.min(meter.pct, 100)}%` }} />
              </div>
              <p>
                {meter.level === 'over'
                  ? t('me.bills.over', { over: money(reserved - needs) })
                  : meter.level === 'warn'
                    ? t('me.bills.warn', { pct: meter.pct, left: money(needs - reserved) })
                    : t('me.bills.ok', { left: money(needs - reserved) })}
              </p>
            </div>
          </div>

          <div class="sec">
            <h2>{t('me.bills.thisMonth')}</h2>
            <span class="meta">{t('me.bills.tapToEdit')}</span>
          </div>
          <div class="list set">
            {bills.map((b) => {
              const status = billStatus(
                b,
                store.billPayments.value,
                store.expenses.value,
                facts.period,
                today,
              );
              return (
                <button key={b.id} type="button" class="srow bill-row" onClick={() => edit(b)}>
                  <span class="ic d3" aria-hidden="true">
                    <Icon3D src={billI3d(b.label)} />
                  </span>
                  <span class="tx">
                    <span class="t">{b.label}</span>
                    <span class="s">
                      {t('me.bill.sub', { day: dayText(b.day), freq: t(`me.bill.freq.${b.frequency}`) })}
                    </span>
                  </span>
                  <span class="a">
                    <b class="num">{money(b.amount_mil, false)}</b>
                    <StatusChip status={status} />
                  </span>
                  <ChevronRight class="chev" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <button type="button" class="addrow" onClick={() => edit()}>
            <Plus size={18} aria-hidden="true" />
            {t('me.bills.add')}
          </button>
          <p class="hint center">{t('me.bills.halfHint')}</p>
        </>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: BillStatus }) {
  if (status.kind === 'paid') return <span class="st ok">{t('me.bill.paid')}</span>;
  if (status.kind === 'none') return <span class="st later">{t('me.bill.notThisMonth')}</span>;
  const { days, due } = status;
  if (days < 0) return <span class="st soon">{t('me.bill.late')}</span>;
  if (days > SOON_DAYS) return <span class="st later">{shortDate(due)}</span>;
  return (
    <span class="st soon">
      {days === 0
        ? t('me.bill.today')
        : days === 1
          ? t('me.bill.tomorrow')
          : t('me.bill.inDays', { n: days })}
    </span>
  );
}
