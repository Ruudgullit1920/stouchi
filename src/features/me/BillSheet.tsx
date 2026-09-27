import { Trash2 } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import { Icon3D, i3d } from '../../design/i3d';
import type { Row } from '../../data/localdb';
import type { Store } from '../../data/store';
import { todayTunis } from '../../shared/dates';
import { t } from '../../shared/i18n/t';
import { MAX_MIL, MIL_PER_TND, formatMoney } from '../../shared/money';
import type { Bill } from '../../shared/schemas';
import { AmountInput } from '../onboarding/AmountInput';
import { BILL_PRESETS, billLabel } from '../onboarding/draft';

const LABEL_MAX = 60;
const ARM_MS = 3_000;
export const FREQUENCIES: Bill['frequency'][] = ['monthly', 'bimonthly', 'quarterly', 'yearly'];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export const dayText = (d: number): string => (d === 1 ? t('setup.payday.first') : String(d));

type Props = {
  store: Store;
  /** the bill to edit; without it the sheet adds one */
  bill?: Bill;
  write: (table: 'bills', row: Row) => Promise<void>;
  onDone: () => void;
};

/** Add or edit a fixed bill; "Supprimer" only deactivates it (no delete policy). */
export function BillSheet({ store, bill, write, onDone }: Props) {
  const [label, setLabel] = useState(bill?.label ?? '');
  const [amount, setAmount] = useState(bill?.amount_mil ?? 0);
  const [frequency, setFrequency] = useState<Bill['frequency']>(bill?.frequency ?? 'monthly');
  const [day, setDay] = useState(bill?.day ?? 5);
  const [error, setError] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const taken = new Set(store.bills.value.filter((b) => b.active).map((b) => b.label.toLowerCase()));
  const suggestions = bill ? [] : BILL_PRESETS.filter((p) => !taken.has(t(billLabel(p.key)).toLowerCase()));

  const save = async () => {
    const clean = label.trim();
    if (!clean) {
      setError(true);
      return;
    }
    const fields = { label: clean, amount_mil: amount, frequency, day };
    if (bill) {
      await write('bills', { ...bill, ...fields });
    } else {
      const userId = store.userId.value;
      if (!userId) return;
      await write('bills', {
        id: crypto.randomUUID(),
        user_id: userId,
        household_id: null,
        ...fields,
        starts_on: todayTunis(),
        active: true,
      });
    }
    onDone();
    showToast({ text: t(bill ? 'me.bill.saved' : 'me.bill.added', { label: clean }) });
  };

  const remove = async () => {
    if (!bill) return;
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), ARM_MS);
      return;
    }
    clearTimeout(timer.current);
    await write('bills', { ...bill, active: false });
    onDone();
    showToast({
      text: t('me.bill.deleted', { label: bill.label }),
      action: { label: t('action.undo'), run: () => void write('bills', { ...bill, active: true }) },
    });
  };

  const money = formatMoney(amount);
  return (
    <div class="me-sheet bill-sheet">
      {suggestions.length > 0 && (
        <div class="sugchips">
          {suggestions.map((p) => {
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setLabel(t(billLabel(p.key)));
                  setAmount(p.tnd * MIL_PER_TND);
                  setError(false);
                }}
              >
                <span class="ic d3" aria-hidden="true">
                  <Icon3D src={i3d(p.icon)} />
                </span>
                {t(billLabel(p.key))}
              </button>
            );
          })}
        </div>
      )}
      <label class="field">
        <span>{t('me.bill.name')}</span>
        <input
          class="tin"
          value={label}
          maxLength={LABEL_MAX}
          placeholder={t('me.bill.namePh')}
          aria-invalid={error}
          onInput={(e) => {
            setLabel(e.currentTarget.value);
            setError(false);
          }}
        />
      </label>
      {error && (
        <p class="field-error" role="alert">
          {t('me.bill.nameError')}
        </p>
      )}
      {/* the input carries the same words as its name */}
      <p class="flabel" aria-hidden="true">
        {t('me.bill.amount')}
      </p>
      <AmountInput
        label={t('me.bill.amount')}
        value={amount}
        onChange={setAmount}
        digits={6}
        unit={t('unit.tnd')}
      />
      <p class="flabel">{t('me.bill.freq')}</p>
      <div class="seg2 four">
        {FREQUENCIES.map((f) => (
          <button key={f} type="button" aria-pressed={frequency === f} onClick={() => setFrequency(f)}>
            {t(`me.bill.freq.${f}`)}
          </button>
        ))}
      </div>
      <p class="flabel">{t('me.bill.day')}</p>
      <div class="daystrip">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            class={day === d ? 'on' : undefined}
            aria-pressed={day === d}
            onClick={() => setDay(d)}
          >
            {d}
          </button>
        ))}
      </div>
      <p class="hint">
        {amount === 0
          ? t('me.bill.hint.none')
          : frequency === 'monthly'
            ? t('me.bill.hint.monthly', { amount: money, day: dayText(day) })
            : t('me.bill.hint.other', { amount: money })}
      </p>
      <button
        type="button"
        class="cta"
        disabled={amount <= 0 || amount > MAX_MIL}
        onClick={() => void save()}
      >
        {t(bill ? 'me.save' : 'me.bill.add')}
      </button>
      {bill && (
        <button type="button" class={armed ? 'cta red' : 'btn2 red'} onClick={() => void remove()}>
          <Trash2 size={18} aria-hidden="true" />
          {t(armed ? 'me.bill.confirm' : 'me.bill.delete')}
        </button>
      )}
    </div>
  );
}
