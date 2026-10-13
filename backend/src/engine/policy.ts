/**
 * Holds the attendance rules: who is eligible and whether a day, week or month meets the hours target.
 */
import { COMPLIANT_MIN_HOURS, daysInMonth, mkDate, weekday, type DateStr } from "./core.js";
import { GENERAL_SHIFT_WINDOW } from "./roster.js";
import type { ShiftWindow } from "./types.js";

type Tri = "Yes" | "No" | "NA";

export function isGeneralShift(shift: ShiftWindow | null): boolean {
  return !!shift && shift.startMinutes === GENERAL_SHIFT_WINDOW.startMinutes
    && shift.endMinutes === GENERAL_SHIFT_WINDOW.endMinutes;
}

export const evaluateEligibility = (shift: ShiftWindow | null): "Yes" | "No" =>
  isGeneralShift(shift) ? "No" : "Yes";

export function evaluateCompliance(eligibility: string, dailyHours: number | null): Tri {
  if (eligibility === "No" || dailyHours === null) return "NA";
  return dailyHours < COMPLIANT_MIN_HOURS ? "No" : "Yes";
}

function datesInWeekBucket(year: number, month: number, week: number): DateStr[] {
  const start = (week - 1) * 7 + 1;
  const end = Math.min(week * 7, daysInMonth(year, month));
  const out: DateStr[] = [];
  for (let d = start; d <= end; d++) out.push(mkDate(year, month, d));
  return out;
}


export function evaluateWeekCompliance(
  eligibility: string, year: number, month: number, week: number, attended: Set<DateStr>,
  holidays: ReadonlySet<DateStr> = new Set(),
): Tri {
  if (eligibility === "No") return "NA";
  const dates = datesInWeekBucket(year, month, week);
  const wednesdaysOk = dates.filter((d) => weekday(d) === 2 && !holidays.has(d)).every((d) => attended.has(d));
  const holidayWeekdays = dates.filter((d) => weekday(d) < 5 && holidays.has(d)).length;
  const required = holidayWeekdays
    ? Math.min(3, dates.filter((d) => weekday(d) < 5).length - holidayWeekdays)
    : 3;
  return wednesdaysOk && attended.size >= required ? "Yes" : "No";
}

export function evaluateMonthCompliance(
  eligibility: string, totalHours: number, workingDays: number, weekCompliance: Map<number, Tri>,
): Tri {
  if (eligibility === "No") return "NA";
  const ratioOk = workingDays > 0 && totalHours / workingDays >= COMPLIANT_MIN_HOURS;
  const weeksOk = [...weekCompliance.values()].every((s) => s === "Yes");
  return ratioOk && weeksOk ? "Yes" : "No";
}
