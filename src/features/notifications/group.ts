/* How the Notifications screen sorts rows: Aujourd'hui / Cette semaine / Plus
 * tôt by Tunis calendar day, the time shown on each row, and the filters. */
import { daysBetween, todayTunis } from '../../shared/dates';
import { dayHeader, shortDate } from '../../shared/format';
import { isTrigger, TRIGGERS, type FilterGroup } from '../../shared/notify/triggers';
import type { Notification } from '../../shared/schemas';

export type WhenGroup = 'today' | 'week' | 'earlier';
export type Filter = 'all' | FilterGroup;
export const FILTERS: Filter[] = ['all', 'alert', 'tip', 'reminder'];

const CLOCK = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Tunis',
});

const ageInDays = (createdAt: string, now: Date) =>
  daysBetween(todayTunis(new Date(createdAt)), todayTunis(now));

/** today, the 6 days before it, or earlier */
export function whenGroup(createdAt: string, now: Date): WhenGroup {
  const age = ageInDays(createdAt, now);
  if (age <= 0) return 'today';
  return age < 7 ? 'week' : 'earlier';
}

/** "09:05" today, "lun." this week, "1 sept." before */
export function timeLabel(createdAt: string, now: Date): string {
  const group = whenGroup(createdAt, now);
  if (group === 'today') return CLOCK.format(new Date(createdAt));
  const day = todayTunis(new Date(createdAt));
  return group === 'week' ? dayHeader(day).weekday : shortDate(day);
}

export const inFilter = (trigger: string, filter: Filter): boolean =>
  filter === 'all' || (isTrigger(trigger) && TRIGGERS[trigger].group === filter);

/** Rows in their order (newest first), cut into the non-empty day groups. */
export function groupNotifications(
  rows: Notification[],
  now: Date,
): { group: WhenGroup; rows: Notification[] }[] {
  const out: { group: WhenGroup; rows: Notification[] }[] = [];
  for (const row of rows) {
    const group = whenGroup(row.created_at, now);
    const last = out[out.length - 1];
    if (last?.group === group) last.rows.push(row);
    else out.push({ group, rows: [row] });
  }
  return out;
}
