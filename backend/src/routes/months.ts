import { Router } from "express";
import { And, LessThan, MoreThanOrEqual } from "typeorm";
import { AppDataSource } from "../db.js";
import {
  AttendanceVisit, AuditIssue, Leave, ManualAdjustment, PublicHoliday, RosterEmployee, Upload, WednesdayAttendance, WednesdayOverride,
} from "../models/index.js";
import { insertChunked, nextMonthStart } from "../services/store.js";
import { processMonth } from "../services/process.js";
import { applyAdjustments } from "../services/adjustments.js";
import { buildWorkbook } from "../services/export.js";
import { NotFoundError } from "../services/process.js";

export const monthsRouter = Router();
const repo = AppDataSource.getRepository.bind(AppDataSource);
const toMonth = (ym: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new RangeError("Month must look like 2026-08");
  return `${ym}-01`;
};

monthsRouter.post("/:ym/process", async (req, res) => res.json(await processMonth(req.params.ym)));

/** Delete a month's report: its movement uploads (swipe events cascade), computed output, and manual edits. Holidays and leaves are kept. */
monthsRouter.delete("/:ym", async (req, res) => {
  const month = toMonth(req.params.ym);
  await AppDataSource.transaction(async (m) => {
    const { affected } = await m.delete(Upload, { kind: "movement", month });
    if (!affected) throw new NotFoundError(`No movement upload for ${req.params.ym}`);
    for (const entity of [AttendanceVisit, AuditIssue, WednesdayAttendance, WednesdayOverride, ManualAdjustment])
      await m.delete(entity, { month });
  });
  res.status(204).end();
});

monthsRouter.get("/", async (_req, res) => {
  res.json(await repo(Upload).createQueryBuilder("u")
    .select("u.month", "month").addSelect("u.filename", "filename").addSelect("u.uploadedAt", "uploadedAt")
    .addSelect("EXISTS (SELECT 1 FROM attendance_visits v WHERE v.month = u.month)", "processed")
    .where("u.kind = 'movement'").orderBy("u.month", "DESC").getRawMany());
});

const ATTENDANCE_COLUMNS = [
  "employeeId", "email", "department", "managerName", "managerEmail", "week", "weekAttendedDays", "workDate",
  "checkIn", "checkOut", "visitHours", "dailyTotalHours", "rowsInDayGroup", "shiftLabel", "eligibility", "compliant",
  "weekCompliant", "monthCompliant", "transportOptIn",
] as const;

async function attendanceRows(ym: string) {
  // Raw (not hydrated) so DATE / naive TIMESTAMP stay strings and the response shape is unchanged.
  const qb = repo(AttendanceVisit).createQueryBuilder("v").select("v.employeeName", "name").addSelect("v.isFirstRow", "isFirstRowOfDayGroup");
  for (const c of ATTENDANCE_COLUMNS) qb.addSelect(`v.${c}`, c);
  const rows = await qb.where("v.month = :month", { month: toMonth(ym) })
    .orderBy('v.employee_name COLLATE "C"').addOrderBy("v.workDate").addOrderBy("v.checkIn").addOrderBy("v.id").getRawMany();
  const adj = await repo(ManualAdjustment).find({
    where: { month: toMonth(ym) }, select: { employeeId: true, workDate: true, action: true, hours: true, note: true } });
  return applyAdjustments(rows, adj);
}

monthsRouter.get("/:ym/attendance", async (req, res) => res.json(await attendanceRows(req.params.ym)));

monthsRouter.get("/:ym/audit", async (req, res) => {
  res.json(await repo(AuditIssue).createQueryBuilder("a")
    .select("a.employeeId", "employeeId").addSelect("a.issueType", "issueType").addSelect("a.at", "at").addSelect("a.detail", "detail")
    .where("a.month = :month", { month: toMonth(req.params.ym) }).orderBy("a.id").getRawMany());
});

async function wednesdayData(ym: string) {
  const rows = await repo(WednesdayAttendance).createQueryBuilder("w")
    .leftJoin(WednesdayOverride, "o", "o.employeeId = w.employeeId AND o.wednesday = w.wednesday")
    .select("w.employeeId", "employeeId").addSelect("w.employeeName", "name").addSelect("w.wednesday", "wednesday")
    .addSelect("COALESCE(o.attended, w.attended)", "attended")
    .where("w.month = :month", { month: toMonth(ym) })
    .orderBy('w.employee_name COLLATE "C"').addOrderBy("w.employeeId").addOrderBy("w.wednesday")
    .getRawMany<{ employeeId: string; name: string; wednesday: string; attended: boolean }>();
  const wednesdays = [...new Set<string>(rows.map((r) => r.wednesday))].sort();
  const byEmp = new Map<string, { employeeId: string; name: string; attended: Record<string, boolean> }>();
  for (const r of rows) {
    let e = byEmp.get(r.employeeId);
    if (!e) byEmp.set(r.employeeId, (e = { employeeId: r.employeeId, name: r.name, attended: {} }));
    e.attended[r.wednesday] = r.attended;
  }
  // Read live (not stored at process time) so holiday edits show without reprocessing.
  const hol = await repo(PublicHoliday).find({ where: { month: toMonth(ym) } });
  const holidaySet = new Set<string>(hol.map((h) => h.holidayDate));
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
  if (!(await repo(WednesdayAttendance).existsBy({ month, employeeId, wednesday })))
    throw new NotFoundError("No such employee/Wednesday in this month");
  if (attended === null) await repo(WednesdayOverride).delete({ employeeId, wednesday });
  else await repo(WednesdayOverride).upsert({ month, employeeId, wednesday, attended }, ["employeeId", "wednesday"]);
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
  const visits = repo(AttendanceVisit);
  const hasDay = await visits.existsBy({ month, employeeId, workDate });
  if (!hasDay) {
    if (!(await visits.existsBy({ month, employeeId }))) throw new NotFoundError("Employee has no attendance rows in this month");
    if (remove) throw new RangeError("Nothing to delete on that date");
  }
  const action = hasDay ? (remove ? "delete" : "edit") : "add";
  await repo(ManualAdjustment).upsert(
    { month, employeeId, workDate, action, hours: remove ? null : hours, note: typeof note === "string" ? note : null, createdAt: new Date() },
    ["employeeId", "workDate"]);
  res.json({ ok: true, action });
});

/** Revert an adjustment, restoring the engine's value. */
monthsRouter.delete("/:ym/hours/:employeeId/:date", async (req, res) => {
  const { affected } = await repo(ManualAdjustment).delete({
    month: toMonth(req.params.ym), employeeId: req.params.employeeId, workDate: req.params.date });
  if (!affected) throw new NotFoundError("No adjustment for that employee/date");
  res.json({ ok: true });
});

monthsRouter.get("/:ym/export.xlsx", async (req, res) => {
  const month = toMonth(req.params.ym);
  if (!(await repo(AttendanceVisit).existsBy({ month }))) throw new NotFoundError(`${req.params.ym} has not been processed`);
  const wb = await buildWorkbook(req.params.ym, await attendanceRows(req.params.ym), await wednesdayData(req.params.ym));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="attendance-${req.params.ym}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

monthsRouter.get("/:ym/holidays", async (req, res) => {
  const rows = await repo(PublicHoliday).find({ where: { month: toMonth(req.params.ym) }, order: { holidayDate: "ASC" } });
  res.json(rows.map((r) => r.holidayDate));
});

/** Replace the month's holiday set with `dates` (each must fall inside the month; weekends are rejected). */
monthsRouter.put("/:ym/holidays", async (req, res) => {
  const month = toMonth(req.params.ym);
  const dates = req.body?.dates;
  if (!Array.isArray(dates) || !dates.every((d) => isDate(d) && d.startsWith(req.params.ym)))
    throw new RangeError("Body must be {dates: ['YYYY-MM-DD', ...]} with every date inside the month");
  if (dates.some((d) => new Date(`${d}T00:00:00Z`).getUTCDay() % 6 === 0)) throw new RangeError("Holidays must fall on weekdays");
  const unique = [...new Set<string>(dates)].sort();
  await AppDataSource.transaction(async (m) => {
    await m.delete(PublicHoliday, { month });
    await insertChunked(m, PublicHoliday, unique.map((holidayDate) => m.create(PublicHoliday, { holidayDate, month })));
  });
  res.json(unique);
});

const inMonth = (month: string) => And(MoreThanOrEqual(month), LessThan(nextMonthStart(month)));

monthsRouter.get("/:ym/leaves", async (req, res) => {
  const rows = await repo(Leave).find({
    where: { leaveDate: inMonth(toMonth(req.params.ym)) }, order: { leaveDate: "ASC", employeeName: "ASC" } });
  res.json(rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employeeName, leaveDate: r.leaveDate, leaveDescription: r.leaveDescription })));
});

/** Add (or update) one leave: {employeeId, employeeName?, date, description?}. Reprocess the month to apply it. */
monthsRouter.post("/:ym/leaves", async (req, res) => {
  const { employeeId, employeeName = "", date, description = "" } = req.body ?? {};
  if (typeof employeeId !== "string" || !employeeId.trim() || !isDate(date) || !date.startsWith(req.params.ym))
    throw new RangeError("Body must be {employeeId, employeeName?, date: 'YYYY-MM-DD' inside the month, description?}");
  const leaves = repo(Leave);
  await leaves.upsert(
    { employeeId: employeeId.trim(), employeeName: String(employeeName), leaveDate: date, leaveDescription: String(description) },
    ["employeeId", "leaveDate"]);
  const saved = await leaves.findOneByOrFail({ employeeId: employeeId.trim(), leaveDate: date });
  res.status(201).json({ id: saved.id, employeeId: saved.employeeId, employeeName: saved.employeeName, leaveDate: saved.leaveDate, leaveDescription: saved.leaveDescription });
});

monthsRouter.delete("/:ym/leaves/:id", async (req, res) => {
  await repo(Leave).delete({ id: req.params.id, leaveDate: inMonth(toMonth(req.params.ym)) });
  res.status(204).end();
});

/** Replace one employee's leaves in the month with `dates` (weekdays inside the month). Reprocess the month to apply. */
monthsRouter.put("/:ym/employees/:employeeId/leaves", async (req, res) => {
  const month = toMonth(req.params.ym);
  const { employeeId } = req.params;
  const { dates, employeeName = "" } = req.body ?? {};
  if (!Array.isArray(dates) || !dates.every((d) => isDate(d) && d.startsWith(req.params.ym)))
    throw new RangeError("Body must be {dates: ['YYYY-MM-DD', ...], employeeName?} with every date inside the month");
  if (dates.some((d) => new Date(`${d}T00:00:00Z`).getUTCDay() % 6 === 0)) throw new RangeError("Leaves must fall on weekdays");
  const unique = [...new Set<string>(dates)].sort();
  await AppDataSource.transaction(async (m) => {
    const old = await m.find(Leave, { where: { employeeId, leaveDate: inMonth(month) } });
    const keep = new Map(old.filter((l) => unique.includes(l.leaveDate)).map((l) => [l.leaveDate, l]));
    const gone = old.filter((l) => !keep.has(l.leaveDate)).map((l) => l.id);
    if (gone.length) await m.delete(Leave, gone);
    const roster = await m.findOneBy(RosterEmployee, { employeeId });
    const name = String(employeeName) || roster?.name || old[0]?.employeeName || "";
    const fresh = unique.filter((d) => !keep.has(d)).map((leaveDate) => m.create(Leave, { employeeId, employeeName: name, leaveDate }));
    if (fresh.length) await insertChunked(m, Leave, fresh);
  });
  const rows = await repo(Leave).find({ where: { employeeId, leaveDate: inMonth(month) }, order: { leaveDate: "ASC" } });
  res.json(rows.map((r) => r.leaveDate));
});

/** One employee's leave dates in the month. */
monthsRouter.get("/:ym/employees/:employeeId/leaves", async (req, res) => {
  const rows = await repo(Leave).find({
    where: { employeeId: req.params.employeeId, leaveDate: inMonth(toMonth(req.params.ym)) }, order: { leaveDate: "ASC" } });
  res.json(rows.map((r) => r.leaveDate));
});
