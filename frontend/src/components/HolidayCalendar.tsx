import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAsync } from '../useAsync';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n: number) => String(n).padStart(2, '0');
const shiftMonth = (ym: string, by: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const sameSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((d) => a.has(d));

function Dismissible({ tone, role, onClose, children }: { tone: string; role?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <span role={role} className={`inline-flex items-center gap-2 pl-3 pr-1 h-9 rounded-md border ${tone}`}>
      {children}
      <button aria-label="Dismiss" onClick={onClose} className="btn btn-icon btn-sm !h-7 !w-7 !min-w-7 border-transparent bg-transparent hover:bg-black/5">×</button>
    </span>
  );
}

export default function HolidayCalendar({ initialMonth }: { initialMonth: string }) {
  const [ym, setYm] = useState(initialMonth || new Date().toISOString().slice(0, 7));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const stored = useAsync(() => api.holidays(ym), [ym]);

  useEffect(() => { if (initialMonth) setYm(initialMonth); }, [initialMonth]);
  useEffect(() => { setPicked(new Set(stored.data ?? [])); }, [stored.data]);
  useEffect(() => setSaved(false), [ym]);

  const year = Number(ym.slice(0, 4)), month = Number(ym.slice(5, 7));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // Monday-first
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dirty = !!stored.data && !sameSet(picked, stored.data);

  const toggle = (date: string) => {
    setSaved(false);
    setPicked((p) => { const n = new Set(p); n.has(date) ? n.delete(date) : n.add(date); return n; });
  };

  const discard = () => { setSaved(false); setPicked(new Set(stored.data ?? [])); };
  const clearAll = () => { setSaved(false); setPicked(new Set()); };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveHolidays(ym, [...picked].sort());
      stored.refresh();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const legend = (cls: string, text: string) => (
    <span className="inline-flex items-center gap-1.5"><span className={`w-3 h-3 rounded ${cls}`} />{text}</span>
  );
  const changes = dirty
    ? [...picked].filter((d) => !stored.data!.includes(d)).length + stored.data!.filter((d) => !picked.has(d)).length
    : 0;
  return (
    <section>
      <h2 className="font-semibold mb-2">Public holidays</h2>
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col items-center">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-3">
            <button className="btn btn-secondary btn-icon" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}>‹</button>
            <span className="font-semibold">{label}</span>
            <button className="btn btn-secondary btn-icon" aria-label="Next month" onClick={() => setYm(shiftMonth(ym, 1))}>›</button>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAYS.map((w) => <div key={w} className="text-xs font-medium text-slate-500 py-1">{w}</div>)}
            {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1;
              const date = `${ym}-${pad(day)}`;
              const weekend = (lead + i) % 7 >= 5;
              const on = picked.has(date);
              const was = !!stored.data?.includes(date);
              // saved holiday = green, newly picked = amber (unsaved), saved-but-removed = red outline (unsaved)
              const tone = weekend ? 'bg-slate-100 text-slate-300 border-transparent cursor-not-allowed'
                : on && was ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600'
                : on ? 'bg-amber-400 border-amber-400 text-slate-900 hover:bg-amber-500'
                : was ? 'bg-white border-rose-400 text-rose-600 line-through hover:bg-rose-50'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100';
              return (
                <button
                  key={date}
                  disabled={weekend || stored.loading}
                  aria-pressed={on}
                  title={weekend ? 'Weekend' : on ? 'Holiday — click to remove' : 'Click to mark as holiday'}
                  onClick={() => toggle(date)}
                  className={`h-10 min-w-10 rounded-md border text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${tone}`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
            {legend('bg-emerald-500', 'Saved holiday')}
            {legend('bg-amber-400', 'New (unsaved)')}
            {legend('border-2 border-rose-400', 'Removed (unsaved)')}
            {legend('bg-slate-100 border border-slate-200', 'Weekend')}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <span className="text-sm text-slate-600">
              {picked.size} {picked.size === 1 ? 'holiday' : 'holidays'} selected
              {changes > 0 && <span className="text-amber-700"> · {changes} unsaved {changes === 1 ? 'change' : 'changes'}</span>}
            </span>
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary" onClick={clearAll} disabled={busy || picked.size === 0}>Clear all</button>
              <button className="btn btn-secondary" onClick={discard} disabled={busy || !dirty}>Discard</button>
              <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save holidays'}</button>
            </div>
          </div>
          <div className="min-h-9 mt-2 flex justify-center items-center text-sm">
            {error && <Dismissible tone="border-red-200 bg-red-50 text-red-700" role="alert" onClose={() => setError(null)}>{error}</Dismissible>}
            {stored.error && <span role="alert" className="text-red-700">{stored.error}</span>}
            {saved && !dirty && <Dismissible tone="border-emerald-200 bg-emerald-50 text-emerald-700" onClose={() => setSaved(false)}>Saved. Reprocess the month to apply.</Dismissible>}
          </div>
        </div>
      </div>
    </section>
  );
}
