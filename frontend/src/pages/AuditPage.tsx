import { useMemo, useState } from 'react';
import { api } from '../api';
import { useAsync } from '../useAsync';

export default function AuditPage({ month }: { month: string }) {
  const { data, error, loading } = useAsync(
    () => (month ? api.audit(month) : Promise.resolve([])),
    [month],
  );
  const [type, setType] = useState('');
  const [q, setQ] = useState('');

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

  if (!month) return <p className="text-slate-500">Upload a movement file and pick a month.</p>;
  if (loading) return <p className="text-slate-500">Loading…</p>;
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
      <div className="flex gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="field">
          <option value="">All issue types</option>
          {counts.map(([t]) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employee id or detail"
          className="field flex-1 max-w-sm"
        />
        <span className="text-sm text-slate-500 self-center">{rows.length} of {data.length}</span>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500 bg-slate-50">
            <tr>{['Employee', 'Issue', 'At', 'Detail'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">{r.employeeId}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.issueType}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.at?.replace('T', ' ') ?? '—'}</td>
                <td className="px-3 py-2">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
