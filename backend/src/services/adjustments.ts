/**
 * Applies manual hour changes (add, edit, delete) on top of the calculated attendance rows.
 * Re-checks compliance after each change.
 */
import { round2, weekNumberInMonth } from "../engine/core.js";
import { evaluateCompliance } from "../engine/policy.js";

export type AdjustmentAction = "add" | "edit" | "delete";
export interface Adjustment { employeeId: string; workDate: string; action: AdjustmentAction; hours: number | null; note: string | null }

/** Row shape as served by GET /attendance (dates are strings). */
export interface ApiRow {
  employeeId: string; workDate: string; checkIn: string | null; dailyTotalHours: number | null; compliant: string;
  eligibility: string; week: number; isFirstRowOfDayGroup: boolean; rowsInDayGroup: number;
  [k: string]: unknown;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Overlay manual adjustments on engine rows. Only the day's total and its per-day Compliant flag are
 * recomputed; week/month compliance stay as the engine computed them. Adjustments that no longer match
 * the data (e.g. add on a date that now has swipes) are ignored.
 */
export function applyAdjustments<T extends ApiRow>(rows: T[], adjustments: Adjustment[]): (T & { adjustment: AdjustmentAction | null })[] {
  const out = rows.map((r) => ({ ...r, adjustment: null as AdjustmentAction | null }));
  const added: typeof out = [];
  for (const a of adjustments) {
    const day = out.filter((r) => r.employeeId === a.employeeId && r.workDate === a.workDate);
    if (day.length) {
      if (a.action === "add") continue;
      const first = day.find((r) => r.isFirstRowOfDayGroup) ?? day[0];
      for (const r of day) r.adjustment = a.action;
      first.dailyTotalHours = a.action === "delete" ? null : a.hours;
      first.compliant = evaluateCompliance(first.eligibility, first.dailyTotalHours);
    } else if (a.action === "add" && a.hours !== null) {
      const tpl = out.find((r) => r.employeeId === a.employeeId);
      if (!tpl) continue;
      added.push({ ...tpl, workDate: a.workDate, week: weekNumberInMonth(a.workDate), checkIn: null, checkOut: null,
        visitHours: null, dailyTotalHours: round2(a.hours), isFirstRowOfDayGroup: true, rowsInDayGroup: 0,
        compliant: evaluateCompliance(tpl.eligibility, a.hours), adjustment: "add" });
    }
  }
  return [...out, ...added].sort((x, y) =>
    cmp(String(x.name), String(y.name)) || cmp(x.workDate, y.workDate) || cmp(x.checkIn ?? "", y.checkIn ?? ""));
}
