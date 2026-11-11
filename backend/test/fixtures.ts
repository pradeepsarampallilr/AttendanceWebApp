/**
 * Builds small, fake roster and movement workbooks for the API tests (no real employee data).
 *
 * The people cover each case the engine cares about:
 *   1001 Alice Boss    general shift, top manager      1005 Erin Idle     general shift, never swipes
 *   1002 Bob Manager   general shift, reports to Alice 1006 Frank Late    4:00 PM - 1:30 AM, short days
 *   1003 Carol Night   6:00 PM - 3:00 AM, crosses midnight  1007 Gina Free  no shift in the roster
 *   1004 Dan Evening   2:00 PM - 11:00 PM, split visits     9999 Zed Visitor swipes but is not in the roster
 */
import ExcelJS from "exceljs";
import { addDays, weekday, type DateStr } from "../src/engine/core.js";

export const ROSTER_HEADER = ["Work Shift", "Shift Timing", "Emplid*", "Legal Name*", "Department", "Worker Type", "Sub-Type", "Email", "Hire Date", "Manager", "Transport", "Current Shift Timing"];
export const MOVEMENT_HEADER = ["SrNo", "EmpCode*", "Name", "TransDate*", "Controller", "Door", "In 1*", "Out 1*", "In 2", "Out 2", "In 3", "Out 3", "Work Hrs"];

const GENERAL = "9:00 AM - 6:30 PM";
// [Shift Timing, Emplid, Name, Department, Email, Manager]
const PEOPLE: [string, number, string, string, string, string][] = [
  [GENERAL, 1001, "Alice Boss", "Management", "alice.boss@example.com", ""],
  [GENERAL, 1002, "Bob Manager", "Engineering", "bob.manager@example.com", "Alice Boss"],
  ["6:00 PM - 3:00 AM", 1003, "Carol Night", "Support", "carol.night@example.com", "Bob Manager"],
  ["2:00 PM - 11:00 PM", 1004, "Dan Evening", "Support", "dan.evening@example.com", "Bob Manager"],
  [GENERAL, 1005, "Erin Idle", "Engineering", "erin.idle@example.com", "Bob Manager"],
  ["4:00 PM - 1:30 AM", 1006, "Frank Late", "Operations", "frank.late@example.com", "Alice Boss"],
  ["", 1007, "Gina Free", "Operations", "gina.free@example.com", "Alice Boss"],
];

async function toBuffer(wb: ExcelJS.Workbook) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function rosterXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Employee Details");
  ws.addRow(ROSTER_HEADER);
  for (const [shift, id, name, dept, email, manager] of PEOPLE) {
    ws.addRow([shift ? "Shift" : "", shift, id, name, dept, "Employee", "Regular", email, "2022-04-01", manager, "No", ""]);
  }
  return toBuffer(wb);
}

type Ev = { date: DateStr; time: string; kind: "in" | "out" };
const visit = (date: DateStr, from: string, to?: string, outDate = date): Ev[] =>
  [{ date, time: from, kind: "in" as const }, ...(to ? [{ date: outDate, time: to, kind: "out" as const }] : [])];

/** Swipes for one weekday of a month (Monday = 0), per person. `day` is the day of the month. */
const SCHEDULE: Record<number, (date: DateStr, w: number, day: number) => Ev[]> = {
  1001: (d, w) => ([0, 2, 3].includes(w) ? visit(d, "09:00:00", "18:00:00") : []),
  1002: (d, w) => (w === 2 ? visit(d, "09:00:00", "18:00:00") : w === 4 ? visit(d, "09:00:00", "13:00:00") : []),
  // Night shift Monday to Wednesday: the checkout is on the next calendar day.
  1003: (d, w, day) => (w <= 2 && day <= 26 ? visit(d, "18:00:00", "03:00:00", addDays(d, 1)) : []),
  // Wednesday is a split day (two visits); the first Friday has a check-in with no checkout.
  1004: (d, w, day) => (w === 2 ? [...visit(d, "14:00:00", "18:00:00"), ...visit(d, "18:45:00", "23:00:00")]
    : w === 0 || w === 3 ? visit(d, "14:00:00", "23:00:00")
    : w === 4 && day <= 7 ? visit(d, "14:00:00") : []),
  1006: (d, w) => (w === 0 ? visit(d, "16:00:00", "23:30:00") : w === 1 ? visit(d, "16:00:00", "20:00:00") : []),
  1007: (d, w) => (w === 1 ? visit(d, "10:00:00", "18:00:00") : []),
  9999: (d, w, day) => (w === 2 && day <= 7 ? visit(d, "09:00:00", "17:00:00") : []),
};
const NAMES: Record<number, string> = { ...Object.fromEntries(PEOPLE.map((p) => [p[1], p[2]])), 9999: "Zed Visitor" };

/** Door-swipe export for a whole month: a title block, then the EmpCode header, then one row per person per day. */
export async function movementXlsx(year: number, month: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Check In-Out");
  ws.addRow(["Door Movement Report"]);
  ws.addRow([`Period: ${year}-${String(month).padStart(2, "0")}`]);
  ws.addRow([]);
  ws.addRow(MOVEMENT_HEADER);

  const pad = (n: number) => String(n).padStart(2, "0");
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byKey = new Map<string, Ev[]>();
  for (let day = 1; day <= days; day++) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const w = weekday(date);
    if (w > 4) continue;
    for (const [id, f] of Object.entries(SCHEDULE)) {
      for (const e of f(date, w, day)) {
        // A checkout that spills into the next month belongs to that month's file.
        if (e.date.slice(0, 7) !== date.slice(0, 7)) continue;
        const key = `${id}|${e.date}`;
        byKey.set(key, [...(byKey.get(key) ?? []), e]);
      }
    }
  }
  let n = 0;
  for (const [key, evs] of [...byKey].sort()) {
    const [id, date] = key.split("|");
    evs.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    // Swipe slots alternate in/out; leave a slot blank when a row starts with a checkout (night shift).
    const slots: (string | null)[] = [];
    for (const e of evs) {
      while (slots.length % 2 !== (e.kind === "in" ? 0 : 1)) slots.push(null);
      slots.push(e.time);
    }
    while (slots.length < 6) slots.push(null);
    const [y, m, d] = date.split("-");
    ws.addRow([++n, Number(id), NAMES[Number(id)], `${d}-${m}-${y}`, "", "", ...slots.slice(0, 6), ""]);
  }
  ws.getColumn(4).numFmt = "@";
  return toBuffer(wb);
}

/** The fixture workbooks by the file names the tests upload them as. */
export const fixtureFile = (name: "roster.xlsx" | "july_movement.xlsx" | "august_movement.xlsx") =>
  name === "roster.xlsx" ? rosterXlsx() : movementXlsx(2026, name === "july_movement.xlsx" ? 7 : 8);
