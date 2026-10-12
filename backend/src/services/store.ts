import type { EntityManager, EntityTarget, ObjectLiteral } from "typeorm";
import type { DateStr } from "../engine/core.js";
import type { EventsByEmployee, RosterEntry } from "../engine/types.js";
import { AttendanceVisit, RosterEmployee, SwipeEvent } from "../models/index.js";

export const ts = (d: Date) => d.toISOString().slice(0, 19);
export const parseTs = (s: string) => new Date(s.slice(0, 19) + "Z");

export const monthStart = (year: number, month: number): DateStr => `${year}-${String(month).padStart(2, "0")}-01`;
export const nextMonthStart = (ms: DateStr): DateStr => {
  const [y, m] = ms.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : monthStart(y, m + 1);
};

/** Multi-row INSERT in chunks (Postgres caps a statement at 65535 bind parameters). */
export async function insertChunked<T extends ObjectLiteral>(m: EntityManager, target: EntityTarget<T>, rows: T[], size = 1000) {
  for (let i = 0; i < rows.length; i += size) await m.insert(target, rows.slice(i, i + size) as never);
}

// Set-based unnest insert: swipes/visits carry naive wall-clock timestamps, which we hand to Postgres as text
// so no JS Date (and therefore no time-zone shift) is ever involved.
export async function insertSwipeEvents(m: EntityManager, uploadId: number, events: EventsByEmployee, names: Map<string, string>) {
  const ids: string[] = [], nm: (string | null)[] = [], at: string[] = [], kind: string[] = [];
  for (const [emp, list] of events) for (const e of list) {
    ids.push(emp); nm.push(names.get(emp) ?? null); at.push(ts(e.at)); kind.push(e.kind);
  }
  await m.query(
    `INSERT INTO swipe_events (employee_id, employee_name, at, kind, upload_id)
     SELECT u.id, u.nm, u.at::timestamp, u.kind, $5 FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS u(id, nm, at, kind)`, [ids, nm, at, kind, uploadId]);
  return ids.length;
}

/** Swipes of a month's movement upload, or (`before`) every swipe earlier than a date, grouped by employee. */
export async function loadEvents(m: EntityManager, scope: { month: DateStr } | { before: DateStr }): Promise<EventsByEmployee> {
  const qb = m.getRepository(SwipeEvent).createQueryBuilder("s")
    .select("s.employeeId", "employeeId").addSelect("s.at", "at").addSelect("s.kind", "kind")
    .orderBy("s.at").addOrderBy("s.id");
  if ("month" in scope) qb.where(`s.uploadId IN ${monthUploadIds(qb, scope.month)}`);
  else qb.where("s.at < :before", { before: scope.before });
  const out: EventsByEmployee = new Map();
  for (const r of await qb.getRawMany<{ employeeId: string; at: string; kind: "in" | "out" }>()) {
    let list = out.get(r.employeeId);
    if (!list) out.set(r.employeeId, (list = []));
    list.push({ at: parseTs(r.at), kind: r.kind });
  }
  return out;
}

/** Sub-select of the movement upload(s) for a month; params are bound onto the outer query. */
export function monthUploadIds(qb: { setParameter(k: string, v: unknown): unknown }, month: DateStr) {
  qb.setParameter("uploadMonth", month);
  return "(SELECT id FROM uploads WHERE kind = 'movement' AND month = :uploadMonth)";
}

export async function loadRoster(m: EntityManager) {
  const rows = await m.getRepository(RosterEmployee).find();
  const roster = new Map<string, RosterEntry>();
  const unresolved = new Set<string>();
  for (const r of rows) {
    roster.set(r.employeeId, {
      employeeId: r.employeeId, name: r.name, email: r.email, department: r.department,
      managerName: r.managerName, managerEmail: r.managerEmail,
      shift: r.shiftLabel == null ? null : { label: r.shiftLabel, startMinutes: r.shiftStartMin!, endMinutes: r.shiftEndMin! },
    });
    if (r.managerName && !r.managerEmail) unresolved.add(r.managerName);
  }
  return { roster, unresolvedManagers: [...unresolved].sort() };
}

/** Recompute attendance_visits.transport_opt_in: NA for general-shift (ineligible) staff, else Yes/No by transport sheet. */
export async function refreshTransportOptIn(m: EntityManager, month?: string) {
  const qb = m.createQueryBuilder().update(AttendanceVisit).set({
    transportOptIn: () => `CASE
      WHEN eligibility = 'No' THEN 'NA'
      WHEN EXISTS (SELECT 1 FROM transport_employees t WHERE t.employee_id = attendance_visits.employee_id) THEN 'Yes'
      ELSE 'No' END`,
  });
  if (month) qb.where("month = :month", { month });
  await qb.execute();
}

