/**
 * Dashboard tab showing one manager's whole reporting tree: totals and a searchable, sortable list of everyone below them,
 * with a way to drill into any manager within it. `lean` is the signed-in manager's version: no manager picker and only the essential columns.
 */
import { useState } from 'react';
import { useUser } from '../../AuthGate';
import type { TeamLine } from '../../api';
import { BENCHMARK_HOURS, pct, summarizeManagers, type EmployeeSummary, type ManagerSummary } from '../../lib/attendance';
import { Badge, Card, Empty, SortTh, hrs, td, th, useSort } from './shared';

type K = 'name' | 'loggedDays' | 'totalHours' | 'avgHours' | 'rate' | 'sessions';

export default function ManagerTab({
  emps, lines, selected, onSelect, onView, lean = false,
}: { emps: EmployeeSummary[]; lines: TeamLine[]; selected: string | null; onSelect: (m: string) => void; onView: (id: string) => void; lean?: boolean }) {
  const [mq, setMq] = useState('');
  const [tq, setTq] = useState('');
  const [path, setPath] = useState<string[]>([]);
  const [directOnly, setDirectOnly] = useState(true);
  const sort = useSort<K>('name');
  const { role, employeeId } = useUser();
  const managers = summarizeManagers(emps, lines);
  if (!managers.length) return <Empty />;
  const shown = managers.filter((m) => m.managerName.toLowerCase().includes(mq.trim().toLowerCase()));
  const own = role === 'manager' ? managers.find((x) => x.managerId === employeeId) : undefined; // a manager starts on their own team
  const m = managers.find((x) => x.managerId === selected) ?? own ?? shown[0] ?? managers[0];
  const managerIds = new Set(managers.map((x) => x.managerId));
  // Breadcrumb starts at whoever was picked from the list and grows as you drill into managers below them.
  const trailIds = path[path.length - 1] === m.managerId ? path : [m.managerId];
  const trail = trailIds.map((id) => managers.find((x) => x.managerId === id)).filter((x): x is ManagerSummary => !!x);
  const pick = (id: string) => { setPath([id]); onSelect(id); };
  const drill = (id: string) => { setPath([...trailIds, id]); onSelect(id); };
  const back = (i: number) => { setPath(trailIds.slice(0, i + 1)); onSelect(trailIds[i]); };
  const level = (e: EmployeeSummary) => m.depth.get(e.employeeId) ?? 1;
  const subManagers = m.members.filter((e) => level(e) === 1 && managerIds.has(e.employeeId));
  const members = sort.sort(
    m.members.filter((e) => (!directOnly || level(e) === 1) && `${e.name} ${e.employeeId} ${e.email}`.toLowerCase().includes(tq.trim().toLowerCase())),
    (e, k) => (k === 'rate' ? pct(e.compliantDays, e.evaluatedDays) : e[k as Exclude<K, 'rate'>]),
  );
  return (
    <div className="space-y-3">
 {!lean && <>
      <div className="filters">
        <input className="field" placeholder="Search manager" value={mq} onChange={(e) => setMq(e.target.value)} />
        <select className="field" value={m.managerId} onChange={(e) => pick(e.target.value)}>
          {managers.map((x) => <option key={x.managerId} value={x.managerId}>{x.managerName}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
        {shown.map((x) => (
          <button key={x.managerId} onClick={() => pick(x.managerId)}
            className={`px-2 py-0.5 rounded-full text-xs ${x.managerId === m.managerId ? 'bg-brand text-white' : 'bg-slate-200'}`}>
            {x.managerName} ({x.teamSize})
          </button>
        ))}
        {!shown.length && <span className="text-sm text-slate-500">No managers match.</span>}
      </div>
 </>}
      {trail.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <button className="btn btn-secondary btn-sm" onClick={() => back(trail.length - 2)}>← Back to {trail[trail.length - 2].managerName}</button>
          {trail.map((x, i) => (
            <span key={x.managerId} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-400">›</span>}
              {i === trail.length - 1
                ? <span className="font-medium">{x.managerName}</span>
                : <button className="text-brand hover:underline" onClick={() => back(i)}>{x.managerName}</button>}
            </span>
          ))}
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="font-semibold">{m.managerName}</div>
        <div className="text-sm text-slate-600">{!lean && `${m.department ?? '—'} · `}team of {m.teamSize} ({m.members.filter((e) => level(e) === 1).length} direct)</div>
        {!!subManagers.length && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Managers under them:</span>
            {subManagers.map((e) => (
              <button key={e.employeeId} onClick={() => drill(e.employeeId)} className="px-2 py-0.5 rounded-full bg-slate-200 hover:bg-slate-300">{e.name}</button>
            ))}
          </div>
        )}
      </div>
      <div className={`grid gap-3 ${lean ? 'grid-cols-3' : 'grid-cols-4'}`}>
        <Card label="Team Size (all levels)" value={m.teamSize} />
        {!lean && <Card label="Total Team Hours" value={hrs(m.totalHours)} />}
        <Card label="Avg Daily Hours" value={<span className={m.avgHours >= BENCHMARK_HOURS ? 'text-emerald-600' : 'text-amber-600'}>{hrs(m.avgHours)}</span>} />
        <Card label="≥ 7.0h Compliance" value={`${pct(m.compliantDays, m.evaluatedDays)}%`} sub={`${m.compliantDays} / ${m.evaluatedDays} eligible days`} />
      </div>
      <div className="filters">
        <input className="field !flex-[3]" placeholder="Filter team members" value={tq} onChange={(e) => setTq(e.target.value)} />
        <select className="field" value={directOnly ? 'direct' : 'all'} onChange={(e) => setDirectOnly(e.target.value === 'direct')} aria-label="Team level">
          <option value="all">Whole hierarchy</option><option value="direct">Direct reports only</option>
        </select>
      </div>
      {!members.length ? <Empty /> : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <SortTh k="name" sort={sort}>Employee</SortTh><th className={th}>Level</th>{!lean && <><th className={th}>Shift</th><th className={th}>Department</th></>}
              <SortTh k="loggedDays" sort={sort}>Days</SortTh>{!lean && <SortTh k="totalHours" sort={sort}>Total Hrs</SortTh>}
              <SortTh k="avgHours" sort={sort}>Daily Avg</SortTh><SortTh k="rate" sort={sort}>≥ 7.0h Days</SortTh>
              <th className={th}>Month</th>{!lean && <SortTh k="sessions" sort={sort}>Sessions</SortTh>}<th className={th} />
            </tr></thead>
            <tbody>
              {members.map((e) => (
                <tr key={e.employeeId}>
                  <td className={td}>{e.name}<div className="text-xs text-slate-500">#{e.employeeId} · {e.email}</div></td>
                  <td className={td}>{level(e) === 1 ? 'Direct' : `Level ${level(e)}`}</td>{!lean && <><td className={td}>{e.shift ?? '—'}</td><td className={td}>{e.department ?? '—'}</td></>}
                  <td className={td}>{e.loggedDays}</td>{!lean && <td className={td}>{hrs(e.totalHours)}</td>}
                  <td className={td}><Badge hours={e.loggedDays ? e.avgHours : null} /></td>
                  <td className={td}>{e.evaluatedDays ? `${e.compliantDays}/${e.evaluatedDays} (${pct(e.compliantDays, e.evaluatedDays)}%)` : 'NA'}</td>
                  <td className={td}>{e.monthCompliant}</td>{!lean && <td className={td}>{e.sessions}</td>}
                  <td className={td}><div className="flex gap-1">
                    <button className="btn btn-secondary btn-sm" onClick={() => onView(e.employeeId)}>View</button>
                    {managerIds.has(e.employeeId) && <button className="btn btn-secondary btn-sm" onClick={() => drill(e.employeeId)}>Team</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
