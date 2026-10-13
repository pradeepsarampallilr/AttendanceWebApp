/**
 * Sets up the database connection and runs database updates (migrations).
 */
import "reflect-metadata";
import "dotenv/config";
import pg from "pg";
import { DataSource } from "typeorm";
import { migrations } from "./migrations/index.js";
import { entities } from "./models/index.js";


pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1114, (v) => v.replace(" ", "T")); // naive timestamp, keep wall-clock

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "attendance",
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  entities,
  migrations,
  synchronize: false, // schema does change util we run migrations, but we don't want TypeORM to auto-change it at runtime
});

export async function migrate() {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.runMigrations();
}
