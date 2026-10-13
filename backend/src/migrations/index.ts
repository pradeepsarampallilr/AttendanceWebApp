/** Lists all database migrations in the order they run. */
import { InitialSchema1700000000000 } from "./1700000000000-InitialSchema.js";
import { CreateLeaves1700000000001 } from "./1700000000001-CreateLeaves.js";
import { CreateAppUsers1700000000002 } from "./1700000000002-CreateAppUsers.js";
import { AddAppUserUsername1700000000003 } from "./1700000000003-AddAppUserUsername.js";

/** Append new migrations here, in order. */
export const migrations = [InitialSchema1700000000000, CreateLeaves1700000000001, CreateAppUsers1700000000002, AddAppUserUsername1700000000003];
