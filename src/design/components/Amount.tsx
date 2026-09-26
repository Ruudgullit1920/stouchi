import { t } from '../../shared/i18n/t';
import { formatTnd, type Mil } from '../../shared/money';

/** What stands in for an amount when the person hides amounts (the eye on Budget). */
export const HIDDEN = '•••';

type Props = { mil: Mil; sign?: boolean; class?: string };

/** A number and its unit (spec §5.2): tabular figures, unit smaller and raised. */
export function Amount({ mil, sign = false, class: extra = '' }: Props) {
  return (
    <span class={`amount num ${extra}`.trim()}>
      {formatTnd(mil, { unit: false, sign })}
      <span class="amount__unit">
        {' '}
        {t('unit.tnd')}
      </span>
    </span>
  );
}
