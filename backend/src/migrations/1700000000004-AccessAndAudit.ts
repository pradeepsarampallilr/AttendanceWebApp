/** Adds the employee role, the active flag, reporting lines, the audit log and holiday descriptions. */
import type { MigrationInterface, QueryRunner } from "typeorm";

export class AccessAndAudit1700000000004 implements MigrationInterface {
  name = "AccessAndAudit1700000000004";

  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
      ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('superadmin', 'hr', 'manager', 'employee'));
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS employee_id TEXT;

      -- Every manager above an employee, at any depth (1 = direct report). Rebuilt on each roster upload.
      CREATE TABLE IF NOT EXISTS reporting_lines (
        manager_id  TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        depth       INT  NOT NULL,
        CONSTRAINT reporting_lines_pkey PRIMARY KEY (manager_id, employee_id)
      );
      CREATE INDEX IF NOT EXISTS reporting_lines_employee_idx ON reporting_lines (employee_id);

      -- One line per employee per calendar week of a processed month (the weekly compliance result).
      CREATE TABLE IF NOT EXISTS weekly_compliance (
        month         DATE NOT NULL,
        employee_id   TEXT NOT NULL,
        employee_name TEXT NOT NULL,
        department    TEXT NOT NULL DEFAULT '',
        week_start    DATE NOT NULL,
        week          INT  NOT NULL,
        required      INT  NOT NULL,
        attended      INT  NOT NULL,
        anchor        TEXT NOT NULL CHECK (anchor IN ('present', 'absent', 'off')),
        status        TEXT NOT NULL CHECK (status IN ('Yes', 'No', 'NA')),
        CONSTRAINT weekly_compliance_pkey PRIMARY KEY (month, employee_id, week_start)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id          BIGSERIAL PRIMARY KEY,
        at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        actor_email TEXT NOT NULL,
        actor_role  TEXT NOT NULL,
        action      TEXT NOT NULL,
        entity      TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS audit_logs_at_idx ON audit_logs (at DESC);

      ALTER TABLE public_holidays ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

      ALTER TABLE uploads ADD COLUMN IF NOT EXISTS uploaded_by TEXT NOT NULL DEFAULT '';
      ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_kind_check;
      ALTER TABLE uploads ADD CONSTRAINT uploads_kind_check CHECK (kind IN ('movement', 'roster', 'transport', 'leaves'));
      CREATE INDEX IF NOT EXISTS uploads_uploaded_at_idx ON uploads (uploaded_at DESC);

      -- Staff without a roster shift are 'NA' (not evaluated).
      ALTER TABLE attendance_visits DROP CONSTRAINT IF EXISTS attendance_visits_eligibility_check;
      ALTER TABLE attendance_visits ADD CONSTRAINT attendance_visits_eligibility_check CHECK (eligibility IN ('Yes','No','NA'));

      ALTER TABLE IF EXISTS wednesday_overrides RENAME TO wednesday_adjustments;
      ALTER TABLE wednesday_adjustments RENAME CONSTRAINT wednesday_overrides_pkey TO wednesday_adjustments_pkey`);
  }

  async down(q: QueryRunner) {
    await q.query(`
      ALTER TABLE wednesday_adjustments RENAME CONSTRAINT wednesday_adjustments_pkey TO wednesday_overrides_pkey;
      ALTER TABLE wednesday_adjustments RENAME TO wednesday_overrides;
      DROP TABLE IF EXISTS audit_logs, reporting_lines, weekly_compliance;
      ALTER TABLE public_holidays DROP COLUMN IF EXISTS description;
      ALTER TABLE uploads DROP COLUMN IF EXISTS uploaded_by;
      ALTER TABLE app_users DROP COLUMN IF EXISTS is_active, DROP COLUMN IF EXISTS employee_id`);
  }
}
