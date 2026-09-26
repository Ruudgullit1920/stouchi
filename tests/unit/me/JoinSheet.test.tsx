// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoupleError } from '../../../src/data/couple';
import { codeInput, JoinSheet } from '../../../src/features/me/JoinSheet';
import { t, type StringKey } from '../../../src/shared/i18n/t';

afterEach(cleanup);

describe('codeInput', () => {
  it.each([
    ['stc-abc234', 'STC-ABC234', 'STC-ABC234'],
    ['STCABC234', 'STC-ABC234', 'STC-ABC234'],
    [' stc abc 234 ', 'STC-ABC234', 'STC-ABC234'],
    ['abc234', 'STC-ABC234', 'STC-ABC234'],
    ['ab c', 'ABC', null],
    ['stc', 'STC', null],
    ['STC-AB', 'STC-AB', null],
    ['STC-ABC2345', 'STC-ABC234', 'STC-ABC234'],
    ['', '', null],
  ])('%j shows %j and gives %j', (typed, shown, code) => {
    expect(codeInput(typed)).toEqual({ shown, code });
  });
});

const open = (join = vi.fn().mockResolvedValue(undefined), onJoined = vi.fn()) => {
  render(<JoinSheet join={join} onJoined={onJoined} />);
  return { join, onJoined, input: screen.getByLabelText<HTMLInputElement>("Code d'invitation") };
};
const go = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Rejoindre le foyer' });

describe('JoinSheet', () => {
  it('formats as typed and enables Rejoindre only when complete', () => {
    const { input } = open();
    expect(go().disabled).toBe(true);
    fireEvent.input(input, { target: { value: 'stc-abc2' } });
    expect(input.value).toBe('STC-ABC2');
    expect(go().disabled).toBe(true);
    fireEvent.input(input, { target: { value: 'stc-abc234' } });
    expect(go().disabled).toBe(false);
  });

  it('joins with the normalised code', async () => {
    const { join, onJoined, input } = open();
    fireEvent.input(input, { target: { value: 'abc 234' } });
    fireEvent.click(go());
    await waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(join).toHaveBeenCalledWith('STC-ABC234');
  });

  it.each<StringKey>([
    'couple.err.invalid',
    'couple.err.expired',
    'couple.err.own',
    'couple.err.full',
    'couple.err.paired',
    'couple.err.tries',
    'couple.err.offline',
    'couple.err.generic',
  ])('shows %s under the code, and typing clears it', async (key) => {
    const { onJoined, input } = open(vi.fn().mockRejectedValue(new CoupleError(key)));
    fireEvent.input(input, { target: { value: 'STC-ABC234' } });
    fireEvent.click(go());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(t(key));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    expect(onJoined).not.toHaveBeenCalled();
    fireEvent.input(input, { target: { value: 'STC-ABC23' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
