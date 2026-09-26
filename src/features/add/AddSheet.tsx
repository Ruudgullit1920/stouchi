import { useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import type { Store } from '../../data/store';
import { t } from '../../shared/i18n/t';
import type { NewExpense } from '../../shared/schemas';
import { ExpenseForm } from './ExpenseForm';

type Props = {
  store: Store;
  repo: { create: (e: NewExpense) => Promise<unknown> };
  onDone: () => void;
};

/** Saisie manuelle (spec §4.2). The id is made when the sheet opens, so a
 * double tap or a retry can only ever write this one expense. */
export function AddSheet({ store, repo, onDone }: Props) {
  const [id] = useState(() => crypto.randomUUID());
  return (
    <ExpenseForm
      store={store}
      onSubmit={async (fields) => {
        const userId = store.userId.value;
        if (!userId) throw new Error('no user');
        await repo.create({
          id,
          user_id: userId,
          household_id: null,
          source: 'manual',
          bill_id: null,
          ...fields,
        });
        onDone();
        showToast({ text: t('add.saved') });
      }}
    />
  );
}
