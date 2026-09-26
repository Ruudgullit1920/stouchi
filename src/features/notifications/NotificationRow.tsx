import {
  Bell,
  CalendarClock,
  ChartNoAxesColumn,
  HandCoins,
  Pencil,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-preact';
import { t } from '../../shared/i18n/t';
import { isTrigger, TRIGGERS } from '../../shared/notify/triggers';
import { NotificationAction, type Notification, type NotificationActionT } from '../../shared/schemas';
import { timeLabel } from './group';

const ICONS: Record<string, LucideIcon> = {
  wallet: Wallet,
  'calendar-clock': CalendarClock,
  bell: Bell,
  'triangle-alert': TriangleAlert,
  'hand-coins': HandCoins,
  'trending-up': TrendingUp,
  sparkles: Sparkles,
  'chart-no-axes-column': ChartNoAxesColumn,
  pencil: Pencil,
  users: Users,
};

export interface RowButton {
  label: string;
  action: NotificationActionT;
  ghost?: boolean;
  /** a partner request's two buttons share one action */
  answer?: 'accept' | 'refuse';
}

/** The buttons a row offers: none when its action is missing or unknown. */
export function buttonsFor(raw: unknown): RowButton[] {
  const parsed = NotificationAction.safeParse(raw);
  if (!parsed.success) return [];
  const a = parsed.data;
  switch (a.kind) {
    case 'open_pot':
      return [{ label: t('notify.buttons.open_pot', { pot: t(`pot.${a.ref}`) }), action: a }];
    case 'remind_debt':
      return [
        { label: t('notify.buttons.remind_debt'), action: a },
        { label: t('notify.buttons.settle_debt'), action: { kind: 'settle_debt', ref: a.ref }, ghost: true },
      ];
    case 'open_history':
      return [{ label: t('notify.buttons.open_history'), action: a, ghost: true }];
    case 'partner_request':
      return [
        { label: t('notify.buttons.partner_accept'), action: a, answer: 'accept' },
        { label: t('notify.buttons.partner_refuse'), action: a, ghost: true, answer: 'refuse' },
      ];
    default:
      return [{ label: t(`notify.buttons.${a.kind}`), action: a }];
  }
}

type Props = {
  row: Notification;
  now: Date;
  /** replaces the body once the row's action is done (never saved on the server) */
  done?: string;
  /** the row's pay period is over: no Marquer payée */
  pastPeriod?: boolean;
  /** a row that stores no text (a partner request) is written by the screen */
  text?: { title: string; body: string } | null;
  onOpen: (row: Notification) => void;
  onAction: (row: Notification, action: NotificationActionT, answer?: 'accept' | 'refuse') => void;
};

/* a partner request is not one of notify-run's triggers */
const PARTNER = { icon: 'users', tone: 'need' } as const;

export function NotificationRow({ row, now, done, pastPeriod, text, onOpen, onAction }: Props) {
  const info = isTrigger(row.trigger)
    ? TRIGGERS[row.trigger]
    : row.trigger === 'partner_request'
      ? PARTNER
      : null;
  const Icon = ICONS[info?.icon ?? 'bell'];
  const unread = !row.read_at;
  const buttons = done
    ? []
    : buttonsFor(row.action).filter((b) => !(pastPeriod && b.action.kind === 'pay_bill'));
  return (
    <li class={unread ? 'notif unread' : 'notif'}>
      <div class={`ic tone-${info?.tone ?? 'acc'}`} aria-hidden="true">
        <Icon />
      </div>
      <div>
        <button type="button" class="notif__open" onClick={() => onOpen(row)}>
          <span class="nt">
            <b class="notif__title">{text?.title ?? row.title}</b>
            <span>
              {unread && <span class="visually-hidden">{t('notify.unread')}, </span>}
              {timeLabel(row.created_at, now)}
            </span>
          </span>
          <span class="notif__body">{done ?? text?.body ?? row.body}</span>
        </button>
        {buttons.length > 0 && (
          <div class="nact">
            {buttons.map((b) => (
              <button
                key={`${b.action.kind}:${b.answer ?? ''}`}
                type="button"
                class={b.ghost ? 'nbtn ghost' : 'nbtn'}
                onClick={() => onAction(row, b.action, b.answer)}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
