/* Three intro slides, Onboarding v2 (prototype/onboarding-v2.html): each one a
 * little animated scene over a sheet. Swipe, the sheet's button or the progress
 * segments move between them; Passer goes straight to login. */
import { ArrowRight, Mic, RefreshCw } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { markIntroSeen } from '../../app/gate';
import { Icon3D, i3dFile } from '../../design/i3d';
import { reducedMotion } from '../../design/motion';
import { useRolling } from '../../design/useRolling';
import { formatMoney, MIL_PER_TND } from '../../shared/money';
import { t, type StringKey } from '../../shared/i18n/t';
import { Stage, Title, Wordmark } from './Scene';
import './onboarding.css';
import './onb.css';

type Scene = (p: { on: boolean }) => preact.JSX.Element;
const SLIDES: { title: StringKey; body: StringKey; cta: StringKey; scene: Scene }[] = [
  { title: 'intro.s1.title', body: 'intro.s1.body', cta: 'intro.next', scene: NoteScene },
  { title: 'intro.s2.title', body: 'intro.s2.body', cta: 'intro.next', scene: SplitScene },
  { title: 'intro.s3.title', body: 'intro.s3.body', cta: 'intro.go', scene: FollowScene },
];
const SWIPE_PX = 50;

export function IntroScreen({ onDone }: { onDone: () => void }) {
  const [slide, setSlide] = useState(0);
  /* the slide moving out keeps its scene until it has slid away */
  const [leaving, setLeaving] = useState<number | null>(null);
  const startX = useRef<number | null>(null);
  useEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(() => setLeaving(null), 600);
    return () => clearTimeout(timer);
  }, [leaving]);
  const finish = () => {
    markIntroSeen();
    onDone();
  };
  const go = (i: number) => {
    const to = Math.max(0, Math.min(SLIDES.length - 1, i));
    if (to === slide) return;
    setLeaving(slide);
    setSlide(to);
  };
  const next = () => (slide < SLIDES.length - 1 ? go(slide + 1) : finish());

  return (
    <main class="onb intro">
      <div
        class="slides"
        data-testid="slides"
        style={{
          transform: `translateX(-${(slide * 100) / SLIDES.length}%)`,
          transition: reducedMotion() ? 'none' : undefined,
        }}
        onTouchStart={(e) => (startX.current = e.changedTouches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const from = startX.current;
          const to = e.changedTouches[0]?.clientX;
          startX.current = null;
          if (from === null || to === undefined || Math.abs(to - from) < SWIPE_PX) return;
          go(slide + (to < from ? 1 : -1));
        }}
      >
        {SLIDES.map((s, i) => (
          <section
            key={s.title}
            class={`slide s${i + 1}${i === slide || i === leaving ? ' play' : ''}`}
            aria-hidden={i !== slide}
            inert={i !== slide}
          >
            <Stage>
              <s.scene on={i === slide} />
            </Stage>
            <div class="onb-sheet">
              <Title text={t(s.title)} />
              <p>{t(s.body)}</p>
              <button type="button" class="cta" tabIndex={i === slide ? undefined : -1} onClick={next}>
                {t(s.cta)}
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </section>
        ))}
      </div>
      <div class="onb-top">
        <Wordmark />
        <div class="seg" role="tablist" aria-label={t('intro.dots')}>
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === slide}
              aria-label={t('intro.dot', { n: i + 1 })}
              tabIndex={i === slide ? 0 : -1}
              onClick={() => go(i)}
            >
              {/* keyed on the slide so the current segment's fill restarts */}
              <i key={`${i}-${slide}`} class={i < slide ? 'done' : i === slide ? 'cur' : undefined} />
            </button>
          ))}
        </div>
        <button type="button" class="skip" onClick={finish}>
          {t('intro.skip')}
        </button>
      </div>
    </main>
  );
}

/* delays and positions are the prototype's, on its 322 × 400 stage */
const d = (s: number) => ({ '--d': `${s}s` });

/** 1 · Noter: tell Aam Salah, it files the expense. */
function NoteScene() {
  return (
    <>
      <Float
        icon="hot_beverage"
        style={{ right: '14px', top: '6px', width: '50px', height: '50px', '--r': '-10deg' }}
      />
      <Float
        icon="shopping_bags"
        style={{
          right: '10px',
          top: '236px',
          width: '48px',
          height: '48px',
          '--r': '8deg',
          animationDelay: '-1.5s',
        }}
      />
      <Float
        icon="fuel_pump"
        style={{
          left: '12px',
          top: '150px',
          width: '42px',
          height: '42px',
          '--r': '6deg',
          animationDelay: '-3s',
        }}
      />
      <span class="spark" style={{ right: '44px', top: '14px', '--sc': 'var(--acc2)' }} />
      <span
        class="spark"
        style={{ left: '70px', top: '250px', '--sc': '#FFC53D', animationDelay: '-1.2s' }}
      />

      <div class="chat glass in" style={d(0.05)}>
        <div class="chat-h">
          <span class="av">
            <Icon3D src={i3dFile('old_man')} />
          </span>
          <span>
            <b>{t('intro.illo.aam')}</b>
            <small>{t('intro.illo.online')}</small>
          </span>
        </div>
        <div class="msg">
          <span class="bub pop" style={d(0.35)}>
            {t('intro.illo.chat')}
          </span>
        </div>
        <div class="typing">
          <i />
          <i />
          <i />
        </div>
        <div class="rc pop" style={d(1.85)}>
          <span class="t">
            <Icon3D src={i3dFile('shopping_cart')} />
          </span>
          <span>
            <b>{t('intro.illo.card')}</b>
            <span>{t('intro.illo.cardSub')}</span>
          </span>
          <span class="amt num">{t('intro.illo.cardAmount')}</span>
        </div>
        <div class="ok in" style={d(2.1)}>
          <span class="yes">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            {t('intro.illo.noted')}
          </span>
          <span class="undo">{t('intro.illo.undo')}</span>
        </div>
      </div>
      <div class="mic in" style={d(2.6)}>
        <span class="m">
          <Mic aria-hidden="true" />
        </span>
        {t('intro.illo.talk')}
      </div>
    </>
  );
}

/** 2 · Répartir: payday splits 50 / 30 / 20 on its own. */
function SplitScene({ on }: { on: boolean }) {
  const pay = useRolling(on ? 2000 * MIL_PER_TND : 0, 900);
  const wire = (dd: string) => [<path key="a" d={dd} />, <path key="b" class="flow" d={dd} />];
  return (
    <>
      <span class="spark" style={{ left: '30px', top: '30px', '--sc': 'var(--want)' }} />
      <span
        class="spark"
        style={{ right: '30px', top: '120px', '--sc': 'var(--need)', animationDelay: '-1s' }}
      />
      <span
        class="spark"
        style={{ left: '50px', top: '400px', '--sc': '#FFC53D', animationDelay: '-1.8s' }}
      />
      <svg class="wires" viewBox="0 0 322 460" preserveAspectRatio="none" aria-hidden="true">
        <g style={{ stroke: 'var(--need)', '--d': '.7s' }}>{wire('M161 104 C161 150 60 160 60 212')}</g>
        <g style={{ stroke: 'var(--want)', '--d': '.85s' }}>{wire('M161 104 L161 212')}</g>
        <g style={{ stroke: 'var(--save)', '--d': '1s' }}>{wire('M161 104 C161 150 262 160 262 212')}</g>
      </svg>
      <div class="pay glass in" style={d(0.05)}>
        <Icon3D src={i3dFile('dollar_banknote')} />
        <span>
          <small>{t('intro.illo.payday')}</small>
          <b>
            +<span class="num">{formatMoney(pay, { unit: false })}</span>
            <em>TND</em>
          </b>
        </span>
      </div>
      <div class="pots3">
        {POTS3.map((p, i) => (
          <div key={p.pot} class={`pt glass pop pt--${p.pot}`} style={d(1.5 + i * 0.15)}>
            <span class="ic">
              <Icon3D src={i3dFile(p.icon)} />
            </span>
            <span class="pc">{t(p.pct)}</span>
            <span class="nm">{t(`pot.${p.pot}`)}</span>
            <span class="am num">{t(p.amount)}</span>
          </div>
        ))}
      </div>
      <div class="auto in" style={d(2.3)}>
        <RefreshCw aria-hidden="true" />
        {t('intro.illo.auto')}
      </div>
    </>
  );
}
const POTS3: { pot: 'needs' | 'wants' | 'savings'; icon: string; pct: StringKey; amount: StringKey }[] = [
  { pot: 'needs', icon: 'house', pct: 'intro.illo.needs', amount: 'intro.illo.needsAmount' },
  { pot: 'wants', icon: 'sparkles', pct: 'intro.illo.wants', amount: 'intro.illo.wantsAmount' },
  { pot: 'savings', icon: 'money_bag', pct: 'intro.illo.savings', amount: 'intro.illo.savingsAmount' },
];

/** 3 · Suivre: one number a day, the rest goes to the goal. */
function FollowScene({ on }: { on: boolean }) {
  const today = useRolling(on ? 46 : 0, 900);
  return (
    <>
      <span class="spark" style={{ right: '18px', top: '26px', '--sc': 'var(--save)' }} />
      <span
        class="spark"
        style={{ left: '26px', top: '250px', '--sc': '#FFC53D', animationDelay: '-1.4s' }}
      />
      <div class="today glass in" style={d(0.05)}>
        <div class="h">
          <Icon3D src={i3dFile('sun')} />
          {t('intro.illo.today')}
        </div>
        <div class="big">
          <b class="num">{today}</b>
          <span>TND</span>
        </div>
        <div class="bar">
          <i />
        </div>
        <div class="f">
          <span>{t('intro.illo.onPace')}</span>
          <span>{t('intro.illo.payIn')}</span>
        </div>
      </div>
      <span class="coin">
        <Icon3D src={i3dFile('coin')} />
      </span>
      <div class="goal glass">
        <span class="ringw">
          <svg viewBox="0 0 62 62" aria-hidden="true">
            <circle class="bg" cx="31" cy="31" r="26" />
            <circle class="fg" cx="31" cy="31" r="26" />
          </svg>
          <Icon3D src={i3dFile('house')} />
        </span>
        <span>
          <b>{t('intro.illo.goal')}</b>
          <small class="num">{t('intro.illo.goalAmount')}</small>
          <br />
          <span class="plus">{t('intro.illo.goalPlus')}</span>
        </span>
      </div>
      <div class="streak in" style={d(2.6)}>
        <Icon3D src={i3dFile('party_popper')} />
        {t('intro.illo.streak')}
      </div>
    </>
  );
}

function Float({ icon, style }: { icon: string; style: Record<string, string> }) {
  return (
    <span class="float" style={style}>
      <Icon3D src={i3dFile(icon)} />
    </span>
  );
}
