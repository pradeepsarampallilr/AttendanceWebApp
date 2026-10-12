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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
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

/** 'YYYY-MM-01' -> '2026-08' */
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
  workDate: string; // 'YYYY-MM-DD'
  checkIn: string | null; // naive 'YYYY-MM-DDTHH:MM:SS'
  checkOut: string | null;
  visitHours: number | null;
  dailyTotalHours: number | null;
  isFirstRowOfDayGroup: boolean;
  rowsInDayGroup: number;
  shiftLabel: string | null;
  eligibility: 'Yes' | 'No';
  /** NA = general shift; otherwise Yes/No by presence in the transport sheet. */
  transportOptIn: Tri;
  compliant: Tri;
  weekCompliant: Tri;
  monthCompliant: Tri;
  /** Set when a manual adjustment overlays this day. */
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
  attended: Record<string, boolean>; // 'YYYY-MM-DD' -> attended
}
export interface WednesdayData {
  wednesdays: string[];
  holidays: string[]; // subset of `wednesdays` that are public holidays
  employees: WednesdayEmployee[];
}

export const wednesdayApi = {
  get: (ym: string) => request<WednesdayData>(`/api/months/${ym}/wednesday`),
  set: (ym: string, employeeId: string, wednesday: string, attended: boolean | null) =>
    request(`/api/months/${ym}/wednesday`, json('PUT', { employeeId, wednesday, attended })),
};
