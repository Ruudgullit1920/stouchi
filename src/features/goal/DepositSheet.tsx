import { Coins } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import { HIDDEN } from '../../design/components/Amount';
import type { Store } from '../../data/store';
import { payPeriod, todayTunis } from '../../shared/dates';
import { monthYear } from '../../shared/format';
import { depositGain, goalView } from '../../shared/goal';
import { t } from '../../shared/i18n/t';
import { MIL_PER_TND, formatMoney, splitSalary } from '../../shared/money';
import { planFor } from '../../shared/plan';
import type { Goal, NewSavingsMove } from '../../shared/schemas';
import { hideAmounts } from '../budget/hideAmounts';
import { AmountInput } from '../onboarding/AmountInput';

const QUICK = [50, 100, 200, 500];
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type Props = {
  store: Store;
  goal: Goal;
  write: (row: NewSavingsMove) => Promise<void>;
  /** false when the undo window has closed */
  undo: (id: string) => Promise<boolean>;
  onDone: () => void;
};

/** Verser: money already set aside goes to the goal; no pot moves (plan D4). */
export function DepositSheet({ store, goal, write, undo, onDone }: Props) {
  const [amount, setAmount] = useState(0);
  const [id] = useState(() => crypto.randomUUID());
  const profile = store.profile.value;
  const userId = store.userId.value;
  const today = todayTunis();
  const plan = profile && planFor(profile, payPeriod(today, profile.payday));
  const monthly = plan ? splitSalary(plan.salary_mil, plan.split).savings : 0;
  const { saved } = goalView(goal, store.savingsMoves.value, monthly, today);
  const gain = amount > 0 ? depositGain(goal, saved, amount, monthly, today) : null;
  const money = (m: number, unit = true) => (hideAmounts.value ? HIDDEN : formatMoney(m, { unit }));
  const name = lower(goal.name);

  const save = async () => {
    if (!userId || amount <= 0) return;
    await write({
      id,
      user_id: userId,
      goal_id: goal.id,
      amount_mil: amount,
      kind: 'deposit',
      from_pot: null,
      occurred_on: today,
    });
    onDone();
    showToast({
      text: t('goal.deposit.done', { amount: formatMoney(amount) }),
      action: { label: t('action.undo'), run: () => void undo(id) },
    });
  };

  return (
    <div class="deposit">
      <p class="hint">{t('goal.deposit.hint', { name })}</p>
      <AmountInput
        label={t('goal.deposit.amount')}
        value={amount}
        onChange={setAmount}
        unit={t('unit.tnd')}
      />
      <div class="qchips">
        {QUICK.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={amount === n * MIL_PER_TND}
            class={amount === n * MIL_PER_TND ? 'on' : undefined}
            onClick={() => setAmount(n * MIL_PER_TND)}
          >
            {formatMoney(n * MIL_PER_TND, { unit: false })}
          </button>
        ))}
      </div>
      {gain && (
        <p class="aamtip" aria-live="polite">
          <span class="sal" aria-hidden="true">
            S
          </span>
          <span>
            {gain.reached
              ? t('goal.deposit.reached', { name })
              : gain.months && gain.eta
                ? t('goal.deposit.afterSooner', {
                    after: money(gain.after, false),
                    target: money(goal.target_mil),
                    n: gain.months,
                    when: monthYear(gain.eta),
                  })
                : t('goal.deposit.after', {
                    after: money(gain.after, false),
                    target: money(goal.target_mil),
                  })}
          </span>
        </p>
      )}
      <button type="button" class="cta" disabled={amount <= 0} onClick={() => void save()}>
        <Coins size={18} aria-hidden="true" />
        {t('goal.verser')}
      </button>
    </div>
  );
}
