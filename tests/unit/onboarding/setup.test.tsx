// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen, type SetupProps } from '../../../src/features/onboarding/SetupScreen';
import { USER } from '../fixtures';

type Write = SetupProps['write'];
let write: ReturnType<typeof vi.fn<Write>>;
let finish: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  localStorage.clear();
  write = vi.fn<Write>().mockResolvedValue(undefined);
  finish = vi.fn<() => void>();
});
afterEach(cleanup);

const open = () =>
  render(
    <SetupScreen
      userId={USER}
      profile={null}
      write={write}
      onFinish={finish}
      today="2026-09-24"
      loadName={() => Promise.resolve('')}
    />,
  );
const next = () => screen.getByRole('button', { name: /Continuer|Voir mon plan|pas de factures/ });
const question = () => screen.getByRole('heading', { level: 1 }).textContent;
const tables = () => write.mock.calls.map(([table]) => table);
const type = (label: string | RegExp, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });

async function answerUpTo(step: 'salary' | 'payday' | 'bills' | 'goal') {
  type('Ton prénom', 'Amel');
  fireEvent.click(next());
  await screen.findByText('Tu gagnes combien par mois ?');
  if (step === 'salary') return;
  type(/Salaire net/, '2000');
  fireEvent.click(next());
  await screen.findByText('Ton jour de paie ?');
  if (step === 'payday') return;
  fireEvent.click(screen.getByRole('button', { name: /^25/ }));
  fireEvent.click(next());
  await screen.findByText('Tes factures fixes ?');
  if (step === 'bills') return;
  fireEvent.click(next());
  await screen.findByText('Ton objectif d’épargne ?');
}

describe('SetupScreen', () => {
  it('asks one question at a time with a progress count', () => {
    open();
    expect(question()).toBe('Comment tu t’appelles ?');
    expect(screen.getByText('1/5')).toBeTruthy();
    expect(screen.getByText(/Moi c’est Aam Salah/)).toBeTruthy();
  });

  it('validates the name and saves the profile before moving on', async () => {
    open();
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    type('Ton prénom', '   ');
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    type('Ton prénom', 'Amel');
    fireEvent.click(next());
    await screen.findByText('Tu gagnes combien par mois ?');
    expect(write).toHaveBeenCalledWith(
      'profiles',
      expect.objectContaining({ first_name: 'Amel', onboarded_at: null }),
    );
  });

  it('refuses a salary under 100 TND and previews the 50/30/20 split', async () => {
    open();
    await answerUpTo('salary');
    type(/Salaire net/, '80');
    expect(screen.getByText('Au moins 100 TND, sinon le partage n’a pas de sens.')).toBeTruthy();
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    type(/Salaire net/, '2000');
    const preview = screen.getByTestId('split-preview').textContent ?? '';
    expect(preview).toMatch(/1\s000\sTND/);
    expect(preview).toMatch(/600\sTND/);
    expect(preview).toMatch(/400\sTND/);
    expect((next() as HTMLButtonElement).disabled).toBe(false);
  });

  it('needs a payday, and "fin du mois" means payday 0', async () => {
    open();
    await answerUpTo('payday');
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    const end = screen.getByRole('button', { name: /fin du mois/ });
    fireEvent.click(end);
    expect(end.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(next());
    await screen.findByText('Tes factures fixes ?');
    expect(write).toHaveBeenLastCalledWith(
      'profiles',
      expect.objectContaining({ payday: 0, salary_mil: 2_000_000 }),
    );
  });

  it('keeps the answers when going back', async () => {
    open();
    await answerUpTo('payday');
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByLabelText<HTMLInputElement>(/Salaire net/).value).toBe('2000');
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByLabelText<HTMLInputElement>('Ton prénom').value).toBe('Amel');
  });

  it('skips bills without writing any', async () => {
    open();
    await answerUpTo('bills');
    expect(next().textContent).toBe('Je n’ai pas de factures fixes');
    fireEvent.click(next());
    await screen.findByText('Ton objectif d’épargne ?');
    expect(tables()).not.toContain('bills');
  });

  it('meters the bills against Besoins, amber above 80 %, explained above 100 %', async () => {
    open();
    await answerUpTo('bills');
    fireEvent.click(screen.getByRole('button', { name: /Loyer/ }));
    type('Montant Loyer, en TND', '800');
    expect(screen.getByTestId('meter').className).not.toContain('warn');
    type('Montant Loyer, en TND', '810');
    expect(screen.getByTestId('meter').className).toContain('warn');
    type('Montant Loyer, en TND', '1010');
    expect(screen.getByTestId('meter').textContent).toMatch(/dépassent tes Besoins de 10\sTND/);
  });

  it('does not duplicate bills when the step is repeated', async () => {
    open();
    await answerUpTo('bills');
    fireEvent.click(screen.getByRole('button', { name: /Loyer/ }));
    fireEvent.click(next());
    await screen.findByText('Ton objectif d’épargne ?');
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    fireEvent.click(next());
    await screen.findByText('Ton objectif d’épargne ?');
    const billIds = write.mock.calls.filter(([t]) => t === 'bills').map(([, row]) => row.id);
    expect(billIds).toHaveLength(2);
    expect(new Set(billIds).size).toBe(1);
  });

  it('prefills Sécurité with three salaries and shows when the goal is reached', async () => {
    open();
    await answerUpTo('goal');
    fireEvent.click(screen.getByRole('button', { name: 'Sécurité' }));
    expect(screen.getByLabelText<HTMLInputElement>(/Il te faut combien/).value).toBe('6000');
    expect(screen.getByText(/À 400\sTND par mois, tu y es en/)).toBeTruthy();
    type(/déjà mis de côté/, '6000');
    expect(screen.getByText('Déjà atteint. Bravo, on vise plus haut ?')).toBeTruthy();
  });

  it('writes the goal and hands over to the reveal', async () => {
    open();
    await answerUpTo('goal');
    fireEvent.click(screen.getByRole('button', { name: 'Voyage' }));
    fireEvent.click(next());
    await waitFor(() => expect(finish).toHaveBeenCalledOnce());
    expect(write).toHaveBeenLastCalledWith(
      'goals',
      expect.objectContaining({ name: 'Mon voyage', target_mil: 3_000_000 }),
    );
  });

  it('resumes at the saved step with the earlier answers after a remount', async () => {
    open();
    await answerUpTo('payday');
    cleanup();
    open();
    expect(question()).toBe('Ton jour de paie ?');
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByLabelText<HTMLInputElement>(/Salaire net/).value).toBe('2000');
  });

  it('pre-fills the first name from Google', async () => {
    render(
      <SetupScreen
        userId={USER}
        profile={null}
        write={write}
        onFinish={finish}
        loadName={() => Promise.resolve('Sofiene')}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Ton prénom').value).toBe('Sofiene'));
  });
});
