/**
 * Looks up and keeps the list of app users and their roles (superadmin, hr, manager).
 * Also tidies and checks email addresses.
 */
import type { EntityManager } from "typeorm";
import { AppUser, type AppRole } from "../models/index.js";

export const normEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Replace the 'manager' rows with the distinct manager emails of this roster. HR / superadmin rows are untouched and win on conflict. */
export async function syncManagers(m: EntityManager, roster: { managerName: string; managerEmail: string }[]) {
  const managers = new Map<string, string>();
  for (const r of roster) {
    const email = normEmail(r.managerEmail);
    if (isEmail(email) && !managers.has(email)) managers.set(email, r.managerName);
  }
  await m.delete(AppUser, { role: "manager" });
  await m.createQueryBuilder().insert().into(AppUser)
    .values([...managers].map(([email, name]) => ({ email, name, role: "manager" as AppRole, username: null })))
    .orIgnore().execute();
}

const RANK: Record<AppRole, number> = { superadmin: 0, hr: 1, manager: 2 };

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
