/** Handles everything for one month: process, view (scoped to what the caller may see), edit hours, Wednesdays, holidays, leaves, export. */
import { Router, type Request } from "express";
import { And, In, LessThan, MoreThanOrEqual } from "typeorm";
import { AppDataSource } from "../db.js";
import {
  AttendanceVisit, AuditIssue, Leave, ManualAdjustment, PublicHoliday, RosterEmployee, Upload, WednesdayAdjustment, WednesdayAttendance,
  WeeklyCompliance,
} from "../models/index.js";
import { requireWrite, visibleEmployees } from "../services/access.js";
import { applyAdjustments } from "../services/adjustments.js";
import { logAction } from "../services/audit.js";
import { buildWorkbook } from "../services/export.js";
import { NotFoundError, processMonth } from "../services/process.js";
import { insertChunked, nextMonthStart } from "../services/store.js";

export const monthsRouter = Router();
const repo = AppDataSource.getRepository.bind(AppDataSource);
const toMonth = (ym: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new RangeError("Month must look like 2026-08");
  return `${ym}-01`;
};
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isWeekend = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() % 6 === 0;
const inMonth = (month: string) => And(MoreThanOrEqual(month), LessThan(nextMonthStart(month)));
const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
/** `In(ids)` for a scoped caller, or no filter for HR. An empty scope matches nothing. */
const only = (ids: string[] | null) => (ids ? { employeeId: In(ids) } : {});

// ---- Everyone signed in: months, holidays ----------------------------------------------------------------------

monthsRouter.get("/", async (_req, res) => {
  res.json(await repo(Upload).createQueryBuilder("u")
    .select("u.month", "month").addSelect("u.filename", "filename").addSelect("u.uploadedAt", "uploadedAt")
    .addSelect("EXISTS (SELECT 1 FROM attendance_visits v WHERE v.month = u.month)", "processed")
    .where("u.kind = 'movement'").orderBy("u.month", "DESC").getRawMany());
});

monthsRouter.get("/:ym/holidays", async (req, res) => {
  const rows = await repo(PublicHoliday).find({ where: { month: toMonth(req.params.ym) }, order: { holidayDate: "ASC" } });
  res.json(rows.map((r) => ({ date: r.holidayDate, description: r.description })));
});

// ---- Attendance (scoped) ---------------------------------------------------------------------------------------

const ATTENDANCE_COLUMNS = [
  "employeeId", "email", "department", "managerName", "managerEmail", "week", "weekAttendedDays", "workDate",
  "checkIn", "checkOut", "visitHours", "dailyTotalHours", "rowsInDayGroup", "shiftLabel", "eligibility", "compliant",
  "weekCompliant", "monthCompliant", "transportOptIn",
] as const;

export async function attendanceRows(ym: string, ids: string[] | null) {
  if (ids && !ids.length) return [];
  const month = toMonth(ym);
  // Raw (not hydrated) so DATE / naive TIMESTAMP stay strings.
  const qb = repo(AttendanceVisit).createQueryBuilder("v").select("v.employeeName", "name").addSelect("v.isFirstRow", "isFirstRowOfDayGroup");
  for (const c of ATTENDANCE_COLUMNS) qb.addSelect(`v.${c}`, c);
  qb.where("v.month = :month", { month });
  if (ids) qb.andWhere("v.employeeId IN (:...ids)", { ids });
  const rows = await qb.orderBy('v.employee_name COLLATE "C"').addOrderBy("v.workDate").addOrderBy("v.checkIn").addOrderBy("v.id").getRawMany();
  const adj = await repo(ManualAdjustment).find({
    where: { month, ...only(ids) }, select: { employeeId: true, workDate: true, action: true, hours: true, note: true } });
  return applyAdjustments(rows, adj);
}

async function wednesdayData(ym: string, ids: string[] | null) {
  if (ids && !ids.length) return { wednesdays: [], holidays: [], employees: [] };
  const qb = repo(WednesdayAttendance).createQueryBuilder("w")
    .leftJoin(WednesdayAdjustment, "o", "o.employeeId = w.employeeId AND o.wednesday = w.wednesday")
    .leftJoin(RosterEmployee, "r", "r.employeeId = w.employeeId")
    .select("w.employeeId", "employeeId").addSelect("w.employeeName", "name").addSelect("w.wednesday", "wednesday")
    .addSelect("COALESCE(o.attended, w.attended)", "attended")
    .addSelect("r.email", "email").addSelect("r.department", "department").addSelect("r.shiftLabel", "shift")
    .where("w.month = :month", { month: toMonth(ym) });
  if (ids) qb.andWhere("w.employeeId IN (:...ids)", { ids });
  const rows = await qb.orderBy('w.employee_name COLLATE "C"').addOrderBy("w.employeeId").addOrderBy("w.wednesday")
    .getRawMany<{ employeeId: string; name: string; email: string | null; department: string | null; shift: string | null; wednesday: string; attended: boolean }>();
  const wednesdays = [...new Set<string>(rows.map((r) => r.wednesday))].sort();
  const byEmp = new Map<string, { employeeId: string; name: string; email: string; department: string; shift: string | null; attended: Record<string, boolean> }>();
  for (const r of rows) {
    let e = byEmp.get(r.employeeId);
    if (!e) byEmp.set(r.employeeId, (e = { employeeId: r.employeeId, name: r.name, email: r.email ?? "", department: r.department ?? "", shift: r.shift, attended: {} }));
    e.attended[r.wednesday] = r.attended;
  }
  // Read live (not stored at process time) so holiday edits show without reprocessing.
  const holidaySet = new Set<string>((await repo(PublicHoliday).find({ where: { month: toMonth(ym) } })).map((h) => h.holidayDate));
  return { wednesdays, holidays: wednesdays.filter((w) => holidaySet.has(w)), employees: [...byEmp.values()] };
}

monthsRouter.get("/:ym/attendance", async (req, res) => res.json(await attendanceRows(req.params.ym, await visibleEmployees(req))));
monthsRouter.get("/:ym/wednesday", async (req, res) => res.json(await wednesdayData(req.params.ym, await visibleEmployees(req))));

/** Every employee's result for every calendar week of the month: office days needed / attended, Wednesday, status. */
monthsRouter.get("/:ym/weekly", async (req, res) => {
  const ids = await visibleEmployees(req);
  if (ids && !ids.length) return void res.json([]);
  res.json(await repo(WeeklyCompliance).find({
    where: { month: toMonth(req.params.ym), ...only(ids) }, order: { employeeName: "ASC", weekStart: "ASC" } }));
});

/** Data-quality issues found while processing. Issues not tied to one employee (id "-") are HR-only. */
monthsRouter.get("/:ym/audit", async (req, res) => {
  const ids = await visibleEmployees(req);
  const qb = repo(AuditIssue).createQueryBuilder("a")
    .select("a.employeeId", "employeeId").addSelect("a.issueType", "issueType").addSelect("a.at", "at").addSelect("a.detail", "detail")
    .where("a.month = :month", { month: toMonth(req.params.ym) });
  if (ids) qb.andWhere("a.employeeId IN (:...ids)", { ids: ids.length ? ids : [""] });
  res.json(await qb.orderBy("a.id").getRawMany());
});

monthsRouter.get("/:ym/leaves", async (req, res) => {
  const ids = await visibleEmployees(req);
  const rows = await repo(Leave).find({
    where: { leaveDate: inMonth(toMonth(req.params.ym)), ...only(ids) }, order: { leaveDate: "ASC", employeeName: "ASC" } });
  res.json(rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employeeName, leaveDate: r.leaveDate, leaveDescription: r.leaveDescription })));
});

monthsRouter.get("/:ym/employees/:employeeId/leaves", async (req, res) => {
  const ids = await visibleEmployees(req);
  if (ids && !ids.includes(req.params.employeeId)) return void res.json([]);
  const rows = await repo(Leave).find({
    where: { employeeId: req.params.employeeId, leaveDate: inMonth(toMonth(req.params.ym)) }, order: { leaveDate: "ASC" } });
  res.json(rows.map((r) => r.leaveDate));
});

monthsRouter.get("/:ym/export.xlsx", async (req, res) => {
  const ids = await visibleEmployees(req);
  if (!(await repo(AttendanceVisit).existsBy({ month: toMonth(req.params.ym) }))) throw new NotFoundError(`${req.params.ym} has not been processed`);
  const wb = await buildWorkbook(req.params.ym, await attendanceRows(req.params.ym, ids), await wednesdayData(req.params.ym, ids));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="attendance-${req.params.ym}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---- HR only: everything below changes data ---------------------------------------------------------------------

monthsRouter.use(requireWrite);
const log = (req: Request, action: string, detail: string) => logAction(req, action, "month " + req.params.ym, detail);

monthsRouter.post("/:ym/process", async (req, res) => {
  const result = await processMonth(req.params.ym);
  await log(req, "process month", `${result.visits} visits, ${result.issues} issues`);
  res.json(result);
});

/** Delete a month's report: its movement uploads (swipe events cascade), computed output, and manual edits. Holidays and leaves are kept. */
monthsRouter.delete("/:ym", async (req, res) => {
  const month = toMonth(req.params.ym);
  await AppDataSource.transaction(async (m) => {
    const { affected } = await m.delete(Upload, { kind: "movement", month });
    if (!affected) throw new NotFoundError(`No movement upload for ${req.params.ym}`);
    for (const entity of [AttendanceVisit, AuditIssue, WednesdayAttendance, WeeklyCompliance, WednesdayAdjustment, ManualAdjustment])
      await m.delete(entity, { month });
  });
  await log(req, "delete month", "report and manual edits removed");
  res.status(204).end();
});

/** Set (or, with attended: null, clear) a manual adjustment for one employee's Wednesday. */
monthsRouter.put("/:ym/wednesday", async (req, res) => {
  const month = toMonth(req.params.ym);
  const { employeeId, wednesday, attended } = req.body ?? {};
  if (typeof employeeId !== "string" || !isDate(wednesday) || (attended !== null && typeof attended !== "boolean"))
    throw new RangeError("Body must be {employeeId, wednesday: 'YYYY-MM-DD', attended: boolean|null}");
  if (!(await repo(WednesdayAttendance).existsBy({ month, employeeId, wednesday })))
    throw new NotFoundError("No such employee/Wednesday in this month");
  if (attended === null) await repo(WednesdayAdjustment).delete({ employeeId, wednesday });
  else await repo(WednesdayAdjustment).upsert({ month, employeeId, wednesday, attended }, ["employeeId", "wednesday"]);
  await log(req, "wednesday adjustment", `${employeeId} ${wednesday}: ${attended === null ? "cleared" : attended ? "present" : "absent"}`);
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
    { month, employeeId, workDate, action, hours: remove ? null : hours, note: text(note, 500) || null, createdAt: new Date() },
    ["employeeId", "workDate"]);
  await log(req, `hours ${action}`, `${employeeId} ${workDate}${remove ? "" : ` = ${hours}h`}${note ? ` (${text(note, 80)})` : ""}`);
  res.json({ ok: true, action });
});

/** Revert an adjustment, restoring the engine's value. */
monthsRouter.delete("/:ym/hours/:employeeId/:date", async (req, res) => {
  if (!isDate(req.params.date)) throw new RangeError("Date must look like 2026-08-14");
  const { affected } = await repo(ManualAdjustment).delete({
    month: toMonth(req.params.ym), employeeId: req.params.employeeId, workDate: req.params.date });
  if (!affected) throw new NotFoundError("No adjustment for that employee/date");
  await log(req, "hours revert", `${req.params.employeeId} ${req.params.date}`);
  res.json({ ok: true });
});

/** Replace the month's holidays. Body: {holidays: [{date, description?}]} (or the older {dates: [...]}); weekdays only. */
monthsRouter.put("/:ym/holidays", async (req, res) => {
  const month = toMonth(req.params.ym);
  const items: { date: unknown; description?: unknown }[] = Array.isArray(req.body?.holidays)
    ? req.body.holidays : Array.isArray(req.body?.dates) ? req.body.dates.map((date: unknown) => ({ date })) : [];
  if (!Array.isArray(req.body?.holidays) && !Array.isArray(req.body?.dates) || !items.every((h) => isDate(h.date) && h.date.startsWith(req.params.ym)))
    throw new RangeError("Body must be {holidays: [{date: 'YYYY-MM-DD', description}]} with every date inside the month");
  if (items.some((h) => isWeekend(h.date as string))) throw new RangeError("Holidays must fall on weekdays");
  const unique = new Map<string, string>(items.map((h) => [h.date as string, text(h.description)]));
  await AppDataSource.transaction(async (m) => {
    await m.delete(PublicHoliday, { month });
    await insertChunked(m, PublicHoliday, [...unique].map(([holidayDate, description]) => m.create(PublicHoliday, { holidayDate, month, description })));
  });
  await log(req, "set holidays", [...unique.keys()].sort().join(", ") || "none");
  res.json([...unique].sort().map(([date, description]) => ({ date, description })));
});

/** Add (or update) one leave: {employeeId, employeeName?, date, description?}. Reprocess the month to apply it. */
monthsRouter.post("/:ym/leaves", async (req, res) => {
  const { employeeId, employeeName = "", date, description = "" } = req.body ?? {};
  if (typeof employeeId !== "string" || !employeeId.trim() || !isDate(date) || !date.startsWith(req.params.ym) || isWeekend(date))
    throw new RangeError("Body must be {employeeId, employeeName?, date: weekday 'YYYY-MM-DD' inside the month, description?}");
  const leaves = repo(Leave);
  await leaves.upsert(
    { employeeId: employeeId.trim(), employeeName: text(employeeName), leaveDate: date, leaveDescription: text(description) },
    ["employeeId", "leaveDate"]);
  const saved = await leaves.findOneByOrFail({ employeeId: employeeId.trim(), leaveDate: date });
  await log(req, "add leave", `${saved.employeeId} ${date}`);
  res.status(201).json({ id: saved.id, employeeId: saved.employeeId, employeeName: saved.employeeName, leaveDate: saved.leaveDate, leaveDescription: saved.leaveDescription });
});

monthsRouter.delete("/:ym/leaves/:id", async (req, res) => {
  await repo(Leave).delete({ id: req.params.id, leaveDate: inMonth(toMonth(req.params.ym)) });
  await log(req, "delete leave", `leave #${req.params.id}`);
  res.status(204).end();
});

/** Replace one employee's leaves in the month with `dates` (weekdays inside the month). Reprocess the month to apply. */
monthsRouter.put("/:ym/employees/:employeeId/leaves", async (req, res) => {
  const month = toMonth(req.params.ym);
  const { employeeId } = req.params;
  const { dates, employeeName = "" } = req.body ?? {};
  if (!Array.isArray(dates) || !dates.every((d) => isDate(d) && d.startsWith(req.params.ym)))
    throw new RangeError("Body must be {dates: ['YYYY-MM-DD', ...], employeeName?} with every date inside the month");
  if (dates.some(isWeekend)) throw new RangeError("Leaves must fall on weekdays");
  const unique = [...new Set<string>(dates)].sort();
  await AppDataSource.transaction(async (m) => {
    const old = await m.find(Leave, { where: { employeeId, leaveDate: inMonth(month) } });
    const keep = new Set(old.filter((l) => unique.includes(l.leaveDate)).map((l) => l.leaveDate));
    const gone = old.filter((l) => !keep.has(l.leaveDate)).map((l) => l.id);
    if (gone.length) await m.delete(Leave, gone);
    const roster = await m.findOneBy(RosterEmployee, { employeeId });
    const name = text(employeeName) || roster?.name || old[0]?.employeeName || "";
    const fresh = unique.filter((d) => !keep.has(d)).map((leaveDate) => m.create(Leave, { employeeId, employeeName: name, leaveDate }));
    if (fresh.length) await insertChunked(m, Leave, fresh);
  });
  await log(req, "set leaves", `${employeeId}: ${unique.join(", ") || "none"}`);
  res.json(unique);
});
