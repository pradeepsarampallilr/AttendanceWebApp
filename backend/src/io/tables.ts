import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { buildRoster, type RawRosterRow, type RosterResult } from "../engine/roster.js";
import { parseMovementRows } from "../engine/movement.js";
import type { EventsByEmployee } from "../engine/types.js";

function plain(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return plain((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return (v as ExcelJS.CellHyperlinkValue).text;
    return null;
  }
  return v;
}

/** Read the first worksheet (or a named one) of an xlsx, or a csv, as dense rows of cell values. */
export async function readTable(buf: Buffer, filename: string, sheetName?: string): Promise<unknown[][]> {
  if (/\.csv$/i.test(filename)) {
    return parseCsv(buf, { relax_column_count: true, skip_empty_lines: false }) as string[][];
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  if (!ws) throw new Error(`Sheet ${sheetName ?? "(first)"} not found in ${filename}`);
  const width = ws.columnCount;
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const out: unknown[] = [];
    for (let c = 1; c <= width; c++) out.push(plain(row.getCell(c).value));
    rows.push(out);
  });
  return rows;
}

/** Header text without surrounding whitespace or the trailing '*' that templates use to mark required columns. */
const stripStar = (v: unknown) => String(v ?? "").trim().replace(/\s*\*$/, "");

export function rosterFromTable(rows: unknown[][]): RosterResult {
  // Columns: Work Shift, Shit timing, Emplid, Legal Name, Department, Worker Type, Sub-Type,
  //          Email, Hire Date, Manager, Transport, Current Shift Timing
  const raw: RawRosterRow[] = rows.slice(1).map((r) => ({
    baseShift: r[1], emplid: r[2], name: r[3], department: r[4], email: r[7], manager: r[9], overrideShift: r[11],
  }));
  return buildRoster(raw);
}

/** Locates the 'EmpCode' header row and keeps rows up to the 'Work Hrs' column (inclusive). */
function movementBody(rows: unknown[][]): unknown[][] {
  const headerIdx = rows.slice(0, 10).findIndex((r) => stripStar(r[1]) === "EmpCode");
  if (headerIdx < 0) throw new Error("Could not locate the EmpCode header row in movement file");
  const header = rows[headerIdx];
  const workHrs = header.map(stripStar).lastIndexOf("Work Hrs");
  const end = workHrs >= 0 ? workHrs + 1 : header.length;
  return rows.slice(headerIdx + 1).map((r) => r.slice(0, end));
}

export const eventsFromMovementTable = (rows: unknown[][]): EventsByEmployee => parseMovementRows(movementBody(rows));

/** employeeId -> name as printed in the movement file (for staff missing from the roster). */
export function fallbackNamesFromTable(rows: unknown[][]): Map<string, string> {
  const names = new Map<string, string>();
  for (const body of movementBody(rows)) {
    const code = String(body[1] ?? "").trim();
    if (/^[+-]?\d+$/.test(code) && body[2]) names.set(String(Number(code)), String(body[2]).trim());
  }
  return names;
}

export class ValidationError extends Error {}

const ROSTER_COLUMNS: [number, string][] = [
  [1, "shit timing"], [2, "emplid"], [3, "legal name"], [4, "department"],
  [7, "email"], [9, "manager"], [11, "current shift timing"],
];

/** Throws ValidationError unless the first row has the roster columns the importer reads by position. */
export function assertRosterHeader(rows: unknown[][]) {
  const header = rows[0] ?? [];
  const bad = ROSTER_COLUMNS.filter(([i, name]) => stripStar(header[i]).toLowerCase() !== name);
  if (bad.length) {
    throw new ValidationError(`Roster file has unexpected columns; expected ${bad.map(([i, n]) => `"${n}" in column ${i + 1}`).join(", ")}`);
  }
}

/** Throws ValidationError unless an 'EmpCode' header row is found in the first 10 rows. */
export function assertMovementHeader(rows: unknown[][]) {
  if (!rows.slice(0, 10).some((r) => stripStar(r[1]) === "EmpCode")) {
    throw new ValidationError("Movement file must contain an 'EmpCode' header row (in column B, within the first 10 rows)");
  }
}

export interface TransportRow {
  employeeId: string; department: string; fullName: string; email: string; businessTitle: string; contactNo: string;
  gender: string; managerName: string; managerEmail: string; workingDays: string; shift: string;
  addressLine1: string; addressLine2: string; city: string; postalCode: string;
}

/** Header (lower-cased prefix) -> field. Prefix match because the address headers are long/truncated in the source sheet. */
const TRANSPORT_COLUMNS: [string, keyof TransportRow][] = [
  ["department", "department"], ["liveramp employee id", "employeeId"], ["full name", "fullName"],
  ["employee email", "email"], ["business title", "businessTitle"], ["employee contact no", "contactNo"],
  ["gender", "gender"], ["lr manager name", "managerName"], ["lr manager email", "managerEmail"],
  ["working days", "workingDays"], ["shift", "shift"], ["home address - street line 1", "addressLine1"],
  ["home address - street line 2", "addressLine2"], ["city/town", "city"], ["postal code", "postalCode"],
];

const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v).trim());

/** Parses the transport sheet by header name (column order is free); throws ValidationError on missing columns. */
export function transportFromTable(rows: unknown[][]): TransportRow[] {
  const header = (rows[0] ?? []).map((h) => stripStar(cell(h)).toLowerCase());
  const index = new Map<keyof TransportRow, number>();
  const missing: string[] = [];
  for (const [prefix, field] of TRANSPORT_COLUMNS) {
    const i = header.findIndex((h) => h === prefix || h.startsWith(prefix));
    if (i < 0) missing.push(prefix); else index.set(field, i);
  }
  if (missing.length) throw new ValidationError(`Transport file is missing columns: ${missing.join(", ")}`);

  const out = new Map<string, TransportRow>();
  for (const r of rows.slice(1)) {
    const rawId = cell(r[index.get("employeeId")!]);
    if (!rawId) continue;
    const employeeId = /^[+-]?\d+(\.0+)?$/.test(rawId) ? String(Math.trunc(Number(rawId))) : rawId;
    const row = { employeeId } as TransportRow;
    for (const [field, i] of index) if (field !== "employeeId") row[field] = cell(r[i]);
    out.set(employeeId, row);
  }
  return [...out.values()];
}

export interface LeaveRow { employeeId: string; employeeName: string; leaveDate: string; leaveDescription: string }

const LEAVE_COLUMNS: { field: keyof LeaveRow; names: string[]; required: boolean }[] = [
  { field: "employeeId", names: ["employee id", "emplid", "empcode", "employee code", "liveramp employee id"], required: true },
  { field: "leaveDate", names: ["leave date", "date"], required: true },
  { field: "employeeName", names: ["employee name", "name", "legal name", "full name"], required: false },
  { field: "leaveDescription", names: ["description", "leave description", "reason", "leave type"], required: false },
];

/** Parses a leaves sheet by header name: Employee ID + Leave Date required; Employee Name / Description optional. One row per leave day. */
export function leavesFromTable(rows: unknown[][]): LeaveRow[] {
  const header = (rows[0] ?? []).map((h) => stripStar(cell(h)).toLowerCase());
  const index = new Map<keyof LeaveRow, number>();
  const missing: string[] = [];
  for (const { field, names, required } of LEAVE_COLUMNS) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) index.set(field, i); else if (required) missing.push(names[0]);
  }
  if (missing.length) throw new ValidationError(`Leave file is missing columns: ${missing.join(", ")}`);

  const out = new Map<string, LeaveRow>();
  rows.slice(1).forEach((r, n) => {
    const rawId = cell(r[index.get("employeeId")!]);
    const rawDate = cell(r[index.get("leaveDate")!]);
    if (!rawId && !rawDate) return;
    const employeeId = /^[+-]?\d+(\.0+)?$/.test(rawId) ? String(Math.trunc(Number(rawId))) : rawId;
    const leaveDate = rawDate.slice(0, 10);
    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(leaveDate) || Number.isNaN(Date.parse(leaveDate)))
      throw new ValidationError(`Leave file row ${n + 2}: needs an Employee ID and a date as YYYY-MM-DD (or an Excel date)`);
    const get = (f: keyof LeaveRow) => (index.has(f) ? cell(r[index.get(f)!]) : "");
    out.set(`${employeeId}|${leaveDate}`, { employeeId, employeeName: get("employeeName"), leaveDate, leaveDescription: get("leaveDescription") });
  });
  return [...out.values()];
}

export type TemplateKind = "roster" | "movement" | "transport" | "leaves";

/** Template headers; a trailing '*' marks a required column (the importers ignore it). */
const TEMPLATES: Record<TemplateKind, { sheet: string; header: string[]; sample: unknown[] }> = {
  roster: {
    sheet: "Employee Details",
    header: ["Work Shift", "Shit timing", "Emplid*", "Legal Name*", "Department", "Worker Type", "Sub-Type", "Email", "Hire Date", "Manager", "Transport", "Current Shift Timing"],
    sample: ["General", "9:00 AM - 6:30 PM", 100123, "Jane Doe", "Engineering", "Employee", "Regular", "jane.doe@example.com", "2022-04-01", "John Smith", "No", ""],
  },
  movement: {
    sheet: "Check In-Out",
    header: ["SrNo", "EmpCode*", "Name", "TransDate*", "Controller", "Door", "In 1*", "Out 1*", "In 2", "Out 2", "In 3", "Out 3", "Work Hrs"],
    sample: [1, 100123, "Jane Doe", "01-04-2026", "", "", "09:05:10", "13:01:22", "13:45:00", "18:35:40", "", "", ""],
  },
  transport: {
    sheet: "Transport Details",
    header: ["Department", "LiveRamp Employee ID*", "Full Name", "Employee Email", "Business Title", "Employee Contact No", "Gender", "LR Manager Name", "LR Manager Email", "Working Days", "Shift", "Home Address - Street Line 1", "Home Address - Street Line 2", "City/Town", "Postal Code"],
    sample: ["Engineering", 100123, "Jane Doe", "jane.doe@example.com", "Software Engineer", "9999999999", "Female", "John Smith", "john.smith@example.com", "Mon-Fri", "4:00 PM - 1:30 AM", "12 Main St", "", "Hyderabad", "500081"],
  },
  leaves: {
    sheet: "Leaves",
    header: ["Employee ID*", "Leave Date*", "Employee Name", "Description"],
    sample: [100123, "2026-04-15", "Jane Doe", "Casual leave"],
  },
};

export const isTemplateKind = (k: string): k is TemplateKind => Object.hasOwn(TEMPLATES, k);

/** Builds a one-sheet xlsx template: bold header (required columns end in '*') and one example row. */
export async function buildTemplate(kind: TemplateKind): Promise<Buffer> {
  const { sheet, header, sample } = TEMPLATES[kind];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(header).font = { bold: true };
  ws.addRow(sample);
  header.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(14, h.length + 4); });
  if (kind === "movement") ws.getColumn(4).numFmt = "@";
  return Buffer.from(await wb.xlsx.writeBuffer());
}
