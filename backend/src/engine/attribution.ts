import {
  DAY_ATTRIBUTION_BUFFER_MIN, HOUR_MS, MAX_SHIFT_DURATION_MS, addDays, dateOf, pyDateTime, round2, type DateStr,
} from "./core.js";
import { crossesMidnight, type AuditIssue, type ShiftWindow, type SwipeEvent, type Visit, type WorkDateGroup } from "./types.js";

/** Greedily pair check-ins with the earliest valid, unused checkout. */
export function pairSwipeEvents(
  employeeId: string, events: SwipeEvent[], monthStart: DateStr,
): { visits: Visit[]; issues: AuditIssue[] } {
  const visits: Visit[] = [];
  const issues: AuditIssue[] = [];
  let pending: SwipeEvent | null = null;
  const prevMonth = (d: Date) => dateOf(d) < monthStart;

  for (const ev of events) {
    if (ev.kind === "in") {
      if (pending) {
        issues.push({ employeeId, issueType: "Missing checkout", at: pending.at,
          detail: `Check-in at ${pyDateTime(pending.at)} had no matching checkout before the next check-in.` });
        visits.push({ employeeId, checkIn: pending.at, checkOut: null, fromPreviousMonth: prevMonth(pending.at) });
      }
      pending = ev;
      continue;
    }
    if (!pending) {
      issues.push({ employeeId, issueType: "Orphan checkout", at: ev.at,
        detail: `Checkout at ${pyDateTime(ev.at)} has no preceding unmatched check-in.` });
      continue;
    }
    const gap = ev.at.getTime() - pending.at.getTime();
    const pd = dateOf(pending.at);
    const od = dateOf(ev.at);
    const sameOrNextDay = od === pd || od === addDays(pd, 1);
    if (sameOrNextDay && gap >= 0 && gap <= MAX_SHIFT_DURATION_MS) {
      visits.push({ employeeId, checkIn: pending.at, checkOut: ev.at, fromPreviousMonth: prevMonth(pending.at) });
      pending = null;
    } else {
      issues.push({ employeeId, issueType: "Orphan checkout", at: ev.at,
        detail: `Checkout at ${pyDateTime(ev.at)} fell outside the 20:00:00 window for the pending check-in at ${pyDateTime(pending.at)}; treated as unmatched.` });
    }
  }
  if (pending) {
    visits.push({ employeeId, checkIn: pending.at, checkOut: null, fromPreviousMonth: prevMonth(pending.at) });
    issues.push({ employeeId, issueType: "Missing checkout", at: pending.at,
      detail: `Check-in at ${pyDateTime(pending.at)} was never closed out by end of the available data.` });
  }
  return { visits, issues };
}

export function looksLikeOvernightWorker(events: SwipeEvent[]): boolean {
  const evening = events.filter((e) => e.kind === "in" && e.at.getUTCHours() >= 17).length;
  const daytime = events.filter((e) => e.kind === "in" && e.at.getUTCHours() >= 6 && e.at.getUTCHours() < 12).length;
  return evening > daytime && evening > 0;
}

/** Overnight shifts: a post-midnight check-in up to (shift end + 1h) belongs to the previous day. */
export function assignWorkDate(checkIn: Date, shift: ShiftWindow | null): DateStr {
  const d = dateOf(checkIn);
  if (!shift || !crossesMidnight(shift)) return d;
  const mins = checkIn.getUTCHours() * 60 + checkIn.getUTCMinutes();
  return mins <= shift.endMinutes + DAY_ATTRIBUTION_BUFFER_MIN ? addDays(d, -1) : d;
}

export const visitHours = (v: Visit): number | null =>
  v.checkOut ? round2((v.checkOut.getTime() - v.checkIn.getTime()) / HOUR_MS) : null;

/** Sum of closed legs; null when no leg is closed. */
export function groupTotalHours(g: WorkDateGroup): number | null {
  const closed = g.visits.filter((v) => v.checkOut);
  if (!closed.length) return null;
  const ms = closed.reduce((s, v) => s + (v.checkOut!.getTime() - v.checkIn.getTime()), 0);
  return round2(ms / HOUR_MS);
}
export const groupHasOpenVisit = (g: WorkDateGroup) => g.visits.some((v) => !v.checkOut);

export function buildWorkDateGroups(
  visits: Visit[], shift: ShiftWindow | null, monthStart: DateStr, monthEnd: DateStr,
): { groups: WorkDateGroup[]; issues: AuditIssue[] } {
  const groups = new Map<DateStr, WorkDateGroup>();
  const issues: AuditIssue[] = [];
  for (const v of visits) {
    if (v.fromPreviousMonth) continue;
    const workDate = assignWorkDate(v.checkIn, shift);
    if (workDate < monthStart || workDate > monthEnd) continue;
    if (workDate === monthEnd) {
      issues.push({ employeeId: v.employeeId, issueType: "Skipped - month boundary", at: v.checkIn,
        detail: `Visit on ${workDate} may cross into next month; its checkout data is unavailable this run, so daily hours were not calculated.` });
      continue;
    }
    let g = groups.get(workDate);
    if (!g) groups.set(workDate, (g = { employeeId: v.employeeId, workDate, visits: [] }));
    g.visits.push(v);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.workDate < b.workDate ? -1 : a.workDate > b.workDate ? 1 : 0));
  for (const g of ordered) g.visits.sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
  return { groups: ordered, issues };
}
