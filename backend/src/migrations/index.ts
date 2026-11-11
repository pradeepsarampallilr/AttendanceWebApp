/** Lists all database migrations in the order they run. */
import { InitialSchema1700000000000 } from "./1700000000000-InitialSchema.js";
import { CreateLeaves1700000000001 } from "./1700000000001-CreateLeaves.js";
import { CreateAppUsers1700000000002 } from "./1700000000002-CreateAppUsers.js";
import { AddAppUserUsername1700000000003 } from "./1700000000003-AddAppUserUsername.js";
import { AccessAndAudit1700000000004 } from "./1700000000004-AccessAndAudit.js";
import { CreateAppSettings1700000000005 } from "./1700000000005-CreateAppSettings.js";
import { BackfillRosterUsers1700000000006 } from "./1700000000006-BackfillRosterUsers.js";

/** Append new migrations here, in order. */
export const migrations = [InitialSchema1700000000000, CreateLeaves1700000000001, CreateAppUsers1700000000002, AddAppUserUsername1700000000003,
  AccessAndAudit1700000000004, CreateAppSettings1700000000005, BackfillRosterUsers1700000000006];
