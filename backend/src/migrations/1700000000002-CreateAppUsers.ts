/** Adds the app users table and fills it with managers from the existing roster. */
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAppUsers1700000000002 implements MigrationInterface {
  name = "CreateAppUsers1700000000002";

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        email      TEXT NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        role       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT app_users_pkey PRIMARY KEY (email),
        CONSTRAINT app_users_role_check CHECK (role IN ('superadmin', 'hr', 'manager')),
        CONSTRAINT app_users_email_lower_check CHECK (email = lower(email))
      );
      -- Backfill managers from an already-uploaded roster.
      INSERT INTO app_users (email, name, role)
      SELECT lower(btrim(manager_email)), max(manager_name), 'manager'
      FROM roster_employees WHERE btrim(manager_email) LIKE '%_@_%'
      GROUP BY lower(btrim(manager_email))
      ON CONFLICT DO NOTHING`);
  }

  async down(q: QueryRunner) {
    await q.query("DROP TABLE IF EXISTS app_users");
  }
}
