import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "../node_modules/@types/pg";

// Unset DB_USER / DB_PASSWORD fall back to pg's defaults (current OS user, trust/peer auth).
export const pool = new pg.Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "attendance",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Return DATE columns as 'YYYY-MM-DD' strings and NUMERIC as numbers (not Dates / strings).
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1114, (v) => v.replace(" ", "T")); // naive timestamp, keep wall-clock

export async function migrate() {
  await pool.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
}
