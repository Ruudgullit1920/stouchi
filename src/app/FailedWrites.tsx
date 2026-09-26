import type { Store } from '../data/store';
import { t } from '../shared/i18n/t';

type Props = { store: Store; onRetry: (key: string) => void; onDiscard: (key: string) => void };

/** A write the server refused stays on screen until the person decides:
 * a banner, not a toast, because a toast would vanish on its own (spec §8.3). */
export function FailedWrites({ store, onRetry, onDiscard }: Props) {
  const failed = store.sync.value.failed;
  if (!failed.length) return null;
  const label = typeof failed[0].row.label === 'string' && failed[0].row.label ? failed[0].row.label : '…';
  return (
    <div class="failed-writes" role="alert">
      <p>
        {failed.length === 1
          ? t('sync.failed.one', { label })
          : t('sync.failed.many', { count: failed.length })}
      </p>
      <div class="failed-writes__actions">
        <button
          type="button"
          class="failed-writes__btn"
          onClick={() => failed.forEach((f) => onRetry(f.key))}
        >
          {t('action.retry')}
        </button>
        <button
          type="button"
          class="failed-writes__btn"
          onClick={() => failed.forEach((f) => onDiscard(f.key))}
        >
          {t('action.delete')}
        </button>
      </div>
    </div>
  );
}
