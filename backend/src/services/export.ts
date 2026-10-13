/**
 * Builds the Excel download of the attendance results.
 */
import ExcelJS from "exceljs";
import { MONTH_NAMES, fmtDate, fmtWeekday } from "../engine/core.js";
import type { ApiRow } from "./adjustments.js";

const HEADERS = [
  "Employee id", "Employee Name", "Employee Email", "Department", "Manager", "Manager Email", "Week",
  "No. of days attended in a week", "Date", "Day", "Checked In Date", "Checked Out Date", "No of hours in Office",
  "Daily Total Hours", "Shift Timings", "Eligibility", "Compliant", "Week Compliant", "Month Compliant",
  "Transport Opt-in",
];

/** Naive 'YYYY-MM-DDTHH:MM:SS' -> '05-Aug-2026 09:00:00', no time-zone conversion. */
const fmtTs = (ts: string | null) => (ts ? `${fmtDate(ts.slice(0, 10))} ${ts.slice(11, 19)}` : "");

const style = (ws: ExcelJS.Worksheet, row: number) => {
  const r = ws.getRow(row);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
};

/** Workbook mirroring build_report.py's two data sheets, with manual adjustments applied. */
export async function buildWorkbook(
  ym: string,
  rows: (ApiRow & Record<string, any>)[],
  wed: { wednesdays: string[]; holidays: string[]; employees: { employeeId: string; name: string; attended: Record<string, boolean> }[] },
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Attendance");
  ws.addRow([`${MONTH_NAMES[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)} Attendance Report`]).font = { bold: true, size: 14 };
  ws.addRow(HEADERS);
  style(ws, 2);
  for (const r of rows) {
    ws.addRow([
      r.employeeId, r.name, r.email, r.department, r.managerName, r.managerEmail, r.week, r.weekAttendedDays,
      fmtDate(r.workDate), fmtWeekday(r.workDate), fmtTs(r.checkIn), fmtTs(r.checkOut), r.visitHours ?? "",
      r.isFirstRowOfDayGroup ? r.dailyTotalHours : null, r.shiftLabel, r.eligibility, r.compliant, r.weekCompliant, r.monthCompliant,
      r.transportOptIn,
    ]);
  }
  ws.views = [{ state: "frozen", ySplit: 2 }];
  ws.columns.forEach((c) => { c.width = 18; });

  const ww = wb.addWorksheet("Wednesday Office Attended");
  const holidays = new Set(wed.holidays);
  ww.addRow(["Employee id", "Employee Name", ...wed.wednesdays.map((d) => fmtDate(d) + (holidays.has(d) ? " (Holiday)" : "")), "Days Attended"]);
  style(ww, 1);
  for (const e of wed.employees) {
    const cells = wed.wednesdays.map((d) => (holidays.has(d) ? "Holiday" : e.attended[d] === true ? "Yes" : "No"));
    ww.addRow([e.employeeId, e.name, ...cells, cells.filter((c) => c === "Yes").length]);
  }
  wed.wednesdays.forEach((d, i) => {
    if (!holidays.has(d)) return;
    for (let r = 1; r <= wed.employees.length + 1; r++) {
      ww.getCell(r, i + 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
      if (r > 1) ww.getCell(r, i + 3).font = { color: { argb: "FF7F7F7F" } };
    }
  });
  ww.views = [{ state: "frozen", ySplit: 1 }];
  ww.columns.forEach((c) => { c.width = 18; });
  return wb;
}
