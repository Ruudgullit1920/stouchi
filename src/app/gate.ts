/* Which place the app shows (spec §4.1): intro and login when nobody is
 * signed in, setup until the first run is done, the reveal once, then the tabs. */
import type { Profile } from '../shared/schemas';
import type { RouteName } from './router';

export type Place = 'loading' | 'intro' | 'login' | 'setup' | 'reveal' | 'app';

export interface GateInput {
  signedIn: boolean;
  /** signed in on this device, but the session expired (spec §8.3) */
  sessionLost: boolean;
  profile: Profile | null;
  /** the device has not had its first load yet, so "no profile" means "not known" */
  loading: boolean;
  introSeen: boolean;
  route: RouteName;
}

export function gate({ signedIn, sessionLost, profile, loading, introSeen, route }: GateInput): Place {
  if (!signedIn) {
    if (route === 'login' || route === 'intro') return route;
    return introSeen ? 'login' : 'intro';
  }
  /* the app stays usable offline; the banner's button leads here */
  if (sessionLost && route === 'login') return 'login';
  if (!profile) return loading ? 'loading' : 'setup';
  /* The reveal stays on screen after it sets onboarded_at; before that, only a
     setup that got as far as the salary can reach it. */
  if (route === 'reveal' && (profile.onboarded_at || profile.salary_mil > 0)) return 'reveal';
  return profile.onboarded_at ? 'app' : 'setup';
}

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;
const INTRO_SEEN = 'stouchi.introSeen';

export function readIntroSeen(storage: KeyValue = localStorage): boolean {
  try {
    return storage.getItem(INTRO_SEEN) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(storage: KeyValue = localStorage): void {
  try {
    storage.setItem(INTRO_SEEN, '1');
  } catch {
    /* private mode: the intro shows again next time, nothing else changes */
  }
}
