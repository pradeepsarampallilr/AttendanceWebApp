import type pg from "../../node_modules/@types/pg/index.js";
import type { DateStr } from "../engine/core.js";
import type { EventsByEmployee, RosterEntry } from "../engine/types.js";

export const ts = (d: Date) => d.toISOString().slice(0, 19);
export const parseTs = (s: string) => new Date(s.slice(0, 19) + "Z");

export const monthStart = (year: number, month: number): DateStr => `${year}-${String(month).padStart(2, "0")}-01`;
export const nextMonthStart = (ms: DateStr): DateStr => {
  const [y, m] = ms.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : monthStart(y, m + 1);
};

export async function insertSwipeEvents(db: pg.PoolClient, uploadId: number, events: EventsByEmployee, names: Map<string, string>) {
  const ids: string[] = [], nm: (string | null)[] = [], at: string[] = [], kind: string[] = [];
  for (const [emp, list] of events) for (const e of list) {
    ids.push(emp); nm.push(names.get(emp) ?? null); at.push(ts(e.at)); kind.push(e.kind);
  }
  await db.query(
    `INSERT INTO swipe_events (employee_id, employee_name, at, kind, upload_id)
     SELECT u.id, u.nm, u.at::timestamp, u.kind, $5 FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS u(id, nm, at, kind)`, [ids, nm, at, kind, uploadId]);
  return ids.length;
}

export async function loadEvents(db: pg.Pool | pg.PoolClient, where: string, params: unknown[]): Promise<EventsByEmployee> {
  const { rows } = await db.query(`SELECT employee_id, at, kind FROM swipe_events WHERE ${where} ORDER BY at, id`, params);
  const out: EventsByEmployee = new Map();
  for (const r of rows) {
    let list = out.get(r.employee_id);
    if (!list) out.set(r.employee_id, (list = []));
    list.push({ at: parseTs(r.at), kind: r.kind });
  }
  return out;
}

export async function loadRoster(db: pg.Pool | pg.PoolClient) {
  const { rows } = await db.query("SELECT * FROM roster_employees");
  const roster = new Map<string, RosterEntry>();
  const unresolved = new Set<string>();
  for (const r of rows) {
    roster.set(r.employee_id, {
      employeeId: r.employee_id, name: r.name, email: r.email, department: r.department,
      managerName: r.manager_name, managerEmail: r.manager_email,
      shift: r.shift_label == null ? null : { label: r.shift_label, startMinutes: r.shift_start_min, endMinutes: r.shift_end_min },
    });
    if (r.manager_name && !r.manager_email) unresolved.add(r.manager_name);
  }
  return { roster, unresolvedManagers: [...unresolved].sort() };
}

/** Recompute attendance_visits.transport_opt_in: NA for general-shift (ineligible) staff, else Yes/No by transport sheet. */
export async function refreshTransportOptIn(db: pg.Pool | pg.PoolClient, month?: string) {
  await db.query(
    `UPDATE attendance_visits v SET transport_opt_in = CASE
       WHEN v.eligibility = 'No' THEN 'NA'
       WHEN EXISTS (SELECT 1 FROM transport_employees t WHERE t.employee_id = v.employee_id) THEN 'Yes'
       ELSE 'No' END
     WHERE $1::date IS NULL OR v.month = $1::date`, [month ?? null]);
}
