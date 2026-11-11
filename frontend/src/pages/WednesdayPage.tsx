/**
 * Users see who came to the office on the anchor day (Wednesday by default), by employee or in a full table, with tiers and totals.
 * They can search, filter and mark days present or absent.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, wednesdayApi } from '../api';
import { useCanEdit } from '../AuthGate';
import { useConfirm } from '../components/ConfirmModal';
import { useAnchorDay } from '../lib/anchorDay';
import { calendarWeek } from '../lib/dates';
import { useAsync } from '../useAsync';
import { Card, Empty, Loading, Toast, PageHeader, Pager, SortTh, Tabs, td, th, useSort } from '../components/dashboard/shared';
import {
  HOURS_PER_DAY, filterWed, stats, summarize, tierOf, tierOptions, workingWednesdays,
  type TierName, type WedEmployee,
} from '../lib/wednesday';

const TABS = [
  ['directory', 'All Employees Details'],
  ['employee', 'Per Employee Details'],
] as const;
type Tab = (typeof TABS)[number][0];
const PAGE = 10;
const LIST_PAGE = 10;
const TIER_CLS: Record<TierName, string> = {
  Perfect: 'bg-emerald-100 text-emerald-800', High: 'bg-sky-100 text-sky-800',
  Moderate: 'bg-amber-100 text-amber-800', Low: 'bg-orange-100 text-orange-800', Zero: 'bg-rose-100 text-rose-800',
};
const short = (d: string) => `${d.slice(8, 10)}-${new Date(`${d}T00:00:00Z`).toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function TierBadge({ days, total }: { days: number; total: number }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TIER_CLS[tierOf(days, total)]}`}>{days}/{total}</span>;
}
const HolidayPill = () => (
  <span className="inline-flex items-center justify-center min-w-[5.5rem] px-2.5 py-1 rounded-full text-xs font-medium bg-slate-200 text-slate-500" title="Public holiday — not counted">Holiday</span>
);
const HOLIDAY_CELL = 'bg-slate-100 text-slate-400';
type Toggle = (employeeId: string, date: string, attended: boolean) => void;
const Pill = ({ on, onClick }: { on: boolean; onClick?: () => void }) => {
  const cls = `inline-flex items-center justify-center gap-1.5 min-w-[5.5rem] px-2.5 py-1 rounded-full text-xs font-medium ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`;
  const dot = <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-400'}`} />;
  return onClick
    ? <button className={`${cls} cursor-pointer transition hover:ring-2 ring-slate-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500`} title={on ? 'Click to mark absent' : 'Click to mark attended'} onClick={onClick}>{dot}{on ? 'Present' : 'Absent'}</button>
    : <span className={cls}>{dot}{on ? 'Present' : 'Absent'}</span>;
};
const ToggleBtn = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
  <button onClick={onClick} className={`btn btn-sm ${on ? 'btn-danger' : 'btn-success'}`}>{on ? 'Mark Absent' : 'Mark Present'}</button>
);
const cth = `${th} !text-center`;
const ctd = `${td} !align-middle text-center`;
const ctdv = `${td} !align-middle`;
type K = 'id' | 'name' | 'days';
const keyOf = (e: WedEmployee, k: K) => (k === 'id' ? e.employeeId : k === 'name' ? e.name : e.days);

function DirectoryTable({ emps, dates, allDates, holidays, onDetail, onToggle }: { emps: WedEmployee[]; dates: string[]; allDates: string[]; holidays: Set<string>; onDetail: (id: string) => void; onToggle: Toggle }) {
  const canEdit = useCanEdit();
  const sort = useSort<K>('name');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [emps]);
  if (!emps.length) return <Empty />;
  const sorted = sort.sort(emps, keyOf);
  const start = page * PAGE;
  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <SortTh k="id" sort={sort}>Employee ID</SortTh><SortTh k="name" sort={sort}>Employee Name</SortTh>
            {allDates.map((d) => <th key={d} className={`${cth} ${holidays.has(d) ? HOLIDAY_CELL : ''}`}>{short(d)}{holidays.has(d) && <span className="block text-xs font-normal">Holiday</span>}</th>)}
            <SortTh k="days" sort={sort}>Days Attended</SortTh>
            <th className={cth}>Action</th>
          </tr></thead>
          <tbody>
            {sorted.slice(start, start + PAGE).map((e) => (
              <tr key={e.employeeId}>
                <td className={`${ctdv}`}>{e.employeeId}</td><td className={ctdv}>{e.name}</td>
                {allDates.map((d) => {
                  if (holidays.has(d)) return <td key={d} className={`${ctd} ${HOLIDAY_CELL}`}><HolidayPill /></td>;
                  const j = dates.indexOf(d);
                  return <td key={d} className={ctd}><Pill on={e.flags[j]} onClick={canEdit ? () => onToggle(e.employeeId, d, !e.flags[j]) : undefined} /></td>;
                })}
                <td className={ctd}><TierBadge days={e.days} total={dates.length} /></td>
                <td className={ctd}><button className="btn btn-secondary btn-sm" onClick={() => onDetail(e.employeeId)}>View Detail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={Math.ceil(sorted.length / PAGE)} onPage={setPage} />
    </div>
  );
}

function EmployeeTab({ emps, dates, allDates, holidays, selectedId, onSelect, onToggle }: { emps: WedEmployee[]; dates: string[]; allDates: string[]; holidays: Set<string>; selectedId: string | null; onSelect: (id: string) => void; onToggle: Toggle }) {
  const canEdit = useCanEdit();
  const day = useAnchorDay();
  const [page, setPage] = useState(0);
  const pages = Math.ceil(emps.length / LIST_PAGE);
  useEffect(() => setPage((p) => Math.min(p, Math.max(pages - 1, 0))), [pages]);
  if (!emps.length) return <Empty />;
  const sel = emps.find((e) => e.employeeId === selectedId) ?? emps[0];
  const n = dates.length;
  return (
    <div className="grid grid-cols-[320px_1fr] gap-4">
      <div className="min-w-0 flex flex-col">
      <ul className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 flex flex-col flex-1">
        {emps.slice(page * LIST_PAGE, (page + 1) * LIST_PAGE).map((e) => (
          <li key={e.employeeId} className="flex-1">
            <button onClick={() => onSelect(e.employeeId)} className={`w-full h-full text-left px-3 py-2 flex items-center justify-between gap-2 ${e.employeeId === sel.employeeId ? 'bg-brand-soft' : 'hover:bg-slate-50'}`}>
              <span className="min-w-0 text-sm truncate">{e.name} <span className="text-slate-500">#{e.employeeId}</span></span>
              <TierBadge days={e.days} total={n} />
            </button>
          </li>
        ))}
      </ul>
      <Pager page={page} pages={pages} onPage={setPage} />
      </div>
      <div className="space-y-4 min-w-0">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="font-semibold text-lg">{sel.name} <span className="text-xs bg-slate-100 rounded px-1.5 py-0.5">#{sel.employeeId}</span> <TierBadge days={sel.days} total={n} /></div>
          <div className="text-sm text-slate-600">{[sel.email, sel.shift ?? 'No shift', sel.department || '—'].join(' · ')}</div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Card label="Days Attended" value={`${sel.days} / ${n} Days`} />
          <Card label="Compliance Rate" value={pct(sel.rate)} />
          <Card label="Est. In-Person Hours" value={`~${(sel.days * HOURS_PER_DAY).toFixed(1)} hrs`} />
          <Card label="Policy Status" value={sel.days === n ? '✓ Compliant' : 'Needs In-Office'} />
        </div>
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={cth}>Date</th><th className={cth}>Calendar Day</th><th className={cth}>In-Office Status</th><th className={cth}>Est. Hours</th>{canEdit && <th className={cth}>Change Status</th>}</tr></thead>
            <tbody>{allDates.map((d) => {
              const i = dates.indexOf(d);
              if (holidays.has(d)) return (
                <tr key={d} className={HOLIDAY_CELL}><td className={ctd}>{d}</td><td className={ctd}>{day} (Week {calendarWeek(d)})</td><td className={ctd}><HolidayPill /></td>
                  <td className={ctd}>—</td>{canEdit && <td className={ctd}>—</td>}</tr>
              );
              return (
                <tr key={d}><td className={ctd}>{d}</td><td className={ctd}>{day} (Week {calendarWeek(d)})</td><td className={ctd}><Pill on={sel.flags[i]} /></td>
                  <td className={ctd}>{(sel.flags[i] ? HOURS_PER_DAY : 0).toFixed(1)} hrs</td>
                  {canEdit && <td className={ctd}><ToggleBtn on={sel.flags[i]} onClick={() => onToggle(sel.employeeId, d, !sel.flags[i])} /></td>}</tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function WednesdayPage({ month }: { month: string }) {
  const day = useAnchorDay();
  const [params, setParams] = useSearchParams();
  const months = useAsync(api.months, []);
  const processed = months.data?.find((m) => m.month.slice(0, 7) === month)?.processed;
  const [err, setErr] = useState<string | null>(null);
  const [ask, modal] = useConfirm();
  const wed = useAsync(() => (month && processed ? wednesdayApi.get(month) : Promise.resolve(null)), [month, processed]);
  const allDates = wed.data?.wednesdays ?? [];
  const holidays = useMemo(() => new Set(wed.data?.holidays ?? []), [wed.data]);
  const dates = useMemo(() => (wed.data ? workingWednesdays(wed.data) : []), [wed.data]);
  const all = useMemo(() => (wed.data ? summarize(wed.data) : []), [wed.data]);

  const q = params.get('q') ?? '';
  const tierParam = params.get('tier');
  const tier = tierParam !== null && /^\d+$/.test(tierParam) && Number(tierParam) <= dates.length ? Number(tierParam) : null;
  const tabParam = params.get('tab');
  const tab: Tab = TABS.some(([k]) => k === tabParam) ? (tabParam as Tab) : 'directory';
  const set = (patch: Record<string, string>) =>
    setParams((p) => {
      const nx = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) (v ? nx.set(k, v) : nx.delete(k));
      return nx;
    }, { replace: 'q' in patch });
  const toggle: Toggle = (id, date, attended) => {
    const name = all.find((e) => e.employeeId === id)?.name ?? id;
    ask({ title: `Mark ${attended ? 'present' : 'absent'}?`, confirmLabel: attended ? 'Mark present' : 'Mark absent', tone: attended ? 'primary' : 'danger',
      message: `Mark ${name} as ${attended ? 'present' : 'absent'} on ${date}?` }, () => {
      setErr(null);
      wednesdayApi.set(month, id, date, attended).then(wed.refresh, (e: Error) => setErr(e.message));
    });
  };
  const emps = useMemo(() => filterWed(all, q, tier), [all, q, tier]);

  if (!month) return <Empty text="Nothing Processed yet, upload and process first!" />;
  if (months.loading || wed.loading) return <Loading />;
  if (months.error || wed.error) return <p className="text-sm text-red-600">Error: {months.error ?? wed.error}</p>;
  if (!processed) return <Empty text={`${month} has not been processed. Process this month first (Upload page).`} />;
  if (!allDates.length || !all.length) return <Empty text={`No ${day} rows for ${month}.`} />;

  const n = dates.length;
  const s = stats(emps, n);
  return (
    <div className="space-y-4">
      <PageHeader title="Anchor Day Attendance" badge={month}
        aside={<span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">Anchor day: {day}</span>}
        sub={`Tracking mandatory ${day} in-office policy across ${n} operational cycles${holidays.size > 0 ? ` (${holidays.size} public ${holidays.size === 1 ? 'holiday' : 'holidays'} excluded)` : ''}`} />
      <div className="filters">
        <input className="field !flex-[3]" placeholder="Search by name or ID" value={q} onChange={(e) => set({ q: e.target.value })} />
        <select className="field" aria-label="Compliance" value={tier ?? ''} onChange={(e) => set({ tier: e.target.value })}>
          <option value="">All Compliance</option>
          {tierOptions(n).map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Card label="Total Staff Tracked" value={s.staff} />
        <Card label={`Full Attendance (${n}/${n})`} value={s.perfect} sub={s.staff ? pct(s.perfect / s.staff) : '0%'} />
        <Card label="Average In-Office Days" value={`${s.avgDays.toFixed(1)} / ${n.toFixed(1)}`} sub={`${n ? pct(s.avgDays / n) : '0%'} of working ${day}s`} />
        <Card label={`Overall ${day} Footfall`} value={s.footfall} sub={`${s.avgTurnout.toFixed(1)} avg per ${day}`} />
      </div>
      {err && <Toast tone="error" onClose={() => setErr(null)}>Update failed: {err}</Toast>}
      <Tabs tabs={TABS} value={tab} onChange={(k) => set({ tab: k })} />
      {tab === 'employee' && <EmployeeTab emps={emps} dates={dates} allDates={allDates} holidays={holidays} selectedId={params.get('emp')} onSelect={(id) => set({ emp: id })} onToggle={toggle} />}
      {modal}
      {tab === 'directory' && <DirectoryTable emps={emps} dates={dates} allDates={allDates} holidays={holidays} onDetail={(id) => set({ tab: 'employee', emp: id })} onToggle={toggle} />}
    </div>
  );
}
