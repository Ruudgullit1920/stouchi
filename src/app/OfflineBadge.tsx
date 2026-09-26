import { WifiOff } from 'lucide-preact';
import type { Store } from '../data/store';
import { t } from '../shared/i18n/t';

/** Writes keep working offline; this only says they are waiting (spec §8.3). */
export function OfflineBadge({ store }: { store: Store }) {
  const { online, pending } = store.sync.value;
  if (online) return null;
  return (
    <p class="offline-badge">
      <WifiOff size={14} aria-hidden="true" />
      {pending ? t('sync.offlinePending', { count: pending }) : t('sync.offline')}
    </p>
  );
}
