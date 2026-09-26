import { t } from '../../shared/i18n/t';

/** Loading state (spec §8.3): shown instead of a spinner. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div class="skeleton" role="status" aria-busy="true" aria-label={t('state.loading')}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} class="skeleton__line" />
      ))}
    </div>
  );
}
