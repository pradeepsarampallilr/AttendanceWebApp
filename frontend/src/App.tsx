/**
 * The main screen: top bar with the signed-in user, month picker and page tabs.
 * Shows the page the user picks (Upload, Dashboard, Wednesday, Audit, Access), and has a button to download the month as Excel.
 */
import { NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { api, downloadFile, toYm } from './api';
import { oktaAuth, signOut } from './auth';
import { useUser } from './AuthGate';
import { useAsync } from './useAsync';
import UploadPage from './pages/UploadPage';
import AccessPage from './pages/AccessPage';
import AuditPage from './pages/AuditPage';
import DashboardPage from './pages/DashboardPage';
import WednesdayPage from './pages/WednesdayPage';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center justify-center min-w-24 px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'
  }`;

export default function App() {
  const { email, role } = useUser();
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
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="w-[90%] mx-auto">
          <div className="flex items-center justify-between gap-4 h-14">
            <span className="font-semibold text-lg tracking-tight whitespace-nowrap">Attendance Management System</span>
            {(oktaAuth || email) && (
              <div className="flex items-center gap-3 text-sm">
                {email && (
                  <span className="text-slate-600" title="Signed in">
                    {email}{role && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{role}</span>}
                  </span>
                )}
                <button className="btn btn-secondary" onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-2">
            <nav className="flex flex-wrap items-center gap-1">
              <NavLink to={`/upload${search}`} className={linkCls}>Upload</NavLink>
              <NavLink to={`/dashboard${search}`} className={linkCls}>Dashboard</NavLink>
              <NavLink to={`/wednesday${search}`} className={linkCls}>Wednesday</NavLink>
              <NavLink to={`/audit${search}`} className={linkCls}>Audit Log</NavLink>
              {(role === 'superadmin' || !oktaAuth) && <NavLink to="/access" className={linkCls}>Access</NavLink>}
            </nav>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="month" className="text-slate-600">Month</label>
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
              {list.find((m) => toYm(m.month) === selected)?.processed && (
                <button
                  className="btn btn-secondary"
                  onClick={() => downloadFile(`/api/months/${selected}/export.xlsx`, `attendance-${selected}.xlsx`).catch((e) => alert(e.message))}
                >
                  Export Excel
                </button>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="w-[90%] mx-auto py-8">
        <Routes>
          <Route path="/" element={<Navigate to={`/upload${search}`} replace />} />
          <Route path="/upload" element={<UploadPage onChanged={months.reload} month={selected} />} />
          <Route path="/dashboard" element={<DashboardPage month={selected} />} />
          <Route path="/wednesday" element={<WednesdayPage month={selected} />} />
          <Route path="/audit" element={<AuditPage month={selected} />} />
          {(role === 'superadmin' || !oktaAuth) && <Route path="/access" element={<AccessPage />} />}
          <Route path="*" element={<Navigate to="/upload" replace />} />
        </Routes>
      </main>
    </div>
  );
}
