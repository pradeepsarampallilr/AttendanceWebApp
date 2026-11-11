/**
 * Weekly compliance by team: for every calendar week, the office days attended against the days required (3, fewer
 * with holidays or leave) and whether the Wednesday anchor was met. Opens on the Engineering team when it exists.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Tri, WeeklyRow } from '../../api';
import { useAnchorDay } from '../../lib/anchorDay';
import { longDate } from '../../lib/dates';
import { Card, Empty, Pager, th, td } from './shared';

const PAGE = 10;
const EMP_W = 220;
const WEEK_W = 120;
const ANCHOR = { present: ['✓ Wed', 'text-emerald-700'], absent: ['✗ Wed', 'text-rose-700'], off: ['Wed off', 'text-slate-400'] } as const;
const STATUS_CLS: Record<Tri, string> = { Yes: 'bg-emerald-50 border-emerald-200', No: 'bg-rose-50 border-rose-200', NA: 'bg-slate-50 border-slate-200' };

export default function WeeklyTab({ weekly, solo = false }: { weekly: WeeklyRow[]; solo?: boolean }) {
  const day = useAnchorDay();
  const departments = useMemo(() => [...new Set(weekly.map((w) => w.department).filter(Boolean))].sort(), [weekly]);
  const [dept, setDept] = useState(() => (departments.includes('Engineering') ? 'Engineering' : ''));
  const [applicability, setApplicability] = useState<'applicable' | 'all'>(solo ? 'all' : 'applicable');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [dept, applicability]);

  const scoped = useMemo(() => weekly.filter((w) => !dept || w.department === dept), [weekly, dept]);
  const weeks = useMemo(() => [...new Map(scoped.map((w) => [w.week, w.weekStart])).entries()].sort((a, b) => a[0] - b[0]), [scoped]);
  const everyone = useMemo(() => {
    const m = new Map<string, { id: string; name: string; byWeek: Map<number, WeeklyRow> }>();
    for (const w of scoped) {
      const p = m.get(w.employeeId) ?? { id: w.employeeId, name: w.employeeName, byWeek: new Map() };
      p.byWeek.set(w.week, w);
      m.set(w.employeeId, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [scoped]);
  const people = useMemo(
    () => (applicability === 'all' ? everyone : everyone.filter((p) => [...p.byWeek.values()].some((w) => w.status !== 'NA'))),
    [everyone, applicability],
  );

  if (!weekly.length) return <Empty text="No weekly results yet. Reprocess this month to build them." />;

  if (solo) {
    const mine = people[0];
    const ANCHOR_LONG = { present: ['Present', 'text-emerald-700'], absent: ['Absent', 'text-rose-700'], off: ['Off', 'text-slate-400'] } as const;
    return (
      <div className="h-full flex flex-col bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className={th}>Weekly compliance</th>
              <th className={`${th} text-center`}>Office days</th>
              <th className={`${th} text-center`}>{day}</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(([wk, start]) => {
              const w = mine?.byWeek.get(wk);
              const [text, cls] = w ? ANCHOR_LONG[w.anchor] : ['—', 'text-slate-400'];
              return (
                <tr key={wk}>
                  <td className={td}>Week {wk}<span className="block text-xs text-slate-500">{longDate(start).slice(0, -5)}</span></td>
                  <td className={`${td} text-center align-middle`}>
                    {w ? <span className={`inline-block rounded border px-2 py-0.5 font-medium ${STATUS_CLS[w.status]}`}>{w.status === 'NA' ? 'N/A' : `${w.attended}/${w.required}`}</span> : '—'}
                  </td>
                  <td className={`${td} text-center align-middle font-medium ${cls}`}>{text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-auto px-3 py-2 text-xs text-slate-500 border-t border-slate-100">{day} + up to 3 office days a week (7h+ each); holidays and leave lower the 3.</p>
      </div>
    );
  }

  const evaluated = scoped.filter((w) => w.status !== 'NA');
  const wedWeeks = evaluated.filter((w) => w.anchor !== 'off');
  const rate = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
  const pages = Math.ceil(people.length / PAGE);

  return (
    <div className="space-y-3">
      {solo ? <p className="text-xs text-slate-500">Rule: {day} in the office + up to 3 office days a week (7h+ each); holidays and leave lower the 3.</p> : <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="dept">Team</label>
        <select id="dept" className="field" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All teams</option>
          {departments.map((d) => <option key={d}>{d}</option>)}
        </select>
        <label className="text-sm text-slate-600 ml-2" htmlFor="applicability">Show</label>
        <select id="applicability" className="field" value={applicability} onChange={(e) => setApplicability(e.target.value as 'applicable' | 'all')}>
          <option value="applicable">Applicable only (hide N/A)</option>
          <option value="all">Everyone</option>
        </select>
        <span className="text-xs text-slate-500">Rule: {day} in the office + up to 3 office days a week (7h+ each); holidays and leave lower the 3.</span>
      </div>}
      {!solo && <div className="grid grid-cols-4 gap-3">
        <Card label="People evaluated" value={everyone.filter((p) => [...p.byWeek.values()].some((w) => w.status !== 'NA')).length} />
        <Card label="Weeks compliant" value={rate(evaluated.filter((w) => w.status === 'Yes').length, evaluated.length)} sub={`${evaluated.filter((w) => w.status === 'Yes').length} of ${evaluated.length} person-weeks`} />
        <Card label={`${day} met`} value={rate(wedWeeks.filter((w) => w.anchor === 'present').length, wedWeeks.length)} sub={`weeks where ${day} was required`} />
        <Card label="Office days met" value={rate(evaluated.filter((w) => w.attended >= w.required).length, evaluated.length)} sub="weeks with enough 7h days" />
      </div>}
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="text-sm border-collapse table-fixed" style={{ width: EMP_W + weeks.length * WEEK_W, minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: EMP_W }} />
            {weeks.map(([wk]) => <col key={wk} style={{ width: WEEK_W }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className={`${th} truncate`}>{solo ? 'Weekly compliance' : 'Employee'}</th>
              {weeks.map(([wk, start]) => <th key={wk} className={`${th} text-center align-middle border-l border-slate-200`}>Week {wk}<span className="block text-xs font-normal text-slate-500">{longDate(start).slice(0, -5)}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {people.slice(page * PAGE, (page + 1) * PAGE).map((p) => (
              <tr key={p.id} className="h-14">
                <td className={`${td} align-middle truncate`} title={p.name}>{p.name} <span className="text-xs text-slate-400">#{p.id}</span></td>
                {weeks.map(([wk]) => {
                  const w = p.byWeek.get(wk);
                  if (!w) return <td key={wk} className={`${td} align-middle text-center border-l border-slate-200 text-slate-400`}>—</td>;
                  const [anchorText, anchorCls] = ANCHOR[w.anchor];
                  return (
                    <td key={wk} className={`${td} align-middle text-center border-l border-slate-200`}>
                      {w.status === 'NA' ? <span className="text-xs text-slate-400">N/A</span> : (
                        <span className={`inline-flex flex-col items-center rounded border px-2 py-1 ${STATUS_CLS[w.status]}`}>
                          <span className="font-medium">{w.attended}/{w.required} days</span>
                          <span className={`text-xs ${anchorCls}`}>{anchorText}</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {people.length > 0 && Array.from({ length: Math.max(0, PAGE - (people.length - page * PAGE)) }, (_, i) => (
              <tr key={`pad-${i}`} className="h-14" aria-hidden><td className={td} colSpan={weeks.length + 1} /></tr>
            ))}
            {!people.length && <tr><td className={`${td} h-14`} colSpan={weeks.length + 1}>No applicable people in this team.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </div>
  );
}
