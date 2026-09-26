// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from '../../../src/design/components/Sheet';
import { Toast } from '../../../src/design/components/Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      <Sheet open={open} title="Détail" onClose={() => setOpen(false)}>
        <button type="button">Premier</button>
        <button type="button">Dernier</button>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('moves focus in, traps Tab both ways, closes on Escape and gives focus back', () => {
    render(<SheetHarness />);
    const opener = screen.getByRole('button', { name: 'Ouvrir' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Détail' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = screen.getAllByRole('button', { name: 'Fermer' }).find((b) => dialog.contains(b));
    expect(document.activeElement).toBe(close);

    const last = screen.getByRole('button', { name: 'Dernier' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close as HTMLElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('renders nothing while closed', () => {
    render(
      <Sheet open={false} title="Détail" onClose={() => undefined}>
        x
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Toast', () => {
  it('keeps a polite live region mounted, even when empty', () => {
    render(<Toast toast={null} onDismiss={() => undefined} />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('shows the message, dismisses itself after 6 s, and the action undoes then dismisses', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onAction = vi.fn();
    render(
      <Toast
        toast={{ id: 1, message: 'Dépense supprimée.', actionLabel: 'Annuler', onAction }}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Dépense supprimée.');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(6000);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('a new inline onDismiss, or a new-but-same-id toast object, does not restart the timer', () => {
    vi.useFakeTimers();
    const onDismissA = vi.fn();
    const onDismissB = vi.fn();
    const toast = { id: 1, message: 'Dépense supprimée.' };
    const { rerender } = render(<Toast toast={toast} onDismiss={onDismissA} />);
    vi.advanceTimersByTime(3000);
    rerender(<Toast toast={{ ...toast }} onDismiss={onDismissB} />);
    vi.advanceTimersByTime(3000);
    expect(onDismissA).not.toHaveBeenCalled();
    expect(onDismissB).toHaveBeenCalledOnce();
  });

  it('a new id restarts the timer', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast toast={{ id: 1, message: 'Un.' }} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(3000);
    rerender(<Toast toast={{ id: 2, message: 'Deux.' }} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(3000);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('toast={null} before 6 s cancels the timer for good', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast toast={{ id: 1, message: 'Un.' }} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(3000);
    rerender(<Toast toast={null} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(10000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
