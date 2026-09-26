/* Login and sign-up on one screen, ported from prototype #f-login (spec §4.2). */
import { ArrowRight, AtSign, Eye, EyeOff, ShieldCheck, Wallet } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { signIn, signInWithGoogle, signUp, validateCredentials } from '../../data/auth';
import { t, type StringKey } from '../../shared/i18n/t';
import { Blob, Illo, Orb, Paths } from './Illo';
import './onboarding.css';

export interface AuthApi {
  signIn: typeof signIn;
  signUp: typeof signUp;
  signInWithGoogle: () => Promise<void>;
}
const LIVE: AuthApi = { signIn, signUp, signInWithGoogle: () => signInWithGoogle() };

type Field = 'email' | 'password';
interface Problem {
  field?: Field;
  key: StringKey;
  /** bumps on every refusal so the shake replays */
  n: number;
}

export function LoginScreen({ onSignedIn, api = LIVE }: { onSignedIn: () => void; api?: AuthApi }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [checkMail, setCheckMail] = useState(false);
  const signup = mode === 'signup';

  const refuse = (key: StringKey, field?: Field) => setProblem((p) => ({ key, field, n: (p?.n ?? 0) + 1 }));

  async function submit(e?: Event) {
    e?.preventDefault();
    if (busy) return;
    const bad = validateCredentials(email, password);
    if (bad) return refuse(bad.key, bad.field);
    setProblem(null);
    setBusy(true);
    const res = signup ? await api.signUp(email, password) : await api.signIn(email, password);
    setBusy(false);
    if (!res.ok) return refuse(res.key);
    if ('confirm' in res && res.confirm) setCheckMail(true);
    else onSignedIn();
  }

  /* the label is keyed on the refusal count, so each refusal remounts it and replays the shake */
  const fieldClass = (f: Field) => (problem?.field === f ? 'uline bad shake' : 'uline');
  const invalid = (f: Field) => (problem?.field === f ? 'true' : undefined);

  return (
    <main class="flow login">
      <Illo wide>
        <Blob x={40} y={40} w={140} h={120} color="#FFE1D8" />
        <Paths viewBox="0 0 390 200" d={['M-10 150 C 60 90, 120 190, 200 120 S 330 50, 400 90']} stretch />
        <Orb x={78} y={84} size="md" icon={ShieldCheck} color="var(--need)" delay={0} />
        <Orb x={262} y={34} size="sm" icon={Wallet} color="var(--acc)" delay={2} />
      </Illo>
      <div class="login-body">
        <span class="wordmark">
          stouchi
          <i />
        </span>
        <h1>{t(signup ? 'signup.title' : 'login.title')}</h1>
        {checkMail ? (
          <div class="checkmail" role="status">
            <h2>{t('signup.checkMail.title')}</h2>
            <p>{t('signup.checkMail.body', { email: email.trim() })}</p>
            <button
              type="button"
              class="link-acc"
              onClick={() => {
                setCheckMail(false);
                setMode('signin');
              }}
            >
              {t('signup.checkMail.back')}
            </button>
          </div>
        ) : (
          <form class="login-body" noValidate onSubmit={(e) => void submit(e)}>
            <p class="login-sub">{t(signup ? 'signup.sub' : 'login.sub')}</p>
            <label class={fieldClass('email')} key={`e${problem?.field === 'email' ? problem.n : 0}`}>
              <span>{t('login.email')}</span>
              <div>
                <input
                  type="email"
                  autocomplete="email"
                  inputMode="email"
                  placeholder="toi@exemple.tn"
                  value={email}
                  aria-invalid={invalid('email')}
                  aria-describedby="l-err"
                  onInput={(e) => setEmail(e.currentTarget.value)}
                />
                <AtSign aria-hidden="true" />
              </div>
            </label>
            <div class={fieldClass('password')} key={`p${problem?.field === 'password' ? problem.n : 0}`}>
              <label for="l-pass">{t('login.password')}</label>
              <div>
                <input
                  id="l-pass"
                  type={shown ? 'text' : 'password'}
                  autocomplete={signup ? 'new-password' : 'current-password'}
                  placeholder="••••••••"
                  value={password}
                  aria-invalid={invalid('password')}
                  aria-describedby="l-err"
                  onInput={(e) => setPassword(e.currentTarget.value)}
                />
                <button
                  type="button"
                  aria-label={t('login.showPassword')}
                  aria-pressed={shown}
                  onClick={() => setShown(!shown)}
                >
                  {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
            </div>
            <div class="l-err" id="l-err" role="alert">
              {problem ? t(problem.key) : ''}
            </div>
            <div class="login-go">
              <button
                type="submit"
                class="roundbtn"
                aria-label={t(signup ? 'signup.go' : 'login.go')}
                aria-busy={busy}
                disabled={busy}
              >
                {busy ? <span class="spin" /> : <ArrowRight aria-hidden="true" />}
              </button>
              <p>
                {t(signup ? 'signup.hasAccount' : 'login.noAccount')}
                <br />
                <button
                  type="button"
                  class="link-acc"
                  onClick={() => {
                    setMode(signup ? 'signin' : 'signup');
                    setProblem(null);
                  }}
                >
                  {t(signup ? 'signup.toLogin' : 'login.toSignup')}
                </button>
              </p>
            </div>
          </form>
        )}
        <div class="or">
          <span>{t('login.or')}</span>
        </div>
        <button type="button" class="gbtn" onClick={() => void api.signInWithGoogle()}>
          <GoogleMark />
          {t('login.google')}
        </button>
      </div>
    </main>
  );
}

/** Google's own mark (its brand rules ask for it on the button). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
