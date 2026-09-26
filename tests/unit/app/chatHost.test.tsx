// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatHost } from '../../../src/app/ChatHost';

afterEach(cleanup);

const Panel = () => <p>la conversation</p>;

describe('ChatHost', () => {
  it('shows the chat once its chunk is loaded', async () => {
    render(<ChatHost load={() => Promise.resolve({ ChatPanel: Panel })} />);
    expect(await screen.findByText('la conversation')).toBeTruthy();
  });

  it('a chunk that cannot load (offline, first time) offers Réessayer, which loads it again', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ ChatPanel: Panel });
    render(<ChatHost load={load} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('la conversation')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
