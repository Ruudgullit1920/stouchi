import { t } from '../shared/i18n/t';
import { sheet } from './ui';
import { applyUpdate, updateReady } from './update';

/** "Nouvelle version — Recharger" (spec §8.3). It stays until tapped, and hides
 * while a sheet is open so the reload never drops what is being typed. */
export function UpdateToast() {
  if (!updateReady.value || sheet.value) return null;
  return (
    <div class="toast-region toast-region--update" role="status">
      <div class="toast">
        <span>{t('update.ready')}</span>
        <button type="button" class="toast__action" onClick={applyUpdate}>
          {t('update.reload')}
        </button>
      </div>
    </div>
  );
}
