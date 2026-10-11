import type { AttendanceRow, Tri } from '../api';

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
  eligibility: 'Yes' | 'No';
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
  managerName: string;
  department: string | null;
  teamSize: number;
  totalHours: number;
  loggedDays: number;
  avgHours: number;
  compliantDays: number;
  evaluatedDays: number;
  members: EmployeeSummary[];
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

export function summarizeManagers(emps: EmployeeSummary[]): ManagerSummary[] {
  const map = new Map<string, ManagerSummary>();
  for (const e of emps) {
    if (!e.managerName) continue;
    let m = map.get(e.managerName);
    if (!m) {
      m = {
        managerName: e.managerName, department: e.department, teamSize: 0, totalHours: 0,
        loggedDays: 0, avgHours: 0, compliantDays: 0, evaluatedDays: 0, members: [],
      };
      map.set(e.managerName, m);
    }
    m.members.push(e);
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
 * Narrows employees to one week of the month (`week` = '' keeps the whole month) and/or a weekly compliance status.
 * With a week selected, each employee's rows/hours/days are limited to that week, so the cards, charts and tables
 * show that week only. Employees with no attendance that week are kept as empty summaries: the engine emits no row
 * for them, but an eligible one is weekly "No" (fewer than 3 days) and an ineligible one is "NA".
 */
export function scopeToWeek(all: EmployeeSummary[], rows: AttendanceRow[], week: string, status: string): EmployeeSummary[] {
  if (!week && !status) return all;
  const weeks = week ? [Number(week)] : [...new Set(rows.map((r) => r.week))];
  // The engine only evaluates weeks an employee attended, so a week with no rows counts as "No" for an eligible
  // employee (fewer than 3 days). Over several weeks: No = any week failed or missed, else Yes; ineligible = NA.
  const weekly = (e: EmployeeSummary): Tri => {
    if (e.eligibility === 'No') return 'NA';
    const byWeek = new Map(e.rows.map((r) => [r.week, r.weekCompliant]));
    return weeks.every((w) => byWeek.get(w) === 'Yes') ? 'Yes' : 'No';
  };
  const scoped = week ? summarizeEmployees(rows.filter((r) => String(r.week) === week)) : all;
  const out = scoped.map((e) => ({ ...e, weekStatus: weekly(e) })).filter((e) => !status || e.weekStatus === status);
  if (!week) return out;
  const seen = new Set(scoped.map((e) => e.employeeId));
  for (const e of all) {
    if (seen.has(e.employeeId)) continue;
    const implied: Tri = e.eligibility === 'No' ? 'NA' : 'No';
    if (status && status !== implied) continue;
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
export const hoursTone = (h: number) => (h >= BENCHMARK_HOURS ? 'green' : 'amber');
