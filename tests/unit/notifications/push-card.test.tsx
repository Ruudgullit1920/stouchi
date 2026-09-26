// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushEnv } from '../../../src/data/push';
import { PushCard, PushSwitch, type PushApi } from '../../../src/features/notifications/PushCard';

const DAY = 86_400_000;
const NOW = new Date('2026-09-24T10:00:00+01:00');
const env = (e: Partial<PushEnv> = {}): PushEnv => ({
  now: NOW,
  onboardedAt: new Date(NOW.getTime() - 8 * DAY).toISOString(),
  permission: 'default',
  pushManager: true,
  ios: false,
  standalone: false,
  laterAt: null,
  ...e,
});

const api = (e: Partial<PushEnv> = {}, on = false): PushApi & { calls: string[] } => {
  const calls: string[] = [];
  let state = on;
  return {
    calls,
    env: () => env(e),
    isOn: () => Promise.resolve(state),
    enable: () => {
      calls.push('enable');
      state = true;
      return Promise.resolve('on' as const);
    },
    disable: () => {
      calls.push('disable');
      state = false;
      return Promise.resolve();
    },
  };
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('PushCard', () => {
  it('a user onboarded 8 days ago sees the card; “Activer” turns push on and hides it', async () => {
    const a = api();
    render(<PushCard api={a} />);
    fireEvent.click(screen.getByRole('button', { name: 'Activer' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Activer' })).toBeNull());
    expect(a.calls).toEqual(['enable']);
  });

  it('no card in the first week, nor once the permission is decided', () => {
    render(<PushCard api={api({ onboardedAt: new Date(NOW.getTime() - 2 * DAY).toISOString() })} />);
    render(<PushCard api={api({ permission: 'granted' })} />);
    expect(screen.queryByRole('button', { name: 'Activer' })).toBeNull();
  });

  it('“Plus tard” hides it and remembers it on this device', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    render(<PushCard api={api()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(screen.queryByRole('button', { name: 'Activer' })).toBeNull();
    expect(localStorage.getItem('stouchi:push-later')).toBe(String(NOW.getTime()));
    vi.useRealTimers();
  });
});

describe('PushSwitch', () => {
  it('shows the device’s state and turns push off and on', async () => {
    const a = api({ permission: 'granted' }, true);
    render(<PushSwitch api={a} />);
    const sw = await screen.findByRole('switch', { name: 'Notifications sur ce téléphone' });
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(a.calls).toEqual(['disable', 'enable']);
  });

  it('follows the card: Activer turns the switch on', async () => {
    const a = api();
    render(
      <>
        <PushCard api={a} />
        <PushSwitch api={a} />
      </>,
    );
    const sw = await screen.findByRole('switch');
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(screen.getByRole('button', { name: 'Activer' }));
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
  });

  it('is not shown where push can’t work or was refused', () => {
    render(<PushSwitch api={api({ pushManager: false })} />);
    render(<PushSwitch api={api({ permission: 'denied' })} />);
    render(<PushSwitch api={api({ ios: true, standalone: false })} />);
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
