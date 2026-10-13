/** Lets the superadmin see, add and remove HR users who can use the app. */
import { Router, type RequestHandler } from "express";
import { AppDataSource } from "../db.js";
import { AppUser } from "../models/index.js";
import { ValidationError } from "../io/tables.js";
import { NotFoundError } from "../services/process.js";
import { isEmail, normEmail } from "../services/users.js";

export const adminRouter = Router();

const superadminOnly: RequestHandler = (req, res, next) => process.env.OKTA_ISSUER && req.userRole !== "superadmin" ? void res.status(403).json({ error: "Superadmin only" }) : next();
adminRouter.use(superadminOnly);

adminRouter.get("/users", async (_req, res) => {
  res.json(await AppDataSource.getRepository(AppUser).find({ order: { role: "ASC", email: "ASC" } }));
});

adminRouter.post("/users", async (req, res) => {
  const email = normEmail(String(req.body?.email ?? ""));
  if (!isEmail(email)) throw new ValidationError("Enter a valid email address");
  const username = normEmail(String(req.body?.username ?? "")) || null;
  if (username && /\s/.test(username)) throw new ValidationError("Username must not contain spaces");
  const repo = AppDataSource.getRepository(AppUser);
  const taken = [email, username].filter((v): v is string => !!v);
  const existing = await repo.createQueryBuilder("u").where("u.email IN (:...taken) OR u.username IN (:...taken)", { taken }).getOne();
  if (existing) throw new ValidationError(`${existing.email} already has access as ${existing.role}`);
  res.status(201).json(await repo.save(repo.create({ email, username, name: String(req.body?.name ?? "").trim(), role: "hr" })));
});

adminRouter.delete("/users/:email", async (req, res) => {
  const repo = AppDataSource.getRepository(AppUser);
  const user = await repo.findOneBy({ email: normEmail(req.params.email) });
  if (!user || user.role !== "hr") throw new NotFoundError("HR user not found (managers follow the roster)");
  await repo.remove(user);
  res.status(204).end();
});
