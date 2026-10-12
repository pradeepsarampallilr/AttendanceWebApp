import { useEffect, useState } from 'react';
import { api, type EmployeeHit } from '../api';
import { useAsync } from '../useAsync';
import { Notice } from './dashboard/shared';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n: number) => String(n).padStart(2, '0');
const shiftMonth = (ym: string, by: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const sameSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((d) => a.has(d));

export default function LeaveCalendar({ initialMonth }: { initialMonth: string }) {
  const [ym, setYm] = useState(initialMonth || new Date().toISOString().slice(0, 7));
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<EmployeeHit[]>([]);
  const [employee, setEmployee] = useState<EmployeeHit | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const stored = useAsync(() => (employee ? api.employeeLeaves(ym, employee.employeeId) : Promise.resolve([] as string[])), [ym, employee?.employeeId]);

  useEffect(() => { if (initialMonth) setYm(initialMonth); }, [initialMonth]);
  useEffect(() => { setPicked(new Set(stored.data ?? [])); }, [stored.data]);
  useEffect(() => setSaved(false), [ym, employee]);

  // Debounced roster search; skipped once an employee is chosen and the box shows their label.
  useEffect(() => {
    const q = query.trim();
    if (!q || (employee && query === `${employee.name} (${employee.employeeId})`)) return setHits([]);
    let cancelled = false;
    const t = setTimeout(() => {
      api.searchEmployees(q).then((r) => !cancelled && setHits(r), (e: Error) => !cancelled && setError(e.message));
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, employee]);

  const choose = (e: EmployeeHit) => { setEmployee(e); setQuery(`${e.name} (${e.employeeId})`); setHits([]); setError(null); };

  const year = Number(ym.slice(0, 4)), month = Number(ym.slice(5, 7));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // Monday-first
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dirty = !!stored.data && !sameSet(picked, stored.data);

  const toggle = (date: string) => {
    setSaved(false);
    setPicked((p) => { const n = new Set(p); n.has(date) ? n.delete(date) : n.add(date); return n; });
  };

  async function save() {
    if (!employee) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveEmployeeLeaves(ym, employee.employeeId, employee.name, [...picked].sort());
      stored.refresh();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="font-semibold mb-2">Employee leaves</h2>
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col items-center">
        <div className="w-full max-w-md">
          <div className="relative mb-4">
            <input
              className="field w-full"
              placeholder="Search employee by name or ID…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setEmployee(null); }}
              aria-label="Search employee"
              onKeyDown={(e) => e.key === 'Enter' && hits[0] && choose(hits[0])}
            />
            {!employee && (
              <p className="text-xs text-amber-700 mt-1">
                {hits.length ? 'Click an employee from the list to enable the calendar.' : 'Type a name or ID, then pick an employee to enable the calendar.'}
              </p>
            )}
            {employee && <p className="text-xs text-emerald-700 mt-1">Selected: {employee.name} ({employee.employeeId})</p>}
            {hits.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-auto bg-white border border-slate-200 rounded-md shadow">
                {hits.map((h) => (
                  <li key={h.employeeId}>
                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100" onClick={() => choose(h)}>
                      <b>{h.name}</b> <span className="text-slate-500">· {h.employeeId}{h.department ? ` · ${h.department}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between mb-3">
            <button className="btn btn-secondary btn-icon" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}>‹</button>
            <span className="font-semibold">{label}</span>
            <button className="btn btn-secondary btn-icon" aria-label="Next month" onClick={() => setYm(shiftMonth(ym, 1))}>›</button>
          </div>
          <div className={`grid grid-cols-7 gap-1.5 text-center ${employee ? '' : 'opacity-40'}`}>
            {WEEKDAYS.map((w) => <div key={w} className="text-xs font-medium text-slate-500 py-1">{w}</div>)}
            {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1;
              const date = `${ym}-${pad(day)}`;
              const weekend = (lead + i) % 7 >= 5;
              const on = picked.has(date);
              const was = !!stored.data?.includes(date);
              // saved leave = green, newly picked = amber (unsaved), saved-but-removed = red outline (unsaved)
              const tone = weekend ? 'bg-slate-100 text-slate-300 border-transparent cursor-not-allowed'
                : on && was ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600'
                : on ? 'bg-amber-400 border-amber-400 text-slate-900 hover:bg-amber-500'
                : was ? 'bg-white border-rose-400 text-rose-600 line-through hover:bg-rose-50'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100';
              return (
                <button
                  key={date}
                  disabled={weekend || !employee || stored.loading}
                  aria-pressed={on}
                  title={!employee ? 'Select an employee first' : weekend ? 'Weekend' : on ? 'Leave — click to remove' : 'Click to mark as leave'}
                  onClick={() => toggle(date)}
                  className={`h-10 min-w-10 rounded-md border text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed ${tone}`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <span className="text-sm text-slate-600">
              {employee ? `${picked.size} leave ${picked.size === 1 ? 'day' : 'days'} selected` : 'Select an employee to edit leaves'}
              {dirty && <span className="text-amber-700"> · unsaved changes</span>}
            </span>
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary" onClick={() => { setSaved(false); setPicked(new Set()); }} disabled={busy || picked.size === 0}>Clear all</button>
              <button className="btn btn-secondary" onClick={() => { setSaved(false); setPicked(new Set(stored.data ?? [])); }} disabled={busy || !dirty}>Undo changes</button>
              <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
          <div className="min-h-9 mt-2 flex justify-center items-center text-sm">
            {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}
            {stored.error && <span role="alert" className="text-red-700">{stored.error}</span>}
            {saved && !dirty && <Notice tone="success" onClose={() => setSaved(false)}>Saved. Reprocess the month to apply.</Notice>}
          </div>
        </div>
      </div>
    </section>
  );
}
