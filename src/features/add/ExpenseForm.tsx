import { Calendar, Check, Pencil } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CATEGORY_ICON } from '../../design/components/CategoryIcon';
import { PERIODS_KEPT } from '../../data/app';
import { factsInput, type Store } from '../../data/store';
import { categoriesIn, categoryLabel, potOf, type CategoryKey, type Pot } from '../../shared/categories';
import { addDays, periodsBack, todayTunis, type ISODate } from '../../shared/dates';
import { shortDate } from '../../shared/format';
import { computeFacts } from '../../shared/facts';
import { t } from '../../shared/i18n/t';
import { keypadMil } from '../../shared/keypad';
import { formatMoney, type Mil } from '../../shared/money';
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
const typed = (mil: Mil) => formatMoney(mil, { unit: false }).replace(/[^0-9,]/g, '');

/** Amount on a keypad, Besoins/Envies, category, date, note — for adding and editing. */
export function ExpenseForm({ store, initial, onSubmit, children }: Props) {
  const today = todayTunis();
  const [amount, setAmount] = useState(initial ? typed(initial.amount_mil) : '');
  const [pot, setPot] = useState<Pot>(initial?.pot ?? 'needs');
  const [category, setCategory] = useState<CategoryKey>(initial?.category ?? categoriesIn('needs')[0]);
  const [date, setDate] = useState<ISODate>(initial?.spent_on ?? today);
  const [note, setNote] = useState(initial?.label ?? '');
  /* the note hides behind a pill until asked for (prototype #m-note-btn) */
  const [noteOpen, setNoteOpen] = useState(Boolean(initial?.label));
  const noteField = useRef<HTMLInputElement>(null);
  const focusNote = useRef(false);
  useEffect(() => {
    if (noteOpen && focusNote.current) noteField.current?.focus();
  }, [noteOpen]);
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
  const dayLabel =
    date === today
      ? t('add.today')
      : date === addDays(today, -1)
        ? t('add.yesterday')
        : date === addDays(today, -2)
          ? t('add.dayBefore')
          : date
            ? shortDate(date)
            : t('add.date');
  /* an old 3-decimal amount shows rounded in a 2-decimal currency: it stays as stored
     unless the amount itself is edited (currency spec §4) */
  const mil = initial && amount === typed(initial.amount_mil) ? initial.amount_mil : keypadMil(amount);
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
        <span class="unit">{t('unit.money')}</span>
      </p>
      <div class="seg2">
        {POTS.map((p) => (
          <button key={p} type="button" aria-pressed={pot === p} onClick={() => choosePot(p)}>
            <i style={{ background: COLOR[p] }} aria-hidden="true" />
            {t('add.left', {
              pot: t(`pot.${p}`),
              amount: facts ? formatMoney(facts.pots[p].left, { unit: false }) : '…',
            })}
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
      {/* the prototype's pills: the date one lays the native picker over itself,
          so any day of the kept year stays reachable */}
      <div class="meta-row">
        <label class="pill meta-pill">
          <Calendar size={16} aria-hidden="true" />
          <span aria-hidden="true">{dayLabel}</span>
          <input
            type="date"
            class="meta-pill__date"
            aria-label={t('add.date')}
            value={date}
            min={oldest}
            max={today}
            onInput={(e) => setDate(e.currentTarget.value)}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker();
              } catch {
                /* no showPicker (older browsers): the tap opens the picker itself */
              }
            }}
            aria-invalid={dateError !== null}
          />
        </label>
        {!noteOpen && (
          <button
            type="button"
            class="pill meta-pill"
            onClick={() => {
              focusNote.current = true;
              setNoteOpen(true);
            }}
          >
            <Pencil size={16} aria-hidden="true" />
            {t('add.noteAdd')}
          </button>
        )}
      </div>
      {noteOpen && (
        <input
          type="text"
          class="tin note-in"
          aria-label={t('add.note')}
          value={note}
          maxLength={60}
          placeholder={t('add.notePlaceholder')}
          ref={noteField}
          onInput={(e) => setNote(e.currentTarget.value)}
        />
      )}
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
