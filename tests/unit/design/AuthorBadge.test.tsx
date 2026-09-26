// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/preact';
import { Coffee } from 'lucide-preact';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthorBadge } from '../../../src/design/components/AuthorBadge';
import { LedgerRow } from '../../../src/design/components/LedgerRow';
import { authorOf } from '../../../src/shared/couple';
import { coupleOn, couplePending, HOUSEHOLD, PARTNER, SOLO, USER } from '../fixtures';

afterEach(cleanup);

describe('authorOf', () => {
  const me = { user_id: USER, first_name: 'Sami' };
  const mine = { user_id: USER, household_id: HOUSEHOLD };
  const theirs = { user_id: PARTNER, household_id: HOUSEHOLD };

  it('names nobody in solo mode, while an invite waits, or before the state is known', () => {
    for (const state of [SOLO, couplePending(), null]) expect(authorOf(mine, me, state)).toBeNull();
  });

  it('names me on my shared rows and the partner on theirs', () => {
    expect(authorOf(mine, me, coupleOn('Amira'))).toBe('Sami');
    expect(authorOf(theirs, me, coupleOn('Amira'))).toBe('Amira');
  });

  it('names nobody on a private row', () => {
    expect(authorOf({ user_id: USER, household_id: null }, me, coupleOn('Amira'))).toBeNull();
  });
});

describe('AuthorBadge', () => {
  it('shows the initials and says who logged it', () => {
    render(<AuthorBadge name="Amira Ben Salah" />);
    const badge = screen.getByRole('img', { name: 'Noté par Amira Ben Salah' });
    expect(badge.textContent).toBe('AB');
  });

  it('sits on a ledger row, and the row reads it out', () => {
    render(<LedgerRow icon={Coffee} tint="var(--want-soft)" title="Café" mil={-4_500} author="Amira" />);
    expect(screen.getByRole('button').textContent).toContain('A');
    expect(screen.getByRole('img', { name: 'Noté par Amira' })).toBeTruthy();
  });

  it('a row with no author has no badge', () => {
    render(<LedgerRow icon={Coffee} tint="var(--want-soft)" title="Café" mil={-4_500} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
