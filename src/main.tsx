import { render } from 'preact';
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

const root = document.getElementById('app');
if (root) render(<App />, root);
