/**
 * Processes a month: loads the saved roster and swipes, works out attendance, and saves the results.
 */
import { And, LessThan, MoreThanOrEqual } from "typeorm";
import { AppDataSource } from "../db.js";
import { buildAttendanceDataset } from "../engine/dataset.js";
import { carryoverFromEvents } from "../engine/movement.js";
import { daysInMonth, mkDate, weekday, type DateStr } from "../engine/core.js";
import { AttendanceVisit, AuditIssue, Leave, PublicHoliday, SwipeEvent, WednesdayAttendance } from "../models/index.js";
import {
  insertChunked, loadEvents, loadRoster, monthStart, monthUploadIds, nextMonthStart, refreshTransportOptIn, ts,
} from "./store.js";

export class NotFoundError extends Error {}

export async function processMonth(ym: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RangeError("Month must look like 2026-08");
  const year = Number(m[1]), month = Number(m[2]);
  const ms = monthStart(year, month);

  const em = AppDataSource.manager;
  const currentEvents = await loadEvents(em, { month: ms });
  if (!currentEvents.size) throw new NotFoundError(`No movement upload found for ${ym}`);
  const { roster, unresolvedManagers } = await loadRoster(em);
  if (!roster.size) throw new NotFoundError("No roster uploaded yet");

  // Previous month's final-day swipes (pairing only), from whatever is already stored.
  const last = await em.getRepository(SwipeEvent).createQueryBuilder("s")
    .select("max(s.at)", "last").where("s.at < :ms", { ms }).getRawOne<{ last: string | null }>();
  const previousEvents = last?.last ? carryoverFromEvents(await loadEvents(em, { before: ms })) : new Map();

  const nameQb = em.getRepository(SwipeEvent).createQueryBuilder("s")
    .select("s.employeeId", "employeeId").addSelect("s.employeeName", "employeeName")
    .distinctOn(["s.employeeId"]).orderBy("s.employeeId")
    .where("s.employeeName IS NOT NULL");
  nameQb.andWhere(`s.uploadId IN ${monthUploadIds(nameQb, ms)}`);
  const fallbackNames = new Map<string, string>(
    (await nameQb.getRawMany<{ employeeId: string; employeeName: string }>()).map((r) => [r.employeeId, r.employeeName]));

  const holidays = new Set<DateStr>(
    (await em.find(PublicHoliday, { where: { month: ms } })).map((h) => h.holidayDate));

  const leaves = new Map<string, Set<DateStr>>();
  for (const l of await em.find(Leave, { where: { leaveDate: And(MoreThanOrEqual(ms), LessThan(nextMonthStart(ms))) } })) {
    if (!leaves.has(l.employeeId)) leaves.set(l.employeeId, new Set());
    leaves.get(l.employeeId)!.add(l.leaveDate);
  }

  const { rows, issues, attendedDates } = buildAttendanceDataset({
    currentEvents, previousEvents, roster, year, month, fallbackNames, holidays, leaves });
  if (unresolvedManagers.length) {
    issues.push({ employeeId: "-", issueType: "Manager email unresolved", at: new Date(),
      detail: "These managers are not present in the India shift roster, so their email could not be resolved (left blank): "
        + unresolvedManagers.join(", ") });
  }

  const wednesdays: DateStr[] = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = mkDate(year, month, d);
    if (weekday(date) === 2) wednesdays.push(date);
  }

  await AppDataSource.transaction(async (m) => {
    await m.delete(AttendanceVisit, { month: ms });
    await m.delete(AuditIssue, { month: ms });
    await m.delete(WednesdayAttendance, { month: ms });

    const col = <T>(f: (r: (typeof rows)[number]) => T) => rows.map(f);
    await m.query(
      `INSERT INTO attendance_visits (month, employee_id, employee_name, email, department, manager_name, manager_email,
         week, week_attended_days, work_date, check_in, check_out, visit_hours, daily_total_hours, is_first_row,
         rows_in_day_group, shift_label, eligibility, compliant, week_compliant, month_compliant)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::int[],
         $10::date[], $11::timestamp[], $12::timestamp[], $13::numeric[], $14::numeric[], $15::bool[], $16::int[],
         $17::text[], $18::text[], $19::text[], $20::text[], $21::text[])`,
      [ms, col((r) => r.employeeId), col((r) => r.name), col((r) => r.email), col((r) => r.department),
        col((r) => r.managerName), col((r) => r.managerEmail), col((r) => r.week), col((r) => r.weekAttendedDays),
        col((r) => r.workDate), col((r) => ts(r.checkIn)), col((r) => (r.checkOut ? ts(r.checkOut) : null)),
        col((r) => r.visitHours), col((r) => r.dailyTotalHours), col((r) => r.isFirstRowOfDayGroup),
        col((r) => r.rowsInDayGroup), col((r) => r.shiftLabel), col((r) => r.eligibility), col((r) => r.compliant),
        col((r) => r.weekCompliant), col((r) => r.monthCompliant)]);

    await refreshTransportOptIn(m, ms);

    await m.query(
      `INSERT INTO audit_issues (month, employee_id, issue_type, at, detail)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::timestamp[], $5::text[])`,
      [ms, issues.map((i) => i.employeeId), issues.map((i) => i.issueType), issues.map((i) => ts(i.at)), issues.map((i) => i.detail)]);

    const emps = [...roster.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const wed: WednesdayAttendance[] = [];
    for (const e of emps) for (const w of wednesdays) {
      wed.push(Object.assign(new WednesdayAttendance(), {
        month: ms, employeeId: e.employeeId, employeeName: e.name, wednesday: w, attended: attendedDates.get(e.employeeId)?.has(w) ?? false }));
    }
    await insertChunked(m, WednesdayAttendance, wed);
  });
  return { month: ms, visits: rows.length, issues: issues.length, wednesdayRows: roster.size * wednesdays.length };
}
