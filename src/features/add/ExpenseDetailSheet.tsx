import { Trash2 } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import { CoupleError } from '../../data/couple';
import type { ExpensePatch } from '../../data/expenses';
import type { Store } from '../../data/store';
import { authorOf } from '../../shared/couple';
import { t, type StringKey } from '../../shared/i18n/t';
import type { Expense } from '../../shared/schemas';
import { ExpenseForm } from './ExpenseForm';

type Props = {
  store: Store;
  expense: Expense;
  repo: {
    update: (id: string, patch: ExpensePatch) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
    restore: (id: string) => Promise<unknown>;
  };
  onDone: () => void;
};

/** Tap any row → edit it, or delete it with a confirmation and 6 s to undo (spec §4.4).
 * In couple mode either partner may edit a shared expense (plan D7); only its
 * author may move it to Envies, and a refusal is shown here. */
export function ExpenseDetailSheet({ store, expense, repo, onDone }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) yes.current?.focus();
  }, [confirming]);

  const remove = async () => {
    await repo.remove(expense.id);
    onDone();
    showToast({
      text: t('detail.deleted'),
      action: { label: t('action.undo'), run: () => void repo.restore(expense.id) },
    });
  };

  const profile = store.profile.value;
  const author = profile && authorOf(expense, profile, store.household.value);

  return (
    <ExpenseForm
      store={store}
      initial={expense}
      onSubmit={async (fields) => {
        setError(null);
        try {
          await repo.update(expense.id, fields);
        } catch (err) {
          if (err instanceof CoupleError) setError(err.key);
          throw err;
        }
        onDone();
        showToast({ text: t('detail.saved') });
      }}
    >
      {error && (
        <p class="field-error" role="alert">
          {t(error)}
        </p>
      )}
      {author && <p class="author-line">{t('couple.author', { name: author })}</p>}
      {confirming ? (
        <div class="confirm" role="group" aria-label={t('detail.confirm')}>
          <p>{t('detail.confirm')}</p>
          <div class="confirm__actions">
            <button type="button" class="confirm__no" onClick={() => setConfirming(false)}>
              {t('detail.no')}
            </button>
            <button ref={yes} type="button" class="confirm__yes" onClick={() => void remove()}>
              {t('detail.yes')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" class="danger-link" onClick={() => setConfirming(true)}>
          <Trash2 size={18} aria-hidden="true" />
          {t('action.delete')}
        </button>
      )}
    </ExpenseForm>
  );
}
