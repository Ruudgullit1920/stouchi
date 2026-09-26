/* The notification triggers (assistant spec §6), and what each one means for
 * the daily cap, the writer, the screen's filters and its icon.
 *
 * Uncapped: payday, bill due dates and the user's own reminders always go out,
 * and so does the Sunday recap — it has one two-hour window a week, and any
 * earlier alert that Sunday would otherwise cost it the whole week.
 * Capped: at most one per day, the lowest `priority` first. `writer` says
 * which triggers the model words; the others use a fixed template. */

export type FilterGroup = 'alert' | 'tip' | 'reminder';
/** the row's icon colours on the Notifications screen */
export type Tone = 'warn' | 'need' | 'save' | 'acc';

export interface TriggerInfo {
  capped: boolean;
  /** among capped triggers due together, the lowest wins the day */
  priority: number;
  group: FilterGroup;
  /** lucide icon name */
  icon: string;
  tone: Tone;
  /** the model writes it; otherwise the template does */
  writer: boolean;
}

export const TRIGGERS = {
  payday: { capped: false, priority: 0, group: 'alert', icon: 'wallet', tone: 'save', writer: false },
  bill_due: {
    capped: false,
    priority: 0,
    group: 'alert',
    icon: 'calendar-clock',
    tone: 'need',
    writer: false,
  },
  user_reminder: { capped: false, priority: 0, group: 'reminder', icon: 'bell', tone: 'acc', writer: false },
  pot_over: { capped: true, priority: 1, group: 'alert', icon: 'triangle-alert', tone: 'warn', writer: true },
  pot_near: { capped: true, priority: 2, group: 'alert', icon: 'triangle-alert', tone: 'warn', writer: true },
  owed_to_me: {
    capped: true,
    priority: 3,
    group: 'reminder',
    icon: 'hand-coins',
    tone: 'save',
    writer: true,
  },
  category_spike: { capped: true, priority: 4, group: 'tip', icon: 'trending-up', tone: 'acc', writer: true },
  savings_opportunity: {
    capped: true,
    priority: 5,
    group: 'tip',
    icon: 'sparkles',
    tone: 'acc',
    writer: true,
  },
  weekly_recap: {
    capped: false,
    priority: 0,
    group: 'tip',
    icon: 'chart-no-axes-column',
    tone: 'save',
    writer: true,
  },
  quiet_week: { capped: true, priority: 7, group: 'tip', icon: 'pencil', tone: 'acc', writer: true },
} as const satisfies Record<string, TriggerInfo>;

export type Trigger = keyof typeof TRIGGERS;

export const isTrigger = (s: string): s is Trigger => Object.hasOwn(TRIGGERS, s);
