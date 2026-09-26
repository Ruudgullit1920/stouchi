import { describe, expect, it } from 'vitest';
import {
  groupNotifications,
  inFilter,
  timeLabel,
  whenGroup,
} from '../../../src/features/notifications/group';
import { notification } from '../fixtures';

/* Thursday 24 Sept 2026, 10:00 in Tunis (UTC+1) */
const NOW = new Date('2026-09-24T10:00:00+01:00');

describe('whenGroup (Tunis days)', () => {
  it('00:00 Tunis today is today; 23:59 the day before is this week', () => {
    expect(whenGroup('2026-09-24T00:00:00+01:00', NOW)).toBe('today');
    expect(whenGroup('2026-09-23T23:00:00Z', NOW)).toBe('today');
    expect(whenGroup('2026-09-23T23:59:00+01:00', NOW)).toBe('week');
  });

  it('6 days ago is this week; 7 days ago is earlier', () => {
    expect(whenGroup('2026-09-18T09:00:00+01:00', NOW)).toBe('week');
    expect(whenGroup('2026-09-17T23:59:00+01:00', NOW)).toBe('earlier');
  });
});

describe('timeLabel', () => {
  it('HH:MM in Tunis today, the weekday this week, the date before', () => {
    expect(timeLabel('2026-09-24T08:05:00Z', NOW)).toBe('09:05');
    expect(timeLabel('2026-09-21T09:00:00+01:00', NOW)).toBe('lun.');
    expect(timeLabel('2026-09-01T09:00:00+01:00', NOW)).toBe('1 sept.');
  });
});

describe('filters', () => {
  it('maps each trigger to one filter; unknown triggers only show under Tout', () => {
    expect(['pot_over', 'pot_near', 'bill_due', 'payday'].every((x) => inFilter(x, 'alert'))).toBe(true);
    expect(
      ['category_spike', 'savings_opportunity', 'weekly_recap', 'quiet_week'].every((x) =>
        inFilter(x, 'tip'),
      ),
    ).toBe(true);
    expect(['user_reminder', 'owed_to_me'].every((x) => inFilter(x, 'reminder'))).toBe(true);
    expect(inFilter('pot_over', 'tip')).toBe(false);
    expect(inFilter('mystery', 'all')).toBe(true);
    expect(inFilter('mystery', 'alert')).toBe(false);
  });
});

describe('groupNotifications', () => {
  it('keeps the order and drops empty groups', () => {
    const a = notification({ created_at: '2026-09-24T09:00:00+01:00' });
    const b = notification({ created_at: '2026-09-01T09:00:00+01:00' });
    expect(groupNotifications([a, b], NOW)).toEqual([
      { group: 'today', rows: [a] },
      { group: 'earlier', rows: [b] },
    ]);
  });
});
