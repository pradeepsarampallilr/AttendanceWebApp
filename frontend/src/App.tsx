/**
 * The main screen: top bar with the signed-in user, month picker and page tabs.
 * Shows the pages the user's role allows (Welcome, Dashboard (upload), Attendance, Anchor Day, Audit, Users, Configuration), and has a button to download the month as Excel.
 */
import { NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { api, downloadFile, toYm } from './api';
import { oktaAuth, signOut } from './auth';
import { useCanEdit, useUser } from './AuthGate';
import { useAsync } from './useAsync';
import { AnchorDayContext } from './lib/anchorDay';
import MonthPicker from './components/MonthPicker';
import UploadPage from './pages/UploadPage';
import AccessPage from './pages/AccessPage';
import AuditPage from './pages/AuditPage';
import ConfigPage from './pages/ConfigPage';
import DashboardPage from './pages/DashboardPage';
import AnchorDayPage from './pages/AnchorDayPage';
import WelcomePage from './pages/WelcomePage';
import {
  AttendanceIcon, CalendarIcon, DashboardIcon, DownloadIcon, HomeIcon, IndianFlag, LiveRampMark, LogoutIcon, SettingsIcon, ShieldIcon, UsersIcon,
} from './components/Icons';

const ROLE_LABEL: Record<string, string> = { superadmin: 'Super admin', hr: 'HR', manager: 'Manager', employee: 'Employee' };

export default function App() {
  const { email, role } = useUser();
  const isHr = useCanEdit();
  const isEmployee = role === 'employee';
  const isManager = role === 'manager';
  const home = '/welcome';
  const [params, setParams] = useSearchParams();
  const months = useAsync(api.months, []);
  const { pathname } = useLocation();
  // Fetched again on every page change, so a new anchor day shows up right after it is saved.
  const anchorDay = useAsync(api.rules, [pathname]).data?.anchorDay ?? 'Anchor day';
  const list = months.data ?? [];
  const selected = params.get('month') ?? (list.length ? toYm(list[0].month) : '');
  const search = selected ? `?month=${selected}` : '';

  const setMonth = (ym: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('month', ym);
      return next;
    });

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center justify-center gap-1.5 min-w-24 px-3 py-2 rounded-md text-sm font-medium border-b-2 ${
      isActive ? 'bg-slate-900 text-white border-accent' : 'border-transparent text-slate-600 hover:bg-slate-200'
    }`;

  return (
    <AnchorDayContext.Provider value={anchorDay}>
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="w-[90%] mx-auto">
          <div className="flex items-center justify-between gap-4 h-14">
            <div className="flex items-center gap-3 whitespace-nowrap text-slate-900">
              <LiveRampMark />
              <IndianFlag />
              <span className="hidden md:inline text-slate-300">|</span>
              <span className="hidden md:inline font-medium text-slate-600">Attendance Management</span>
            </div>
            {(oktaAuth || email) && (
              <div className="flex items-center gap-3 text-sm">
                {email && (
                  <span className="text-slate-600" title="Signed in">
                    {email}{role && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{ROLE_LABEL[role] ?? role}</span>}
                  </span>
                )}
                {oktaAuth && <button className="btn btn-secondary" onClick={signOut}><LogoutIcon /> Sign out</button>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-2">
            <nav className="flex flex-wrap items-center gap-1">
              <NavLink to={`/welcome${search}`} className={linkCls}><HomeIcon /> Welcome</NavLink>
              {isHr && <NavLink to={`/upload${search}`} className={linkCls}><DashboardIcon /> Dashboard</NavLink>}
              <NavLink to={`/dashboard${search}`} className={linkCls}><AttendanceIcon /> Attendance</NavLink>
              {isManager && <NavLink to={`/team${search}`} className={linkCls}><UsersIcon /> Team</NavLink>}
              {!isEmployee && !isManager && <NavLink to={`/anchor-day${search}`} className={linkCls}><CalendarIcon /> Anchor Day Attendance</NavLink>}
              {isHr && <NavLink to={`/audit${search}`} className={linkCls}><ShieldIcon /> Audit Log</NavLink>}
              {isHr && <NavLink to="/access" className={linkCls}><UsersIcon /> Users</NavLink>}
              {isHr && <NavLink to="/config" className={linkCls}><SettingsIcon /> Configuration</NavLink>}
            </nav>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="month" className="text-slate-600">Month</label>
              <MonthPicker id="month" value={selected} onChange={setMonth} available={list.map((m) => toYm(m.month))} disabled={!list.length}
                placeholder={list.length ? 'Select month' : 'No months yet'} />
              {list.find((m) => toYm(m.month) === selected)?.processed && (
                <button
                  className="btn btn-secondary"
                  onClick={() => downloadFile(`/api/months/${selected}/export.xlsx`, `attendance-${selected}.xlsx`).catch((e) => alert(e.message))}
                >
                  <DownloadIcon /> Export Excel
                </button>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="w-[90%] mx-auto py-8">
        <Routes>
          <Route path="/" element={<Navigate to={`${home}${search}`} replace />} />
          {isHr && <Route path="/upload" element={<UploadPage onChanged={months.reload} month={selected} />} />}
          <Route path="/dashboard" element={<DashboardPage month={selected} />} />
          {isManager && <Route path="/team" element={<DashboardPage month={selected} team />} />}
          {!isEmployee && !isManager && <Route path="/anchor-day" element={<AnchorDayPage month={selected} />} />}
          {isHr && <Route path="/audit" element={<AuditPage month={selected} />} />}
          {isHr && <Route path="/access" element={<AccessPage />} />}
          {isHr && <Route path="/config" element={<ConfigPage />} />}
          <Route path="/welcome" element={<WelcomePage month={selected} />} />
          <Route path="/summary" element={<Navigate to={`/welcome${search}`} replace />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
    </AnchorDayContext.Provider>
  );
}
