// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newDraft, saveDraft } from '../../../src/features/onboarding/draft';
import { RevealScreen, type RevealProps } from '../../../src/features/onboarding/RevealScreen';
import { profile, USER } from '../fixtures';

const reduce = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q }));

type Write = RevealProps['write'];
let write: ReturnType<typeof vi.fn<Write>>;
let open: ReturnType<typeof vi.fn<() => void>>;
const NOW = new Date('2026-09-24T10:00:00+01:00');
const fresh = profile({ onboarded_at: null, first_name: 'Amel', payday: 25 });

beforeEach(() => {
  localStorage.clear();
  reduce(true);
  write = vi.fn<Write>().mockResolvedValue(undefined);
  open = vi.fn<() => void>();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (p = fresh) =>
  render(
    <RevealScreen
      profile={p}
      goalName="Mon voyage"
      billsMil={0}
      write={write}
      onOpen={open}
      now={() => NOW}
      today="2026-09-24"
    />,
  );

describe('RevealScreen', () => {
  it('marks the profile onboarded once', async () => {
    show();
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        'profiles',
        expect.objectContaining({ onboarded_at: NOW.toISOString() }),
      ),
    );
    cleanup();
    write.mockClear();
    show(profile({ onboarded_at: NOW.toISOString() }));
    await new Promise((r) => setTimeout(r, 20));
    expect(write).not.toHaveBeenCalled();
  });

  it('records "déjà épargné" with the setup draft’s id, then forgets the draft', async () => {
    const draft = {
      ...newDraft(USER),
      goal: { key: 'voyage' as const, target_mil: 3_000_000, saved_mil: 500_000 },
    };
    saveDraft(draft);
    show();
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        'savings_moves',
        expect.objectContaining({ id: draft.depositId, amount_mil: 500_000, kind: 'deposit' }),
      ),
    );
    expect(localStorage.getItem(`stouchi.setup.${USER}`)).toBeNull();
  });

  it('shows the three pots from the salary split', () => {
    show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Voilà ton plan, Amel !');
    const amounts = screen.getAllByTestId('rv-amount').map((e) => e.textContent?.replace(/\s/g, ' '));
    expect(amounts).toEqual(['1 000', '600', '400']);
    for (const name of ['Besoins', 'Envies', 'Épargne']) expect(screen.getByText(name)).toBeTruthy();
    expect(document.querySelector('.rv-pot--needs')).not.toBeNull();
    expect(screen.getByText(/Mon voyage/)).toBeTruthy();
  });

  it('opens the budget at once, before any animation ends', () => {
    reduce(false);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir mon budget' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('drops, counts and throws confetti only when motion is allowed', () => {
    show();
    expect(screen.getByTestId('confetti').children).toHaveLength(0);
    expect(document.querySelector('.rv.still')).not.toBeNull();
    cleanup();
    reduce(false);
    show();
    expect(screen.getByTestId('confetti').children.length).toBeGreaterThan(0);
    expect(document.querySelector('.rv.still')).toBeNull();
    expect(screen.getAllByTestId('rv-amount').map((e) => e.textContent)).toEqual(['0', '0', '0']);
  });
});
