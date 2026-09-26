/* Three intro slides, ported from prototype #f-intro (spec §4.1): swipe, the
 * arrow or the dots move between them; Passer goes straight to login. */
import {
  ArrowRight,
  Check,
  Coins,
  Flag,
  House,
  MessageCircle,
  ShoppingCart,
  Sparkles,
  Wallet,
} from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import { markIntroSeen } from '../../app/gate';
import { reducedMotion } from '../../design/motion';
import { t, type StringKey } from '../../shared/i18n/t';
import { Blob, Illo, Orb, Paths } from './Illo';
import './onboarding.css';

const SLIDES: { title: StringKey; body: StringKey; illo: () => preact.JSX.Element }[] = [
  { title: 'intro.s1.title', body: 'intro.s1.body', illo: SplitIllo },
  { title: 'intro.s2.title', body: 'intro.s2.body', illo: ChatIllo },
  { title: 'intro.s3.title', body: 'intro.s3.body', illo: GoalIllo },
];
const SWIPE_PX = 50;

export function IntroScreen({ onDone }: { onDone: () => void }) {
  const [slide, setSlide] = useState(0);
  const startX = useRef<number | null>(null);
  const finish = () => {
    markIntroSeen();
    onDone();
  };
  const go = (i: number) => setSlide(Math.max(0, Math.min(SLIDES.length - 1, i)));

  return (
    <main class="flow intro">
      <div class="intro-top">
        <span class="wordmark">
          stouchi
          <i />
        </span>
        <button type="button" class="link-mut" onClick={finish}>
          {t('intro.skip')}
        </button>
      </div>
      <div class="slides-wrap">
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
            <section key={s.title} class={i === slide ? 'slide cur' : 'slide'} aria-hidden={i !== slide}>
              <s.illo />
              <h1>
                {t(s.title)
                  .split('\n')
                  .flatMap((line, j) => (j ? [<br key={j} />, line] : [line]))}
              </h1>
              <p>{t(s.body)}</p>
            </section>
          ))}
        </div>
      </div>
      <div class="intro-foot">
        <div class="dots" role="tablist" aria-label={t('intro.dots')}>
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              class={i === slide ? 'on' : undefined}
              aria-selected={i === slide}
              aria-label={t('intro.dot', { n: i + 1 })}
              tabIndex={i === slide ? 0 : -1}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <button
          type="button"
          class="roundbtn"
          aria-label={t('intro.next')}
          onClick={() => (slide < SLIDES.length - 1 ? go(slide + 1) : finish())}
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}

function SplitIllo() {
  return (
    <Illo>
      <Blob x={10} y={50} w={150} h={150} color="#FFD5C9" />
      <Paths
        viewBox="0 0 300 250"
        d={['M74 125 C 150 125, 160 45, 250 45', 'M74 125 L 250 125', 'M74 125 C 150 125, 160 205, 250 205']}
      />
      <Orb x={22} y={73} size="lg" icon={Wallet} color="var(--acc)" delay={0} />
      <Orb x={214} y={9} size="md" icon={House} color="var(--need)" delay={1.2} />
      <Orb x={214} y={89} size="md" icon={Sparkles} color="var(--want)" delay={2.4} />
      <Orb x={214} y={169} size="md" icon={Coins} color="var(--save)" delay={3.6} />
      <span
        class="tagf"
        style={{ left: '150px', top: '30px', color: 'var(--need-ink)', animationDelay: '-1.2s' }}
      >
        {t('intro.illo.needs')}
      </span>
      <span
        class="tagf"
        style={{ left: '150px', top: '100px', color: 'var(--want-ink)', animationDelay: '-2.4s' }}
      >
        {t('intro.illo.wants')}
      </span>
      <span
        class="tagf"
        style={{ left: '150px', top: '188px', color: 'var(--save-ink)', animationDelay: '-3.6s' }}
      >
        {t('intro.illo.savings')}
      </span>
    </Illo>
  );
}

function ChatIllo() {
  return (
    <Illo>
      <Blob x={130} y={40} w={150} h={150} color="#E4DAFF" />
      <Paths
        viewBox="0 0 300 250"
        d={['M66 176 C 110 176, 120 90, 190 70', 'M110 186 C 150 196, 170 176, 200 170']}
      />
      <Orb x={14} y={124} size="lg" icon={MessageCircle} color="var(--acc)" delay={0} />
      <div class="chatpill" style={{ left: '140px', top: '30px', animationDelay: '-1.5s' }}>
        {t('intro.illo.chat')}
      </div>
      <div class="rcard" style={{ left: '118px', top: '138px', animationDelay: '-3s' }}>
        <div class="ic">
          <ShoppingCart />
        </div>
        <div>
          <b>{t('intro.illo.card')}</b>
          <small>{t('intro.illo.cardSub')}</small>
        </div>
        <span class="v">{t('intro.illo.cardAmount')}</span>
        <span class="okb">
          <Check />
        </span>
      </div>
    </Illo>
  );
}

function GoalIllo() {
  return (
    <Illo>
      <Blob x={120} y={10} w={160} h={160} color="#CFF3E3" />
      <Paths viewBox="0 0 300 250" d={['M60 200 C 120 205, 90 130, 150 128 S 200 64, 242 60']} />
      <Orb x={24} y={164} size="md" icon={Coins} color="var(--save)" delay={0} />
      <Orb x={190} y={8} size="lg" icon={House} color="var(--acc)" delay={2} />
      <span class="pdot" style={{ left: '104px', top: '170px' }} />
      <span class="pdot" style={{ left: '146px', top: '123px', animationDelay: '.5s' }} />
      <span class="pdot" style={{ left: '194px', top: '86px', animationDelay: '1s' }} />
      <span
        class="tagf"
        style={{ left: '84px', top: '96px', color: 'var(--save-ink)', animationDelay: '-1s' }}
      >
        <Flag class="tagf__icon" /> {t('intro.illo.progress')}
      </span>
    </Illo>
  );
}
