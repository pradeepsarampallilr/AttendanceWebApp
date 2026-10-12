import "reflect-metadata";
import "dotenv/config";
import pg from "pg";
import { DataSource } from "typeorm";
import { migrations } from "./migrations/index.js";
import { entities } from "./models/index.js";

// Return DATE columns as 'YYYY-MM-DD' strings and NUMERIC as numbers (not Dates / strings).
// TypeORM's postgres driver uses this same `pg` module, so the parsers apply to its raw results too.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1114, (v) => v.replace(" ", "T")); // naive timestamp, keep wall-clock

// Unset DB_USER / DB_PASSWORD fall back to pg's defaults (current OS user, trust/peer auth).
export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "attendance",
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  entities,
  migrations,
  synchronize: false, // schema changes go through migrations only
});

/** Connect (once) and apply any pending migrations. Run on every server start. */
export async function migrate() {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.runMigrations();
}
