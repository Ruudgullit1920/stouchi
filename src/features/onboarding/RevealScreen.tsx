/* The reveal, ported from prototype #f-reveal (spec §4.1): the salary coin, the
 * three pots dropping in with their amounts, confetti once. The button works
 * from the first frame; under reduced motion nothing moves. */
import { ArrowRight } from 'lucide-preact';
import { Icon3D, i3dFile } from '../../design/i3d';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Row, Table } from '../../data/localdb';
import { reducedMotion } from '../../design/motion';
import { useRolling } from '../../design/useRolling';
import { todayTunis, type ISODate } from '../../shared/dates';
import { t, type StringKey } from '../../shared/i18n/t';
import { formatTnd, splitSalary, type Mil } from '../../shared/money';
import type { Profile } from '../../shared/schemas';
import { clearDraft, loadDraft, openingDeposit } from './draft';
import { dayLabel } from './StepPayday';
import './onboarding.css';
import './reveal.css';

export interface RevealProps {
  profile: Profile;
  goalName: string | null;
  /** what the setup bills reserve in Besoins each month */
  billsMil: Mil;
  write: (table: Table, row: Row) => Promise<void>;
  onOpen: () => void;
  now?: () => Date;
  today?: ISODate;
}

const COUNT_DELAY_MS = 650;
const CONFETTI = ['var(--acc)', 'var(--need)', 'var(--want)', 'var(--save)', 'var(--warn)'];

export function RevealScreen({
  profile,
  goalName,
  billsMil,
  write,
  onOpen,
  now = () => new Date(),
  today = todayTunis(),
}: RevealProps) {
  const [still] = useState(reducedMotion);
  const [counting, setCounting] = useState(still);
  const [pieces] = useState(() => (still ? [] : confetti()));
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void (async () => {
      const draft = loadDraft(profile.user_id);
      const deposit = draft && openingDeposit(draft, today);
      if (deposit) await write('savings_moves', deposit);
      if (!profile.onboarded_at)
        await write('profiles', {
          user_id: profile.user_id,
          first_name: profile.first_name,
          salary_mil: profile.salary_mil,
          payday: profile.payday,
          split_needs: profile.split_needs,
          split_wants: profile.split_wants,
          split_savings: profile.split_savings,
          onboarded_at: now().toISOString(),
        });
      clearDraft(profile.user_id);
    })();
    if (still) return;
    const timer = setTimeout(() => setCounting(true), COUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const split = { needs: profile.split_needs, wants: profile.split_wants, savings: profile.split_savings };
  const pots = splitSalary(profile.salary_mil, split);
  const rows: { pot: keyof typeof pots; icon: string; desc: string }[] = [
    {
      pot: 'needs',
      icon: 'house',
      desc: billsMil
        ? t('reveal.needs.bills', { pct: split.needs, bills: formatTnd(billsMil) })
        : t('reveal.needs.desc', { pct: split.needs }),
    },
    { pot: 'wants', icon: 'sparkles', desc: t('reveal.wants.desc', { pct: split.wants }) },
    {
      pot: 'savings',
      icon: 'money_bag',
      desc: t('reveal.savings.desc', { pct: split.savings, goal: goalName ?? t('pot.savings') }),
    },
  ];
  const when =
    profile.payday === 0 ? t('setup.payday.end') : t('reveal.on', { day: dayLabel(profile.payday) });

  return (
    <main class="flow reveal">
      <div class="confetti" data-testid="confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <i key={i} style={p} />
        ))}
      </div>
      <div class={still ? 'rv still' : 'rv'}>
        <div class="rv-coin">
          <small>{t('reveal.salary')}</small>
          <b class="num">{formatTnd(profile.salary_mil, { unit: false })}</b>
          <small>{t('reveal.when', { when })}</small>
        </div>
        <h1>{t('reveal.title', { name: profile.first_name })}</h1>
        <p>{t('reveal.body')}</p>
        {rows.map((r, i) => (
          <PotRow key={r.pot} {...r} amount={counting ? pots[r.pot] : 0} delay={0.55 + i * 0.16} />
        ))}
        <button type="button" class="rv-cta" onClick={onOpen}>
          {t('reveal.open')}
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}

function PotRow({
  pot,
  icon,
  desc,
  amount,
  delay,
}: {
  pot: 'needs' | 'wants' | 'savings';
  icon: string;
  desc: string;
  amount: Mil;
  delay: number;
}) {
  const shown = useRolling(amount, 800);
  return (
    <div class={`rv-pot rv-pot--${pot}`} style={{ animationDelay: `${delay}s` }}>
      <div class="tile" aria-hidden="true">
        <Icon3D src={i3dFile(icon)} />
      </div>
      <div>
        <div class="name">{t(`pot.${pot}` as StringKey)}</div>
        <div class="desc">{desc}</div>
      </div>
      <div class="amt">
        <b class="num" data-testid="rv-amount">
          {formatTnd(shown, { unit: false })}
        </b>
        <span>{t('reveal.perMonth')}</span>
      </div>
    </div>
  );
}

function confetti(): Record<string, string>[] {
  return Array.from({ length: 34 }, (_, i) => {
    const a = Math.random() * Math.PI * 2;
    const r = 90 + Math.random() * 160;
    return {
      background: CONFETTI[i % CONFETTI.length],
      '--x': `${Math.cos(a) * r}px`,
      '--y': `${Math.sin(a) * r + 60}px`,
      '--r': `${Math.random() * 540}deg`,
      animationDelay: `${1.1 + Math.random() * 0.12}s`,
    };
  });
}
