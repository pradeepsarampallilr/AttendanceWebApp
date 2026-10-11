// Naive wall-clock time helpers. Datetimes are JS Dates holding wall-clock values in
// UTC fields (no timezone semantics), mirroring Python's naive datetime. Calendar
// dates are 'YYYY-MM-DD' strings, which sort and hash correctly.

export type DateStr = string;

export const HOUR_MS = 3_600_000;
export const MAX_SHIFT_DURATION_MS = 20 * HOUR_MS;
export const DAY_ATTRIBUTION_BUFFER_MIN = 60;
export const COMPLIANT_MIN_HOURS = 7.0;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function mkDateTime(date: DateStr, h: number, m: number, s: number): Date {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m, s));
}

export function dateOf(dt: Date): DateStr {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(date: DateStr, n: number): DateStr {
  const [y, m, d] = date.split("-").map(Number);
  return dateOf(new Date(Date.UTC(y, m - 1, d + n)));
}

export function mkDate(y: number, m: number, d: number): DateStr {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Python weekday(): Monday = 0 ... Sunday = 6 */
export function weekday(date: DateStr): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export const dayOfMonth = (date: DateStr) => Number(date.slice(8, 10));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/** '05-Aug-2026' */
export function fmtDate(date: DateStr): string {
  return `${date.slice(8, 10)}-${MONTHS[Number(date.slice(5, 7)) - 1]}-${date.slice(0, 4)}`;
}
export const fmtWeekday = (date: DateStr) => DAYS[weekday(date)];

/** '05-Aug-2026 15:57:00' */
export function fmtDateTime(dt: Date): string {
  return `${fmtDate(dateOf(dt))} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

/** Python-style round(x, 2): correctly rounded, ties to even. */
export function round2(x: number): number {
  const scaled = x * 100;
  const floor = Math.floor(scaled);
  if (Math.abs(scaled - floor - 0.5) < 1e-9 && Number.isInteger(x * 800)) {
    return (floor % 2 === 0 ? floor : floor + 1) / 100; // exact binary tie
  }
  return Number(x.toFixed(2));
}

export function workingDaysInMonth(year: number, month: number, holidays: ReadonlySet<DateStr> = new Set()): number {
  let n = 0;
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const ds = mkDate(year, month, d);
    if (weekday(ds) < 5 && !holidays.has(ds)) n++;
  }
  return n;
}

/** Fixed 7-day buckets: days 1-7 = week 1, 8-14 = week 2 ... */
export const weekNumberInMonth = (date: DateStr) => Math.floor((dayOfMonth(date) - 1) / 7) + 1;

/** Python str(datetime): '2026-08-04 15:57:00' (used in audit-log text). */
export function pyDateTime(dt: Date): string {
  return `${dateOf(dt)} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

/** Python str(float): 4 -> '4.0', 7.28 -> '7.28'. */
export const pyFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
