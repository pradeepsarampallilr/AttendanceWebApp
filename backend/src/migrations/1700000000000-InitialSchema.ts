import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Baseline: the schema as it stood before TypeORM (formerly db/schema.sql). Every statement is idempotent so
 * databases created by the old script adopt TypeORM's migration history without being touched.
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = "InitialSchema1700000000000";

  async up(q: QueryRunner) {
    await q.query(`
-- Attendance engine schema. Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS uploads (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('movement', 'roster')),
  filename    TEXT NOT NULL,
  month       DATE,                       -- first day of month (movement uploads)
  row_count   INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'uploaded',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing databases carry the old two-value check; widen it to allow transport uploads.
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_kind_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_kind_check CHECK (kind IN ('movement', 'roster', 'transport'));

CREATE TABLE IF NOT EXISTS roster_employees (
  employee_id    TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL DEFAULT '',
  department     TEXT NOT NULL DEFAULT '',
  manager_name   TEXT NOT NULL DEFAULT '',
  manager_email  TEXT NOT NULL DEFAULT '',
  shift_label    TEXT,                    -- NULL = unassigned
  shift_start_min INT,
  shift_end_min   INT,
  upload_id      INT REFERENCES uploads(id)
);

-- Raw flattened swipes. Wall-clock times, so timestamp WITHOUT time zone.
CREATE TABLE IF NOT EXISTS swipe_events (
  employee_id TEXT NOT NULL,
  employee_name TEXT,
  at          TIMESTAMP NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  upload_id   INT REFERENCES uploads(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, at, kind)
);
CREATE INDEX IF NOT EXISTS swipe_events_at_idx ON swipe_events (at);
-- Duplicate swipes in the source must survive (the engine keeps them), so no natural key:
-- swap the original composite PK for a surrogate id (no-op once migrated).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'swipe_events' AND column_name = 'id') THEN
    ALTER TABLE swipe_events DROP CONSTRAINT IF EXISTS swipe_events_pkey;
    ALTER TABLE swipe_events ADD COLUMN id BIGSERIAL PRIMARY KEY;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swipe_events_pkey' AND conrelid = 'swipe_events'::regclass) THEN
    -- The old schema.sql dropped this key on every start; restore it.
    ALTER TABLE swipe_events ADD CONSTRAINT swipe_events_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- Computed output: one row per visit, same columns as the Attendance sheet.
CREATE TABLE IF NOT EXISTS attendance_visits (
  id                 BIGSERIAL PRIMARY KEY,
  month              DATE NOT NULL,
  employee_id        TEXT NOT NULL,
  employee_name      TEXT NOT NULL,
  email              TEXT NOT NULL DEFAULT '',
  department         TEXT NOT NULL DEFAULT '',
  manager_name       TEXT NOT NULL DEFAULT 'NA',
  manager_email      TEXT NOT NULL DEFAULT 'NA',
  week               INT NOT NULL,
  week_attended_days INT NOT NULL,
  work_date          DATE NOT NULL,
  check_in           TIMESTAMP NOT NULL,
  check_out          TIMESTAMP,
  visit_hours        NUMERIC(6,2),
  daily_total_hours  NUMERIC(6,2),        -- repeated on every leg; see is_first_row
  is_first_row       BOOLEAN NOT NULL,
  rows_in_day_group  INT NOT NULL,
  shift_label        TEXT NOT NULL,
  eligibility        TEXT NOT NULL CHECK (eligibility IN ('Yes','No')),
  compliant          TEXT NOT NULL CHECK (compliant IN ('Yes','No','NA')),
  week_compliant     TEXT NOT NULL CHECK (week_compliant IN ('Yes','No','NA')),
  month_compliant    TEXT NOT NULL CHECK (month_compliant IN ('Yes','No','NA'))
);
CREATE INDEX IF NOT EXISTS attendance_visits_month_emp_idx ON attendance_visits (month, employee_id, work_date);

CREATE TABLE IF NOT EXISTS wednesday_attendance (
  month       DATE NOT NULL,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  wednesday   DATE NOT NULL,
  attended    BOOLEAN NOT NULL,
  PRIMARY KEY (month, employee_id, wednesday)
);

CREATE TABLE IF NOT EXISTS audit_issues (
  id          BIGSERIAL PRIMARY KEY,
  month       DATE NOT NULL,
  employee_id TEXT NOT NULL,
  issue_type  TEXT NOT NULL,
  at          TIMESTAMP NOT NULL,
  detail      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_issues_month_idx ON audit_issues (month);

-- Dashboard add/edit/delete of daily hours. Kept apart from computed rows so a re-run never erases them.
CREATE TABLE IF NOT EXISTS manual_adjustments (
  id          SERIAL PRIMARY KEY,
  month       DATE NOT NULL,
  employee_id TEXT NOT NULL,
  work_date   DATE NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('add', 'edit', 'delete')),
  hours       NUMERIC(6,2),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS wednesday_overrides (
  month DATE NOT NULL, employee_id TEXT NOT NULL, wednesday DATE NOT NULL, attended BOOLEAN NOT NULL,
  PRIMARY KEY (employee_id, wednesday)
);

-- Public holidays picked on the Upload page's calendar. One row per date; month is the first day of its month.
CREATE TABLE IF NOT EXISTS public_holidays (
  holiday_date DATE PRIMARY KEY,
  month        DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_holidays_month_idx ON public_holidays (month);

-- Transport details sheet; the latest upload replaces the whole table.
CREATE TABLE IF NOT EXISTS transport_employees (
  employee_id    TEXT PRIMARY KEY,
  department     TEXT NOT NULL DEFAULT '',
  full_name      TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  business_title TEXT NOT NULL DEFAULT '',
  contact_no     TEXT NOT NULL DEFAULT '',
  gender         TEXT NOT NULL DEFAULT '',
  manager_name   TEXT NOT NULL DEFAULT '',
  manager_email  TEXT NOT NULL DEFAULT '',
  working_days   TEXT NOT NULL DEFAULT '',
  shift          TEXT NOT NULL DEFAULT '',
  address_line1  TEXT NOT NULL DEFAULT '',
  address_line2  TEXT NOT NULL DEFAULT '',
  city           TEXT NOT NULL DEFAULT '',
  postal_code    TEXT NOT NULL DEFAULT '',
  upload_id      INT REFERENCES uploads(id)
);

-- 'NA' = general shift (not eligible); otherwise 'Yes' if listed in transport_employees, else 'No'.
ALTER TABLE attendance_visits ADD COLUMN IF NOT EXISTS transport_opt_in TEXT NOT NULL DEFAULT 'NA'
  CHECK (transport_opt_in IN ('Yes','No','NA'));
`);
  }

  async down(q: QueryRunner) {
    await q.query(`
      DROP TABLE IF EXISTS transport_employees, public_holidays, wednesday_overrides, manual_adjustments,
        audit_issues, wednesday_attendance, attendance_visits, swipe_events, roster_employees, uploads CASCADE`);
  }
}
