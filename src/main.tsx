import { render } from 'preact';
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

const root = document.getElementById('app');
if (root) render(<App />, root);

/* PostHog (error tracking and analytics) once the page has loaded and gone
   idle, so it neither counts in nor competes with the first load (spec §8.4,
   §8.7; posthog-js alone would put first-load JS over the 150 kB budget) */
const startMonitoring = () => void initMonitoring().catch(() => undefined);
const whenIdle = () =>
  'requestIdleCallback' in window
    ? requestIdleCallback(startMonitoring, { timeout: 5000 })
    : setTimeout(startMonitoring, 1000);
if (document.readyState === 'complete') whenIdle();
else addEventListener('load', whenIdle, { once: true });
