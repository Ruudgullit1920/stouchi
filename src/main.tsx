import { render } from 'preact';
import posthog from 'posthog-js';
import '@fontsource-variable/plus-jakarta-sans/index.css';
import './design/tokens.css';
import './design/base.css';
import './design/components/components.css';
import { App } from './app/App';
import { initMonitoring } from './app/monitoring';
import { navigate } from './app/router';
import { checkForUpdates, watchUpdates } from './app/update';
import { listenToServiceWorker } from './data/push';
import { NOTIFY_EVENT } from './data/sync';

/* Push, the offline shell and "Nouvelle version" (spec §8.3): production only,
   so dev never serves from a cache. */
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD)
    void navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        watchUpdates(reg, navigator.serviceWorker, () => window.location.reload());
        const check = checkForUpdates(reg);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check(Date.now());
        });
      })
      .catch(() => undefined);
  const pull = () => window.dispatchEvent(new Event(NOTIFY_EVENT));
  listenToServiceWorker(navigator.serviceWorker, {
    notify: pull,
    open: (id) => {
      navigate(id ? `#/notifications/${id}` : '#/notifications');
      pull();
    },
  });
}

const phKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
if (phKey) {
  posthog.init(phKey, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com',
    person_profiles: 'identified_only',
    defaults: '2026-05-30',
  });
}

const root = document.getElementById('app');
if (root) render(<App />, root);

/* after the first paint, off the first-load budget (spec §8.4, §8.7) */
setTimeout(() => void initMonitoring().catch(() => undefined), 0);
