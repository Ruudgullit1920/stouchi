import { ChartPie, ChevronLeft } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { closeSheet, openSheet, showToast } from '../../app/ui';
import type { Row } from '../../data/localdb';
import type { Store } from '../../data/store';
import { billsDueTotal } from '../../shared/bills';
import { nextPayday, payPeriod, todayTunis } from '../../shared/dates';
import { monthName, monthYear, shortDate } from '../../shared/format';
import { goalView } from '../../shared/goal';
import { t } from '../../shared/i18n/t';
import { formatMoney, splitSalary, type Split } from '../../shared/money';
import { activeGoal } from '../../shared/payday';
import { HIDDEN, hideAmounts } from '../budget/hideAmounts';
import { currentPlan, nextPlanPatch, pendingPlan } from '../../shared/plan';
import { SPLIT_PRESETS, sameSplit, splitText, splitTip, type SplitTip } from '../../shared/split';
import { SplitEditor } from './SplitEditor';
import { WhenSwitch, changes, type When } from './When';

const POTS = ['needs', 'wants', 'savings'] as const;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type Props = {
  store: Store;
  write: (table: 'profiles', row: Row) => Promise<void>;
  onBack: () => void;
};

/** Répartition (#/me/split): drag the two handles, or pick a preset. */
export function SplitScreen({ store, write, onBack }: Props) {
  const p = store.profile.value;
  /* opens on what is coming (a pending split, else today's), "dès ce mois" by default;
     a split already waiting opens as it stands, so saving without a change never applies it early */
  const [split, setSplit] = useState<Split | null>(() =>
    p ? (pendingPlan(p) ?? currentPlan(p)).split : null,
  );
  const [start] = useState(split);
  const [when, setWhen] = useState<When>(() => {
    const next = p && pendingPlan(p);
    return p && next && !sameSplit(next.split, currentPlan(p).split) ? 'next' : 'now';
  });
  if (!p || !split || !start) return null;

  const today = todayTunis();
  const current = currentPlan(p);
  const period = payPeriod(today, p.payday);
  const next = shortDate(nextPayday(today, p.payday));
  const month = monthName(period.label);
  const amounts = splitSalary(current.salary_mil, split);
  const patch = nextPlanPatch(p, { split }, when, today);
  const canSave = changes(p, patch);
  const dirty = !sameSplit(split, start);
  const goal = activeGoal(store.goals.value);
  const tip = splitTip({
    split,
    current: current.split,
    salary: current.salary_mil,
    bills: billsDueTotal(
      store.bills.value.filter((b) => b.active),
      period,
    ),
    goal: goal
      ? { target: goal.target_mil, saved: goalView(goal, store.savingsMoves.value, 0, today).saved }
      : null,
    today,
  });
  const money = (m: number, unit = true) => (hideAmounts.value ? HIDDEN : formatMoney(m, { unit }));
  const preset = SPLIT_PRESETS.find((x) => sameSplit(x.split, split));

  const save = async () => {
    await write('profiles', { ...p, ...patch });
    showToast(
      when === 'now'
        ? {
            text: t('me.split.saved', { split: splitText(split) }),
            action: { label: t('action.undo'), run: () => void write('profiles', p) },
          }
        : { text: t('me.split.savedNext', { split: splitText(split), date: next }) },
    );
    onBack();
  };

  const leave = () => {
    if (!dirty) return onBack();
    openSheet(
      t('me.split.discard.title'),
      <div class="me-sheet confirm">
        <div class="big-ic tone-need" aria-hidden="true">
          <ChartPie />
        </div>
        <p>{t('me.split.discard.body', { split: splitText(split) })}</p>
        <button
          type="button"
          class="cta"
          disabled={!canSave}
          onClick={() => {
            closeSheet();
            void save();
          }}
        >
          {t('me.split.apply')}
        </button>
        <button
          type="button"
          class="btn2"
          onClick={() => {
            closeSheet();
            onBack();
          }}
        >
          {t('me.split.discard.drop')}
        </button>
      </div>,
    );
  };

  return (
    <div class="me">
      <header class="top">
        <button type="button" class="icon-btn" aria-label={t('action.back')} onClick={leave}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <h1 class="set-h1">{t('me.split')}</h1>
        {canSave ? (
          <button type="button" class="set-save" onClick={() => void save()}>
            {t('me.save')}
          </button>
        ) : (
          <span class="set-save" aria-hidden="true" />
        )}
      </header>
      <p class="lead">{t('me.split.lead', { salary: money(current.salary_mil) })}</p>
      <div class="card">
        <SplitEditor value={split} onChange={setSplit} />
        <div class="sp-scale" aria-hidden="true">
          <span>0 %</span>
          <span>50 %</span>
          <span>100 %</span>
        </div>
        <div data-testid="split-rows">
          {POTS.map((k) => (
            <div key={k} class="sp-row">
              <i class={`bg-${k}`} aria-hidden="true" />
              <span>
                {t(`pot.${k}`)} <small>{split[k]} %</small>
              </span>
              <b class="num">{money(amounts[k], false)}</b>
            </div>
          ))}
        </div>
      </div>
      <p class={tip.kind === 'goal' || tip.kind === 'left' ? 'aamtip' : 'aamtip warn'} aria-live="polite">
        <span class="sal" aria-hidden="true">
          S
        </span>
        <span>{tipText(tip, goal ? lower(goal.name) : '', money)}</span>
      </p>

      <div class="sec">
        <h2>{t('me.split.presets')}</h2>
      </div>
      <div class="presets">
        {SPLIT_PRESETS.map((x) => (
          <button
            key={x.key}
            type="button"
            class={x === preset ? 'preset on' : 'preset'}
            aria-pressed={x === preset}
            onClick={() => setSplit(x.split)}
          >
            <b>
              {splitText(x.split)}
              {x.recommended && <span class="badge">{t('me.split.recommended')}</span>}
            </b>
            <small>{t(`me.split.preset.${x.key}`)}</small>
            <Mini split={x.split} />
          </button>
        ))}
        {!preset && (
          <div class="preset on">
            <b>{splitText(split)}</b>
            <small>{t('me.split.custom')}</small>
            <Mini split={split} />
          </div>
        )}
      </div>

      <div class="me-when">
        <WhenSwitch value={when} onChange={setWhen} today={today} payday={p.payday} />
        <p class="hint">
          {when === 'now'
            ? t('me.split.nowHint', { month: month.toLowerCase() })
            : t('me.split.nextHint', { month, split: splitText(current.split), date: next })}
        </p>
      </div>
      <button type="button" class="cta" disabled={!canSave} onClick={() => void save()}>
        {t('me.split.apply')}
      </button>
    </div>
  );
}

const Mini = ({ split }: { split: Split }) => (
  <span class="mini" aria-hidden="true">
    {POTS.map((k) => (
      <i key={k} class={`bg-${k}`} style={{ flex: split[k] }} />
    ))}
  </span>
);

function tipText(tip: SplitTip, goal: string, money: (m: number) => string): string {
  switch (tip.kind) {
    case 'over':
      return t('me.split.tip.over', { bills: money(tip.bills), needs: money(tip.needs) });
    case 'tight':
      return t('me.split.tip.tight', { left: money(tip.left) });
    case 'low':
      return tip.eta
        ? t('me.split.tip.lowGoal', { goal, when: monthYear(tip.eta).toLowerCase() })
        : t('me.split.tip.low');
    case 'left':
      return t('me.split.tip.left', { left: money(tip.left) });
    case 'goal': {
      const base = {
        monthly: money(tip.monthly),
        goal,
        when: tip.eta ? monthYear(tip.eta).toLowerCase() : '',
      };
      if (tip.diff > 0) return t('me.split.tip.sooner', { ...base, n: tip.diff });
      if (tip.diff < 0) return t('me.split.tip.later', { ...base, n: -tip.diff });
      return t('me.split.tip.same', base);
    }
  }
}
