import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AttendanceRow } from '../api';
import { buildLedger, filterEmployees, summarizeEmployees, summarizeManagers, totals } from './attendance';

const row = (o: Partial<AttendanceRow>): AttendanceRow => ({
  employeeId: 'E1', name: 'Emp One', email: 'e1@example.com', department: 'Eng', managerName: 'Boss A',
  managerEmail: null, week: 1, weekAttendedDays: 3, workDate: '2026-08-03', checkIn: '2026-08-03T09:00:00',
  checkOut: '2026-08-03T17:00:00', visitHours: 8, dailyTotalHours: 8, isFirstRowOfDayGroup: true,
  rowsInDayGroup: 1, shiftLabel: '9-6', eligibility: 'Yes', compliant: 'Yes', weekCompliant: 'Yes',
  monthCompliant: 'No', transportOptIn: 'Yes', adjustment: null, ...o,
});

const sample = [
  row({}),
  row({ workDate: '2026-08-04', checkIn: '2026-08-04T09:00:00', dailyTotalHours: 5, compliant: 'No', rowsInDayGroup: 2, visitHours: 3 }),
  row({ workDate: '2026-08-04', checkIn: '2026-08-04T14:00:00', visitHours: 2, isFirstRowOfDayGroup: false, dailyTotalHours: 5, compliant: 'No' }),
  row({ workDate: '2026-08-10', week: 2, checkOut: null, visitHours: null, dailyTotalHours: null, compliant: 'NA' }),
  row({ employeeId: 'E2', name: 'Emp Two', managerName: 'Boss A', shiftLabel: '4-1', eligibility: 'No', compliant: 'NA', dailyTotalHours: 9 }),
];

describe('aggregation', () => {
  const emps = summarizeEmployees(sample);
  it('sums daily totals once per day group, ignoring open visits', () => {
    const e1 = emps.find((e) => e.employeeId === 'E1')!;
    expect(e1.loggedDays).toBe(2);
    expect(e1.totalHours).toBe(13);
    expect(e1.avgHours).toBe(6.5);
    expect(e1.sessions).toBe(4);
    expect([e1.compliantDays, e1.evaluatedDays]).toEqual([1, 2]);
  });
  it('totals and manager rollup', () => {
    expect(totals(emps)).toEqual({ employees: 2, dailyEntries: 3, totalHours: 22, sessions: 5 });
    const [m] = summarizeManagers(emps);
    expect([m.teamSize, m.totalHours, m.compliantDays, m.evaluatedDays]).toEqual([2, 22, 1, 2]);
  });
  it('filters by search and shift', () => {
    expect(filterEmployees(emps, 'two', '')).toHaveLength(1);
    expect(filterEmployees(emps, '2026-08-10', '')).toHaveLength(1);
    expect(filterEmployees(emps, '', '4-1')).toHaveLength(1);
    expect(filterEmployees(emps, 'zzz', '')).toHaveLength(0);
  });
  it('builds ledger with contiguous week/date spans', () => {
    const [l] = buildLedger(emps);
    expect(l.rowCount).toBe(4);
    expect(l.weeks.map((w) => [w.week, w.rowCount])).toEqual([[1, 3], [2, 1]]);
    expect(l.weeks[0].days.map((d) => [d.date, d.rows.length, d.total])).toEqual([['2026-08-03', 1, 8], ['2026-08-04', 2, 5]]);
  });
});

describe('golden parity (august)', () => {
  const path = new URL('../../../golden/august.json', import.meta.url);
  it.skipIf(!existsSync(path))('manager compliance counts match golden rows', () => {
    const g = JSON.parse(readFileSync(path, 'utf8')).rows as Record<string, any>[];
    const rows: AttendanceRow[] = g.map((r) => ({
      employeeId: r.employee_id, name: r.name, email: r.email, department: r.department,
      managerName: r.manager_name, managerEmail: r.manager_email, week: r.week,
      weekAttendedDays: r.week_attended_days, workDate: r.work_date, checkIn: r.check_in,
      checkOut: r.check_out, visitHours: r.visit_hours, dailyTotalHours: r.daily_total_hours,
      adjustment: null, isFirstRowOfDayGroup: r.is_first_row_of_day_group, rowsInDayGroup: r.rows_in_day_group,
      shiftLabel: r.shift_label, eligibility: r.eligibility, compliant: r.compliant,
      weekCompliant: r.week_compliant, monthCompliant: r.month_compliant, transportOptIn: 'NA',
    }));
    const mgrs = summarizeManagers(summarizeEmployees(rows));
    expect(mgrs.length).toBeGreaterThan(0);
    for (const m of mgrs) {
      const mine = rows.filter((r) => r.managerName === m.managerName && r.isFirstRowOfDayGroup);
      expect(m.compliantDays).toBe(mine.filter((r) => r.compliant === 'Yes').length);
      expect(m.evaluatedDays).toBe(mine.filter((r) => r.compliant !== 'NA').length);
    }
  });
});
