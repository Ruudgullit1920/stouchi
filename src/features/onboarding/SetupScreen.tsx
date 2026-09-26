/* Five questions, one per screen, ported from prototype #f-setup (spec §4.1).
 * After every step the answers are kept on the device and that step's rows are
 * written, so closing the app mid-way loses nothing. */
import { ChevronLeft } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { currentFirstName } from '../../data/auth';
import type { Row, Table } from '../../data/localdb';
import { todayTunis, type ISODate } from '../../shared/dates';
import { t, type StringKey } from '../../shared/i18n/t';
import type { Profile } from '../../shared/schemas';
import {
  DONE,
  loadDraft,
  markWritten,
  newDraft,
  rowsForStep,
  saveDraft,
  stepValid,
  STEPS,
  type Draft,
  type StepName,
  type StepProps,
} from './draft';
import { StepBills } from './StepBills';
import { StepGoal } from './StepGoal';
import { StepName as StepNameView } from './StepName';
import { StepPayday } from './StepPayday';
import { StepSalary } from './StepSalary';
import './onboarding.css';
import './setup.css';

export interface SetupProps {
  userId: string;
  /** a profile started on another device seeds the answers */
  profile: Profile | null;
  write: (table: Table, row: Row) => Promise<void>;
  onFinish: () => void;
  today?: ISODate;
  /** Google's first name, for the first question */
  loadName?: () => Promise<string>;
}

const VIEWS: Record<StepName, (p: StepProps) => preact.JSX.Element> = {
  name: StepNameView,
  salary: StepSalary,
  payday: StepPayday,
  bills: StepBills,
  goal: StepGoal,
};

export function SetupScreen({
  userId,
  profile,
  write,
  onFinish,
  today = todayTunis(),
  loadName = currentFirstName,
}: SetupProps) {
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = loadDraft(userId);
    if (saved) return { ...saved, step: Math.min(saved.step, STEPS.length - 1) };
    return newDraft(userId, {
      name: profile?.first_name,
      salary_mil: profile?.salary_mil || undefined,
      payday: profile?.salary_mil ? profile.payday : null,
    });
  });
  const [dir, setDir] = useState<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = STEPS[draft.step];

  useEffect(() => {
    if (draft.name) return;
    void loadName().then((name) => name && setDraft((d) => (d.name ? d : { ...d, name })));
  }, []);
  useEffect(() => saveDraft(draft), [draft]);
  useEffect(() => heading.current?.focus(), [draft.step]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const valid = stepValid(draft, step);

  async function next() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      for (const { table, row } of rowsForStep(draft, step, today)) await write(table, row);
    } finally {
      setBusy(false);
    }
    const sent = step === 'bills' ? markWritten(draft) : draft;
    const moved = { ...sent, step: draft.step + 1 };
    setDir(1);
    saveDraft(moved);
    if (moved.step >= DONE) onFinish();
    else setDraft(moved);
  }

  const back = () => {
    const moved = { ...draft, step: draft.step - 1 };
    setDir(-1);
    saveDraft(moved);
    setDraft(moved);
  };

  const noBills = step === 'bills' && !draft.bills.some((b) => b.on);
  const View = VIEWS[step];
  const say = t(`setup.${step}.say` as StringKey, { name: draft.name.trim() });

  return (
    <main class="flow setup">
      <div class="su-head">
        {draft.step > 0 ? (
          <button type="button" class="icon-btn line" aria-label={t('setup.back')} onClick={back}>
            <ChevronLeft aria-hidden="true" />
          </button>
        ) : (
          <span />
        )}
        <div
          class="su-prog"
          role="progressbar"
          aria-label={t('setup.progress', { n: draft.step + 1, total: STEPS.length })}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={draft.step + 1}
        >
          {STEPS.map((s, i) => (
            <i key={s} class={i <= draft.step ? 'done' : undefined} />
          ))}
        </div>
        <span class="su-count" aria-hidden="true">
          {t('setup.count', { n: draft.step + 1, total: STEPS.length })}
        </span>
      </div>
      <div class="su-body">
        <div key={step} class={dir < 0 ? 'su-step back' : 'su-step'}>
          <div class="aam">
            <span class="sal" aria-hidden="true">
              {t('setup.aam.initial')}
            </span>
            <p class="bubble" aria-live="polite">
              {say}
            </p>
          </div>
          <h1 class="su-q" tabIndex={-1} ref={heading}>
            {t(`setup.${step}.q` as StringKey)}
          </h1>
          <View draft={draft} set={set} today={today} />
        </div>
      </div>
      <div class="su-foot">
        <button
          type="button"
          class="su-cta"
          disabled={!valid || busy}
          aria-busy={busy}
          onClick={() => void next()}
        >
          {noBills ? t('setup.noBills') : step === 'goal' ? t('setup.finish') : t('setup.continue')}
        </button>
      </div>
    </main>
  );
}
