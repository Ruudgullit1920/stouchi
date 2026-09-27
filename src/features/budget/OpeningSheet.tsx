import { useState } from 'preact/hooks';
import { closeSheet, openSheet, sheet, showToast } from '../../app/ui';
import type { Row } from '../../data/localdb';
import { factsInput, type Store } from '../../data/store';
import { nextPayday, todayTunis, type ISODate } from '../../shared/dates';
import { computeFacts, inOpeningPeriod, openingBudget } from '../../shared/facts';
import { shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { formatTnd } from '../../shared/money';
import type { Expense, Profile } from '../../shared/schemas';
import { AmountInput } from '../onboarding/AmountInput';

type Write = (table: 'profiles', row: Row) => Promise<void>;

/* « Plus tard » asks again on the next launch, not on every visit to Budget */
let askedThisLaunch = false;
export function resetOpeningAsk(): void {
  askedThisLaunch = false;
}

/** A new user, in the period they joined in, who has not said what was left in the account.
 * A user moved over from the old app (spec §9) has expenses dated before that day: never asked. */
export function asksOpening(profile: Profile, expenses: Expense[], today: ISODate): boolean {
  if (profile.opening_mil != null || !profile.onboarded_at || !inOpeningPeriod(profile, today)) return false;
  const joined = todayTunis(new Date(profile.onboarded_at));
  return !expenses.some((e) => e.user_id === profile.user_id && e.spent_on < joined);
}

/** Open the sheet once per launch while `asksOpening` holds and no other sheet is up. */
export function maybeAskOpening(store: Store, write: Write): void {
  const p = store.profile.value;
  if (askedThisLaunch || sheet.value || !p || !asksOpening(p, store.expenses.value, todayTunis())) return;
  askedThisLaunch = true;
  openSheet(t('opening.title'), <OpeningSheet store={store} write={write} onDone={closeSheet} />);
}

/** « Il te reste combien ? » — someone joining mid-period has already spent part of
 * that salary; this period runs on what is left instead (spec §4.6). */
export function OpeningSheet({ store, write, onDone }: { store: Store; write: Write; onDone: () => void }) {
  const [balance, setBalance] = useState(0);
  const p = store.profile.value;
  if (!p) return null;

  const today = todayTunis();
  const input = factsInput(store, p, today);
  const opening_mil = openingBudget(input, balance);
  const preview = balance > 0 ? computeFacts({ ...input, profile: { ...p, opening_mil } }) : null;

  const save = async () => {
    await write('profiles', { ...p, opening_mil });
    onDone();
    showToast({
      text: t('opening.saved', { amount: formatTnd(balance) }),
      action: { label: t('action.undo'), run: () => void write('profiles', p) },
    });
  };

  return (
    <div class="me-sheet opening">
      <p class="hint">{t('opening.why', { date: shortDate(nextPayday(today, p.payday)) })}</p>
      <AmountInput label={t('opening.label')} value={balance} onChange={setBalance} unit={t('unit.tnd')} />
      <p class="opening__preview" aria-live="polite" data-testid="opening-preview">
        {preview
          ? t('opening.preview', {
              left: formatTnd(preview.left),
              perDay: formatTnd(preview.perDay),
            })
          : t('opening.tip')}
      </p>
      <button type="button" class="cta" disabled={balance <= 0} onClick={() => void save()}>
        {t('opening.go')}
      </button>
      <button type="button" class="btn2" onClick={onDone}>
        {t('opening.later')}
      </button>
    </div>
  );
}
