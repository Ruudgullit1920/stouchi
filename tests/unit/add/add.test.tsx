// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../../../src/data/store';
import { AddSheet } from '../../../src/features/add/AddSheet';
import type { NewExpense } from '../../../src/shared/schemas';
import { profile, USER } from '../fixtures';

let store: Store;
let created: NewExpense[];
let finish: () => void;
const repo = {
  create: vi.fn((e: NewExpense) => {
    created.push(e);
    return new Promise<void>((r) => (finish = r));
  }),
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  store = createStore();
  store.userId.value = USER;
  store.profile.value = profile();
  store.sync.value = { ...store.sync.value, load: 'ready' };
  created = [];
  repo.create.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const key = (k: string) => fireEvent.click(screen.getByRole('button', { name: k }));
const save = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Enregistrer' });

describe('AddSheet', () => {
  it('shows what is left in each pot on the switch, Besoins first', () => {
    render(<AddSheet store={store} repo={repo} onDone={() => undefined} />);
    const needs = screen.getByRole('button', { name: /Besoins · reste/ });
    expect(needs.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Envies · reste/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps Enregistrer off until an amount is typed', () => {
    render(<AddSheet store={store} repo={repo} onDone={() => undefined} />);
    expect(save().disabled).toBe(true);
    key('0');
    expect(save().disabled).toBe(true);
    key('4');
    key('Virgule');
    key('5');
    expect(screen.getByText('4,5')).toBeTruthy();
    expect(save().disabled).toBe(false);
    key('Effacer');
    expect(screen.getByText('4,')).toBeTruthy();
  });

  it('switching pot shows its categories and picks its first one', () => {
    render(<AddSheet store={store} repo={repo} onDone={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Courses' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Envies · reste/ }));
    expect(screen.queryByRole('button', { name: 'Courses' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Resto' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('saves the expense once, even on a double tap, then closes', async () => {
    const onDone = vi.fn();
    render(<AddSheet store={store} repo={repo} onDone={onDone} />);
    key('1');
    key('2');
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: '  Café Ali ' } });
    fireEvent.click(save());
    fireEvent.click(save());
    expect(repo.create).toHaveBeenCalledOnce();
    finish();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(created[0]).toMatchObject({
      user_id: USER,
      amount_mil: 12_000,
      category: 'courses',
      pot: 'needs',
      label: 'Café Ali',
      spent_on: '2026-09-10',
      source: 'manual',
      household_id: null,
      bill_id: null,
    });
  });

  it('refuses a date in the future', () => {
    render(<AddSheet store={store} repo={repo} onDone={() => undefined} />);
    key('5');
    fireEvent.input(screen.getByLabelText('Date'), { target: { value: '2026-09-11' } });
    expect(save().disabled).toBe(true);
    expect(screen.getByText('La date ne peut pas être dans le futur.')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Date'), { target: { value: '2026-09-09' } });
    expect(save().disabled).toBe(false);
  });

  it('refuses a date older than the 12 periods kept', () => {
    render(<AddSheet store={store} repo={repo} onDone={() => undefined} />);
    key('5');
    fireEvent.input(screen.getByLabelText('Date'), { target: { value: '2025-09-30' } });
    expect(save().disabled).toBe(true);
    expect(screen.getByText('Cette date est trop ancienne.')).toBeTruthy();
  });
});
