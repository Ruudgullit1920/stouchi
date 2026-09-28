import type { ComponentType } from 'preact';
import { Suspense } from 'preact/compat';
import { Skeleton } from '../design/components/Skeleton';
import type { Store } from '../data/store';
import type { Expense } from '../shared/schemas';
import { FailedWrites } from './FailedWrites';
import { OfflineBadge } from './OfflineBadge';
import { SessionLost } from './SessionLost';
import { route, routePath, type RouteName } from './router';
import { SheetHost } from './SheetHost';
import { TabBar } from './TabBar';
import { ToastHost } from './ToastHost';
import { UpdateToast } from './UpdateToast';

export type ScreenProps = { store: Store; onOpenExpense?: (e: Expense) => void; onAdd?: () => void };
type Props = {
  store: Store;
  screens: Partial<Record<RouteName, ComponentType<ScreenProps>>>;
  onAdd: () => void;
  /** the + speed dial is open */
  addOpen?: boolean;
  onOpenExpense: (e: Expense) => void;
  onRetry: (key: string) => void;
  onDiscard: (key: string) => void;
};

/** The signed-in app: the current screen, the tab bar, and the overlays. */
export function Shell({ store, screens, onAdd, addOpen, onOpenExpense, onRetry, onDiscard }: Props) {
  const r = route.value;
  const Screen = screens[r.name] ?? screens.budget;
  const push = r.name === 'pot' || r.name === 'notifications';
  return (
    <div class="app">
      {/* the pot ledger is white (the prototype's .ledger); other pushed screens keep the grey */}
      <main
        key={routePath(r)}
        class={push ? (r.name === 'pot' ? 'screen push ledger' : 'screen push') : 'screen'}
      >
        <OfflineBadge store={store} />
        <SessionLost store={store} />
        <FailedWrites store={store} onRetry={onRetry} onDiscard={onDiscard} />
        <Suspense fallback={<Skeleton lines={6} />}>
          {Screen && <Screen store={store} onOpenExpense={onOpenExpense} onAdd={onAdd} />}
        </Suspense>
      </main>
      <TabBar onAdd={onAdd} addOpen={addOpen} />
      <SheetHost />
      <ToastHost />
      <UpdateToast />
    </div>
  );
}
