/**
 * Dashboard tab with a sortable, paged table of all employees and their hours and compliance.
 */
import { useEffect, useState } from 'react';
import type { EmployeeSummary } from '../../lib/attendance';
import { ComplianceBadge, Empty, Pager, SortTh, hrs, td, th, useSort } from './shared';

type K = 'name' | 'loggedDays' | 'totalHours' | 'avgHours';
const PAGE = 25;

export default function DirectoryTab({ emps, onDetail }: { emps: EmployeeSummary[]; onDetail: (id: string) => void }) {
  const sort = useSort<K>('name');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [emps]);
  if (!emps.length) return <Empty />;
  const sorted = sort.sort(emps, (e, k) => e[k]);
  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <SortTh k="name" sort={sort}>Staff Member</SortTh>
            <th className={th}>Shift</th><th className={th}>Department</th>
            <SortTh k="loggedDays" sort={sort}>Logged Days</SortTh>
            <SortTh k="totalHours" sort={sort}>Total Hours</SortTh>
            <SortTh k="avgHours" sort={sort}>Daily Avg</SortTh>
            <th className={th}>Sessions</th><th className={th}>Compliance</th><th className={th} />
          </tr></thead>
          <tbody>
            {sorted.slice(page * PAGE, (page + 1) * PAGE).map((e) => (
              <tr key={e.employeeId}>
                <td className={td}>{e.name}<div className="text-xs text-slate-500">#{e.employeeId} · {e.email}</div></td>
                <td className={td}>{e.shift ?? '—'}</td><td className={td}>{e.department ?? '—'}</td>
                <td className={td}>{e.loggedDays}</td><td className={td}>{hrs(e.totalHours)}</td>
                <td className={td}>{hrs(e.avgHours)}</td><td className={td}>{e.sessions}</td>
                <td className={td}><ComplianceBadge emp={e} /></td>
                <td className={td}><button className="btn btn-secondary btn-sm" onClick={() => onDetail(e.employeeId)}>Detail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={Math.ceil(sorted.length / PAGE)} onPage={setPage} />
    </div>
  );
}
