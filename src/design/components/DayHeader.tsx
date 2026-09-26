import type { ISODate } from '../../shared/dates';
import { dayHeader } from '../../shared/format';

/** Spec §5.4 day header: big date, weekday pill, MM.YYYY, hairline. */
export function DayHeader({ date }: { date: ISODate }) {
  const { day, weekday, monthYear } = dayHeader(date);
  return (
    <h3 class="dayhead">
      <b class="num">{day}</b>
      <span class="dayhead__wd">{weekday}</span>
      <span class="dayhead__my">{monthYear}</span>
      <span class="dayhead__rule" aria-hidden="true" />
    </h3>
  );
}
