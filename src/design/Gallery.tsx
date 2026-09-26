import { useCallback, useState } from 'preact/hooks';
import { Coffee, PiggyBank, ShoppingCart, Zap } from 'lucide-preact';
import { t, type StringKey } from '../shared/i18n/t';
import { Amount } from './components/Amount';
import { Button } from './components/Button';
import { EmptyState } from './components/EmptyState';
import { ErrorState } from './components/ErrorState';
import { LedgerRow } from './components/LedgerRow';
import { Pill } from './components/Pill';
import { SegmentedBar } from './components/SegmentedBar';
import { Sheet } from './components/Sheet';
import { Skeleton } from './components/Skeleton';
import { Toast, type ToastData } from './components/Toast';
import './gallery.css';

type Filter = 'all' | 'needs' | 'wants';
const FILTERS: Record<Filter, StringKey> = { all: 'gallery.all', needs: 'pot.needs', wants: 'pot.wants' };

/* Every design-system component in every state, on one page: the E2E and axe
   run against it, and it is the visual reference while screens are rebuilt. */
export function Gallery() {
  const [filter, setFilter] = useState<Filter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const pots = [
    { label: t('pot.needs'), mil: 1_250_000, color: 'var(--need)' },
    { label: t('pot.wants'), mil: 750_000, color: 'var(--want)' },
    { label: t('pot.savings'), mil: 500_000, color: 'var(--save)' },
  ];

  return (
    <main class="gallery">
      <h1>{t('gallery.title')}</h1>

      <section aria-labelledby="g-pots">
        <h2 id="g-pots" class="label">
          {t('gallery.pots')}
        </h2>
        <p class="gallery__big">
          <Amount mil={640_000} />
        </p>
        <p class="gallery__caption">{t('gallery.remaining')}</p>
        <SegmentedBar segments={pots} />
        <ul class="legend">
          {pots.map((p) => (
            <li key={p.label}>
              <span class="legend__dot" style={{ background: p.color }} />
              {p.label}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="g-ledger">
        <h2 id="g-ledger" class="label">
          {t('gallery.ledger')}
        </h2>
        <LedgerRow
          icon={ShoppingCart}
          tint="var(--need)"
          title="Carrefour"
          subtitle={t('category.courses')}
          mil={-32_500}
        />
        <LedgerRow
          icon={Coffee}
          tint="var(--want)"
          title={t('category.cafe')}
          subtitle={t('pot.wants')}
          mil={-12_000}
        />
        <LedgerRow
          icon={Zap}
          tint="var(--need)"
          title="STEG"
          subtitle={t('category.factures')}
          mil={-95_000}
        />
        <LedgerRow icon={PiggyBank} tint="var(--save)" title={t('pot.savings')} mil={200_000} sign />
      </section>

      <section aria-labelledby="g-pills">
        <h2 id="g-pills" class="label">
          {t('gallery.pills')}
        </h2>
        <div class="pills">
          {(Object.keys(FILTERS) as Filter[]).map((k) => (
            <Pill key={k} label={t(FILTERS[k])} pressed={filter === k} onToggle={() => setFilter(k)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="g-buttons">
        <h2 id="g-buttons" class="label">
          {t('gallery.buttons')}
        </h2>
        <div class="buttons">
          <Button onClick={() => setSheetOpen(true)}>{t('gallery.openSheet')}</Button>
          <Button
            variant="secondary"
            onClick={() =>
              setToast({
                id: Date.now(),
                message: t('gallery.toast'),
                actionLabel: t('action.undo'),
                onAction: () => undefined,
              })
            }
          >
            {t('gallery.showToast')}
          </Button>
        </div>
      </section>

      <section aria-labelledby="g-states">
        <h2 id="g-states" class="label">
          {t('gallery.states')}
        </h2>
        <Skeleton />
        <EmptyState title={t('gallery.empty.title')} body={t('gallery.empty.body')} />
        <ErrorState onRetry={() => undefined} />
      </section>

      <Sheet open={sheetOpen} title={t('gallery.sheetTitle')} onClose={closeSheet}>
        <p>{t('gallery.sheetBody')}</p>
        <Button onClick={closeSheet}>{t('gallery.primary')}</Button>
      </Sheet>
      <Toast toast={toast} onDismiss={dismissToast} />
    </main>
  );
}
