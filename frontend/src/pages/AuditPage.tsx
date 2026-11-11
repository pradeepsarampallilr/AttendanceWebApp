/**
 * HR sees the activity log (who did what) and the data problems found for the month, filterable by issue type, employee or detail.
 */
import { useEffect, useMemo, useState } from 'react';
import { accessApi, api } from '../api';
import { useAsync } from '../useAsync';
import { Empty, Loading, PageHeader, Pager } from '../components/dashboard/shared';

const PAGE = 10;
const MANAGER_ISSUE = 'Manager email unresolved';

/** The unresolved-manager issue lists every manager after a colon; show them as chips instead of one long run-on line. */
function IssueDetail({ type, detail }: { type: string; detail: string }) {
  const [all, setAll] = useState(false);
  const cut = detail.lastIndexOf(': ');
  if (type !== MANAGER_ISSUE || cut < 0) return <>{detail}</>;
  const names = detail.slice(cut + 2).split(',').map((n) => n.trim()).filter(Boolean);
  const shown = all ? names : names.slice(0, 6);
  return (
    <div className="space-y-1.5">
      <div>{detail.slice(0, cut)}</div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((n) => <span key={n} className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium">{n}</span>)}
        {names.length > 6 && (
          <button className="text-xs font-medium text-brand hover:underline" onClick={() => setAll((v) => !v)}>{all ? 'Show less' : `+${names.length - 6} more`}</button>
        )}
      </div>
    </div>
  );
}

/** Who did what in the app: uploads, edits, deletes, holiday and user changes. Newest first. */
function ActivityLog() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const log = useAsync(() => accessApi.activity({ page: page + 1, pageSize: PAGE, q }), [page, q]);
  const rows = log.data?.items ?? [];
  return (
    <div className="space-y-3">
      <div className="filters">
        <input className="field !flex-[3]" placeholder="Search person, action or detail" aria-label="Search activity" value={q}
          onChange={(e) => { setPage(0); setQ(e.target.value); }} />
        <span className="text-sm text-slate-500 ml-auto">{log.data?.total ?? 0} entries</span>
      </div>
      {log.error && <p role="alert" className="text-red-700 text-sm">{log.error}</p>}
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500 bg-slate-50">
            <tr>{['When', 'Who', 'Action', 'Detail'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">{r.at.replace('T', ' ').slice(0, 19)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.actorEmail} <span className="text-xs text-slate-400">{r.actorRole}</span></td>
                <td className="px-3 py-2 whitespace-nowrap">{r.action}</td>
                <td className="px-3 py-2">{r.detail}</td>
              </tr>
            ))}
            {!log.loading && !rows.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">Nothing logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager always page={page} pages={Math.ceil((log.data?.total ?? 0) / PAGE)} onPage={setPage} />
    </div>
  );
}

export default function AuditPage({ month }: { month: string }) {
  const [view, setView] = useState<'activity' | 'issues'>('issues');
  return (
    <div className="space-y-4">
      <PageHeader title="Audit Log" badge={view === 'issues' ? month : undefined}
        sub="Data problems found while processing the month, and who changed what in the app" />
      <div className="flex gap-2">
        <button className={`btn ${view === 'issues' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('issues')}>Data Issues</button>
        <button className={`btn ${view === 'activity' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('activity')}>Activity Log</button>
      </div>
      {view === 'issues' ? <DataIssues month={month} /> : <ActivityLog />}
    </div>
  );
}

function DataIssues({ month }: { month: string }) {
  const { data, error, loading } = useAsync(
    () => (month ? api.audit(month) : Promise.resolve([])),
    [month],
  );
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    data?.forEach((r) => c.set(r.issueType, (c.get(r.issueType) ?? 0) + 1));
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (r) =>
        (!type || r.issueType === type) &&
        (!needle || r.employeeId.toLowerCase().includes(needle) || r.detail.toLowerCase().includes(needle)),
    );
  }, [data, type, q]);

  useEffect(() => setPage(0), [type, q, month]);

  if (!month) return <Empty text="Nothing Processed yet, upload and process first!" />;
  if (loading) return <Loading />;
  if (error) return <p role="alert" className="text-red-700">{error}</p>;
  if (!data?.length)
    return <p className="text-slate-500">No audit entries for {month}. Process this month first (Upload page).</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {counts.map(([t, n]) => (
          <button
            key={t}
            onClick={() => setType(type === t ? '' : t)}
            className={`btn ${type === t ? 'btn-primary' : 'btn-secondary'}`}
          >
            {t} <b>{n}</b>
          </button>
        ))}
      </div>
      <div className="filters">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employee id or detail"
          className="field !flex-[3]"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className="field">
          <option value="">All issue types</option>
          {counts.map(([t]) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-sm text-slate-500 ml-auto">{rows.length} of {data.length}</span>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500 bg-slate-50">
            <tr>{['Employee', 'Issue', 'At', 'Detail'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(page * PAGE, (page + 1) * PAGE).map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">{r.employeeId}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.issueType}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.at?.replace('T', ' ') ?? '—'}</td>
                <td className="px-3 py-2"><IssueDetail type={r.issueType} detail={r.detail} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager always page={page} pages={Math.ceil(rows.length / PAGE)} onPage={setPage} />
    </div>
  );
}
