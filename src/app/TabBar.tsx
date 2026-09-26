import { ChartNoAxesColumn, CircleUserRound, House, Plus, Target, type LucideIcon } from 'lucide-preact';
import { t, type StringKey } from '../shared/i18n/t';
import { navigate, route, type RouteName } from './router';

type Tab = { name: RouteName; label: StringKey; icon: LucideIcon };
const LEFT: Tab[] = [
  { name: 'budget', label: 'nav.budget', icon: House },
  { name: 'history', label: 'nav.history', icon: ChartNoAxesColumn },
];
const RIGHT: Tab[] = [
  { name: 'goal', label: 'nav.goal', icon: Target },
  { name: 'me', label: 'nav.me', icon: CircleUserRound },
];

/** The floating tab bar with the raised + (spec §3). The pot ledger belongs to Budget.
 * Tabs switch whole screens, so they are navigation: aria-current, not a tablist. */
export function TabBar({ onAdd, addOpen = false }: { onAdd: () => void; addOpen?: boolean }) {
  const current = route.value.name === 'pot' ? 'budget' : route.value.name;
  const tab = ({ name, label, icon: Icon }: Tab) => (
    <button
      key={name}
      type="button"
      class={current === name ? 'nav__tab on' : 'nav__tab'}
      aria-current={current === name ? 'page' : undefined}
      onClick={() => navigate(`#/${name}`)}
    >
      <Icon size={22} aria-hidden="true" />
      {t(label)}
    </button>
  );
  return (
    <nav class={addOpen ? 'nav dial-open' : 'nav'} aria-label={t('nav.label')}>
      {LEFT.map(tab)}
      <div class="nav__fab-cell">
        <button
          type="button"
          class={addOpen ? 'fab open' : 'fab'}
          aria-label={t('nav.add')}
          aria-expanded={addOpen}
          onClick={onAdd}
        >
          <Plus size={26} aria-hidden="true" />
        </button>
      </div>
      {RIGHT.map(tab)}
    </nav>
  );
}
