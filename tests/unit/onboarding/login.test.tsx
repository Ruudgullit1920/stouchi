// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginScreen, type AuthApi } from '../../../src/features/onboarding/LoginScreen';

afterEach(cleanup);

const api = (over: Partial<AuthApi> = {}): AuthApi => ({
  signIn: vi.fn().mockResolvedValue({ ok: true }),
  signUp: vi.fn().mockResolvedValue({ ok: true, confirm: false }),
  signInWithGoogle: vi.fn().mockResolvedValue(undefined),
  ...over,
});

function fill(email: string, password: string) {
  fireEvent.input(screen.getByLabelText('Adresse e-mail'), { target: { value: email } });
  fireEvent.input(screen.getByLabelText('Mot de passe'), { target: { value: password } });
}

describe('LoginScreen', () => {
  it('flags an incomplete e-mail inline and does not call the server', () => {
    const a = api();
    render(<LoginScreen api={a} onSignedIn={() => undefined} />);
    fill('sofien@', 'secret12');
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(screen.getByRole('alert').textContent).toBe('Cette adresse e-mail ne semble pas complète.');
    expect(screen.getByLabelText('Adresse e-mail').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Adresse e-mail').closest('.uline')?.classList.contains('bad')).toBe(true);
    expect(a.signIn).not.toHaveBeenCalled();
  });

  it('flags a short password', () => {
    render(<LoginScreen api={api()} onSignedIn={() => undefined} />);
    fill('sofien@exemple.tn', '123');
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(screen.getByRole('alert').textContent).toBe('Le mot de passe fait au moins 8 caractères.');
    expect(screen.getByLabelText('Mot de passe').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the server’s refusal in French', async () => {
    const a = api({ signIn: vi.fn().mockResolvedValue({ ok: false, key: 'auth.error.credentials' }) });
    const done = vi.fn();
    render(<LoginScreen api={a} onSignedIn={done} />);
    fill('sofien@exemple.tn', 'secret12');
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('E-mail ou mot de passe incorrect.'),
    );
    expect(done).not.toHaveBeenCalled();
  });

  it('signs in and hands over', async () => {
    const a = api();
    const done = vi.fn();
    render(<LoginScreen api={a} onSignedIn={done} />);
    fill('sofien@exemple.tn', 'secret12');
    fireEvent.submit(screen.getByLabelText('Mot de passe').closest('form') as HTMLFormElement);
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(a.signIn).toHaveBeenCalledWith('sofien@exemple.tn', 'secret12');
  });

  it('creates an account on the same screen and asks to check the mailbox', async () => {
    const a = api({ signUp: vi.fn().mockResolvedValue({ ok: true, confirm: true }) });
    const done = vi.fn();
    render(<LoginScreen api={a} onSignedIn={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Créer un compte');
    fill('amel@exemple.tn', 'secret12');
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    await waitFor(() => expect(screen.getByText('Vérifie ta boîte mail')).toBeTruthy());
    expect(a.signUp).toHaveBeenCalledWith('amel@exemple.tn', 'secret12');
    expect(done).not.toHaveBeenCalled();
  });

  it('goes straight in when sign-up needs no confirmation', async () => {
    const done = vi.fn();
    render(<LoginScreen api={api()} onSignedIn={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));
    fill('amel@exemple.tn', 'secret12');
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
  });

  it('offers Google and a password toggle', () => {
    const a = api();
    render(<LoginScreen api={a} onSignedIn={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer avec Google' }));
    expect(a.signInWithGoogle).toHaveBeenCalledOnce();
    const eye = screen.getByRole('button', { name: 'Afficher le mot de passe' });
    fireEvent.click(eye);
    expect(screen.getByLabelText('Mot de passe').getAttribute('type')).toBe('text');
    expect(eye.getAttribute('aria-pressed')).toBe('true');
  });
});
