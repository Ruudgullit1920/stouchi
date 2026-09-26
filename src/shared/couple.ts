/* Couple mode on screen (plan D9): who logged a shared row. */
import type { CoupleStateT } from './schemas';

/** The first name to badge a row with: only shared rows, only while two share
 * the household. Private rows and solo mode get no badge. */
export function authorOf(
  row: { user_id: string; household_id: string | null },
  me: { user_id: string; first_name: string },
  couple: CoupleStateT | null,
): string | null {
  if (couple?.status !== 'on' || row.household_id === null) return null;
  return row.user_id === me.user_id ? me.first_name : couple.partner.first_name;
}
