/**
 * Who may do what. HR and superadmin see and change everything; a manager sees themselves and everyone below them
 * in the reporting chain; an employee sees only their own data.
 */
import type { RequestHandler } from "express";
import { AppDataSource } from "../db.js";
import type { AppRole } from "../models/index.js";

const ROLES: readonly AppRole[] = ["superadmin", "hr", "manager", "employee"];
export const isRole = (v: unknown): v is AppRole => ROLES.includes(v as AppRole);
export const canWrite = (role?: AppRole) => role === "superadmin" || role === "hr";

export const requireWrite: RequestHandler = (req, res, next) =>
  canWrite(req.userRole) ? next() : void res.status(403).json({ error: "HR access required" });

export interface TeamLine { managerId: string; managerName: string; employeeId: string; depth: number }

/**
 * Who reports to whom, read straight from the roster: a person's manager is the roster row whose email is their manager email,
 * else the one row with their manager name (a name shared by several people cannot be resolved).
 * Returns each person's direct reports and a lookup of the people.
 */
async function rosterTree() {
  const rows: { employee_id: string; name: string; email: string; manager_name: string; manager_email: string }[] = await AppDataSource.query(
    "SELECT employee_id, name, email, manager_name, manager_email FROM roster_employees");
  const key = (s: string) => s.trim().toLowerCase();
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const r of rows) {
    if (key(r.email)) byEmail.set(key(r.email), r.employee_id);
    byName.set(key(r.name), byName.has(key(r.name)) ? null : r.employee_id);
  }
  const people = new Map(rows.map((r) => [r.employee_id, r]));
  const children = new Map<string, string[]>();
  for (const r of rows) {
    const boss = (key(r.manager_email) && byEmail.get(key(r.manager_email))) || (key(r.manager_name) && byName.get(key(r.manager_name)));
    if (boss && boss !== r.employee_id) children.set(boss, [...(children.get(boss) ?? []), r.employee_id]);
  }
  return { people, children };
}

/** Everyone below `root` with their level (1 = direct report), breadth first; guards against manager loops. */
function descendants(children: Map<string, string[]>, root: string) {
  const depth = new Map<string, number>();
  const queue: [string, number][] = (children.get(root) ?? []).map((id) => [id, 1]);
  while (queue.length) {
    const [id, d] = queue.shift()!;
    if (id === root || depth.has(id)) continue;
    depth.set(id, d);
    for (const c of children.get(id) ?? []) queue.push([c, d + 1]);
  }
  return depth;
}

/** The signed-in person's roster employee id: the one on their login, else the roster row with their email. */
export async function myEmployeeId(req: { userEmployeeId?: string | null; userEmail?: string }): Promise<string | null> {
  if (req.userEmployeeId) return req.userEmployeeId;
  if (!req.userEmail) return null;
  const rows: { employee_id: string }[] = await AppDataSource.query(
    "SELECT employee_id FROM roster_employees WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1", [req.userEmail]);
  return rows[0]?.employee_id ?? null;
}

type Caller = { userRole?: AppRole; userEmployeeId?: string | null; userEmail?: string };

/** Employee ids the caller may view; null means everyone. */
export async function visibleEmployees(req: Caller): Promise<string[] | null> {
  if (canWrite(req.userRole)) return null;
  const me = await myEmployeeId(req);
  if (!me) return [];
  if (req.userRole !== "manager") return [me];
  const { children } = await rosterTree();
  return [me, ...descendants(children, me).keys()];
}

/** Reporting lines (manager above employee at any depth) among the people the caller may view. */
export async function teamLines(req: Caller): Promise<TeamLine[]> {
  const ids = await visibleEmployees(req);
  const allowed = ids && new Set(ids);
  const { people, children } = await rosterTree();
  const out: TeamLine[] = [];
  for (const managerId of children.keys()) {
    if (allowed && !allowed.has(managerId)) continue;
    for (const [employeeId, depth] of descendants(children, managerId)) {
      if (allowed && !allowed.has(employeeId)) continue;
      out.push({ managerId, managerName: people.get(managerId)!.name, employeeId, depth });
    }
  }
  return out;
}
