import { Router } from "express";
import { pool } from "../db.js";
import { processMonth } from "../services/process.js";
import { applyAdjustments } from "../services/adjustments.js";
import { buildWorkbook } from "../services/export.js";
import { NotFoundError } from "../services/process.js";

export const monthsRouter = Router();
const toMonth = (ym: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new RangeError("Month must look like 2026-08");
  return `${ym}-01`;
};

monthsRouter.post("/:ym/process", async (req, res) => res.json(await processMonth(req.params.ym)));

monthsRouter.get("/", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.month, u.filename, u.uploaded_at AS "uploadedAt",
            EXISTS (SELECT 1 FROM attendance_visits v WHERE v.month = u.month) AS processed
     FROM uploads u WHERE u.kind = 'movement' ORDER BY u.month DESC`);
  res.json(rows);
});

async function attendanceRows(ym: string) {
  const { rows } = await pool.query(
    `SELECT employee_id AS "employeeId", employee_name AS name, email, department, manager_name AS "managerName",
            manager_email AS "managerEmail", week, week_attended_days AS "weekAttendedDays", work_date AS "workDate",
            check_in AS "checkIn", check_out AS "checkOut", visit_hours AS "visitHours", daily_total_hours AS "dailyTotalHours",
            is_first_row AS "isFirstRowOfDayGroup", rows_in_day_group AS "rowsInDayGroup", shift_label AS "shiftLabel",
            eligibility, compliant, week_compliant AS "weekCompliant", month_compliant AS "monthCompliant",
            transport_opt_in AS "transportOptIn"
     FROM attendance_visits WHERE month = $1 ORDER BY employee_name COLLATE "C", work_date, check_in, id`, [toMonth(ym)]);
  const { rows: adj } = await pool.query(
    `SELECT employee_id AS "employeeId", work_date AS "workDate", action, hours::float8 AS hours, note
     FROM manual_adjustments WHERE month = $1`, [toMonth(ym)]);
  return applyAdjustments(rows, adj);
}

monthsRouter.get("/:ym/attendance", async (req, res) => res.json(await attendanceRows(req.params.ym)));

monthsRouter.get("/:ym/audit", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT employee_id AS "employeeId", issue_type AS "issueType", at, detail
     FROM audit_issues WHERE month = $1 ORDER BY id`, [toMonth(req.params.ym)]);
  res.json(rows);
});

async function wednesdayData(ym: string) {
  const { rows } = await pool.query(
    `SELECT w.employee_id AS "employeeId", w.employee_name AS name, w.wednesday, COALESCE(o.attended, w.attended) AS attended
     FROM wednesday_attendance w
     LEFT JOIN wednesday_overrides o ON o.employee_id = w.employee_id AND o.wednesday = w.wednesday
     WHERE w.month = $1 ORDER BY w.employee_name COLLATE "C", w.employee_id, w.wednesday`, [toMonth(ym)]);
  const wednesdays = [...new Set<string>(rows.map((r) => r.wednesday))].sort();
  const byEmp = new Map<string, { employeeId: string; name: string; attended: Record<string, boolean> }>();
  for (const r of rows) {
    let e = byEmp.get(r.employeeId);
    if (!e) byEmp.set(r.employeeId, (e = { employeeId: r.employeeId, name: r.name, attended: {} }));
    e.attended[r.wednesday] = r.attended;
  }
  // Read live (not stored at process time) so holiday edits show without reprocessing.
  const { rows: hol } = await pool.query(
    "SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d FROM public_holidays WHERE month = $1 ORDER BY holiday_date", [toMonth(ym)]);
  const holidaySet = new Set<string>(hol.map((h) => h.d));
  return { wednesdays, holidays: wednesdays.filter((w) => holidaySet.has(w)), employees: [...byEmp.values()] };
}

monthsRouter.get("/:ym/wednesday", async (req, res) => res.json(await wednesdayData(req.params.ym)));

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Set (or, with attended: null, clear) a manual override for one employee's Wednesday. */
monthsRouter.put("/:ym/wednesday", async (req, res) => {
  const month = toMonth(req.params.ym);
  const { employeeId, wednesday, attended } = req.body ?? {};
  if (typeof employeeId !== "string" || !isDate(wednesday) || (attended !== null && typeof attended !== "boolean"))
    throw new RangeError("Body must be {employeeId, wednesday: 'YYYY-MM-DD', attended: boolean|null}");
  const { rowCount } = await pool.query(
    "SELECT 1 FROM wednesday_attendance WHERE month = $1 AND employee_id = $2 AND wednesday = $3", [month, employeeId, wednesday]);
  if (!rowCount) throw new NotFoundError("No such employee/Wednesday in this month");
  if (attended === null) await pool.query("DELETE FROM wednesday_overrides WHERE employee_id = $1 AND wednesday = $2", [employeeId, wednesday]);
  else await pool.query(
    `INSERT INTO wednesday_overrides (month, employee_id, wednesday, attended) VALUES ($1,$2,$3,$4)
     ON CONFLICT (employee_id, wednesday) DO UPDATE SET attended = EXCLUDED.attended`, [month, employeeId, wednesday, attended]);
  res.json({ ok: true });
});

/** Add / edit / delete one employee-day's total hours. The action is derived from whether the day has engine rows. */
monthsRouter.put("/:ym/hours", async (req, res) => {
  const month = toMonth(req.params.ym);
  const { employeeId, workDate, hours, note, remove } = req.body ?? {};
  if (typeof employeeId !== "string" || !isDate(workDate) || !workDate.startsWith(req.params.ym))
    throw new RangeError("Body must be {employeeId, workDate inside the month, hours | remove: true, note?}");
  if (!remove && !(typeof hours === "number" && hours >= 0 && hours <= 24))
    throw new RangeError("hours must be a number between 0 and 24");
  const { rows: [{ n }] } = await pool.query(
    "SELECT count(*)::int AS n FROM attendance_visits WHERE month = $1 AND employee_id = $2 AND work_date = $3", [month, employeeId, workDate]);
  if (!n) {
    const { rowCount } = await pool.query("SELECT 1 FROM attendance_visits WHERE month = $1 AND employee_id = $2 LIMIT 1", [month, employeeId]);
    if (!rowCount) throw new NotFoundError("Employee has no attendance rows in this month");
    if (remove) throw new RangeError("Nothing to delete on that date");
  }
  const action = n ? (remove ? "delete" : "edit") : "add";
  await pool.query(
    `INSERT INTO manual_adjustments (month, employee_id, work_date, action, hours, note) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (employee_id, work_date) DO UPDATE SET action = EXCLUDED.action, hours = EXCLUDED.hours, note = EXCLUDED.note, created_at = now()`,
    [month, employeeId, workDate, action, remove ? null : hours, typeof note === "string" ? note : null]);
  res.json({ ok: true, action });
});

/** Revert an adjustment, restoring the engine's value. */
monthsRouter.delete("/:ym/hours/:employeeId/:date", async (req, res) => {
  const { rowCount } = await pool.query(
    "DELETE FROM manual_adjustments WHERE month = $1 AND employee_id = $2 AND work_date = $3", [toMonth(req.params.ym), req.params.employeeId, req.params.date]);
  if (!rowCount) throw new NotFoundError("No adjustment for that employee/date");
  res.json({ ok: true });
});

monthsRouter.get("/:ym/export.xlsx", async (req, res) => {
  const month = toMonth(req.params.ym);
  const { rowCount } = await pool.query("SELECT 1 FROM attendance_visits WHERE month = $1 LIMIT 1", [month]);
  if (!rowCount) throw new NotFoundError(`${req.params.ym} has not been processed`);
  const wb = await buildWorkbook(req.params.ym, await attendanceRows(req.params.ym), await wednesdayData(req.params.ym));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="attendance-${req.params.ym}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

monthsRouter.get("/:ym/holidays", async (req, res) => {
  const { rows } = await pool.query("SELECT holiday_date AS date FROM public_holidays WHERE month = $1 ORDER BY holiday_date", [toMonth(req.params.ym)]);
  res.json(rows.map((r) => r.date));
});

/** Replace the month's holiday set with `dates` (each must fall inside the month; weekends are rejected). */
monthsRouter.put("/:ym/holidays", async (req, res) => {
  const month = toMonth(req.params.ym);
  const dates = req.body?.dates;
  if (!Array.isArray(dates) || !dates.every((d) => isDate(d) && d.startsWith(req.params.ym)))
    throw new RangeError("Body must be {dates: ['YYYY-MM-DD', ...]} with every date inside the month");
  if (dates.some((d) => new Date(`${d}T00:00:00Z`).getUTCDay() % 6 === 0)) throw new RangeError("Holidays must fall on weekdays");
  const unique = [...new Set<string>(dates)].sort();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM public_holidays WHERE month = $1", [month]);
    if (unique.length) await client.query(
      "INSERT INTO public_holidays (holiday_date, month) SELECT d::date, $2::date FROM unnest($1::text[]) AS d", [unique, month]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.json(unique);
});
