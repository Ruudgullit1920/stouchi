/* Writes the payday deposits the device owes (spec §4.6) when the app starts
 * and whenever it comes back to the foreground. The rows go through the
 * outbox as insert-only, so a deposit already written by another device or by
 * the Phase 4 cron (same id) is left as it is. */
import { effect, untracked } from '@preact/signals';
import { todayTunis } from '../shared/dates';
import { activeGoal, dueDeposits } from '../shared/payday';
import { foldPatch } from '../shared/plan';
import type { LocalDb } from './localdb';
import type { Store } from './store';
import { writeRow } from './write';

export async function runPayday(db: LocalDb, store: Store, now: Date = new Date()): Promise<void> {
  const userId = store.userId.value;
  const profile = store.profile.value;
  /* Until this session has pulled, the device may hold an old goal, salary or moves. */
  if (!userId || !profile || !store.sync.value.pulled) return;
  /* a pending plan whose period has opened becomes the main plan (Phase 5) */
  const fold = foldPatch(profile, todayTunis(now));
  if (fold) await writeRow(db, userId, 'profiles', { ...profile, ...fold }, store);
  const due = dueDeposits({
    profile,
    goal: activeGoal(store.goals.value),
    moves: store.savingsMoves.value,
    now,
  });
  for (const move of due) await writeRow(db, userId, 'savings_moves', move, store);
}

type PaydayWindow = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
  document: Pick<Document, 'visibilityState'>;
};

/** Runs on the first load and on every return to the app. Returns a stop function. */
export function startPayday(
  db: LocalDb,
  store: Store,
  win: PaydayWindow = window,
  clock: () => Date = () => new Date(),
): () => void {
  let running: Promise<void> | null = null;
  const run = () => {
    running ??= runPayday(db, store, clock())
      .catch(() => undefined)
      .finally(() => (running = null));
  };
  const onVisible = () => {
    if (win.document.visibilityState === 'visible') run();
  };
  const stopEffect = effect(() => {
    if (store.sync.value.pulled && store.profile.value) untracked(run);
  });
  win.addEventListener('focus', run);
  win.addEventListener('visibilitychange', onVisible);
  return () => {
    stopEffect();
    win.removeEventListener('focus', run);
    win.removeEventListener('visibilitychange', onVisible);
  };
}
