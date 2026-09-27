import { currencyOf } from '../currencies';
import { currentCurrency } from '../currentCurrency';
import fr from './fr.json';

export type StringKey = keyof typeof fr;

/** The French string for `key`, with {name} placeholders filled from `vars`.
 * {unit} ("€") and {code} ("EUR") come from the current currency unless `vars` gives them. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const text: string = fr[key];
  if (!text.includes('{')) return text;
  const c = currencyOf(currentCurrency());
  const all: Record<string, string | number> = { unit: c.suffix, code: c.code, ...vars };
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in all ? String(all[name]) : whole));
}
