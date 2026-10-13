/**
 * Users see the month's attendance in tabs (per employee, all employees, managers, full log).
 * They can search, filter by shift, week or compliance.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, attendanceApi } from '../api';
import { useAsync } from '../useAsync';
import { distinctShifts, filterEmployees, scopeToWeek, summarizeEmployees, totals } from '../lib/attendance';
import { Card, Empty, Loading, hrs } from '../components/dashboard/shared';
import EmployeeTab from '../components/dashboard/EmployeeTab';
import DirectoryTab from '../components/dashboard/DirectoryTab';
import ManagerTab from '../components/dashboard/ManagerTab';
import LedgerTab from '../components/dashboard/LedgerTab';

const TABS = [
  ['employee', 'Per Employee Daily Work Hours'],
  ['directory', 'All Employees Details'],
  ['managers', 'Manager & Team Metrics'],
  ['ledger', 'Complete Attendance & Daily Log'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function DashboardPage({ month }: { month: string }) {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [shift, setShift] = useState('');
  const [compliance, setCompliance] = useState('');
  const [weekCompliance, setWeekCompliance] = useState('');
  const [week, setWeek] = useState('');
  const [transport, setTransport] = useState('');
  const months = useAsync(api.months, []);
  const processed = months.data?.find((m) => m.month.slice(0, 7) === month)?.processed;
  const att = useAsync(
    () => (month && processed ? attendanceApi.attendance(month) : Promise.resolve(null)),
    [month, processed],
  );
  const rows = att.data;
  const all = useMemo(() => (rows ? summarizeEmployees(rows) : []), [rows]);
  const shifts = useMemo(() => (rows ? distinctShifts(rows) : []), [rows]);
  const weeks = useMemo(() => (rows ? [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b) : []), [rows]);
  const scoped = useMemo(() => (rows ? scopeToWeek(all, rows, week, weekCompliance) : all), [all, rows, week, weekCompliance]);
  const emps = useMemo(() => filterEmployees(scoped, q, shift, compliance, transport), [scoped, q, shift, compliance, transport]);

  const tabParam = params.get('tab');
  const tab: Tab = TABS.some(([k]) => k === tabParam) ? (tabParam as Tab) : 'employee';
  const set = (patch: Record<string, string>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) n.set(k, v);
      return n;
    });
  const jump = (id: string) => set({ tab: 'employee', emp: id });

  if (!month) return <Empty text="Nothing Processed yet, upload and process first!" />;
  if (months.loading || att.loading) return <Loading />;
  if (months.error || att.error) return <p className="text-sm text-red-600">Error: {months.error ?? att.error}</p>;
  if (!processed) return <Empty text={`${month} has not been processed. Process this month first (Upload page).`} />;
  if (!all.length) return <Empty text={`No attendance rows for ${month}.`} />;

  const t = totals(emps);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Attendance &amp; Work Hours <span className="ml-2 text-xs bg-slate-200 rounded-full px-2 py-0.5">{month}</span></h1>
        <p className="text-sm text-slate-500">Synchronized live attendance monitoring &amp; timesheet ledger</p>
      </div>
      <div className="flex gap-2">
        <input className="field flex-1 max-w-md" placeholder="Search name, ID, email, shift or date"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field" value={shift} onChange={(e) => setShift(e.target.value)}>
          <option value="">All Shifts</option>
          {shifts.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="field" value={compliance} onChange={(e) => setCompliance(e.target.value)} aria-label="Monthly compliance">
          <option value="">All Monthly Compliance</option>
          <option value="Yes">Monthly: Compliant</option>
          <option value="No">Monthly: Non-Compliant</option>
          <option value="NA">Monthly: Not Evaluated</option>
        </select>
        <select className="field" value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week">
          <option value="">All Weeks</option>
          {weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
        </select>
        <select className="field" value={weekCompliance} onChange={(e) => setWeekCompliance(e.target.value)} aria-label="Weekly compliance">
          <option value="">All Weekly Compliance</option>
          <option value="Yes">Weekly: Compliant</option>
          <option value="No">Weekly: Non-Compliant</option>
          <option value="NA">Weekly: Not Evaluated</option>
        </select>
        <select className="field" value={transport} onChange={(e) => setTransport(e.target.value)} aria-label="Transport">
          <option value="">All Transport</option>
          <option value="Yes">Transport: Opted In</option>
          <option value="No">Transport: Not Opted In</option>
          <option value="NA">Transport: N/A</option>
        </select>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Card label="Total Employees" value={t.employees} />
        <Card label="Daily Hours Entries" value={t.dailyEntries} />
        <Card label="Total Work Hours Logged" value={hrs(t.totalHours)} />
        <Card label="Check-In Sessions" value={t.sessions} />
      </div>
      <nav className="flex gap-1 border-b border-slate-200">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => set({ tab: k })}
            className={`px-4 py-2 min-w-32 text-center text-sm -mb-px border-b-2 ${tab === k ? 'border-slate-900 font-medium' : 'border-transparent text-slate-500'}`}>{label}</button>
        ))}
      </nav>
      {tab === 'employee' && <EmployeeTab month={month} onChanged={att.refresh} emps={emps} selectedId={params.get('emp')} onSelect={(id) => set({ emp: id })} />}
      {tab === 'directory' && <DirectoryTab emps={emps} onDetail={jump} />}
      {tab === 'managers' && <ManagerTab emps={emps} selected={params.get('mgr')} onSelect={(m) => set({ mgr: m })} onView={jump} />}
      {tab === 'ledger' && <LedgerTab emps={emps} />}
    </div>
  );
}
