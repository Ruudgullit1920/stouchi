import type { Store } from '../data/store';
import { t } from '../shared/i18n/t';
import { navigate } from './router';

/** The session expired: nothing is lost, writes wait on this device until the
 * same person logs in again (spec §8.3), and then they go out. */
export function SessionLost({ store }: { store: Store }) {
  if (!store.sync.value.authLost) return null;
  return (
    <div class="failed-writes" role="alert">
      <p>{t('sync.sessionLost')}</p>
      <div class="failed-writes__actions">
        <button type="button" class="failed-writes__btn" onClick={() => navigate('#/login')}>
          {t('sync.signIn')}
        </button>
      </div>
    </div>
  );
}
