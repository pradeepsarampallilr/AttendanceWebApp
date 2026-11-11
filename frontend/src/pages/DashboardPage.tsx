/**
 * Users see the month's attendance in tabs (per employee, all employees, managers, full log).
 * They can search, filter by shift, week or compliance.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, attendanceApi } from '../api';
import { useUser } from '../AuthGate';
import { useAnchorDay } from '../lib/anchorDay';
import { useAsync } from '../useAsync';
import { distinctShifts, filterEmployees, scopeToWeek, summarizeEmployees, totals } from '../lib/attendance';
import { Card, Empty, Loading, PageHeader, Tabs, hrs } from '../components/dashboard/shared';
import EmployeeTab from '../components/dashboard/EmployeeTab';
import DirectoryTab from '../components/dashboard/DirectoryTab';
import ManagerTab from '../components/dashboard/ManagerTab';
import LedgerTab from '../components/dashboard/LedgerTab';
import WeeklyTab from '../components/dashboard/WeeklyTab';
import { AttendanceIcon, UsersIcon } from '../components/Icons';

const TABS = [
  ['directory', 'All Employees Details'],
  ['employee', 'Per Employee Details'],
  ['managers', 'Manager & Team Details'],
  ['weekly', 'Weekly Compliance Details'],
  ['ledger', 'Complete Attendance & Daily Logs'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function DashboardPage({ month, team: teamView = false }: { month: string; team?: boolean }) {
  const day = useAnchorDay();
  const { role, employeeId } = useUser();
  const isEmployee = role === 'employee';
  const isManager = role === 'manager';
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
  const weekly = useAsync(
    () => (month && processed ? api.weekly(month) : Promise.resolve([])),
    [month, processed],
  );
  const team = useAsync(api.team, []);
  const lines = useMemo(() => team.data ?? [], [team.data]);
  const weeklyRows = useMemo(() => weekly.data ?? [], [weekly.data]);
  const rows = att.data;
  const all = useMemo(() => (rows ? summarizeEmployees(rows) : []), [rows]);
  const shifts = useMemo(() => (rows ? distinctShifts(rows) : []), [rows]);
  const weeks = useMemo(() => [...new Map(weeklyRows.map((w) => [w.week, w.weekStart]))].sort((a, b) => a[0] - b[0]), [weeklyRows]);
  const scoped = useMemo(() => (rows ? scopeToWeek(all, rows, weeklyRows, week, weekCompliance) : all), [all, rows, weeklyRows, week, weekCompliance]);
  const emps = useMemo(() => filterEmployees(scoped, q, shift, compliance, transport), [scoped, q, shift, compliance, transport]);

  const tabParam = params.get('tab');
  const tab: Tab = TABS.some(([k]) => k === tabParam) ? (tabParam as Tab) : 'directory';
  const set = (patch: Record<string, string>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) n.set(k, v);
      return n;
    });
  const jump = (id: string) => set({ tab: 'employee', emp: id });

  if (!month) return <Empty text="Nothing Processed yet, upload and process first!" />;
  if (months.loading || att.loading || weekly.loading || team.loading) return <Loading />;
  if (months.error || att.error || weekly.error || team.error) return <p className="text-sm text-red-600">Error: {months.error ?? att.error ?? weekly.error ?? team.error}</p>;
  if (!processed) return <Empty text={`${month} has not been processed. Process this month first (Upload page).`} />;
  if (!all.length) return <Empty text={`No attendance rows for ${month}.`} />;

  if (isEmployee) {
    return (
      <div className="space-y-4">
        <PageHeader icon={<AttendanceIcon className="h-5 w-5" />} title="My Attendance" badge={month} sub={`Your office days, hours and weekly compliance — 3 office days a week, with ${day} as the anchor day`} />
        <EmployeeTab solo month={month} onChanged={att.refresh} emps={all} selectedId={null} onSelect={() => {}}>
          <WeeklyTab solo weekly={weeklyRows} />
        </EmployeeTab>
      </div>
    );
  }

  if (isManager) {
    const team = teamView;
    const weeklyOf = (id: string) => weeklyRows.filter((w) => w.employeeId === id);
    if (!team) {
      return (
        <div className="space-y-4">
          <PageHeader icon={<AttendanceIcon className="h-5 w-5" />} title="My Attendance" badge={month} sub={`Your office days, hours and weekly compliance — 3 office days a week, with ${day} as the anchor day`} />
          <EmployeeTab solo month={month} onChanged={att.refresh} emps={all.filter((e) => e.employeeId === employeeId)} selectedId={null} onSelect={() => {}}>
            <WeeklyTab solo weekly={weeklyOf(employeeId ?? '')} />
          </EmployeeTab>
        </div>
      );
    }
    const viewed = params.get('emp') ? all.find((e) => e.employeeId === params.get('emp') && e.employeeId !== employeeId) : undefined;
    return (
      <div className="space-y-4">
        <PageHeader icon={<UsersIcon className="h-5 w-5" />} title="Team" badge={month} sub="Your reporting hierarchy — office days and weekly compliance for everyone under you" />
        {viewed ? (
          <div className="space-y-3">
            <button className="btn btn-secondary btn-sm" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete('emp'); return n; })}>← Back to team</button>
            <EmployeeTab solo month={month} onChanged={att.refresh} emps={[viewed]} selectedId={null} onSelect={() => {}}>
              <WeeklyTab solo weekly={weeklyOf(viewed.employeeId)} />
            </EmployeeTab>
          </div>
        ) : <ManagerTab lean emps={all} lines={lines} selected={params.get('mgr')} onSelect={(m) => set({ mgr: m })} onView={(id) => set({ emp: id })} />}
      </div>
    );
  }

  const t = totals(emps);
  return (
    <div className="space-y-4">
      <PageHeader icon={<AttendanceIcon className="h-5 w-5" />} title="Attendance & Work Hours" badge={month} sub={`Office days, hours and compliance by calendar week — 3 office days a week, with ${day} as the anchor day`} />
      <div className="filters">
        <input className="field !flex-[2]" placeholder="Search name, ID, email, shift or date"
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
          {weeks.map(([w, start]) => <option key={w} value={w}>Week {w} · from {start.slice(8)}-{start.slice(5, 7)}</option>)}
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
      <Tabs tabs={TABS} value={tab} onChange={(k) => set({ tab: k })} />
      {tab === 'employee' && <EmployeeTab month={month} onChanged={att.refresh} emps={emps} selectedId={params.get('emp')} onSelect={(id) => set({ emp: id })} />}
      {tab === 'directory' && <DirectoryTab emps={emps} onDetail={jump} />}
      {tab === 'managers' && <ManagerTab emps={emps} lines={lines} selected={params.get('mgr')} onSelect={(m) => set({ mgr: m })} onView={jump} />}
      {tab === 'weekly' && <WeeklyTab weekly={weeklyRows} />}
      {tab === 'ledger' && <LedgerTab emps={emps} />}
    </div>
  );
}
