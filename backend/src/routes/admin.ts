/** HR and superadmin: manage who can use the app (roles, active / deactivated) and read the audit log. */
import { Router } from "express";
import { AppDataSource } from "../db.js";
import { AppUser, AuditLog, type AppRole } from "../models/index.js";
import { ValidationError } from "../io/tables.js";
import { isRole, requireWrite } from "../services/access.js";
import { logAction } from "../services/audit.js";
import { NotFoundError } from "../services/process.js";
import { listSettings, saveSettings } from "../services/settings.js";
import { escapeLike } from "../services/store.js";
import { pageParams } from "../services/paging.js";
import { cleanText } from "../services/text.js";
import { isEmail, normEmail } from "../services/users.js";

export const adminRouter = Router();
adminRouter.use(requireWrite);

const users = () => AppDataSource.getRepository(AppUser);
const assertMayTouch = (actor: AppRole | undefined, target: AppRole) => {
  if (target === "superadmin" && actor !== "superadmin") throw new ValidationError("Only a superadmin can manage superadmin users");
};

/** ?q= matches name / email / username, ?role= filters, paged with page / pageSize. */
adminRouter.get("/users", async (req, res) => {
  const { page: p, pageSize } = pageParams(req.query, 20);
  const qb = users().createQueryBuilder("u").orderBy("u.role", "ASC").addOrderBy("u.email", "ASC").skip((p - 1) * pageSize).take(pageSize);
  const q = escapeLike(req.query.q);
  if (q) qb.andWhere("(u.email ILIKE :q OR u.name ILIKE :q OR u.username ILIKE :q)", { q: `%${q}%` });
  if (isRole(req.query.role)) qb.andWhere("u.role = :role", { role: req.query.role });
  const [items, total] = await qb.getManyAndCount();
  res.json({ items, total, page: p, pageSize });
});

/** Add an HR user (or, for a superadmin, a superadmin). Managers and employees come from the roster. */
adminRouter.post("/users", async (req, res) => {
  const email = normEmail(cleanText(req.body?.email, 400));
  if (!isEmail(email)) throw new ValidationError("Enter a valid email address");
  const role: AppRole = req.body?.role === "superadmin" ? "superadmin" : "hr";
  assertMayTouch(req.userRole, role);
  const username = normEmail(cleanText(req.body?.username, 100)) || null;
  if (username && /\s/.test(username)) throw new ValidationError("Username must not contain spaces");
  const taken = [email, username].filter((v): v is string => !!v);
  const existing = await users().createQueryBuilder("u").where("u.email IN (:...taken) OR u.username IN (:...taken)", { taken }).getOne();
  if (existing) throw new ValidationError(`${existing.email} already has access as ${existing.role}`);
  const saved = await users().save(users().create({ email, username, name: cleanText(req.body?.name, 200), role }));
  await logAction(req, "add user", "user", `${email} as ${role}`);
  res.status(201).json(saved);
});

/** Activate / deactivate a user, or change their role: {isActive?: boolean, role?: AppRole}. */
adminRouter.patch("/users/:email", async (req, res) => {
  const user = await users().findOneBy({ email: normEmail(req.params.email) });
  if (!user) throw new NotFoundError("User not found");
  assertMayTouch(req.userRole, user.role);
  const { isActive, role } = req.body ?? {};
  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") throw new ValidationError("isActive must be true or false");
    if (!isActive && user.email === req.userEmail) throw new ValidationError("You cannot deactivate your own account");
    user.isActive = isActive;
  }
  if (role !== undefined) {
    if (!isRole(role)) throw new ValidationError("Unknown role");
    assertMayTouch(req.userRole, role);
    if (user.email === req.userEmail && role !== user.role) throw new ValidationError("You cannot change your own role");
    user.role = role;
  }
  await users().save(user);
  await logAction(req, "update user", "user", `${user.email}: ${isActive === undefined ? "" : isActive ? "activated " : "deactivated "}${role ? `role ${role}` : ""}`.trim());
  res.json(user);
});

/** Remove a manually added (HR / superadmin) user. Roster-based users are deactivated instead. */
adminRouter.delete("/users/:email", async (req, res) => {
  const user = await users().findOneBy({ email: normEmail(req.params.email) });
  if (!user || (user.role !== "hr" && user.role !== "superadmin")) throw new NotFoundError("HR user not found (managers and employees follow the roster; deactivate them instead)");
  assertMayTouch(req.userRole, user.role);
  if (user.email === req.userEmail) throw new ValidationError("You cannot remove your own account");
  await users().remove(user);
  await logAction(req, "remove user", "user", user.email);
  res.status(204).end();
});

/** Who did what, newest first: ?q= searches actor / action / detail. */
adminRouter.get("/audit-logs", async (req, res) => {
  const { page: p, pageSize } = pageParams(req.query, 20);
  const qb = AppDataSource.getRepository(AuditLog).createQueryBuilder("a").orderBy("a.id", "DESC").skip((p - 1) * pageSize).take(pageSize);
  const q = escapeLike(req.query.q);
  if (q) qb.where("(a.actorEmail ILIKE :q OR a.action ILIKE :q OR a.detail ILIKE :q OR a.entity ILIKE :q)", { q: `%${q}%` });
  const [items, total] = await qb.getManyAndCount();
  res.json({ items, total, page: p, pageSize });
});

/** The rule settings with their defaults and limits. */
adminRouter.get("/settings", (_req, res) => void res.json(listSettings()));

/** Save changed settings: {compliantMinHours?: number, ...}. Already processed months keep their results until processed again. */
adminRouter.put("/settings", async (req, res) => {
  const changes = await saveSettings(req.body ?? {}, req.userEmail ?? "anonymous");
  if (changes.length) await logAction(req, "update settings", "settings", changes.join("; "));
  res.json(listSettings());
});
