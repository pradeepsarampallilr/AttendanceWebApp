import { NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { api, toYm } from './api';
import { useAsync } from './useAsync';
import UploadPage from './pages/UploadPage';
import AuditPage from './pages/AuditPage';
import DashboardPage from './pages/DashboardPage';
import WednesdayPage from './pages/WednesdayPage';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center justify-center min-w-24 px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'
  }`;

export default function App() {
  const [params, setParams] = useSearchParams();
  const months = useAsync(api.months, []);
  const list = months.data ?? [];
  const selected = params.get('month') ?? (list.length ? toYm(list[0].month) : '');
  const search = selected ? `?month=${selected}` : '';

  const setMonth = (ym: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('month', ym);
      return next;
    });

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2">
          <span className="font-semibold mr-4">Attendance Engine</span>
          <NavLink to={`/upload${search}`} className={linkCls}>Upload</NavLink>
          <NavLink to={`/dashboard${search}`} className={linkCls}>Dashboard</NavLink>
          <NavLink to={`/wednesday${search}`} className={linkCls}>Wednesday</NavLink>
          <NavLink to={`/audit${search}`} className={linkCls}>Audit Log</NavLink>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <label htmlFor="month">Month</label>
            {list.find((m) => toYm(m.month) === selected)?.processed && (
              <a className="btn btn-secondary" href={`/api/months/${selected}/export.xlsx`} download>Export Excel</a>
            )}
            <select
              id="month"
              className="field"
              value={selected}
              onChange={(e) => setMonth(e.target.value)}
              disabled={!list.length}
            >
              {!list.length && <option value="">No months yet</option>}
              {list.map((m) => (
                <option key={m.month} value={toYm(m.month)}>
                  {toYm(m.month)}
                  {m.processed ? '' : ' (unprocessed)'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to={`/upload${search}`} replace />} />
          <Route path="/upload" element={<UploadPage onChanged={months.reload} month={selected} />} />
          <Route path="/dashboard" element={<DashboardPage month={selected} />} />
          <Route path="/wednesday" element={<WednesdayPage month={selected} />} />
          <Route path="/audit" element={<AuditPage month={selected} />} />
          <Route path="*" element={<Navigate to="/upload" replace />} />
        </Routes>
      </main>
    </div>
  );
}
