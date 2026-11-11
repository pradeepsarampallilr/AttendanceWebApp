/**
 * Basic date, time and number helpers shared by the attendance logic.
 * Also holds the shared settings, like the 7-hour minimum for a full day.
 * Dates are plain 'YYYY-MM-DD' strings and times are UTC wall-clock, so there are no time-zone shifts.
 */
export type DateStr = string;

export const HOUR_MS = 3_600_000;

/** The tunable rules. HR / superadmin change them on the Configuration page; the saved values are loaded into `settings` at start-up. */
export interface Settings {
  /** Hours in the office that make a day count as a full office day. */
  compliantMinHours: number;
  /** Office days required in a full week. */
  weeklyOfficeDays: number;
  /** The anchor day as a weekday() index (Monday = 0, Wednesday = 2 by default). */
  anchorWeekday: number;
  /** Minutes around a shift's start (check-in) and end (checkout) when assigning a swipe to a work day. */
  dayAttributionBufferMin: number;
  /** Longest gap, in hours, between a check-in and the checkout it pairs with. */
  maxShiftHours: number;
}
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  compliantMinHours: 7, weeklyOfficeDays: 3, anchorWeekday: 2, dayAttributionBufferMin: 60, maxShiftHours: 20,
};
export const settings: Settings = { ...DEFAULT_SETTINGS };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const utc = (date: DateStr) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export const mkDate = (y: number, m: number, d: number): DateStr => `${y}-${pad(m)}-${pad(d)}`;
export const mkDateTime = (date: DateStr, h: number, m: number, s: number) => new Date(utc(date) + ((h * 60 + m) * 60 + s) * 1000);
export const dateOf = (dt: Date): DateStr => mkDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
export const addDays = (date: DateStr, n: number): DateStr => dateOf(new Date(utc(date) + n * 86_400_000));
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Monday = 0 ... Sunday = 6. */
export const weekday = (date: DateStr) => (new Date(utc(date)).getUTCDay() + 6) % 7;
export const isWeekday = (date: DateStr) => weekday(date) < 5;

/** The Monday of the calendar week containing `date`. */
export const weekStart = (date: DateStr): DateStr => addDays(date, -weekday(date));

/** Calendar week (Monday-start) counted within `date`'s month; week 1 is the first week with a weekday in the month. */
export function calendarWeek(date: DateStr, monthStart: DateStr = `${date.slice(0, 7)}-01`): number {
  let first = weekStart(monthStart);
  if (addDays(first, 4) < monthStart) first = addDays(first, 7);
  return Math.max(1, Math.round((utc(weekStart(date)) - utc(first)) / (7 * 86_400_000)) + 1);
}

export const round2 = (x: number) => Math.round(x * 100) / 100;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/** '05-Aug-2026' */
export const fmtDate = (date: DateStr) => `${date.slice(8, 10)}-${MONTHS[Number(date.slice(5, 7)) - 1]}-${date.slice(0, 4)}`;
export const fmtWeekday = (date: DateStr) => DAYS[weekday(date)];
/** Name of the configured anchor day ("Wednesday", "Thursday", ...). */
export const anchorDayName = () => DAYS[settings.anchorWeekday];

/** '2026-08-05 15:57:00' */
export const fmtDateTime = (dt: Date) => `${dateOf(dt)} ${dt.toISOString().slice(11, 19)}`;
