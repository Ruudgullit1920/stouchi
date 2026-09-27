import { ChevronLeft } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ScreenProps } from '../../app/Shell';
import { back, route } from '../../app/router';
import { EmptyState } from '../../design/components/EmptyState';
import { Pill } from '../../design/components/Pill';
import { Skeleton } from '../../design/components/Skeleton';
import { data, pushApi } from '../../data/app';
import { markAllRead, markRead } from '../../data/notifications';
import { t } from '../../shared/i18n/t';
import type { Notification, NotificationActionT } from '../../shared/schemas';
import { inCurrentPeriod, runAction } from './actions';
import { partnerText } from './partner';
import { FILTERS, groupNotifications, inFilter, type Filter } from './group';
import { NotificationRow } from './NotificationRow';
import { PushCard, PushSwitch } from './PushCard';
import './notifications.css';

/** What Aam Salah wrote (spec §4.5), newest first, with one-tap actions. */
export function NotificationsScreen({ store }: ScreenProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const rows = store.notifications.value;
  const unread = store.unreadCount.value;
  const now = new Date();
  const shown = rows.filter((r) => inFilter(r.trigger, filter));

  const push = useMemo(pushApi, []);
  const read = (row: Notification) => {
    if (data.db) void markRead(data.db, store, [row.id]);
  };
  /* opened from a push (#/notifications/<id>): that row is read, once it is here */
  const opened = route.value.params.read;
  useEffect(() => {
    const row = rows.find((r) => r.id === opened);
    if (row && !row.read_at) read(row);
  }, [opened, rows]);
  const act = (row: Notification, action: NotificationActionT, answer?: 'accept' | 'refuse') => {
    if (data.db) void runAction(row, action, { db: data.db, store }, answer);
  };

  let body;
  if (!rows.length && store.sync.value.load === 'loading') body = <Skeleton lines={6} />;
  else if (!shown.length) body = <EmptyState title={t('notify.empty.title')} body={t('notify.empty.body')} />;
  else
    body = groupNotifications(shown, now).map((g) => (
      <section key={g.group}>
        <h2 class="ngroup">{t(`notify.group.${g.group}`)}</h2>
        <ul class="nlist">
          {g.rows.map((r) => (
            <NotificationRow
              key={r.id}
              row={r}
              now={now}
              done={store.actedOn.value[r.id]}
              pastPeriod={!inCurrentPeriod(r, store.profile.value?.payday ?? 1, now)}
              text={partnerText(r, store)}
              onOpen={read}
              onAction={act}
            />
          ))}
        </ul>
      </section>
    ));

  return (
    <>
      <header class="top">
        <button type="button" class="icon-btn" aria-label={t('action.back')} onClick={back}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <h1 class="notif-h1">{t('notify.title')}</h1>
        <button
          type="button"
          class="readall"
          disabled={unread === 0}
          onClick={() => {
            if (data.db) void markAllRead(data.db, store);
          }}
        >
          {t('notify.readAll')}
        </button>
      </header>
      <div class="filters" role="group" aria-label={t('notify.filters')}>
        {FILTERS.map((f) => (
          <Pill
            key={f}
            label={t(`notify.filter.${f}`)}
            pressed={filter === f}
            onToggle={() => setFilter(f)}
          />
        ))}
      </div>
      {push && <PushCard api={push} />}
      {body}
      {push && <PushSwitch api={push} />}
      <p class="notif-foot">{t('notify.foot')}</p>
    </>
  );
}
