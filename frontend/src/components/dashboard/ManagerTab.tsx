/**
 * Dashboard tab showing one manager's team: totals and a searchable, sortable list of team members.
 */
import { useState } from 'react';
import { BENCHMARK_HOURS, pct, summarizeManagers, type EmployeeSummary } from '../../lib/attendance';
import { Badge, Card, Empty, SortTh, hrs, td, th, useSort } from './shared';

type K = 'name' | 'loggedDays' | 'totalHours' | 'avgHours' | 'rate' | 'sessions';

export default function ManagerTab({
  emps, selected, onSelect, onView,
}: { emps: EmployeeSummary[]; selected: string | null; onSelect: (m: string) => void; onView: (id: string) => void }) {
  const [mq, setMq] = useState('');
  const [tq, setTq] = useState('');
  const sort = useSort<K>('name');
  const managers = summarizeManagers(emps);
  if (!managers.length) return <Empty />;
  const shown = managers.filter((m) => m.managerName.toLowerCase().includes(mq.trim().toLowerCase()));
  const m = managers.find((x) => x.managerName === selected) ?? shown[0] ?? managers[0];
  const members = sort.sort(
    m.members.filter((e) => `${e.name} ${e.employeeId} ${e.email}`.toLowerCase().includes(tq.trim().toLowerCase())),
    (e, k) => (k === 'rate' ? pct(e.compliantDays, e.evaluatedDays) : e[k as Exclude<K, 'rate'>]),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input className="field" placeholder="Search manager" value={mq} onChange={(e) => setMq(e.target.value)} />
        <select className="field" value={m.managerName} onChange={(e) => onSelect(e.target.value)}>
          {managers.map((x) => <option key={x.managerName}>{x.managerName}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
        {shown.map((x) => (
          <button key={x.managerName} onClick={() => onSelect(x.managerName)}
            className={`px-2 py-0.5 rounded-full text-xs ${x.managerName === m.managerName ? 'bg-slate-900 text-white' : 'bg-slate-200'}`}>
            {x.managerName} ({x.teamSize})
          </button>
        ))}
        {!shown.length && <span className="text-sm text-slate-500">No managers match.</span>}
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="font-semibold">{m.managerName}</div>
        <div className="text-sm text-slate-600">{m.department ?? '—'} · team of {m.teamSize}</div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Card label="Team Size" value={m.teamSize} />
        <Card label="Total Team Hours" value={hrs(m.totalHours)} />
        <Card label="Avg Daily Hours" value={<span className={m.avgHours >= BENCHMARK_HOURS ? 'text-emerald-600' : 'text-amber-600'}>{hrs(m.avgHours)}</span>} />
        <Card label="≥ 7.0h Compliance" value={`${pct(m.compliantDays, m.evaluatedDays)}%`} sub={`${m.compliantDays} / ${m.evaluatedDays} eligible days`} />
      </div>
      <input className="field" placeholder="Filter team members" value={tq} onChange={(e) => setTq(e.target.value)} />
      {!members.length ? <Empty /> : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <SortTh k="name" sort={sort}>Employee</SortTh><th className={th}>Shift</th><th className={th}>Department</th>
              <SortTh k="loggedDays" sort={sort}>Days</SortTh><SortTh k="totalHours" sort={sort}>Total Hrs</SortTh>
              <SortTh k="avgHours" sort={sort}>Daily Avg</SortTh><SortTh k="rate" sort={sort}>≥ 7.0h Days</SortTh>
              <th className={th}>Month</th><SortTh k="sessions" sort={sort}>Sessions</SortTh><th className={th} />
            </tr></thead>
            <tbody>
              {members.map((e) => (
                <tr key={e.employeeId}>
                  <td className={td}>{e.name}<div className="text-xs text-slate-500">#{e.employeeId} · {e.email}</div></td>
                  <td className={td}>{e.shift ?? '—'}</td><td className={td}>{e.department ?? '—'}</td>
                  <td className={td}>{e.loggedDays}</td><td className={td}>{hrs(e.totalHours)}</td>
                  <td className={td}><Badge hours={e.loggedDays ? e.avgHours : null} /></td>
                  <td className={td}>{e.evaluatedDays ? `${e.compliantDays}/${e.evaluatedDays} (${pct(e.compliantDays, e.evaluatedDays)}%)` : 'NA'}</td>
                  <td className={td}>{e.monthCompliant}</td><td className={td}>{e.sessions}</td>
                  <td className={td}><button className="btn btn-secondary btn-sm" onClick={() => onView(e.employeeId)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
