/**
 * Works out attendance numbers from raw rows: hours per employee, manager totals, search and filters, and the grouped log.
 */
import type { AttendanceRow, TeamLine, Tri, WeeklyRow } from '../api';

export const BENCHMARK_HOURS = 7.0;

export interface DayTotal {
  date: string;
  week: number;
  hours: number;
  compliant: Tri;
  sessions: number;
}

export interface EmployeeSummary {
  employeeId: string;
  name: string;
  email: string | null;
  department: string | null;
  managerName: string | null;
  shift: string | null;
  eligibility: Tri;
  monthCompliant: Tri;
  transportOptIn: Tri;
  /** Set by scopeToWeek while a week / weekly-compliance filter is active; badges show it instead of the month status. */
  weekStatus?: Tri;
  loggedDays: number;
  totalHours: number;
  avgHours: number;
  sessions: number;
  /** Eligible days with a daily total, split by the engine's per-day compliant flag. */
  compliantDays: number;
  evaluatedDays: number;
  days: DayTotal[];
  rows: AttendanceRow[];
}

export interface ManagerSummary {
  managerId: string;
  managerName: string;
  department: string | null;
  teamSize: number;
  totalHours: number;
  loggedDays: number;
  avgHours: number;
  compliantDays: number;
  evaluatedDays: number;
  /** Everyone below this manager at any level (reports of reports included). */
  members: EmployeeSummary[];
  /** Reporting level of each member: 1 = direct report, 2 = report of a report, and so on. */
  depth: Map<string, number>;
}

export interface Totals {
  employees: number;
  dailyEntries: number;
  totalHours: number;
  sessions: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const hasSession = (r: AttendanceRow) => r.checkIn !== null;

/** Only the first row of a day group carries the day's total; sum those (closed visits only, per the engine). */
export function summarizeEmployees(rows: AttendanceRow[]): EmployeeSummary[] {
  const map = new Map<string, EmployeeSummary>();
  for (const r of rows) {
    let e = map.get(r.employeeId);
    if (!e) {
      e = {
        employeeId: r.employeeId, name: r.name, email: r.email, department: r.department,
        managerName: r.managerName, shift: r.shiftLabel, eligibility: r.eligibility,
        monthCompliant: r.monthCompliant, transportOptIn: r.transportOptIn, loggedDays: 0, totalHours: 0, avgHours: 0, sessions: 0,
        compliantDays: 0, evaluatedDays: 0, days: [], rows: [],
      };
      map.set(r.employeeId, e);
    }
    e.rows.push(r);
    if (hasSession(r)) e.sessions++;
    if (r.isFirstRowOfDayGroup && r.dailyTotalHours !== null) {
      e.days.push({
        date: r.workDate, week: r.week, hours: r.dailyTotalHours,
        compliant: r.compliant, sessions: r.rowsInDayGroup,
      });
      e.loggedDays++;
      e.totalHours += r.dailyTotalHours;
      if (r.compliant !== 'NA') {
        e.evaluatedDays++;
        if (r.compliant === 'Yes') e.compliantDays++;
      }
    }
  }
  const out = [...map.values()];
  for (const e of out) {
    e.totalHours = round2(e.totalHours);
    e.avgHours = e.loggedDays ? round2(e.totalHours / e.loggedDays) : 0;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Groups each manager's whole reporting tree (every level below them) from the stored reporting lines, matched by employee id. */
export function summarizeManagers(emps: EmployeeSummary[], lines: TeamLine[]): ManagerSummary[] {
  const byId = new Map(emps.map((e) => [e.employeeId, e]));
  const map = new Map<string, ManagerSummary>();
  for (const l of lines) {
    const e = byId.get(l.employeeId);
    if (!e) continue; // no attendance rows for this person
    let m = map.get(l.managerId);
    if (!m) {
      m = {
        managerId: l.managerId, managerName: l.managerName, department: byId.get(l.managerId)?.department ?? e.department, teamSize: 0,
        totalHours: 0, loggedDays: 0, avgHours: 0, compliantDays: 0, evaluatedDays: 0, members: [], depth: new Map(),
      };
      map.set(l.managerId, m);
    }
    m.members.push(e);
    m.depth.set(e.employeeId, l.depth);
    m.teamSize++;
    m.totalHours += e.totalHours;
    m.loggedDays += e.loggedDays;
    m.compliantDays += e.compliantDays;
    m.evaluatedDays += e.evaluatedDays;
  }
  const out = [...map.values()];
  for (const m of out) {
    m.totalHours = round2(m.totalHours);
    m.avgHours = m.loggedDays ? round2(m.totalHours / m.loggedDays) : 0;
  }
  return out.sort((a, b) => a.managerName.localeCompare(b.managerName));
}

export function totals(emps: EmployeeSummary[]): Totals {
  return {
    employees: emps.length,
    dailyEntries: emps.reduce((s, e) => s + e.loggedDays, 0),
    totalHours: round2(emps.reduce((s, e) => s + e.totalHours, 0)),
    sessions: emps.reduce((s, e) => s + e.sessions, 0),
  };
}

export const distinctShifts = (rows: AttendanceRow[]) =>
  [...new Set(rows.map((r) => r.shiftLabel).filter((s): s is string => !!s))].sort();

/** Matches name, id, email, shift, department or date (any row of the employee for date). */
export function matchesSearch(e: EmployeeSummary, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    [e.name, e.employeeId, e.email, e.shift, e.department].some((v) => v?.toLowerCase().includes(s)) ||
    e.rows.some((r) => r.workDate.includes(s))
  );
}

/** `compliance` is a Tri value ('Yes' / 'No' / 'NA') matched against the employee's month status; `transport` likewise against transport opt-in; '' = all. */
export function filterEmployees(emps: EmployeeSummary[], q: string, shift: string, compliance = '', transport = ''): EmployeeSummary[] {
  return emps.filter((e) => (!shift || e.shift === shift) && (!compliance || e.monthCompliant === compliance)
    && (!transport || e.transportOptIn === transport) && matchesSearch(e, q));
}

/**
 * Narrows employees to one calendar week (`week` = '' keeps the whole month) and/or a weekly compliance status.
 * The status comes from the server's weekly results, which also cover weeks with no swipes. With a week selected,
 * each employee's rows/hours/days are limited to that week; employees with no attendance that week stay as empty
 * summaries so a missed week still shows as non-compliant.
 */
export function scopeToWeek(all: EmployeeSummary[], rows: AttendanceRow[], weekly: WeeklyRow[], week: string, status: string): EmployeeSummary[] {
  if (!week && !status) return all;
  const byEmp = new Map<string, Tri[]>();
  for (const w of weekly) if (!week || String(w.week) === week) byEmp.set(w.employeeId, [...(byEmp.get(w.employeeId) ?? []), w.status]);
  const statusOf = (id: string): Tri => {
    const list = byEmp.get(id);
    if (!list?.length || list.includes('NA')) return 'NA';
    return list.every((s) => s === 'Yes') ? 'Yes' : 'No';
  };
  const scoped = week ? summarizeEmployees(rows.filter((r) => String(r.week) === week)) : all;
  const out = scoped.map((e) => ({ ...e, weekStatus: statusOf(e.employeeId) })).filter((e) => !status || e.weekStatus === status);
  if (!week) return out;
  const seen = new Set(scoped.map((e) => e.employeeId));
  for (const e of all) {
    const implied = statusOf(e.employeeId);
    if (seen.has(e.employeeId) || (status && status !== implied)) continue;
    out.push({ ...e, weekStatus: implied, loggedDays: 0, totalHours: 0, avgHours: 0, sessions: 0, compliantDays: 0, evaluatedDays: 0, days: [], rows: [] });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface LedgerGroup {
  date: string;
  week: number;
  total: number | null;
  rows: AttendanceRow[];
}
export interface LedgerEmployee {
  emp: EmployeeSummary;
  weeks: { week: number; days: LedgerGroup[]; rowCount: number }[];
  rowCount: number;
}

/** Rows grouped employee -> week -> date so the table can use rowSpan. Input order is preserved. */
export function buildLedger(emps: EmployeeSummary[]): LedgerEmployee[] {
  return emps.map((emp) => {
    const weeks: LedgerEmployee['weeks'] = [];
    for (const r of emp.rows) {
      let w = weeks[weeks.length - 1];
      if (!w || w.week !== r.week) weeks.push((w = { week: r.week, days: [], rowCount: 0 }));
      let d = w.days[w.days.length - 1];
      if (!d || d.date !== r.workDate) {
        w.days.push((d = { date: r.workDate, week: r.week, total: null, rows: [] }));
      }
      d.rows.push(r);
      if (r.isFirstRowOfDayGroup) d.total = r.dailyTotalHours;
      w.rowCount++;
    }
    return { emp, weeks, rowCount: emp.rows.length };
  });
}

export const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0);
