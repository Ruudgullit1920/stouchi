import { lazy, Suspense } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { Gallery } from '../design/Gallery';
import { ErrorState } from '../design/components/ErrorState';
import { Skeleton } from '../design/components/Skeleton';
import { boot, data, discardWrite, retryWrite, store, syncNow, writeMine } from '../data/app';
import { AddSheet } from '../features/add/AddSheet';
import { AddChooser } from '../features/chat/AddChooser';
import { ExpenseDetailSheet } from '../features/add/ExpenseDetailSheet';
import { BudgetScreen } from '../features/budget/BudgetScreen';
import { GoalScreen } from '../features/goal/GoalScreen';
import { HistoryScreen } from '../features/history/HistoryScreen';
import { MeScreen } from '../features/me/MeScreen';
import { PotScreen } from '../features/pot/PotScreen';
import { t } from '../shared/i18n/t';
import { activeGoal } from '../shared/payday';
import { ChatHost, prefetchChat } from './ChatHost';
import { gate, readIntroSeen } from './gate';
import { navigate, route, startRouter } from './router';
import { closeSheet, openSheet } from './ui';
import { Shell, type ScreenProps } from './Shell';
import type { ComponentType } from 'preact';
import type { RouteName } from './router';
import './shell.css';

const SCREENS: Partial<Record<RouteName, ComponentType<ScreenProps>>> = {
  budget: BudgetScreen,
  pot: PotScreen,
  history: HistoryScreen,
  goal: GoalScreen,
  me: MeScreen,
};

/* Notifications are their own lazy chunk (Phase 4). */
const NotificationsScreen = lazy(() =>
  import('../features/notifications/NotificationsScreen').then((m) => ({ default: m.NotificationsScreen })),
);
SCREENS.notifications = NotificationsScreen;

/* The first-run screens are one lazy chunk: returning users never download them. */
const onboarding = () => import('../features/onboarding');
const IntroScreen = lazy(() => onboarding().then((m) => ({ default: m.IntroScreen })));
const LoginScreen = lazy(() => onboarding().then((m) => ({ default: m.LoginScreen })));
const SetupScreen = lazy(() => onboarding().then((m) => ({ default: m.SetupScreen })));
const RevealScreen = lazy(() => onboarding().then((m) => ({ default: m.RevealScreen })));

/* the sheet hands focus back to whatever had it when it opened: make that the + */
const focusAdd = () => document.querySelector<HTMLElement>('.nav .fab')?.focus();

const loadingScreen = (
  <main class="screen" aria-busy="true">
    <Skeleton lines={6} />
  </main>
);

type State = 'booting' | 'signed-in' | 'signed-out' | 'error';

export function App() {
  const [state, setState] = useState<State>('booting');
  const [adding, setAdding] = useState(false);
  const start = () => {
    setState('booting');
    boot().then(setState, () => setState('error'));
  };
  useEffect(startRouter, []);
  useEffect(start, []);
  /* the chat chunk comes down once signed in, so it still opens offline */
  useEffect(() => {
    if (state === 'signed-in') prefetchChat();
  }, [state]);

  /* The component gallery stays reachable for the design E2E and axe checks. */
  if (route.value.name === 'gallery') return <Gallery />;
  if (state === 'booting') return loadingScreen;
  if (state === 'error')
    return (
      <main class="screen">
        <ErrorState onRetry={start} />
      </main>
    );
  const signedIn = state === 'signed-in';
  const { load, authLost } = store.sync.value;
  const profile = store.profile.value;
  if (signedIn && !profile && load === 'error')
    return (
      <main class="screen">
        <ErrorState onRetry={() => void syncNow()} />
      </main>
    );
  const place = gate({
    signedIn,
    sessionLost: authLost,
    profile,
    loading: load === 'loading',
    introSeen: readIntroSeen(),
    route: route.value.name,
  });
  if (place === 'loading') return loadingScreen;
  if (place === 'intro')
    return (
      <Suspense fallback={loadingScreen}>
        <IntroScreen onDone={() => navigate('#/login')} />
      </Suspense>
    );
  if (place === 'login')
    return (
      <Suspense fallback={loadingScreen}>
        <LoginScreen
          onSignedIn={() => {
            navigate('#/budget');
            /* same user back after a lost session: send what waited; otherwise start as them */
            if (signedIn) void syncNow();
            else start();
          }}
        />
      </Suspense>
    );
  if (place === 'setup' && store.userId.value)
    return (
      <Suspense fallback={loadingScreen}>
        <SetupScreen
          userId={store.userId.value}
          profile={profile}
          write={writeMine}
          onFinish={() => navigate('#/reveal')}
        />
      </Suspense>
    );
  if (place === 'reveal' && profile) {
    const goal = activeGoal(store.goals.value);
    const bills = store.bills.value.filter((b) => b.active).reduce((s, b) => s + b.amount_mil, 0);
    return (
      <Suspense fallback={loadingScreen}>
        <RevealScreen
          profile={profile}
          goalName={goal?.name ?? null}
          billsMil={bills}
          write={writeMine}
          onOpen={() => navigate('#/budget')}
        />
      </Suspense>
    );
  }
  const closeAdd = () => {
    setAdding(false);
    focusAdd();
  };
  return (
    <>
      <Shell
        store={store}
        screens={SCREENS}
        addOpen={adding}
        onAdd={() => setAdding(!adding)}
        onOpenExpense={(e) => {
          if (data.expenses)
            openSheet(
              t('detail.title'),
              <ExpenseDetailSheet store={store} expense={e} repo={data.expenses} onDone={closeSheet} />,
            );
        }}
        onRetry={(key) => void retryWrite(key)}
        onDiscard={(key) => void discardWrite(key)}
      />
      <AddChooser
        open={adding}
        onClose={closeAdd}
        onManual={() => {
          closeAdd();
          if (data.expenses)
            openSheet(t('add.title'), <AddSheet store={store} repo={data.expenses} onDone={closeSheet} />);
        }}
        onChat={() => {
          closeAdd();
          openSheet(t('chat.title'), <ChatHost />, 'sheet--chat');
        }}
      />
    </>
  );
}
