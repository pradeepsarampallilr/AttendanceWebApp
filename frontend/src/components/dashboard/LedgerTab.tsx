/**
 * Dashboard tab with the full attendance log by employee, week and day, with check-in sessions.
 * Can show all rows, daily totals only, or sessions only.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { buildLedger, type EmployeeSummary } from '../../lib/attendance';
import { Badge, Empty, Pager, dayName, hrs, th, time } from './shared';

type Scope = 'all' | 'daily' | 'sessions';
const PAGE = 10;
const td = 'px-4 py-3.5 align-middle whitespace-nowrap border-b border-r border-slate-300 last:border-r-0';
const c = `${td} text-center`;

export default function LedgerTab({ emps }: { emps: EmployeeSummary[] }) {
  const [scope, setScope] = useState<Scope>('all');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [emps, scope]);
  const ledger = useMemo(() => buildLedger(emps), [emps]);
  if (!ledger.length) return <Empty />;
  const pageItems = ledger.slice(page * PAGE, (page + 1) * PAGE);
  const showDaily = scope !== 'sessions', showSessions = scope !== 'daily';
  return (
    <div>
      <div className="flex gap-2 text-sm mb-3">
        {([['all', 'All Rows'], ['daily', 'Daily Total Hours Only'], ['sessions', 'Check-In Sessions Only']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setScope(k)} className={`btn ${scope === k ? 'btn-primary' : 'btn-secondary'}`}>{l}</button>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            {['Name', 'ID', 'Email', 'Shift', 'Date', 'Day'].map((h) => <th key={h} className={`${th} px-4 py-3 border-b border-r border-slate-300 last:border-r-0`}>{h}</th>)}
            {showDaily && <th className={`${th} px-4 py-3 border-b border-r border-slate-300 last:border-r-0`}>Daily Total</th>}
            {showSessions && ['Checked In', 'Checked Out', 'Hours'].map((h) => <th key={h} className={`${th} px-4 py-3 border-b border-r border-slate-300 last:border-r-0`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {pageItems.map(({ emp, weeks }) => {
              // In daily-only mode each date collapses to one row; otherwise one row per visit.
              const visible = (rows: typeof weeks[0]['days'][0]['rows']) => (scope === 'daily' ? rows.slice(0, 1) : rows);
              const total = weeks.reduce((s, w) => s + w.days.reduce((t, d) => t + visible(d.rows).length, 0), 0);
              let first = true;
              return weeks.map((w) => {
                return w.days.map((d) => {
                  const rows = visible(d.rows);
                  return rows.map((r, i) => {
                    const cells = (
                      <>
                        {first && (<>
                          <td rowSpan={total} className={td}>{emp.name}</td>
                          <td rowSpan={total} className={`${td}`}>{emp.employeeId}</td>
                          <td rowSpan={total} className={td}>{emp.email}</td>
                          <td rowSpan={total} className={td}>{emp.shift ?? '—'}</td>
                        </>)}
                        {i === 0 && (<>
                          <td rowSpan={rows.length} className={`${td}`}>{d.date}<div className="mt-0.5 text-xs text-slate-400">{d.rows.length} session{d.rows.length === 1 ? '' : 's'}</div></td>
                          <td rowSpan={rows.length} className={td}>{dayName(d.date)}</td>
                          {showDaily && <td rowSpan={rows.length} className={c}><Badge hours={d.total} /></td>}
                        </>)}
                        {showSessions && (<>
                          <td className={`${td}`}>{time(r.checkIn)}</td>
                          <td className={`${td}`}>{time(r.checkOut)}</td>
                          <td className={`${c}`}>{hrs(r.visitHours)}</td>
                        </>)}
                      </>
                    );
                    first = false;
                    return <tr key={`${emp.employeeId}-${d.date}-${i}`}>{cells}</tr>;
                  });
                });
              });
            }).map((x, i) => <Fragment key={i}>{x}</Fragment>)}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={Math.ceil(ledger.length / PAGE)} onPage={setPage} />
    </div>
  );
}
