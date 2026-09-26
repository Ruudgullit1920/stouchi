/* Small formatting helpers shared by the receipts and the confirm cards. */
import type { Pot } from '../../shared/categories';
import { addDays, todayTunis, type ISODate } from '../../shared/dates';
import { shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { formatTnd, milFromTnd, type Mil } from '../../shared/money';

/** The model's TND amount → millimes (0 when it isn't one). */
export const milOf = (x: unknown): Mil => (typeof x === 'number' ? (milFromTnd(x) ?? 0) : 0);

/** "12,5", "−12,5", "+12,5": the prototype shows receipt amounts without the unit. */
export const amount = (mil: Mil, sign = false) => formatTnd(mil, { unit: false, sign });

export const potOf = (name: unknown): Pot => (name === 'besoins' ? 'needs' : 'wants');
export const POT_COLOR: Record<Pot, string> = { needs: 'var(--need)', wants: 'var(--want)' };
export const potName = (name: unknown) => t(name === 'besoins' ? 'pot.needs' : 'pot.wants');

/** "Aujourd'hui", "Hier", else "15 sept." */
export function dayName(d: ISODate): string {
  const today = todayTunis();
  if (d === today) return t('chat.day.today');
  if (d === addDays(today, -1)) return t('chat.day.yesterday');
  return shortDate(d);
}
