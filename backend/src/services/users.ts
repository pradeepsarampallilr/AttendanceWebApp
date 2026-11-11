/**
 * Looks up and keeps the list of app users and their roles (superadmin, hr, manager, employee).
 * Also tidies and checks email addresses.
 */
import type { EntityManager } from "typeorm";
import { AppUser, type AppRole } from "../models/index.js";

export const normEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/**
 * Gives every roster employee with an email a login: 'manager' if anyone reports to them, else 'employee'.
 * HR / superadmin rows keep their role, and every row keeps its active flag. People who left the roster lose access.
 */
export async function syncRosterUsers(
  m: EntityManager, roster: { employeeId: string; name: string; email: string }[], managerIds: Set<string>,
) {
  const people = new Map<string, { email: string; name: string; role: AppRole; employeeId: string }>();
  for (const r of roster) {
    const email = normEmail(r.email);
    if (isEmail(email) && !people.has(email)) {
      people.set(email, { email, name: r.name, role: managerIds.has(r.employeeId) ? "manager" : "employee", employeeId: r.employeeId });
    }
  }
  await m.query(
    `DELETE FROM app_users WHERE role IN ('manager', 'employee') AND NOT (email = ANY($1::text[]))`, [[...people.keys()]]);
  if (!people.size) return;
  await m.query(
    `INSERT INTO app_users (email, name, role, employee_id)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
     ON CONFLICT (email) DO UPDATE SET employee_id = EXCLUDED.employee_id,
       role = CASE WHEN app_users.role IN ('manager', 'employee') THEN EXCLUDED.role ELSE app_users.role END`,
    [[...people.values()].map((p) => p.email), [...people.values()].map((p) => p.name),
      [...people.values()].map((p) => p.role), [...people.values()].map((p) => p.employeeId)]);
}

const RANK: Record<AppRole, number> = { superadmin: 0, hr: 1, manager: 2, employee: 3 };

/**
 * The app_users row whose email OR username equals ANY of the identifiers taken from the Okta token
 * (login, email claim, ...). If several rows match, the highest role wins. Null = not allowed.
 */
export async function findUser(m: EntityManager, ids: string[]): Promise<AppUser | null> {
  if (!ids.length) return null;
  const rows = await m.createQueryBuilder(AppUser, "u")
    .where("u.email IN (:...ids) OR u.username IN (:...ids)", { ids })
    .getMany();
  return rows.sort((a, b) => RANK[a.role] - RANK[b.role])[0] ?? null;
}
