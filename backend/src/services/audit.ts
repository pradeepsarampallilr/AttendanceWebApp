/** Writes one line to the audit log: who did what. */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../db.js";
import { AuditLog } from "../models/index.js";

export const logAction = (
  req: { userEmail?: string; userRole?: string }, action: string, entity: string, detail = "", m: EntityManager = AppDataSource.manager,
) => m.insert(AuditLog, { actorEmail: req.userEmail ?? "anonymous", actorRole: req.userRole ?? "none", action, entity, detail });
