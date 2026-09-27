// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sheet } from '../../../src/app/ui';
import { createStore, type Store } from '../../../src/data/store';
import { HIDDEN } from '../../../src/design/components/Amount';
import { hideAmounts } from '../../../src/features/budget/hideAmounts';
import { GoalScreen } from '../../../src/features/goal/GoalScreen';
import { formatMoney } from '../../../src/shared/money';
import { coupleOn, goal, HOUSEHOLD, move, PARTNER, profile } from '../fixtures';

/* 2 000 TND, payday 1, 50/30/20 → 400 TND a month to savings; today 2026-09-10 */
let store: Store;
const G = goal({ name: 'Mon voyage', icon: 'plane', target_mil: 6_000_000 });
const norm = (s: string) => s.replace(/\s/g, ' ');
const text = () => norm(document.body.textContent ?? '');

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  hideAmounts.value = false;
  store = createStore();
  store.profile.value = profile();
  store.goals.value = [G];
  store.sync.value = { ...store.sync.value, load: 'ready' };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GoalScreen', () => {
  it('shows the goal: saved, target, percent, monthly rate and date', () => {
    store.savingsMoves.value = [
      move({ goal_id: G.id, amount_mil: 400_000, kind: 'payday', from_pot: null, occurred_on: '2026-09-01' }),
      move({ goal_id: G.id, amount_mil: 200_000, from_pot: null, occurred_on: '2026-09-05' }),
    ];
    render(<GoalScreen store={store} />);
    expect(text()).toContain('Mon voyage');
    expect(text()).toContain('10 %');
    expect(text()).toContain(norm(formatMoney(600_000, { unit: false })));
    expect(text()).toContain(norm(`sur ${formatMoney(6_000_000)}`));
    expect(text()).toContain(norm(`Au rythme de ${formatMoney(400_000)} / mois`));
    /* 5 400 left at 400 a month: 14 months → novembre 2027 */
    expect(text()).toContain('Novembre 2027');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(text()).toContain('Épargne de septembreAutomatique · 1 sept.');
    expect(text()).toContain('VersementVersement manuel · 5 sept.');
    expect(text()).toContain(norm(`2 · ${formatMoney(600_000)}`));
  });

  it('names a payday move by its month, with d’ before a vowel', () => {
    store.savingsMoves.value = [
      move({ goal_id: G.id, amount_mil: 400_000, kind: 'payday', from_pot: null, occurred_on: '2026-08-01' }),
    ];
    render(<GoalScreen store={store} />);
    expect(text()).toContain('Épargne d’août');
  });

  it('+100 a month shows the new date and how many months sooner', () => {
    render(<GoalScreen store={store} />);
    fireEvent.click(screen.getByRole('button', { name: '+100' }));
    /* 6 000 at 500 a month: 12 months → septembre 2027, 3 months sooner */
    expect(text()).toContain('Septembre 2027 — 3 mois plus tôt');
    expect(screen.getByRole('button', { name: '+100' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('says when the first deposit comes, when there is none yet', () => {
    render(<GoalScreen store={store} />);
    expect(text()).toContain('Ton premier versement arrive le 1 oct., avec ta paie.');
  });

  it('a reached goal: capped at 100 %, no "et si", a way to a new goal', () => {
    store.goals.value = [{ ...G, target_mil: 500_000 }];
    store.savingsMoves.value = [move({ goal_id: G.id, amount_mil: 600_000, from_pot: null })];
    render(<GoalScreen store={store} />);
    expect(text()).toContain('100 %');
    expect(text()).toContain('Atteint, mabrouk !');
    expect(text()).not.toContain('Et si tu mettais plus');
    expect(screen.getByRole('button', { name: 'Nouvel objectif' })).toBeTruthy();
  });

  it('no active goal: an empty state that offers to choose one', () => {
    store.goals.value = [{ ...G, archived_at: '2026-09-02T10:00:00+01:00' }];
    render(<GoalScreen store={store} />);
    expect(screen.getByRole('button', { name: 'Choisir un objectif' })).toBeTruthy();
  });

  it('hides the amounts when the eye is closed', () => {
    hideAmounts.value = true;
    store.savingsMoves.value = [move({ goal_id: G.id, amount_mil: 600_000, from_pot: null })];
    render(<GoalScreen store={store} />);
    expect(text()).toContain(HIDDEN);
    expect(text()).not.toContain(norm(formatMoney(600_000, { unit: false })));
  });

  it('opens the Verser sheet, the goal sheet, and the new-goal sheet', () => {
    render(<GoalScreen store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verser' }));
    expect(sheet.value?.title).toBe('Verser dans l’objectif');
    fireEvent.click(screen.getByRole('button', { name: /Modifier l’objectif$/ }));
    expect(sheet.value?.title).toBe('Modifier l’objectif');
    cleanup();
    store.goals.value = [];
    render(<GoalScreen store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choisir un objectif' }));
    expect(sheet.value?.title).toBe('Nouvel objectif');
  });
});

describe('GoalScreen — couple mode', () => {
  it('each deposit on the shared goal shows who made it', () => {
    const shared = { ...G, household_id: HOUSEHOLD };
    store.goals.value = [shared];
    store.household.value = coupleOn('Amira');
    store.profile.value = profile({ first_name: 'Sami' });
    store.savingsMoves.value = [
      move({ goal_id: G.id, amount_mil: 200_000, from_pot: null, occurred_on: '2026-09-05' }),
      move({
        goal_id: G.id,
        user_id: PARTNER,
        amount_mil: 100_000,
        from_pot: null,
        occurred_on: '2026-09-06',
      }),
    ];
    render(<GoalScreen store={store} />);
    expect(screen.getByRole('img', { name: 'Noté par Amira' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Noté par Sami' })).toBeTruthy();
  });

  it('no badge on a solo goal', () => {
    store.savingsMoves.value = [
      move({ goal_id: G.id, amount_mil: 200_000, from_pot: null, occurred_on: '2026-09-05' }),
    ];
    render(<GoalScreen store={store} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
