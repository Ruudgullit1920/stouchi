import { render } from 'preact';
import posthog from 'posthog-js';
import '@fontsource-variable/plus-jakarta-sans/index.css';
import './design/tokens.css';
import './design/base.css';
import './design/components/components.css';
import { App } from './app/App';
import { navigate } from './app/router';
import { listenToServiceWorker } from './data/push';
import { NOTIFY_EVENT } from './data/sync';

/* Push only (Phase 4); the worker has no fetch handler, so dev never runs it. */
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) void navigator.serviceWorker.register('/sw.js');
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
  });
}

const root = document.getElementById('app');
if (root) render(<App />, root);
