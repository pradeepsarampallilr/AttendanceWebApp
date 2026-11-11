/** Calendar helpers on 'YYYY-MM-DD' strings, computed in UTC so no time-zone shift can occur. */
const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

const monday = (d: string) => utc(d) - ((new Date(utc(d)).getUTCDay() + 6) % 7) * DAY;

/** Calendar week (Monday-start) within the date's month, the same numbering the server uses: week 1 is the first week with a weekday in the month. */
export function calendarWeek(date: string): number {
  let first = monday(`${date.slice(0, 7)}-01`);
  if (first + 4 * DAY < utc(`${date.slice(0, 7)}-01`)) first += 7 * DAY;
  return Math.max(1, Math.round((monday(date) - first) / (7 * DAY)) + 1);
}

/** '15 Aug 2026' */
export const longDate = (d: string) =>
  new Date(utc(d)).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** 'Sat, 15 Aug 2026' */
export const longDateDay = (d: string) =>
  new Date(utc(d)).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
