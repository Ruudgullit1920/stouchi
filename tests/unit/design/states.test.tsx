// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../../../src/design/components/EmptyState';
import { ErrorState } from '../../../src/design/components/ErrorState';
import { Skeleton } from '../../../src/design/components/Skeleton';

afterEach(cleanup);

describe('loading, empty and error states', () => {
  it('loading: a busy status with a spoken label, and the requested lines', () => {
    const { container } = render(<Skeleton lines={4} />);
    const status = screen.getByRole('status', { name: 'Chargement…' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('.skeleton__line')).toHaveLength(4);
  });

  it('empty: title, body and an optional action', () => {
    render(
      <EmptyState
        title="Rien ce mois-ci"
        body="Tes dépenses apparaîtront ici."
        action={<button type="button">Ajouter</button>}
      />,
    );
    expect(screen.getByText('Rien ce mois-ci')).toBeTruthy();
    expect(screen.getByText('Tes dépenses apparaîtront ici.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeTruthy();
  });

  it('error: announced as an alert, with a working retry', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Ça n’a pas marché');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
