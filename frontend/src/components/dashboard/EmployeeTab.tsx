import { useEffect, useState } from 'react';
import { attendanceApi } from '../../api';
import { BENCHMARK_HOURS, type EmployeeSummary } from '../../lib/attendance';
import { Badge, Card, Notice, ComplianceBadge, Empty, Pager, dayName, hrs, td, th, time } from './shared';

function Chart({ emp }: { emp: EmployeeSummary }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = emp.days;
  if (!days.length) return null;
  const W = Math.max(960, days.length * 48), H = 220, pad = { l: 30, b: 50, t: 10 };
  const max = Math.max(10, ...days.map((d) => d.hours));
  const y = (h: number) => H - pad.b - (h / max) * (H - pad.b - pad.t);
  const bw = (W - pad.l) / days.length;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="Daily work hours">
        <line x1={pad.l} x2={W} y1={y(BENCHMARK_HOURS)} y2={y(BENCHMARK_HOURS)} stroke="#059669" strokeDasharray="4 3" />
        <line x1={pad.l} x2={W} y1={y(emp.avgHours)} y2={y(emp.avgHours)} stroke="#6366f1" strokeDasharray="2 3" />
        <text x={2} y={y(BENCHMARK_HOURS) + 4} fontSize="10" fill="#059669">7h</text>
        {days.map((d, i) => {
          const x = pad.l + i * bw + 4;
          const ok = d.hours >= BENCHMARK_HOURS;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={y(d.hours)} width={bw - 8} height={H - pad.b - y(d.hours)}
                fill={ok ? (hover === i ? '#047857' : '#10b981') : hover === i ? '#d97706' : '#f59e0b'} />
              <text transform={`translate(${x + bw / 2 - 4},${H - pad.b + 12}) rotate(-35)`} textAnchor="end" fontSize="10" fill="#475569">
                {d.date.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="text-xs text-slate-600 flex gap-4 items-center justify-center min-h-5 mt-1">
        <span><span className="inline-block w-2 h-2 bg-emerald-500 mr-1" />≥ 7.0h</span>
        <span><span className="inline-block w-2 h-2 bg-amber-500 mr-1" />&lt; 7.0h</span>
        <span className="text-indigo-600">- - average {hrs(emp.avgHours)}h</span>
        {hover !== null && (
          <span>
            {days[hover].date} {dayName(days[hover].date)} · {hrs(days[hover].hours)}h ·{' '}
            {(days[hover].hours - BENCHMARK_HOURS >= 0 ? '+' : '') + (days[hover].hours - BENCHMARK_HOURS).toFixed(2)}h vs 7.0h
          </span>
        )}
      </div>
    </div>
  );
}

const EMP_PAGE = 15;

const TAG: Record<string, string> = { add: 'added', edit: 'edited', delete: 'deleted' };

/** Add / edit / delete / revert one employee-day's total hours. */
function DailyEditor({ emp, month, onChanged }: { emp: EmployeeSummary; month: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [newDate, setNewDate] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // Day-group first rows; deleted days are kept so they can be reverted.
  const days = emp.rows.filter((r) => r.isFirstRowOfDayGroup && (r.dailyTotalHours !== null || r.adjustment === 'delete'));
  const run = (p: Promise<unknown>) => {
    setErr(null);
    p.then(() => { setEditing(null); setNewDate(''); setValue(''); onChanged(); }, (e: Error) => setErr(e.message));
  };
  const save = (date: string) => {
    const h = Number(value);
    if (value.trim() === '' || Number.isNaN(h)) return setErr('Enter hours as a number');
    run(attendanceApi.setHours(month, emp.employeeId, date, h));
  };
  const input = (date: string) => (
    <span className="inline-flex gap-1">
      <input className="field !min-w-0 w-24" inputMode="decimal" placeholder="hrs" value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn btn-primary btn-sm" onClick={() => save(date)}>Save</button>
      <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button>
    </span>
  );
  return (
    <>
      {err && <Notice tone="error" className="mb-1" onClose={() => setErr(null)}>Update failed: {err}</Notice>}
      <table className="w-full text-sm">
        <thead><tr>{['Date', 'Day', 'Daily Total', 'Week', 'Actions'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {days.map((r) => (
            <tr key={r.workDate}>
              <td className={td}>{r.workDate}{r.adjustment && <span className="ml-2 text-xs bg-indigo-100 text-indigo-800 rounded px-1.5">{TAG[r.adjustment]}</span>}</td>
              <td className={td}>{dayName(r.workDate)}</td>
              <td className={td}>{editing === r.workDate ? input(r.workDate) : <Badge hours={r.dailyTotalHours} />}</td>
              <td className={td}>{r.week}</td>
              <td className={`${td} space-x-3`}>
                {r.adjustment !== 'delete' && <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(r.workDate); setValue(String(r.dailyTotalHours ?? '')); }}>Edit</button>}
                {r.adjustment !== 'delete' && <button className="btn btn-secondary btn-sm" onClick={() => window.confirm(`Delete ${r.workDate}'s hours?`) && run(attendanceApi.removeHours(month, emp.employeeId, r.workDate))}>Delete</button>}
                {r.adjustment && <button className="btn btn-secondary btn-sm" onClick={() => run(attendanceApi.revertHours(month, emp.employeeId, r.workDate))}>Revert</button>}
              </td>
            </tr>
          ))}
          {!days.length && <tr><td className={td} colSpan={5}>No closed visits this month.</td></tr>}
          <tr>
            <td className={td} colSpan={5}>
              <span className="inline-flex gap-2 items-center">
                {/* <input type="date" className="field" min={`${month}-01`} max={`${month}-31`} value={newDate} onChange={(e) => setNewDate(e.target.value)} /> */}
                {newDate && (editing === newDate ? input(newDate) : <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(newDate); setValue(''); }}>Add hours for this date</button>)}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

export default function EmployeeTab({
  emps, selectedId, onSelect, month, onChanged,
}: { emps: EmployeeSummary[]; selectedId: string | null; onSelect: (id: string) => void; month: string; onChanged: () => void }) {
  const [showChart, setShowChart] = useState(true);
  const [sub, setSub] = useState<'daily' | 'sessions'>('daily');
  const [page, setPage] = useState(0);
  const pages = Math.ceil(emps.length / EMP_PAGE);
  useEffect(() => setPage((p) => Math.min(p, Math.max(pages - 1, 0))), [pages]);
  if (!emps.length) return <Empty />;
  const emp = emps.find((e) => e.employeeId === selectedId) ?? emps[0];
  return (
    <div className="grid grid-cols-[320px_1fr] gap-4">
      <div className="min-w-0">
      <ul className="bg-white border border-slate-200 rounded-lg max-h-[75vh] overflow-y-auto divide-y divide-slate-100">
        {emps.slice(page * EMP_PAGE, (page + 1) * EMP_PAGE).map((e) => (
          <li key={e.employeeId}>
            <button onClick={() => onSelect(e.employeeId)}
              className={`w-full text-left px-3 py-2 text-sm ${e.employeeId === emp.employeeId ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}>
              <div className="font-medium flex items-center gap-1">{e.name} <span className="opacity-60">#{e.employeeId}</span><span className="ml-auto"><ComplianceBadge emp={e} /></span></div>
              <div className="text-xs opacity-70">{e.shift ?? 'No shift'} · {e.loggedDays} days · {hrs(e.totalHours)}h</div>
            </button>
          </li>
        ))}
      </ul>
      <Pager page={page} pages={pages} onPage={setPage} />
      </div>
      <div className="space-y-3 min-w-0">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="font-semibold text-lg">{emp.name} <span className="text-xs bg-slate-100 rounded px-1.5 py-0.5">#{emp.employeeId}</span> <ComplianceBadge emp={emp} /></div>
          <div className="text-sm text-slate-600">{emp.email} · {emp.shift ?? 'No shift'} · {emp.department ?? '—'}</div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Card label="Logged Days" value={emp.loggedDays} />
          <Card label="Total Daily Hours" value={hrs(emp.totalHours)} />
          <Card label="Daily Average" value={hrs(emp.avgHours)} />
          <Card label="Office Sessions" value={emp.sessions} />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowChart((s) => !s)}>{showChart ? 'Hide Graph' : 'Show Graph'}</button>
        {showChart && <Chart emp={emp} />}
        <div className="flex gap-2 text-sm">
          {(['daily', 'sessions'] as const).map((s) => (
            <button key={s} onClick={() => setSub(s)} className={`btn ${sub === s ? 'btn-primary' : 'btn-secondary'}`}>
              {s === 'daily' ? 'Daily Work Hours' : 'Check-In Sessions'}
            </button>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          {sub === 'daily' ? (
            <DailyEditor emp={emp} month={month} onChanged={onChanged} />
          ) : (
            <table className="w-full text-sm">
              <thead><tr>{['Checked In', 'Checked Out', 'Hours', 'Shift'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {emp.rows.filter((r) => r.checkIn).map((r, i) => (
                  <tr key={i}><td className={`${td}`}>{time(r.checkIn)}</td><td className={`${td}`}>{time(r.checkOut)}</td>
                    <td className={td}>{hrs(r.visitHours)}</td><td className={td}>{r.shiftLabel ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
