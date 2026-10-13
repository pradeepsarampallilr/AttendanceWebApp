/**
 * Builds the full attendance table (one row per person per day) from the roster and swipes.
 * Calculates hours and compliance for each day.
 */
import { COMPLIANT_MIN_HOURS, pyFloat, weekNumberInMonth, workingDaysInMonth, mkDate, type DateStr } from "./core.js";
import {
  buildWorkDateGroups, groupHasOpenVisit, groupTotalHours, looksLikeOvernightWorker,
  pairSwipeEvents, visitHours,
} from "./attribution.js";
import { INFERRED_NIGHT_SHIFT } from "./roster.js";
import { evaluateCompliance, evaluateEligibility, evaluateMonthCompliance, evaluateWeekCompliance } from "./policy.js";
import type { AttendanceRow, AuditIssue, EventsByEmployee, RosterEntry } from "./types.js";

export interface DatasetInput {
  currentEvents: EventsByEmployee;
  previousEvents: EventsByEmployee;
  roster: Map<string, RosterEntry>;
  year: number;
  month: number;
  fallbackNames: Map<string, string>;
  holidays?: ReadonlySet<DateStr>;
  leaves?: ReadonlyMap<string, ReadonlySet<DateStr>>;
}

export interface DatasetResult {
  rows: AttendanceRow[];
  issues: AuditIssue[];
  attendedDates: Map<string, Set<DateStr>>;
}

export function buildAttendanceDataset(input: DatasetInput): DatasetResult {
  const { currentEvents, previousEvents, roster, year, month, fallbackNames } = input;
  const holidays = input.holidays ?? new Set<DateStr>();
  const monthStart = mkDate(year, month, 1);
  const monthEnd = mkDate(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
  const rows: AttendanceRow[] = [];
  const issues: AuditIssue[] = [];
  const attendedDates = new Map<string, Set<DateStr>>();

  const ids = new Set([...currentEvents.keys(), ...previousEvents.keys()]);
  for (const employeeId of ids) {
    const combined = [...(previousEvents.get(employeeId) ?? []), ...(currentEvents.get(employeeId) ?? [])]
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const { visits, issues: pairingIssues } = pairSwipeEvents(employeeId, combined, monthStart);
    issues.push(...pairingIssues);

    const entry = roster.get(employeeId) ?? null;
    const shift = entry?.shift ?? null;

    let groupingShift = shift;
    if (!shift && looksLikeOvernightWorker(combined)) {
      groupingShift = INFERRED_NIGHT_SHIFT;
      issues.push({ employeeId, issueType: "Inferred overnight pattern", at: combined[0].at,
        detail: `Employee ${employeeId} has no shift roster match, but its swipe pattern looks like an overnight shift, so an inferred overnight boundary (buffer to 07:00) was used to avoid splitting a single shift across two calendar days.` });
    }

    const { groups, issues: boundaryIssues } = buildWorkDateGroups(visits, groupingShift, monthStart, monthEnd);
    issues.push(...boundaryIssues);
    if (!groups.length) continue;

    const name = entry ? entry.name : fallbackNames.get(employeeId) ?? employeeId;
    const email = entry?.email ?? "";
    const department = entry?.department ?? "";
    const managerName = entry?.managerName || "NA";
    const managerEmail = entry?.managerEmail || "NA";
    const shiftLabel = shift ? shift.label : "Unassigned";
    const eligibility = evaluateEligibility(shift);

    if (!entry) {
      issues.push({ employeeId, issueType: "No roster match", at: new Date(),
        detail: `Employee ${employeeId} (${name}) appears in door-swipe data but not in the shift roster; department/manager/shift left blank.` });
    }

    const weeklyDays = new Map<number, number>();
    const attendedPerWeek = new Map<number, Set<DateStr>>();
    for (const g of groups) {
      const w = weekNumberInMonth(g.workDate);
      weeklyDays.set(w, (weeklyDays.get(w) ?? 0) + 1);
      let s = attendedPerWeek.get(w);
      if (!s) attendedPerWeek.set(w, (s = new Set()));
      const total = groupTotalHours(g);
      if (total !== null && total >= COMPLIANT_MIN_HOURS) s.add(g.workDate);
    }
    const weekCompliance = new Map<number, "Yes" | "No" | "NA">();
    for (const [w, set] of attendedPerWeek) weekCompliance.set(w, evaluateWeekCompliance(eligibility, year, month, w, set, holidays));

    const totalHours = groups.reduce((s, g) => s + (groupTotalHours(g) ?? 0), 0);
    const offDays = new Set<DateStr>([...holidays, ...(input.leaves?.get(employeeId) ?? [])]);
    const monthCompliant = evaluateMonthCompliance(eligibility, totalHours, workingDaysInMonth(year, month, offDays), weekCompliance);

    const attended = new Set<DateStr>();
    for (const g of groups) {
      attended.add(g.workDate);
      const week = weekNumberInMonth(g.workDate);
      const daily = groupTotalHours(g);
      const compliant = evaluateCompliance(eligibility, daily);

      if (groupHasOpenVisit(g) && daily !== null) {
        issues.push({ employeeId, issueType: "Daily total is partial", at: g.visits[0].checkIn,
          detail: `${g.workDate}: Daily Total Hours (${pyFloat(daily)}) excludes at least one visit that day with a missing checkout; the true total may be higher.` });
      }
      g.visits.forEach((v, i) => rows.push({
        employeeId, name, email, department, managerName, managerEmail, week,
        weekAttendedDays: weeklyDays.get(week)!, workDate: g.workDate,
        checkIn: v.checkIn, checkOut: v.checkOut, visitHours: visitHours(v),
        dailyTotalHours: daily, shiftLabel, eligibility, compliant,
        weekCompliant: weekCompliance.get(week)!, monthCompliant,
        isFirstRowOfDayGroup: i === 0, rowsInDayGroup: g.visits.length,
      }));
    }
    attendedDates.set(employeeId, attended);
  }

  rows.sort((a, b) => cmp(a.name, b.name) || cmp(a.workDate, b.workDate) || a.checkIn.getTime() - b.checkIn.getTime());
  return { rows, issues, attendedDates };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
