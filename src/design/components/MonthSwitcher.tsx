import { ChevronLeft, ChevronRight } from 'lucide-preact';
import { t } from '../../shared/i18n/t';

type Props = { label: string; onPrev: () => void; onNext: () => void; canPrev: boolean; canNext: boolean };

/** ‹ Septembre › — steps through pay periods; the label is the screen's heading. */
export function MonthSwitcher({ label, onPrev, onNext, canPrev, canNext }: Props) {
  return (
    <div class="monthnav">
      <button type="button" aria-label={t('period.prev')} disabled={!canPrev} onClick={onPrev}>
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <h1 class="monthnav__label" aria-live="polite">
        {label}
      </h1>
      <button type="button" aria-label={t('period.next')} disabled={!canNext} onClick={onNext}>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
