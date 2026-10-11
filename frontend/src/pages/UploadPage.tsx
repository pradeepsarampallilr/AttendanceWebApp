import { useEffect, useState } from 'react';
import { api, toYm, type ProcessResult } from '../api';
import { useAsync } from '../useAsync';
import UploadCard from '../components/UploadCard';
import HolidayCalendar from '../components/HolidayCalendar';
import { Notice, Pager } from '../components/dashboard/shared';

const HISTORY_PAGE = 10;

const badge = (ok: boolean) =>
  `text-xs px-2 py-0.5 rounded-full ${ok ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`;

export default function UploadPage({ onChanged, month }: { onChanged: () => void; month: string }) {
  const uploads = useAsync(api.uploads, []);
  const months = useAsync(api.months, []);
  const [busyYm, setBusyYm] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ProcessResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [historyPage, setHistoryPage] = useState(0);
  const history = uploads.data ?? [];
  const historyPages = Math.ceil(history.length / HISTORY_PAGE);
  useEffect(() => setHistoryPage((p) => Math.min(p, Math.max(historyPages - 1, 0))), [historyPages]);

  const refresh = () => {
    uploads.reload();
    months.reload();
    onChanged();
  };

  async function process(ym: string) {
    setBusyYm(ym);
    setErrors(({ [ym]: _, ...rest }) => rest);
    try {
      const r = await api.process(ym);
      setResults((p) => ({ ...p, [ym]: r }));
      refresh();
    } catch (e) {
      setErrors((p) => ({ ...p, [ym]: (e as Error).message }));
    } finally {
      setBusyYm(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid md:grid-cols-3 gap-4">
        <UploadCard kind="roster" title="Roster" hint="Employee list (replaces the current roster)." onDone={refresh} />
        <UploadCard kind="movement" title="Movement" hint="Badge events for one month." onDone={refresh} />
        <UploadCard kind="transport" title="Transport" hint="Transport details (replaces the current list)." onDone={refresh} />
      </section>

      <HolidayCalendar initialMonth={month} />

      <section>
        <h2 className="font-semibold mb-2">Months</h2>
        {months.error && <p className="text-red-700 text-sm">{months.error}</p>}
        {months.data?.length === 0 && <p className="text-sm text-slate-500">Upload a movement file to get started.</p>}
        <ul className="space-y-2">
          {months.data?.map((m) => {
            const ym = toYm(m.month);
            const r = results[ym];
            return (
              <li key={ym} className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
                <span className="font-medium">{ym}</span>
                <span className="text-sm text-slate-500">{m.filename}</span>
                <span className={badge(m.processed)}>{m.processed ? 'Processed' : 'Not processed'}</span>
                <button
                  onClick={() => process(ym)}
                  disabled={busyYm !== null}
                  className="btn btn-primary ml-auto"
                >
                  {busyYm === ym ? 'Processing…' : m.processed ? 'Reprocess' : 'Process month'}
                </button>
                {r && (
                  <Notice tone="info" className="basis-full" onClose={() => setResults(({ [ym]: _, ...rest }) => rest)}>
                    {r.visits} visits · {r.issues} issues · {r.wednesdayRows} Wednesday rows
                  </Notice>
                )}
                {errors[ym] && (
                  <Notice tone="error" className="basis-full" onClose={() => setErrors(({ [ym]: _, ...rest }) => rest)}>{errors[ym]}</Notice>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Upload history</h2>
        {uploads.error && <p className="text-red-700 text-sm">{uploads.error}</p>}
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500 bg-slate-50">
              <tr>
                {['ID', 'Kind', 'File', 'Month', 'Rows', 'Status', 'Uploaded'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.slice(historyPage * HISTORY_PAGE, (historyPage + 1) * HISTORY_PAGE).map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{u.id}</td>
                  <td className="px-3 py-2">{u.kind}</td>
                  <td className="px-3 py-2">{u.filename}</td>
                  <td className="px-3 py-2">{u.month ? toYm(u.month) : '—'}</td>
                  <td className="px-3 py-2">{u.rowCount}</td>
                  <td className="px-3 py-2">{u.status}</td>
                  <td className="px-3 py-2">{u.uploadedAt.replace('T', ' ').slice(0, 19)}</td>
                </tr>
              ))}
              {uploads.data?.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-4 text-slate-500">No uploads yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={historyPage} pages={historyPages} onPage={setHistoryPage} />
      </section>
    </div>
  );
}
