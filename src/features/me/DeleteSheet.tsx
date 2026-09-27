import { Download, TriangleAlert, X } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { Store } from '../../data/store';
import { todayTunis } from '../../shared/dates';
import { monthYear } from '../../shared/format';
import { goalView } from '../../shared/goal';
import { t } from '../../shared/i18n/t';
import { formatMoney } from '../../shared/money';
import { activeGoal } from '../../shared/payday';
import { HIDDEN, hideAmounts } from '../budget/hideAmounts';
import { HoldButton } from './HoldButton';

type Props = {
  store: Store;
  /** deletes the account on the server, then wipes this device */
  remove: () => Promise<void>;
  onExport: () => void;
  onDeleted: () => void;
};

/** Supprimer mon compte (plan D2, prototype `delete`): what goes, an export
 * first if wanted, and a 2 s hold. Offline it can't run; with unsent writes it
 * warns first, as sign-out does (Review Focus 5). */
export function DeleteSheet({ store, remove, onExport, onDeleted }: Props) {
  const { online, pending, failed } = store.sync.value;
  const [warned, setWarned] = useState(pending + failed.length === 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const p = store.profile.value;
  if (!p) return null;

  if (!warned)
    return (
      <div class="me-sheet">
        <div class="del-confirm">
          <div class="big-ic tone-danger" aria-hidden="true">
            <TriangleAlert />
          </div>
          <p role="alert">{t('me.delete.pending')}</p>
        </div>
        <button type="button" class="cta red" onClick={() => setWarned(true)}>
          {t('me.delete.continue')}
        </button>
      </div>
    );

  const today = todayTunis();
  const first = [
    p.onboarded_at ? todayTunis(new Date(p.onboarded_at)) : today,
    ...store.expenses.value.map((e) => e.spent_on),
  ].sort()[0];
  const goal = activeGoal(store.goals.value);
  const saved = goal ? goalView(goal, store.savingsMoves.value, 0, today).saved : 0;

  const go = async () => {
    setBusy(true);
    setError(false);
    try {
      await remove();
      onDeleted();
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <div class="me-sheet">
      <div class="del-confirm">
        <div class="big-ic tone-danger" aria-hidden="true">
          <TriangleAlert />
        </div>
        <h4>{t('me.delete.title')}</h4>
        <p>{t('me.delete.body')}</p>
        <ul class="gone">
          <li>
            <X aria-hidden="true" />
            {t('me.delete.expenses', { month: monthYear(first).toLowerCase() })}
          </li>
          <li>
            <X aria-hidden="true" />
            {goal
              ? t('me.delete.goal', { amount: hideAmounts.value ? HIDDEN : formatMoney(saved) })
              : t('me.delete.plan')}
          </li>
          <li>
            <X aria-hidden="true" />
            {t('me.delete.chats')}
          </li>
        </ul>
      </div>
      <button type="button" class="btn2" onClick={onExport}>
        <Download size={18} aria-hidden="true" />
        {t('me.delete.export')}
      </button>
      {error && (
        <p class="field-error" role="alert">
          {t('me.delete.error')}
        </p>
      )}
      <HoldButton
        label={t('me.delete.hold')}
        holdingLabel={t('me.delete.holding')}
        disabled={!online || busy}
        onHeld={() => void go()}
      />
      <p class="hint center">{online ? t('me.delete.holdHint') : t('me.delete.offline')}</p>
    </div>
  );
}
