import { Check } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { CATEGORY_ICON } from '../../design/components/CategoryIcon';
import { PERIODS_KEPT } from '../../data/app';
import { factsInput, type Store } from '../../data/store';
import { categoriesIn, categoryLabel, potOf, type CategoryKey, type Pot } from '../../shared/categories';
import { periodsBack, todayTunis, type ISODate } from '../../shared/dates';
import { computeFacts } from '../../shared/facts';
import { t } from '../../shared/i18n/t';
import { keypadMil } from '../../shared/keypad';
import { formatTnd, type Mil } from '../../shared/money';
import { Keypad } from './Keypad';
import './add.css';

export interface ExpenseFields {
  amount_mil: Mil;
  category: CategoryKey;
  pot: Pot;
  label: string;
  spent_on: ISODate;
}

type Props = {
  store: Store;
  initial?: ExpenseFields;
  onSubmit: (fields: ExpenseFields) => Promise<unknown>;
  /** extra actions under Enregistrer (the detail sheet's Supprimer) */
  children?: ComponentChildren;
};

const POTS: Pot[] = ['needs', 'wants'];
const COLOR: Record<Pot, string> = { needs: 'var(--need)', wants: 'var(--want)' };
const typed = (mil: Mil) => formatTnd(mil, { unit: false }).replace(/[^0-9,]/g, '');

/** Amount on a keypad, Besoins/Envies, category, date, note — for adding and editing. */
export function ExpenseForm({ store, initial, onSubmit, children }: Props) {
  const today = todayTunis();
  const [amount, setAmount] = useState(initial ? typed(initial.amount_mil) : '');
  const [pot, setPot] = useState<Pot>(initial?.pot ?? 'needs');
  const [category, setCategory] = useState<CategoryKey>(initial?.category ?? categoriesIn('needs')[0]);
  const [date, setDate] = useState<ISODate>(initial?.spent_on ?? today);
  const [note, setNote] = useState(initial?.label ?? '');
  const [saving, setSaving] = useState(false);

  const profile = store.profile.value;
  const periods = periodsBack(today, profile?.payday ?? 1, PERIODS_KEPT);
  const oldest = periods[periods.length - 1].start;
  const dateError = !date
    ? 'add.dateMissing'
    : date > today
      ? 'add.dateFuture'
      : date < oldest
        ? 'add.dateTooOld'
        : null;
  const mil = keypadMil(amount);
  const facts = profile ? computeFacts(factsInput(store, profile, today)) : null;

  const choosePot = (p: Pot) => {
    setPot(p);
    if (potOf(category) !== p) setCategory(categoriesIn(p)[0]);
  };
  const submit = () => {
    if (saving || mil <= 0 || dateError) return;
    setSaving(true);
    onSubmit({ amount_mil: mil, category, pot, label: note.trim(), spent_on: date }).catch(() =>
      setSaving(false),
    );
  };

  return (
    <div class="xform">
      <p class="xform__amount">
        <output class="big num" aria-label={t('add.amount')}>
          {amount || '0'}
        </output>
        <span class="unit">{t('unit.tnd')}</span>
      </p>
      <div class="seg2">
        {POTS.map((p) => (
          <button key={p} type="button" aria-pressed={pot === p} onClick={() => choosePot(p)}>
            <i style={{ background: COLOR[p] }} aria-hidden="true" />
            {t('add.left', { pot: t(`pot.${p}`), amount: facts ? formatTnd(facts.pots[p].left) : '…' })}
          </button>
        ))}
      </div>
      <div class="cats">
        {categoriesIn(pot).map((c) => {
          const Icon = CATEGORY_ICON[c];
          return (
            <button
              key={c}
              type="button"
              class="cat"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              <span
                class="cat__ic"
                style={category === c ? { background: COLOR[pot] } : undefined}
                aria-hidden="true"
              >
                <Icon size={20} />
              </span>
              {categoryLabel(c)}
            </button>
          );
        })}
      </div>
      <div class="meta-row">
        <label class="field">
          <span>{t('add.date')}</span>
          <input
            type="date"
            value={date}
            min={oldest}
            max={today}
            onInput={(e) => setDate(e.currentTarget.value)}
            aria-invalid={dateError !== null}
          />
        </label>
        <label class="field field--grow">
          <span>{t('add.note')}</span>
          <input
            type="text"
            value={note}
            maxLength={60}
            placeholder={t('add.notePlaceholder')}
            onInput={(e) => setNote(e.currentTarget.value)}
          />
        </label>
      </div>
      {dateError && (
        <p class="field-error" role="alert">
          {t(dateError)}
        </p>
      )}
      <Keypad value={amount} onChange={setAmount} />
      <button type="button" class="cta" disabled={saving || mil <= 0 || dateError !== null} onClick={submit}>
        <Check size={20} aria-hidden="true" />
        {t('add.save')}
      </button>
      {children}
    </div>
  );
}
