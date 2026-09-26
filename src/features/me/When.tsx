import { nextPayday, type ISODate, type Payday } from '../../shared/dates';
import { shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import type { Profile } from '../../shared/schemas';

export type When = 'now' | 'next';

/** "Dès ce mois / Au <next payday>" for a salary or split change (spec §4.6). */
export function WhenSwitch({
  value,
  onChange,
  today,
  payday,
}: {
  value: When;
  onChange: (w: When) => void;
  today: ISODate;
  payday: Payday;
}) {
  const opt = (w: When, label: string) => (
    <button type="button" aria-pressed={value === w} onClick={() => onChange(w)}>
      {label}
    </button>
  );
  return (
    <div class="seg2 when">
      {opt('now', t('me.when.now'))}
      {opt('next', t('me.when.next', { date: shortDate(nextPayday(today, payday)) }))}
    </div>
  );
}

/** A patch changes something only when one of its columns differs from the row
 * (a missing next_* column and null are the same). */
export const changes = (p: Profile, patch: Partial<Profile>): boolean =>
  (Object.keys(patch) as (keyof Profile)[]).some((k) => (patch[k] ?? null) !== (p[k] ?? null));
