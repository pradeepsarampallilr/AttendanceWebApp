/**
 * A month calendar where the user picks public holidays and saves them.
 */
import { useConfirm } from './ConfirmModal';
import { useEffect, useState } from 'react';
import { api, type Holiday } from '../api';
import { useAsync } from '../useAsync';
import { Toast } from './dashboard/shared';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n: number) => String(n).padStart(2, '0');
const shiftMonth = (ym: string, by: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const sameMap = (a: Map<string, string>, b: Holiday[]) => a.size === b.length && b.every((h) => a.get(h.date) === h.description);

export default function HolidayCalendar({ initialMonth }: { initialMonth: string }) {
  const [ym, setYm] = useState(initialMonth || new Date().toISOString().slice(0, 7));
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const stored = useAsync(() => api.holidays(ym), [ym]);

  useEffect(() => { if (initialMonth) setYm(initialMonth); }, [initialMonth]);
  useEffect(() => { setPicked(new Map((stored.data ?? []).map((h) => [h.date, h.description]))); }, [stored.data]);
  useEffect(() => setSaved(false), [ym]);

  const year = Number(ym.slice(0, 4)), month = Number(ym.slice(5, 7));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // Monday-first
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dirty = !!stored.data && !sameMap(picked, stored.data);
  const storedDates = new Set((stored.data ?? []).map((h) => h.date));

  const toggle = (date: string) => {
    setSaved(false);
    setPicked((p) => { const n = new Map(p); n.has(date) ? n.delete(date) : n.set(date, ''); return n; });
  };

  const [ask, modal] = useConfirm();
  const clearAll = () => { setSaved(false); setPicked(new Map()); };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveHolidays(ym, [...picked].sort(([a], [b]) => a.localeCompare(b)).map(([date, description]) => ({ date, description })));
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
  return (
    <section className="flex flex-col">
      <h2 className="font-semibold mb-2">Public holidays</h2>
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col items-center flex-1">
        <div className="w-full max-w-md">
          <p className="mb-4 h-20 text-sm text-slate-600">
            Click weekdays to select public holidays, then press <strong>Save</strong>. Click a selected day again to remove it.
          </p>
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
              const was = storedDates.has(date);
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
            <div className="flex items-center gap-2 ml-auto">
              <button className="btn btn-secondary" onClick={clearAll} disabled={busy || picked.size === 0}>Clear all</button>
              <button className="btn btn-primary" onClick={() => ask({ title: 'Save holidays?', confirmLabel: 'Save', message: `Save the public holidays for ${label}? Processed months will use them on reprocess.` }, save)} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
          <div className="min-h-9 mt-2 flex justify-center items-center text-sm">
            {error && <Toast tone="error" onClose={() => setError(null)}>{error}</Toast>}
            {stored.error && <span role="alert" className="text-red-700">{stored.error}</span>}
            {saved && !dirty && <Toast tone="success" onClose={() => setSaved(false)}>Saved. Reprocess the month to apply.</Toast>}
          </div>
        </div>
      </div>
      {modal}
    </section>
  );
}
