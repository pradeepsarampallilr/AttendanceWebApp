/**
 * Reads the door swipe (movement) rows into check-in and check-out events per employee.
 * Also finds the month covered and carries over swipes from earlier days.
 */
import { addDays, dateOf, mkDateTime, type DateStr } from "./core.js";
import type { EventsByEmployee, SwipeEvent } from "./types.js";

export const SWIPE_START_COL = 6;

export function parseMovementRows(rows: unknown[][]): EventsByEmployee {
  const events: EventsByEmployee = new Map();
  for (const row of rows) {
    const code = String(row[1] ?? "").trim();
    if (!/^[+-]?\d+$/.test(code)) continue;
    const employeeId = String(Number(code));

    const tm = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(row[3] ?? "").trim());
    if (!tm) continue;
    const transDate: DateStr = `${tm[3]}-${tm[2]}-${tm[1]}`;

    const slots = row.slice(SWIPE_START_COL, -1);
    slots.forEach((cell, offset) => {
      if (cell == null || cell === "") return;
      const t = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(cell).trim());
      if (!t) return;
      const kind = offset % 2 === 0 ? "in" : "out";
      const at = mkDateTime(transDate, Number(t[1]), Number(t[2]), Number(t[3]));
      let list = events.get(employeeId);
      if (!list) events.set(employeeId, (list = []));
      list.push({ at, kind });
    });
  }
  for (const list of events.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

/** Only the final TransDate's swipes of a previous-month export (used for pairing only). */
export function carryoverFromEvents(all: EventsByEmployee): EventsByEmployee {
  let last: DateStr | null = null;
  for (const list of all.values()) for (const e of list) {
    const d = dateOf(e.at);
    if (last === null || d > last) last = d;
  }
  const out: EventsByEmployee = new Map();
  if (last === null) return out;
  for (const [emp, list] of all) {
    const tail = list.filter((e) => dateOf(e.at) === last);
    if (tail.length) out.set(emp, tail);
  }
  return out;
}

export function inferMonthBounds(events: EventsByEmployee): { year: number; month: number } {
  const counts = new Map<string, number>();
  for (const list of events.values()) for (const e of list) {
    const k = `${e.at.getUTCFullYear()}-${e.at.getUTCMonth() + 1}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [k, n] of counts) if (best === null || n > counts.get(best)!) best = k;
  if (best === null) throw new Error("No swipe events found in movement file");
  const [year, month] = best.split("-").map(Number);
  return { year, month };
}

export { addDays };
export type { SwipeEvent };
