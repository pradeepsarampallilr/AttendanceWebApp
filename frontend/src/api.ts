/**
 * Talks to the server: all the requests the website makes (uploads, months, attendance, access list, downloads).
 * Also defines the shapes of the data that comes back.
 */
import { getAccessToken, oktaAuth } from './auth';

export type UploadKind = 'roster' | 'movement' | 'transport';

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
  uploadedAt: string;
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

export type Role = 'superadmin' | 'hr' | 'manager';
export interface Me {
  email: string | null;
  role: Role | null;
}
export interface AppUserRow {
  email: string;
  username: string | null;
  name: string;
  role: Role;
}

export const accessApi = {
  list: () => request<AppUserRow[]>('/api/admin/users'),
  addHr: (email: string, username: string) => request<AppUserRow>('/api/admin/users', json('POST', { email, username })),
  remove: (email: string) => request<null>(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
};

export const api = {
  me: () => request<Me>('/api/me', undefined, true),
  uploads: () => request<UploadRow[]>('/api/uploads'),
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
  holidays: (ym: string) => request<string[]>(`/api/months/${ym}/holidays`),
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
  saveHolidays: (ym: string, dates: string[]) => request<string[]>(`/api/months/${ym}/holidays`, json('PUT', { dates })),
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
  eligibility: 'Yes' | 'No';
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
