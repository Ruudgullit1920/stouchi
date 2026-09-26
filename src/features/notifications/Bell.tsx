import { Bell as BellIcon } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { navigate } from '../../app/router';
import type { Store } from '../../data/store';
import { t } from '../../shared/i18n/t';
import './bell.css';

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const bellLabel = (unread: number): string =>
  unread === 0
    ? t('notify.bell')
    : unread === 1
      ? t('notify.bellUnread.one')
      : t('notify.bellUnread.many', { n: unread });

/** The bell on Budget: a dot while something is unread, one ring when more arrives. */
export function Bell({ store }: { store: Store }) {
  const unread = store.unreadCount.value;
  const before = useRef(unread);
  const [rings, setRings] = useState(0);
  useEffect(() => {
    if (unread > before.current && !reducedMotion()) setRings((r) => r + 1);
    before.current = unread;
  }, [unread]);

  return (
    <button
      type="button"
      class={rings ? 'icon-btn bell ring' : 'icon-btn bell'}
      aria-label={bellLabel(unread)}
      onClick={() => navigate('#/notifications')}
    >
      <BellIcon key={rings} aria-hidden="true" />
      <span class="bdot" hidden={unread === 0} />
    </button>
  );
}
