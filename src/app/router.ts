/* A small hash router: #/budget, #/history, #/goal, #/me, #/me/split|bills|notifications|couple, #/pot/needs|wants,
 * #/notifications, #/gallery (and the first-run places from Phase 2). Anything else is Budget. */
import { signal } from '@preact/signals';
import { isCategory } from '../shared/categories';

export type RouteName =
  | 'budget'
  | 'pot'
  | 'history'
  | 'goal'
  | 'me'
  | 'notifications'
  | 'intro'
  | 'login'
  | 'setup'
  | 'reveal'
  | 'gallery';
export interface Route {
  name: RouteName;
  params: Record<string, string>;
}

const SIMPLE: RouteName[] = [
  'budget',
  'history',
  'goal',
  'me',
  'notifications',
  'intro',
  'login',
  'setup',
  'reveal',
  'gallery',
];
const HOME: Route = { name: 'budget', params: {} };
const ME_SUBS = ['split', 'bills', 'notifications', 'couple'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  const [name, arg] = parts;
  if (parts.length === 1 && (SIMPLE as string[]).includes(name))
    return { name: name as RouteName, params: {} };
  if (name === 'pot' && parts.length === 2 && (arg === 'needs' || arg === 'wants'))
    return { name: 'pot', params: { pot: arg } };
  if (name === 'me' && parts.length === 2 && ME_SUBS.includes(arg))
    return { name: 'me', params: { sub: arg } };
  if (name === 'notifications' && parts.length === 2 && UUID.test(arg))
    return { name: 'notifications', params: { read: arg } };
  if (name === 'history' && parts.length === 2 && isCategory(arg))
    return { name: 'history', params: { category: arg } };
  return HOME;
}

export const routePath = (r: Route): string =>
  r.name === 'pot'
    ? `#/pot/${r.params.pot}`
    : r.params.category || r.params.read || r.params.sub
      ? `#/${r.name}/${r.params.category ?? r.params.read ?? r.params.sub}`
      : `#/${r.name}`;

export const route = signal<Route>(typeof location === 'undefined' ? HOME : parseRoute(location.hash));

export function navigate(path: string): void {
  route.value = parseRoute(path);
  if (location.hash !== path) location.hash = path;
}

/** Back from a push screen; with no history to go back to, go home. */
export function back(): void {
  if (history.length > 1) history.back();
  else navigate('#/budget');
}

export function startRouter(): () => void {
  const onHash = () => (route.value = parseRoute(location.hash));
  window.addEventListener('hashchange', onHash);
  return () => window.removeEventListener('hashchange', onHash);
}
