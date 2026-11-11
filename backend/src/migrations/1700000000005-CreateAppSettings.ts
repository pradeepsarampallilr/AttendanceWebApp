/** Adds the table that keeps the configurable rule settings. A missing row means the built-in default applies. */
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAppSettings1700000000005 implements MigrationInterface {
  name = "CreateAppSettings1700000000005";

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      INT  NOT NULL,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }

  async down(q: QueryRunner) {
    await q.query("DROP TABLE IF EXISTS app_settings");
  }
}
