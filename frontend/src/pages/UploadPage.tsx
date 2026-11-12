/**
 * Users upload roster, movement and transport files, set holidays and leaves, process or delete a month, and see upload history.
 */
import { useEffect, useState } from 'react';
import { api, toYm, type ProcessResult, type UploadKind } from '../api';
import { useAnchorDay } from '../lib/anchorDay';
import { useAsync } from '../useAsync';
import UploadCard from '../components/UploadCard';
import HolidayCalendar from '../components/HolidayCalendar';
import LeaveCalendar from '../components/LeaveCalendar';
import MonthPicker from '../components/MonthPicker';
import ConfirmModal, { useConfirm } from '../components/ConfirmModal';
import { PageHeader, Pager, Toast } from '../components/dashboard/shared';
import { DashboardIcon } from '../components/Icons';

const HISTORY_PAGE = 5;
const MONTHS_PAGE = 5;

async function sendKind(kind: UploadKind, file: File) {
  const r = await api.upload(kind, file);
  return (
    <>Uploaded <b>{r.filename}</b>: {kind !== 'movement' ? `${r.employees} employees` : `${r.month?.slice(0, 7)} — ${r.events} events`}</>
  );
}

const badge = (ok: boolean) =>
  `text-xs px-2 py-0.5 rounded-full ${ok ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`;

export default function UploadPage({ onChanged, month }: { onChanged: () => void; month: string }) {
  const day = useAnchorDay();
  const limits = useAsync(() => api.limits(), []).data;
  const [historyPage, setHistoryPage] = useState(0);
  const uploads = useAsync(() => api.uploads(historyPage + 1, HISTORY_PAGE), [historyPage]);
  const months = useAsync(api.months, []);
  const [monthsPage, setMonthsPage] = useState(0);
  const [monthFilter, setMonthFilter] = useState('');
  const [ask, askModal] = useConfirm();
  const [busyYm, setBusyYm] = useState<string | null>(null);
  const [deleteYm, setDeleteYm] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ProcessResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const history = uploads.data?.items ?? [];
  const historyPages = Math.ceil((uploads.data?.total ?? 0) / HISTORY_PAGE);
  const allMonths = months.data ?? [];
  const shownMonths = monthFilter ? allMonths.filter((m) => toYm(m.month) === monthFilter) : allMonths;
  const monthPages = Math.ceil(shownMonths.length / MONTHS_PAGE);
  const pagedMonths = shownMonths.slice(monthsPage * MONTHS_PAGE, (monthsPage + 1) * MONTHS_PAGE);
  useEffect(() => setMonthsPage((p) => Math.min(p, Math.max(monthPages - 1, 0))), [monthPages]);
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

  async function remove(ym: string) {
    setBusyYm(ym);
    setErrors(({ [ym]: _, ...rest }) => rest);
    try {
      await api.deleteMonth(ym);
      setResults(({ [ym]: _, ...rest }) => rest);
      refresh();
    } catch (e) {
      setErrors((p) => ({ ...p, [ym]: (e as Error).message }));
    } finally {
      setBusyYm(null);
      setDeleteYm(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={<DashboardIcon className="h-5 w-5" />} title="Dashboard" sub="Upload the roster, monthly check-ins, transport and leaves, then process the month." />
      <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <UploadCard title="Employee Details" hint="Employee list (replaces the current roster)." template="roster" upload={(f) => sendKind('roster', f)} onDone={refresh} maxMb={limits?.maxUploadMb} />
        <UploadCard title="Monthly Check In/Out's" hint="Badge events for one month." template="movement" upload={(f) => sendKind('movement', f)} onDone={refresh} maxMb={limits?.maxUploadMb} />
        <UploadCard title="Transport Details" hint="Transport details (replaces the current list)." template="transport" upload={(f) => sendKind('transport', f)} onDone={refresh} maxMb={limits?.maxUploadMb} />
        <UploadCard title="Leaves Details" hint="Row: Employee ID, Leave Date (optional Name, Description). Adds to existing leaves."
          template="leaves"
          upload={async (f) => {
            const r = await api.uploadLeaves(f);
            return <>Uploaded <b>{r.filename}</b>: {r.leaves} leave days · {r.employees} employees ({r.months.join(', ')})</>;
          }}
          onDone={refresh}
          maxMb={limits?.maxLeavesUploadMb}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2 items-stretch">
        <HolidayCalendar initialMonth={month} />
        <LeaveCalendar initialMonth={month} />
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Months</h2>
          <MonthPicker value={monthFilter} onChange={(ym) => { setMonthFilter(ym); setMonthsPage(0); }}
            available={allMonths.map((m) => toYm(m.month))} placeholder="Find a month" clearable ariaLabel="Find a month" />
        </div>
        {months.error && <p className="text-red-700 text-sm">{months.error}</p>}
        {allMonths.length === 0 && <p className="text-sm text-slate-500">Upload a movement file to get started.</p>}
        <ul className="space-y-2">
          {pagedMonths.map((m) => {
            const ym = toYm(m.month);
            const r = results[ym];
            return (
              <li key={ym} className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
                <span className="font-medium">{ym}</span>
                <span className="text-sm text-slate-500">{m.filename}</span>
                <span className={badge(m.processed)}>{m.processed ? 'Processed' : 'Not processed'}</span>
                <button
                  onClick={() => ask({ title: `${m.processed ? 'Reprocess' : 'Process'} ${ym}?`, confirmLabel: m.processed ? 'Reprocess' : 'Process month',
                    message: m.processed ? 'Existing results and manual hour adjustments for this month are recalculated.' : 'Attendance results will be calculated from the uploaded files.' }, () => process(ym))}
                  disabled={busyYm !== null}
                  className="btn btn-primary ml-auto"
                >
                  {busyYm === ym ? 'Processing…' : m.processed ? 'Reprocess' : 'Process month'}
                </button>
                <button onClick={() => setDeleteYm(ym)} disabled={busyYm !== null} className="btn btn-danger">
                  Delete
                </button>
                {r && (
                  <Toast tone="success" onClose={() => setResults(({ [ym]: _, ...rest }) => rest)}>
                    {r.visits} visits · {r.issues} issues · {r.anchorDayRows} {day} rows
                  </Toast>
                )}
                {errors[ym] && (
                  <Toast tone="error" onClose={() => setErrors(({ [ym]: _, ...rest }) => rest)}>{errors[ym]}</Toast>
                )}
              </li>
            );
          })}
        </ul>
        <Pager always page={monthsPage} pages={monthPages} onPage={setMonthsPage} />
      </section>

      <section>
        <h2 className="font-semibold mb-2">Upload history</h2>
        {uploads.error && <p className="text-red-700 text-sm">{uploads.error}</p>}
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500 bg-slate-50">
              <tr>
                {['ID', 'Kind', 'File', 'Month', 'Rows', 'Uploaded by', 'Uploaded'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{u.id}</td>
                  <td className="px-3 py-2">{u.kind}</td>
                  <td className="px-3 py-2">{u.filename}</td>
                  <td className="px-3 py-2">{u.month ? toYm(u.month) : '—'}</td>
                  <td className="px-3 py-2">{u.rowCount}</td>
                  <td className="px-3 py-2">{u.uploadedBy || '—'}</td>
                  <td className="px-3 py-2">{u.uploadedAt.replace('T', ' ').slice(0, 19)}</td>
                </tr>
              ))}
              {uploads.data?.total === 0 && (
                <tr><td colSpan={7} className="px-3 py-4 text-slate-500">No uploads yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager always page={historyPage} pages={historyPages} onPage={setHistoryPage} />
      </section>
      {deleteYm && (
        <ConfirmModal title={`Delete ${deleteYm} report?`} confirmLabel="Delete report" busyLabel="Deleting…" busy={busyYm === deleteYm}
          onConfirm={() => remove(deleteYm)} onCancel={() => setDeleteYm(null)}>
          <p>This permanently deletes the uploaded check-in/out file, the processed attendance and audit results for this month.</p>
          <p className="font-medium text-rose-700">It will also delete all manual adjustments for this month (edited hours and {day} attendance adjustments).</p>
          <p>Holidays and leaves are kept. This cannot be undone.</p>
        </ConfirmModal>
      )}
      {askModal}
    </div>
  );
}
