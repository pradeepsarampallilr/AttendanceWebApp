/**
 * Holds the attendance rules: who is eligible and whether a day, week or month meets the office-day target.
 */
import {
  addDays, settings, type DateStr,
} from "./core.js";
import type { ShiftWindow } from "./types.js";

export type Tri = "Yes" | "No" | "NA";

/** The general shift starts at 9:00 AM and ends between 6:00 PM and 6:30 PM (the roster writes it as 6:30 PM). */
export const isGeneralShift = (s: ShiftWindow) => s.startMinutes === 9 * 60 && s.endMinutes >= 18 * 60 && s.endMinutes <= 18 * 60 + 30;

/** General shift: not covered by the policy (No). No shift in the roster: unknown (NA). Anything else: covered (Yes). */
export const evaluateEligibility = (shift: ShiftWindow | null): Tri => (!shift ? "NA" : isGeneralShift(shift) ? "No" : "Yes");

export const evaluateCompliance = (eligibility: string, dailyHours: number | null): Tri =>
  eligibility !== "Yes" || dailyHours === null ? "NA" : dailyHours >= settings.compliantMinHours ? "Yes" : "No";

export interface WeekResult {
  weekStart: DateStr;
  /** Office days needed: min(3, 3 - off weekdays), and never more than the working weekdays left in the data. */
  required: number;
  attended: number;
  /** The anchor day: attended, missed, or not required (holiday, leave, or outside the data window). */
  anchor: "present" | "absent" | "off";
  anchorOk: boolean;
  status: Tri;
}

/**
 * One calendar week (Mon-Sun) inside the data window [from, to].
 * `attended` holds the days with a full-length (7h+) visit; `off` holds public holidays and the employee's leave days.
 * The anchor day is only checked when it lies inside the window and is not an off day.
 */
export function evaluateWeek(
  eligibility: string, monday: DateStr, from: DateStr, to: DateStr, attended: ReadonlySet<DateStr>, off: ReadonlySet<DateStr>,
): WeekResult {
  let available = 0, offDays = 0, present = 0;
  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i);
    if (d < from || d > to) continue;
    available++;
    if (off.has(d)) offDays++;
    if (attended.has(d)) present++;
  }
  const required = Math.max(0, Math.min(settings.weeklyOfficeDays - offDays, available - offDays));
  const anchor = addDays(monday, settings.anchorWeekday);
  const anchorState = anchor < from || anchor > to || off.has(anchor) ? "off" : attended.has(anchor) ? "present" : "absent";
  const anchorOk = anchorState !== "absent";
  const status: Tri = eligibility !== "Yes" ? "NA" : anchorOk && present >= required ? "Yes" : "No";
  return { weekStart: monday, required, attended: present, anchor: anchorState, anchorOk, status };
}

/** Month is compliant only when every evaluated week is compliant; weeks that are not evaluated (NA) are ignored. */
export function evaluateMonth(eligibility: string, weeks: WeekResult[]): Tri {
  if (eligibility !== "Yes") return "NA";
  const evaluated = weeks.filter((w) => w.status !== "NA");
  return evaluated.every((w) => w.status === "Yes") ? "Yes" : "No";
}
