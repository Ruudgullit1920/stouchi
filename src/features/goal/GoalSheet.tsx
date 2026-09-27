import { useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import type { Row } from '../../data/localdb';
import type { Store } from '../../data/store';
import { t, type StringKey } from '../../shared/i18n/t';
import { MAX_MIL } from '../../shared/money';
import type { Goal } from '../../shared/schemas';
import { AmountInput } from '../onboarding/AmountInput';
import { GOAL_PRESETS, goalLabel, goalTarget, type GoalKey } from '../onboarding/draft';
import { goalIcon } from './goalIcon';

const NAME_MAX = 40;
const defaultName = (key: GoalKey) => t(`${goalLabel(key)}.name` as StringKey);

type Props = {
  store: Store;
  /** the goal to edit; without it the sheet makes a new goal */
  goal?: Goal;
  /** the active goal a new one replaces: archived, its moves stay with it */
  current?: Goal;
  write: (table: 'goals', row: Row) => Promise<void>;
  onDone: () => void;
};

/** Edit the goal (type, name, target), or start a new one. */
export function GoalSheet({ store, goal, current, write, onDone }: Props) {
  const salary = store.profile.value?.salary_mil ?? 0;
  const [key, setKey] = useState<GoalKey | null>(
    goal ? (GOAL_PRESETS.find((p) => p.icon === goal.icon)?.key ?? 'autre') : null,
  );
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal?.target_mil ?? 0);
  const [error, setError] = useState(false);

  const choose = (next: GoalKey) => {
    /* a name the user typed stays; the type's own name follows the type */
    if (!name.trim() || (key && name === defaultName(key))) setName(defaultName(next));
    if (!goal && !target) setTarget(goalTarget(next, salary));
    setKey(next);
  };

  const save = async () => {
    const clean = name.trim();
    if (!clean) {
      setError(true);
      return;
    }
    const icon = GOAL_PRESETS.find((p) => p.key === key)?.icon ?? goal?.icon ?? 'sparkles';
    if (goal) {
      await write('goals', { ...goal, name: clean, icon, target_mil: target });
    } else {
      const userId = store.userId.value;
      if (!userId) return;
      if (current) await write('goals', { ...current, archived_at: new Date().toISOString() });
      await write('goals', {
        id: crypto.randomUUID(),
        user_id: userId,
        household_id: null,
        name: clean,
        icon,
        target_mil: target,
        archived_at: null,
      });
    }
    onDone();
    showToast({ text: t(goal ? 'goal.sheet.saved' : 'goal.sheet.created') });
  };

  return (
    <div class="goal-sheet">
      <div class="goals">
        {GOAL_PRESETS.map((p) => {
          const Icon = goalIcon(p.icon);
          return (
            <button
              key={p.key}
              type="button"
              class={key === p.key ? 'on' : undefined}
              aria-pressed={key === p.key}
              onClick={() => choose(p.key)}
            >
              <Icon aria-hidden="true" />
              {t(goalLabel(p.key))}
            </button>
          );
        })}
      </div>
      <label class="field">
        <span>{t('goal.sheet.name')}</span>
        <input
          class="tin"
          value={name}
          maxLength={NAME_MAX}
          aria-invalid={error}
          onInput={(e) => {
            setName(e.currentTarget.value);
            setError(false);
          }}
        />
      </label>
      {error && (
        <p class="field-error" role="alert">
          {t('goal.sheet.nameError')}
        </p>
      )}
      <label class="gfield">
        <span aria-hidden="true">{t('setup.goal.target')}</span>
        <AmountInput
          label={t('setup.goal.target')}
          value={target}
          onChange={setTarget}
          digits={7}
          unit={t('unit.money')}
        />
      </label>
      <button
        type="button"
        class="cta"
        disabled={target <= 0 || target > MAX_MIL}
        onClick={() => void save()}
      >
        {t(goal ? 'goal.sheet.save' : 'goal.sheet.create')}
      </button>
    </div>
  );
}
