/**
 * Builds the full attendance table (one row per visit) from the roster and swipes.
 * Calculates hours, then daily, calendar-week and monthly compliance for each employee.
 */
import {
  addDays, settings, calendarWeek, daysInMonth, mkDate, weekStart, type DateStr,
} from "./core.js";
import {
  buildWorkDateGroups, groupHasOpenVisit, groupTotalHours, looksLikeOvernightWorker, pairSwipeEvents, visitHours,
} from "./attribution.js";
import { INFERRED_NIGHT_SHIFT } from "./roster.js";
import { evaluateCompliance, evaluateEligibility, evaluateMonth, evaluateWeek, type WeekResult } from "./policy.js";
import type { AttendanceRow, AuditIssue, EventsByEmployee, RosterEntry } from "./types.js";

export interface DatasetInput {
  currentEvents: EventsByEmployee;
  /** Swipes from before the month, back to the Monday of its first week (empty for the very first month). */
  previousEvents: EventsByEmployee;
  roster: Map<string, RosterEntry>;
  year: number;
  month: number;
  fallbackNames: Map<string, string>;
  holidays?: ReadonlySet<DateStr>;
  leaves?: ReadonlyMap<string, ReadonlySet<DateStr>>;
}

export interface WeeklyRow {
  employeeId: string;
  name: string;
  department: string;
  weekStart: DateStr;
  week: number;
  required: number;
  attended: number;
  anchor: WeekResult["anchor"];
  status: WeekResult["status"];
}

export interface DatasetResult {
  rows: AttendanceRow[];
  /** Every calendar week of the month for every roster employee (also weeks with no swipes at all). */
  weekly: WeeklyRow[];
  issues: AuditIssue[];
  attendedDates: Map<string, Set<DateStr>>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildAttendanceDataset(input: DatasetInput): DatasetResult {
  const { currentEvents, previousEvents, roster, year, month, fallbackNames } = input;
  const holidays = input.holidays ?? new Set<DateStr>();
  const monthStart = mkDate(year, month, 1);
  const monthEnd = mkDate(year, month, daysInMonth(year, month));
  // Last day with usable data: the month's final day is skipped (its checkouts may sit in the next file).
  const lastDay = addDays(monthEnd, -1);
  // A week that began in the previous month is checked from its Monday when the earlier data exists, else from the 1st.
  const dataStart = previousEvents.size ? weekStart(monthStart) : monthStart;
  const rows: AttendanceRow[] = [];
  const issues: AuditIssue[] = [];
  const weekly: WeeklyRow[] = [];
  const judged = new Set<string>();
  const attendedDates = new Map<string, Set<DateStr>>();
  const off = (employeeId: string) => new Set<DateStr>([...holidays, ...(input.leaves?.get(employeeId) ?? [])]);

  /** Every calendar week touching the month, judged on the data window [dataStart, lastDay]. */
  const judgeWeeks = (employeeId: string, eligibility: string, attended: ReadonlySet<DateStr>) => {
    const offDays = off(employeeId); // public holidays and this employee's leave days lower the requirement
    const weeks = new Map<DateStr, WeekResult>();
    let monday = weekStart(monthStart);
    if (addDays(monday, 4) < monthStart) monday = addDays(monday, 7); // the first week has no weekday in this month
    for (; monday <= lastDay; monday = addDays(monday, 7)) {
      weeks.set(monday, evaluateWeek(eligibility, monday, dataStart, lastDay, attended, offDays));
    }
    return weeks;
  };
  const saveWeeks = (employeeId: string, name: string, department: string, weeks: Map<DateStr, WeekResult>) => {
    for (const w of weeks.values()) {
      weekly.push({ employeeId, name, department, weekStart: w.weekStart, week: calendarWeek(w.weekStart, monthStart), required: w.required,
        attended: w.attended, anchor: w.anchor, status: w.status });
    }
  };

  for (const employeeId of new Set([...currentEvents.keys(), ...previousEvents.keys()])) {
    const combined = [...(previousEvents.get(employeeId) ?? []), ...(currentEvents.get(employeeId) ?? [])]
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const paired = pairSwipeEvents(employeeId, combined);
    issues.push(...paired.issues.filter((i) => i.at >= new Date(`${monthStart}T00:00:00Z`)));

    const entry = roster.get(employeeId) ?? null;
    const shift = entry?.shift ?? null;
    let groupingShift = shift;
    if (!shift && looksLikeOvernightWorker(combined)) {
      groupingShift = INFERRED_NIGHT_SHIFT;
      issues.push({ employeeId, issueType: "Inferred overnight pattern", at: combined[0].at,
        detail: `Employee ${employeeId} has no shift roster match, but its swipe pattern looks like an overnight shift, so an inferred overnight boundary (buffer to 07:00) was used to avoid splitting a single shift across two calendar days.` });
    }

    const { groups, issues: boundaryIssues } = buildWorkDateGroups(paired.visits, groupingShift, dataStart, monthEnd);
    issues.push(...boundaryIssues.filter((i) => i.at >= new Date(`${monthStart}T00:00:00Z`)));
    const inMonth = groups.some((g) => g.workDate >= monthStart);
    if (!inMonth && !entry) continue;

    const name = entry ? entry.name : fallbackNames.get(employeeId) ?? employeeId;
    const eligibility = evaluateEligibility(shift);
    if (!entry) {
      issues.push({ employeeId, issueType: "No roster match", at: new Date(),
        detail: `Employee ${employeeId} (${name}) appears in door-swipe data but not in the shift roster; department/manager/shift left blank.` });
    }

    // Days that count as an office day: the configured minimum hours in the day.
    const attended = new Set<DateStr>();
    for (const g of groups) if ((groupTotalHours(g) ?? 0) >= settings.compliantMinHours) attended.add(g.workDate);

    const weeks = judgeWeeks(employeeId, eligibility, attended);
    saveWeeks(employeeId, name, entry?.department ?? "", weeks);
    judged.add(employeeId);
    if (!inMonth) continue; // only last month's days of the first week: counted above, no rows to show
    const monthCompliant = evaluateMonth(eligibility, [...weeks.values()]);

    for (const g of groups) {
      if (g.workDate < monthStart) continue;
      const daily = groupTotalHours(g);
      const compliant = evaluateCompliance(eligibility, daily);
      const monday = weekStart(g.workDate);
      // A weekend day can belong to a week whose weekdays all fall in the previous month (not in `weeks`); judge it only for this lookup.
      const wk = weeks.get(monday) ?? evaluateWeek(eligibility, monday, dataStart, lastDay, attended, off(employeeId));
      if (groupHasOpenVisit(g) && daily !== null) {
        issues.push({ employeeId, issueType: "Daily total is partial", at: g.visits[0].checkIn,
          detail: `${g.workDate}: Daily Total Hours (${daily.toFixed(2)}) excludes at least one visit that day with a missing checkout; the true total may be higher.` });
      }
      g.visits.forEach((v, i) => rows.push({
        employeeId, name, email: entry?.email ?? "", department: entry?.department ?? "",
        managerName: entry?.managerName || "NA", managerEmail: entry?.managerEmail || "NA",
        week: calendarWeek(g.workDate, monthStart), weekAttendedDays: wk.attended, workDate: g.workDate,
        checkIn: v.checkIn, checkOut: v.checkOut, visitHours: visitHours(v), dailyTotalHours: daily,
        shiftLabel: shift ? shift.label : "Unassigned", eligibility, compliant, weekCompliant: wk.status, monthCompliant,
        isFirstRowOfDayGroup: i === 0, rowsInDayGroup: g.visits.length,
      }));
    }
    attendedDates.set(employeeId, new Set(groups.filter((g) => g.workDate >= monthStart).map((g) => g.workDate)));
  }

  // Roster staff with no swipes this month still owe their office days.
  for (const e of roster.values()) {
    if (judged.has(e.employeeId)) continue;
    saveWeeks(e.employeeId, e.name, e.department, judgeWeeks(e.employeeId, evaluateEligibility(e.shift), new Set()));
  }

  rows.sort((a, b) => cmp(a.name, b.name) || cmp(a.workDate, b.workDate) || a.checkIn.getTime() - b.checkIn.getTime());
  return { rows, weekly, issues, attendedDates };
}
