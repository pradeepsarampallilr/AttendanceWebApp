/**
 * Talks to the server: all the requests the website makes (uploads, months, attendance, access list, downloads).
 * Also defines the shapes of the data that comes back.
 */
import { getAccessToken, oktaAuth } from './auth';

export type UploadKind = 'roster' | 'movement' | 'transport' | 'leaves';

export interface UploadResult {
  id: number;
  kind: UploadKind;
  filename: string;
  employees?: number;
  month?: string;
  events?: number;
}

export interface UploadRow {
  id: number;
  kind: UploadKind;
  filename: string;
  month: string | null;
  rowCount: number;
  status: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Holiday {
  date: string;
  description: string;
}

export interface MonthRow {
  month: string; // 'YYYY-MM-01'
  filename: string;
  uploadedAt: string;
  processed: boolean;
}

export interface ProcessResult {
  month: string;
  visits: number;
  issues: number;
  wednesdayRows: number;
}

export interface LeaveUploadResult {
  filename: string;
  leaves: number;
  employees: number;
  months: string[]; // 'YYYY-MM'
}

export interface EmployeeHit {
  employeeId: string;
  name: string;
  department: string | null;
}

export interface AuditRow {
  employeeId: string;
  issueType: string;
  at: string | null;
  detail: string;
}

const json = (method: string, body?: object): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body && JSON.stringify(body),
});


function mayRedirectFor401(): boolean {
  const KEY = 'attendance.last401Redirect';
  if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000) return false;
  sessionStorage.setItem(KEY, String(Date.now()));
  return true;
}

async function authFetch(url: string, init: RequestInit = {}, noRedirect = false): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && oktaAuth && !noRedirect && mayRedirectFor401()) {
    oktaAuth.tokenManager.clear();
    oktaAuth.setOriginalUri(window.location.pathname + window.location.search);
    await oktaAuth.signInWithRedirect();
  }
  return res;
}

export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href, download: name });
  a.click();
  URL.revokeObjectURL(href);
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly email?: string, readonly reason?: string, readonly identifiers?: string[]) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit, noRedirect = false): Promise<T> {
  const res = await authFetch(url, init, noRedirect);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body?.email, body?.reason, body?.identifiers);
  return body as T;
}

export type Role = 'superadmin' | 'hr' | 'manager' | 'employee';
export interface Me {
  email: string | null;
  role: Role | null;
  employeeId?: string | null;
}
/** One reporting line: `managerId` is above `employeeId` by `depth` levels (1 = direct report). */
export interface TeamLine { managerId: string; managerName: string; employeeId: string; depth: number }
export interface AppUserRow {
  email: string;
  username: string | null;
  name: string;
  role: Role;
  isActive: boolean;
  employeeId: string | null;
}
export interface ActivityRow {
  id: string;
  at: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  entity: string;
  detail: string;
}

const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();

export const accessApi = {
  list: (p: { page: number; pageSize: number; q?: string; role?: string }) => request<Page<AppUserRow>>(`/api/admin/users?${qs(p)}`),
  add: (email: string, username: string, role: Role) => request<AppUserRow>('/api/admin/users', json('POST', { email, username, role })),
  update: (email: string, patch: { isActive?: boolean; role?: Role }) =>
    request<AppUserRow>(`/api/admin/users/${encodeURIComponent(email)}`, json('PATCH', patch)),
  remove: (email: string) => request<null>(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  activity: (p: { page: number; pageSize: number; q?: string }) => request<Page<ActivityRow>>(`/api/admin/audit-logs?${qs(p)}`),
};

export interface SettingRow {
  key: string;
  label: string;
  description: string;
  unit: string;
  min: number;
  max: number;
  /** Names for the values min..max; when present the setting is picked from a list. */
  options?: string[];
  value: number;
  default: number;
}

export const settingsApi = {
  list: () => request<SettingRow[]>('/api/admin/settings'),
  save: (values: Record<string, number>) => request<SettingRow[]>('/api/admin/settings', json('PUT', values)),
};

export interface RulesDoc {
  version: string;
  anchorDay: string;
  summary: { rule: string; value: string }[];
  sections: { title: string; points: string[] }[];
  changelog: { version: string; date: string; changes: string[] }[];
}

export interface WeeklyRow {
  employeeId: string;
  employeeName: string;
  department: string;
  weekStart: string;
  week: number;
  required: number;
  attended: number;
  anchor: 'present' | 'absent' | 'off';
  status: Tri;
}

export const api = {
  me: () => request<Me>('/api/me', undefined, true),
  team: () => request<TeamLine[]>('/api/team'),
  uploads: (page: number, pageSize: number) => request<Page<UploadRow>>(`/api/uploads?${qs({ page, pageSize })}`),
  rules: () => request<RulesDoc>('/api/rules'),
  weekly: (ym: string) => request<WeeklyRow[]>(`/api/months/${ym}/weekly`),
  months: () => request<MonthRow[]>('/api/months'),
  upload: (kind: UploadKind, file: File) => {
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', file);
    return request<UploadResult>('/api/uploads', { method: 'POST', body: fd });
  },
  process: (ym: string) =>
    request<ProcessResult>(`/api/months/${ym}/process`, { method: 'POST' }),
  deleteMonth: (ym: string) => request<null>(`/api/months/${ym}`, { method: 'DELETE' }),
  audit: (ym: string) => request<AuditRow[]>(`/api/months/${ym}/audit`),
  holidays: (ym: string) => request<Holiday[]>(`/api/months/${ym}/holidays`),
  uploadLeaves: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<LeaveUploadResult>('/api/leaves/upload', { method: 'POST', body: fd });
  },
  searchEmployees: (q: string) => request<EmployeeHit[]>(`/api/leaves/employees?q=${encodeURIComponent(q)}`),
  employeeLeaves: (ym: string, employeeId: string) =>
    request<string[]>(`/api/months/${ym}/employees/${encodeURIComponent(employeeId)}/leaves`),
  saveEmployeeLeaves: (ym: string, employeeId: string, employeeName: string, dates: string[]) =>
    request<string[]>(`/api/months/${ym}/employees/${encodeURIComponent(employeeId)}/leaves`, json('PUT', { dates, employeeName })),
  saveHolidays: (ym: string, holidays: Holiday[]) => request<Holiday[]>(`/api/months/${ym}/holidays`, json('PUT', { holidays })),
};

export const toYm = (month: string) => month.slice(0, 7);

export type Tri = 'Yes' | 'No' | 'NA';

export interface AttendanceRow {
  employeeId: string;
  name: string;
  email: string | null;
  department: string | null;
  managerName: string | null;
  managerEmail: string | null;
  week: number;
  weekAttendedDays: number;
  workDate: string;
  checkIn: string | null;
  checkOut: string | null;
  visitHours: number | null;
  dailyTotalHours: number | null;
  isFirstRowOfDayGroup: boolean;
  rowsInDayGroup: number;
  shiftLabel: string | null;
  eligibility: Tri;
  transportOptIn: Tri;
  compliant: Tri;
  weekCompliant: Tri;
  monthCompliant: Tri;
  adjustment: 'add' | 'edit' | 'delete' | null;
}

export const attendanceApi = {
  attendance: (ym: string) => request<AttendanceRow[]>(`/api/months/${ym}/attendance`),
  setHours: (ym: string, employeeId: string, workDate: string, hours: number) =>
    request(`/api/months/${ym}/hours`, json('PUT', { employeeId, workDate, hours })),
  removeHours: (ym: string, employeeId: string, workDate: string) =>
    request(`/api/months/${ym}/hours`, json('PUT', { employeeId, workDate, remove: true })),
  revertHours: (ym: string, employeeId: string, workDate: string) =>
    request(`/api/months/${ym}/hours/${encodeURIComponent(employeeId)}/${workDate}`, { method: 'DELETE' }),
};

export interface WednesdayEmployee {
  employeeId: string;
  name: string;
  email: string;
  department: string;
  shift: string | null;
  attended: Record<string, boolean>;
}
export interface WednesdayData {
  wednesdays: string[];
  holidays: string[];
  employees: WednesdayEmployee[];
}

export const wednesdayApi = {
  get: (ym: string) => request<WednesdayData>(`/api/months/${ym}/wednesday`),
  set: (ym: string, employeeId: string, wednesday: string, attended: boolean | null) =>
    request(`/api/months/${ym}/wednesday`, json('PUT', { employeeId, wednesday, attended })),
};
