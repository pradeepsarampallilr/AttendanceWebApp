/** Creates every database table the app uses. */
import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1700000000000 implements MigrationInterface {
  name = "InitialSchema1700000000000";

  async up(q: QueryRunner) {
    await q.query(`
-- Record of each uploaded file. month is the first day of the month (movement uploads only).
CREATE TABLE uploads (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('movement', 'roster', 'transport', 'leaves')),
  filename    TEXT NOT NULL,
  month       DATE,
  row_count   INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'uploaded',
  uploaded_by TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX uploads_uploaded_at_idx ON uploads (uploaded_at DESC);

-- The latest roster upload replaces the whole table.
CREATE TABLE roster_employees (
  employee_id     TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL DEFAULT '',
  department      TEXT NOT NULL DEFAULT '',
  manager_name    TEXT NOT NULL DEFAULT '',
  manager_email   TEXT NOT NULL DEFAULT '',
  shift_label     TEXT,                    -- NULL = no shift
  shift_start_min INT,
  shift_end_min   INT,
  upload_id       INT REFERENCES uploads(id)
);

-- Every manager above an employee, at any depth (1 = direct report). Rebuilt on each roster upload.
CREATE TABLE reporting_lines (
  manager_id  TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  depth       INT  NOT NULL,
  CONSTRAINT reporting_lines_pkey PRIMARY KEY (manager_id, employee_id)
);
CREATE INDEX reporting_lines_employee_idx ON reporting_lines (employee_id);

-- Raw door swipes. Wall-clock times, so timestamp WITHOUT time zone. Duplicates must survive, so there is no natural key.
CREATE TABLE swipe_events (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   TEXT NOT NULL,
  employee_name TEXT,
  at            TIMESTAMP NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  upload_id     INT REFERENCES uploads(id) ON DELETE CASCADE
);
CREATE INDEX swipe_events_at_idx ON swipe_events (at);

-- Computed output: one row per visit.
CREATE TABLE attendance_visits (
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
  daily_total_hours  NUMERIC(6,2),        -- repeated on every visit of the day; see is_first_row
  is_first_row       BOOLEAN NOT NULL,
  rows_in_day_group  INT NOT NULL,
  shift_label        TEXT NOT NULL,
  eligibility        TEXT NOT NULL CHECK (eligibility IN ('Yes','No','NA')),
  compliant          TEXT NOT NULL CHECK (compliant IN ('Yes','No','NA')),
  week_compliant     TEXT NOT NULL CHECK (week_compliant IN ('Yes','No','NA')),
  month_compliant    TEXT NOT NULL CHECK (month_compliant IN ('Yes','No','NA')),
  transport_opt_in   TEXT NOT NULL DEFAULT 'NA' CHECK (transport_opt_in IN ('Yes','No','NA'))
);
CREATE INDEX attendance_visits_month_emp_idx ON attendance_visits (month, employee_id, work_date);

-- One row per employee per calendar week of a processed month.
CREATE TABLE weekly_compliance (
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

CREATE TABLE anchor_day_attendance (
  month         DATE NOT NULL,
  employee_id   TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  anchor_date   DATE NOT NULL,
  attended      BOOLEAN NOT NULL,
  CONSTRAINT anchor_day_attendance_pkey PRIMARY KEY (month, employee_id, anchor_date)
);

CREATE TABLE audit_issues (
  id          BIGSERIAL PRIMARY KEY,
  month       DATE NOT NULL,
  employee_id TEXT NOT NULL,
  issue_type  TEXT NOT NULL,
  at          TIMESTAMP NOT NULL,
  detail      TEXT NOT NULL
);
CREATE INDEX audit_issues_month_idx ON audit_issues (month);

-- Hand-made hour changes, kept apart from computed rows so reprocessing never erases them.
CREATE TABLE manual_adjustments (
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

-- Hand-made changes to anchor-day attendance, also kept apart from computed rows.
CREATE TABLE anchor_day_adjustments (
  month       DATE NOT NULL,
  employee_id TEXT NOT NULL,
  anchor_date DATE NOT NULL,
  attended    BOOLEAN NOT NULL,
  CONSTRAINT anchor_day_adjustments_pkey PRIMARY KEY (employee_id, anchor_date)
);

-- One row per date; month is the first day of its month.
CREATE TABLE public_holidays (
  holiday_date DATE PRIMARY KEY,
  month        DATE NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX public_holidays_month_idx ON public_holidays (month);

CREATE TABLE leaves (
  id                BIGSERIAL NOT NULL,
  employee_id       TEXT NOT NULL,
  employee_name     TEXT NOT NULL DEFAULT '',
  leave_date        DATE NOT NULL,
  leave_description TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leaves_pkey PRIMARY KEY (id),
  CONSTRAINT leaves_employee_id_leave_date_key UNIQUE (employee_id, leave_date)
);
CREATE INDEX leaves_date_idx ON leaves (leave_date);

-- The latest transport upload replaces the whole table.
CREATE TABLE transport_employees (
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

-- People allowed to use the app. A sign-in matches a row on email OR username (the Okta login).
CREATE TABLE app_users (
  email       TEXT NOT NULL,
  username    TEXT,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  employee_id TEXT,                        -- roster employee this login belongs to (managers and employees)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_users_pkey PRIMARY KEY (email),
  CONSTRAINT app_users_role_check CHECK (role IN ('superadmin', 'hr', 'manager', 'employee')),
  CONSTRAINT app_users_email_lower_check CHECK (email = lower(email)),
  CONSTRAINT app_users_username_lower_check CHECK (username IS NULL OR username = lower(username))
);
CREATE UNIQUE INDEX app_users_username_key ON app_users (username) WHERE username IS NOT NULL;

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_email TEXT NOT NULL,
  actor_role  TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_logs_at_idx ON audit_logs (at DESC);

-- Configurable rule settings. A missing row means the built-in default applies.
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      INT  NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
  }

  async down(q: QueryRunner) {
    await q.query(`
      DROP TABLE IF EXISTS app_settings, audit_logs, app_users, transport_employees, leaves, public_holidays,
        anchor_day_adjustments, manual_adjustments, audit_issues, anchor_day_attendance, weekly_compliance,
        attendance_visits, swipe_events, reporting_lines, roster_employees, uploads CASCADE`);
  }
}
