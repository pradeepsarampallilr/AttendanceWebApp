/**
 * Matches each check-in with its checkout and flags missing or stray swipes.
 * Then works out which work day each visit belongs to and how many hours were worked.
 */
import {
  HOUR_MS, addDays, settings, dateOf, fmtDateTime, round2, type DateStr,
} from "./core.js";
import { crossesMidnight, type AuditIssue, type ShiftWindow, type SwipeEvent, type Visit, type WorkDateGroup } from "./types.js";

export function pairSwipeEvents(employeeId: string, events: SwipeEvent[]): { visits: Visit[]; issues: AuditIssue[] } {
  const visits: Visit[] = [];
  const issues: AuditIssue[] = [];
  let pending: SwipeEvent | null = null;

  for (const ev of events) {
    if (ev.kind === "in") {
      if (pending) {
        issues.push({ employeeId, issueType: "Missing checkout", at: pending.at,
          detail: `Check-in at ${fmtDateTime(pending.at)} had no matching checkout before the next check-in.` });
        visits.push({ employeeId, checkIn: pending.at, checkOut: null });
      }
      pending = ev;
      continue;
    }
    if (!pending) {
      issues.push({ employeeId, issueType: "Orphan checkout", at: ev.at,
        detail: `Checkout at ${fmtDateTime(ev.at)} has no preceding unmatched check-in.` });
      continue;
    }
    const gap = ev.at.getTime() - pending.at.getTime();
    const pd = dateOf(pending.at);
    const od = dateOf(ev.at);
    const sameOrNextDay = od === pd || od === addDays(pd, 1);
    if (sameOrNextDay && gap >= 0 && gap <= settings.maxShiftHours * HOUR_MS) {
      visits.push({ employeeId, checkIn: pending.at, checkOut: ev.at });
      pending = null;
    } else {
      issues.push({ employeeId, issueType: "Missing checkout", at: ev.at,
        detail: `Checkout at ${fmtDateTime(ev.at)} fell outside the ${settings.maxShiftHours}:00:00 window for the pending check-in at ${fmtDateTime(pending.at)}; treated as unmatched.` });
    }
  }
  if (pending) {
    visits.push({ employeeId, checkIn: pending.at, checkOut: null });
    issues.push({ employeeId, issueType: "Missing checkout", at: pending.at,
      detail: `Check-in at ${fmtDateTime(pending.at)} was never closed out by end of the available data.` });
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
  return mins <= shift.endMinutes + settings.dayAttributionBufferMin ? addDays(d, -1) : d;
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

/**
 * Groups visits by work date inside [from, monthEnd]. A visit on the last day of the month is skipped (its checkout
 * may sit in next month's data), and logged.
 */
export function buildWorkDateGroups(
  visits: Visit[], shift: ShiftWindow | null, from: DateStr, monthEnd: DateStr,
): { groups: WorkDateGroup[]; issues: AuditIssue[] } {
  const groups = new Map<DateStr, WorkDateGroup>();
  const issues: AuditIssue[] = [];
  for (const v of visits) {
    const workDate = assignWorkDate(v.checkIn, shift);
    if (workDate < from || workDate > monthEnd) continue;
    if (workDate === monthEnd) {
      issues.push({ employeeId: v.employeeId, issueType: "Skipped - month boundary", at: v.checkIn,
        detail: `Visit on ${workDate} may cross into next month; its checkout data is unavailable this run, so daily hours were not calculated.` });
      continue;
    }
    let g = groups.get(workDate);
    if (!g) groups.set(workDate, (g = { employeeId: v.employeeId, workDate, visits: [] }));
    g.visits.push(v);
  }
  const ordered = [...groups.values()].sort((a, b) => cmp(a.workDate, b.workDate));
  for (const g of ordered) g.visits.sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
  return { groups: ordered, issues };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
