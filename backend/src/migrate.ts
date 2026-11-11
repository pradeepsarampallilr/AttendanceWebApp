/**
 * Applies any database migrations that have not run yet, then exits (the server also does this on start).
 */
import { AppDataSource, migrate } from "./db.js";

await migrate();
await AppDataSource.destroy();
console.log("Migrations are up to date.");
