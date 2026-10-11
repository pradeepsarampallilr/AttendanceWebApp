import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { buildRoster, type RawRosterRow, type RosterResult } from "../engine/roster.js";
import { parseMovementRows } from "../engine/movement.js";
import type { EventsByEmployee } from "../engine/types.js";

/** Normalise an exceljs cell value to a primitive (string | number | Date | null). */
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
  const headerIdx = rows.slice(0, 10).findIndex((r) => r[1] === "EmpCode");
  if (headerIdx < 0) throw new Error("Could not locate the EmpCode header row in movement file");
  const header = rows[headerIdx];
  const workHrs = header.lastIndexOf("Work Hrs");
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
  const bad = ROSTER_COLUMNS.filter(([i, name]) => String(header[i] ?? "").trim().toLowerCase() !== name);
  if (bad.length) {
    throw new ValidationError(`Roster file has unexpected columns; expected ${bad.map(([i, n]) => `"${n}" in column ${i + 1}`).join(", ")}`);
  }
}

/** Throws ValidationError unless an 'EmpCode' header row is found in the first 10 rows. */
export function assertMovementHeader(rows: unknown[][]) {
  if (!rows.slice(0, 10).some((r) => r[1] === "EmpCode")) {
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
  const header = (rows[0] ?? []).map((h) => cell(h).toLowerCase());
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
