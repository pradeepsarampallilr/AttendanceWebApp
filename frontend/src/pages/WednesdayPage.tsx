import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, wednesdayApi } from '../api';
import { useAsync } from '../useAsync';
import { Card, Empty, Notice, Pager, SortTh, td, th, useSort } from '../components/dashboard/shared';
import {
  HOURS_PER_DAY, TARGET_RATE, filterWed, lowIndex, peakIndex, stats, summarize, tierOf, tierOptions, workingWednesdays,
  type TierName, type WedEmployee,
} from '../lib/wednesday';

const TABS = [
  ['employee', 'Per Employee Attendance'],
  ['directory', 'All Employees Directory'],
  ['analytics', 'Weekly Turnout & Analytics'],
  ['ledger', 'Complete Wednesday Ledger'],
] as const;
type Tab = (typeof TABS)[number][0];
const PAGE_SIZES = [10, 15, 25, 50];
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
const actionBtn = 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500';
const ToggleBtn = ({ on, onClick, full, label }: { on: boolean; onClick: () => void; full?: boolean; label?: string }) => (
  <button
    onClick={onClick}
    className={`${actionBtn} ${full ? 'w-full' : 'min-w-[8rem]'} ${on ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
  >
    {label ?? (on ? 'Mark Absent' : 'Mark Attended')}
  </button>
);
const cth = `${th} !text-center`;
const ctd = `${td} !align-middle text-center`;
const ctdv = `${td} !align-middle`;
const Dots = ({ flags }: { flags: boolean[] }) => (
  <span className="inline-flex gap-1">{flags.map((f, i) => <span key={i} className={`w-2.5 h-2.5 rounded-full ${f ? 'bg-emerald-500' : 'bg-slate-300'}`} />)}</span>
);
const Bar = ({ value }: { value: number }) => (
  <div className="flex items-center gap-2"><div className="w-24 h-2 bg-slate-100 rounded"><div className="h-2 bg-emerald-500 rounded" style={{ width: pct(value) }} /></div><span className="text-xs">{pct(value)}</span></div>
);

function PageSize({ size, onChange }: { size: number; onChange: (n: number) => void }) {
  return (
    <label className="text-sm text-slate-600">Rows <select className="field py-0.5 ml-1" value={size} onChange={(e) => onChange(Number(e.target.value))}>
      {PAGE_SIZES.map((n) => <option key={n}>{n}</option>)}</select></label>
  );
}

type K = 'id' | 'name' | 'days';
const keyOf = (e: WedEmployee, k: K) => (k === 'id' ? e.employeeId : k === 'name' ? e.name : e.days);

function DirectoryTable({ emps, dates, allDates, holidays, ledger, onDetail, onToggle }: { emps: WedEmployee[]; dates: string[]; allDates: string[]; holidays: Set<string>; ledger?: boolean; onDetail: (id: string) => void; onToggle: Toggle }) {
  const sort = useSort<K>('name');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(15);
  useEffect(() => setPage(0), [emps, size]);
  if (!emps.length) return <Empty />;
  const sorted = sort.sort(emps, keyOf);
  const start = page * size;
  return (
    <div>
      <div className="flex justify-end mb-2"><PageSize size={size} onChange={setSize} /></div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            {ledger && <th className={cth}>#</th>}
            <SortTh k="id" sort={sort}>Employee ID</SortTh><SortTh k="name" sort={sort}>Employee Name</SortTh>
            {allDates.map((d) => <th key={d} className={`${cth} ${holidays.has(d) ? HOLIDAY_CELL : ''}`}>{short(d)}{holidays.has(d) && <span className="block text-xs font-normal">Holiday</span>}</th>)}
            <SortTh k="days" sort={sort}>Days Attended</SortTh>
            {!ledger && <><th className={cth}>Compliance</th><th className={cth}>Action</th></>}
          </tr></thead>
          <tbody>
            {sorted.slice(start, start + size).map((e, i) => (
              <tr key={e.employeeId}>
                {ledger && <td className={ctd}>{start + i + 1}</td>}
                <td className={`${ctdv}`}>{e.employeeId}</td><td className={ctdv}>{e.name}</td>
                {allDates.map((d) => {
                  if (holidays.has(d)) return <td key={d} className={`${ctd} ${HOLIDAY_CELL}`}><HolidayPill /></td>;
                  const j = dates.indexOf(d);
                  return <td key={d} className={ctd}><Pill on={e.flags[j]} onClick={() => onToggle(e.employeeId, d, !e.flags[j])} /></td>;
                })}
                <td className={ctd}><TierBadge days={e.days} total={dates.length} /></td>
                {!ledger && <><td className={ctd}><div className="flex justify-center"><Bar value={e.rate} /></div></td>
                  <td className={ctd}><button className={`${actionBtn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} onClick={() => onDetail(e.employeeId)}>View Detail</button></td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={Math.ceil(sorted.length / size)} onPage={setPage} />
    </div>
  );
}

function EmployeeTab({ emps, dates, allDates, holidays, selectedId, onSelect, onToggle }: { emps: WedEmployee[]; dates: string[]; allDates: string[]; holidays: Set<string>; selectedId: string | null; onSelect: (id: string) => void; onToggle: Toggle }) {
  if (!emps.length) return <Empty />;
  const sel = emps.find((e) => e.employeeId === selectedId) ?? emps[0];
  const n = dates.length;
  const initials = sel.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="grid grid-cols-[18rem_1fr] gap-4">
      <ul className="bg-white border border-slate-200 rounded-lg max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
        {emps.map((e) => (
          <li key={e.employeeId}>
            <button onClick={() => onSelect(e.employeeId)} className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 ${e.employeeId === sel.employeeId ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
              <span className="min-w-0"><span className="block text-sm truncate">{e.name}</span><span className="block text-xs text-slate-500">{e.employeeId}</span><Dots flags={e.flags} /></span>
              <TierBadge days={e.days} total={n} />
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold">{initials}</div>
          <div className="flex-1"><div className="font-semibold">{sel.name}</div><div className="text-xs text-slate-500">{sel.employeeId}</div></div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TIER_CLS[tierOf(sel.days, n)]}`}>{sel.days}/{n} {tierOf(sel.days, n)} ({pct(sel.rate)})</span>
        </div>
        <div className="grid grid-cols-4 gap-3 text-center">
          <Card label="Days Attended" value={`${sel.days} / ${n} Days`} />
          <Card label="Compliance Rate" value={pct(sel.rate)} />
          <Card label="Est. In-Person Hours" value={`~${(sel.days * HOURS_PER_DAY).toFixed(1)} hrs`} />
          <Card label="Policy Status" value={sel.days === n ? '✓ Compliant' : 'Needs In-Office'} />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {allDates.map((d, w) => {
            const i = dates.indexOf(d);
            return holidays.has(d) ? (
              <div key={d} className={`border border-slate-200 rounded-lg p-3 flex flex-col items-center text-center ${HOLIDAY_CELL}`}>
                <div className="text-sm font-medium">{short(d)}</div><div className="text-xs mb-2">Week {w + 1}</div><HolidayPill />
                <div className="mt-3 text-xs">Public holiday</div>
              </div>
            ) : (
              <div key={d} className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col items-center text-center">
                <div className="text-sm font-medium">{short(d)}</div><div className="text-xs text-slate-500 mb-2">Week {w + 1}</div><Pill on={sel.flags[i]} />
                <div className="mt-3 w-full"><ToggleBtn full on={sel.flags[i]} onClick={() => onToggle(sel.employeeId, d, !sel.flags[i])} /></div>
              </div>
            );
          })}
        </div>
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={cth}>Date</th><th className={cth}>Calendar Day</th><th className={cth}>In-Office Status</th><th className={cth}>Est. Hours</th><th className={cth}>Toggle State</th></tr></thead>
            <tbody>{allDates.map((d, w) => {
              const i = dates.indexOf(d);
              if (holidays.has(d)) return (
                <tr key={d} className={HOLIDAY_CELL}><td className={ctd}>{d}</td><td className={ctd}>Wednesday (Week {w + 1})</td><td className={ctd}><HolidayPill /></td>
                  <td className={ctd}>—</td><td className={ctd}>—</td></tr>
              );
              return (
                <tr key={d}><td className={ctd}>{d}</td><td className={ctd}>Wednesday (Week {w + 1})</td><td className={ctd}><Pill on={sel.flags[i]} /></td>
                  <td className={ctd}>{(sel.flags[i] ? HOURS_PER_DAY : 0).toFixed(1)} hrs</td>
                  <td className={ctd}><ToggleBtn on={sel.flags[i]} label="Toggle" onClick={() => onToggle(sel.employeeId, d, !sel.flags[i])} /></td></tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Chart({ dates, perDate, staff }: { dates: string[]; perDate: number[]; staff: number }) {
  const [mode, setMode] = useState<'bar' | 'trend'>('bar');
  const W = 560, H = 240, L = 36, B = 28, T = 12;
  const max = Math.max(staff, 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const x = (i: number) => L + ((W - L - 8) * (i + 0.5)) / Math.max(dates.length, 1);
  const bw = Math.min(60, ((W - L - 8) / Math.max(dates.length, 1)) * 0.6);
  const avg = perDate.length ? perDate.reduce((a, b) => a + b, 0) / perDate.length : 0;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2"><div className="font-medium text-sm">Headcount Turnout</div>
        <div className="flex gap-1 text-xs">{(['bar', 'trend'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-secondary'}`}>{m === 'bar' ? 'Bar Columns' : 'Trend Line'}</button>))}</div></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Wednesday headcount turnout">
        <line x1={L} x2={W - 8} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
        <line x1={L} x2={W - 8} y1={y(staff * TARGET_RATE)} y2={y(staff * TARGET_RATE)} stroke="#10b981" strokeDasharray="4 3" />
        <line x1={L} x2={W - 8} y1={y(avg)} y2={y(avg)} stroke="#f59e0b" strokeDasharray="4 3" />
        <text x={W - 10} y={y(staff * TARGET_RATE) - 3} textAnchor="end" fontSize="9" fill="#047857">75% target ({Math.round(staff * TARGET_RATE)})</text>
        <text x={W - 10} y={y(avg) + 11} textAnchor="end" fontSize="9" fill="#b45309">avg {avg.toFixed(1)}</text>
        {mode === 'bar' && perDate.map((v, i) => <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={y(0) - y(v)} fill="#64748b" />)}
        {mode === 'trend' && <polyline fill="none" stroke="#64748b" strokeWidth="2" points={perDate.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />}
        {mode === 'trend' && perDate.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="4" fill="#334155" />)}
        {perDate.map((v, i) => <text key={`l${i}`} x={x(i)} y={y(v) - 6} textAnchor="middle" fontSize="10">{v} ({staff ? pct(v / staff) : '0%'})</text>)}
        {dates.map((d, i) => <text key={d} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#475569">{short(d)}</text>)}
      </svg>
    </div>
  );
}

function AnalyticsTab({ emps, dates }: { emps: WedEmployee[]; dates: string[] }) {
  const n = dates.length;
  const s = stats(emps, n);
  if (!emps.length) return <Empty />;
  const pk = peakIndex(s.perDate), lo = lowIndex(s.perDate);
  return (
    <div className="space-y-4">
      <Chart dates={dates} perDate={s.perDate} staff={s.staff} />
      <div className="grid grid-cols-5 gap-3">
        {[...s.distribution.keys()].reverse().map((d) => (
          <div key={d} className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="text-xs text-slate-500">{d} {d === 1 ? 'Day' : 'Days'} · {tierOf(d, n)}</div>
            <div className="text-xl font-semibold">{s.distribution[d]}</div>
            <div className="text-xs text-slate-500 mb-1">{pct(s.distribution[d] / s.staff)} of staff</div>
            <Bar value={s.distribution[d] / s.staff} />
          </div>
        ))}
      </div>
      {pk >= 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card label="Peak Wednesday In-Office Turnout" value={dates[pk]} sub={`${s.perDate[pk]} attendees (${pct(s.perDate[pk] / s.staff)})`} />
          <Card label="Attendance Opportunity & Deficit" value={dates[lo]} sub={`${s.perDate[lo]} attended · ${s.staff - s.perDate[lo]} absent`} />
        </div>
      )}
    </div>
  );
}

export default function WednesdayPage({ month }: { month: string }) {
  const [params, setParams] = useSearchParams();
  const months = useAsync(api.months, []);
  const processed = months.data?.find((m) => m.month.slice(0, 7) === month)?.processed;
  const [err, setErr] = useState<string | null>(null);
  const wed = useAsync(() => (month && processed ? wednesdayApi.get(month) : Promise.resolve(null)), [month, processed]);
  const allDates = wed.data?.wednesdays ?? [];
  const holidays = useMemo(() => new Set(wed.data?.holidays ?? []), [wed.data]);
  const dates = useMemo(() => (wed.data ? workingWednesdays(wed.data) : []), [wed.data]);
  const all = useMemo(() => (wed.data ? summarize(wed.data) : []), [wed.data]);

  const q = params.get('q') ?? '';
  const tierParam = params.get('tier');
  const tier = tierParam !== null && /^\d+$/.test(tierParam) && Number(tierParam) <= dates.length ? Number(tierParam) : null;
  const tabParam = params.get('tab');
  const tab: Tab = TABS.some(([k]) => k === tabParam) ? (tabParam as Tab) : 'employee';
  const set = (patch: Record<string, string>) =>
    setParams((p) => {
      const nx = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) (v ? nx.set(k, v) : nx.delete(k));
      return nx;
    }, { replace: 'q' in patch });
  const toggle: Toggle = (id, date, attended) => {
    setErr(null);
    wednesdayApi.set(month, id, date, attended).then(wed.refresh, (e: Error) => setErr(e.message));
  };
  const emps = useMemo(() => filterWed(all, q, tier), [all, q, tier]);

  if (!month) return <Empty text="No months yet. Upload files first." />;
  if (months.loading || wed.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (months.error || wed.error) return <p className="text-sm text-red-600">Error: {months.error ?? wed.error}</p>;
  if (!processed) return <Empty text={`${month} has not been processed. Process this month first (Upload page).`} />;
  if (!allDates.length || !all.length) return <Empty text={`No Wednesday rows for ${month}.`} />;

  const n = dates.length;
  const s = stats(emps, n);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Wednesday In-Office Attendance <span className="ml-2 text-xs bg-slate-200 rounded-full px-2 py-0.5">{month}</span></h1>
        <p className="text-sm text-slate-500">Tracking mandatory Wednesday in-office policy across {n} operational cycles{holidays.size > 0 && ` (${holidays.size} public ${holidays.size === 1 ? 'holiday' : 'holidays'} excluded)`}</p>
      </div>
      <div className="flex gap-2">
        <input className="field flex-1 max-w-md" placeholder="Search by name or ID" value={q} onChange={(e) => set({ q: e.target.value })} />
        <select className="field" value={tier ?? ''} onChange={(e) => set({ tier: e.target.value })}>
          <option value="">Compliance </option>
          {tierOptions(n).map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Card label="Total Staff Tracked" value={s.staff} />
        <Card label={`Perfect Attendance (${n}/${n})`} value={s.perfect} sub={s.staff ? pct(s.perfect / s.staff) : '0%'} />
        <Card label="Average In-Office Days" value={`${s.avgDays.toFixed(1)} / ${n.toFixed(1)}`} sub={`${n ? pct(s.avgDays / n) : '0%'} of goal`} />
        <Card label="Overall Wednesday Footfall" value={s.footfall} sub={`${s.avgTurnout.toFixed(1)} avg per Wednesday`} />
      </div>
      {err && <Notice tone="error" onClose={() => setErr(null)}>Update failed: {err}</Notice>}
      <nav className="flex gap-1 border-b border-slate-200">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => set({ tab: k })} className={`px-4 py-2 min-w-32 text-center text-sm -mb-px border-b-2 ${tab === k ? 'border-slate-900 font-medium' : 'border-transparent text-slate-500'}`}>{label}</button>
        ))}
      </nav>
      {tab === 'employee' && <EmployeeTab emps={emps} dates={dates} allDates={allDates} holidays={holidays} selectedId={params.get('emp')} onSelect={(id) => set({ emp: id })} onToggle={toggle} />}
      {tab === 'directory' && <DirectoryTable emps={emps} dates={dates} allDates={allDates} holidays={holidays} onDetail={(id) => set({ tab: 'employee', emp: id })} onToggle={toggle} />}
      {tab === 'analytics' && <AnalyticsTab emps={emps} dates={dates} />}
      {tab === 'ledger' && <DirectoryTable emps={emps} dates={dates} allDates={allDates} holidays={holidays} ledger onDetail={() => {}} onToggle={toggle} />}
    </div>
  );
}
