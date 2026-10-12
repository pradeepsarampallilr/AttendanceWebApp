import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLeaves1700000000001 implements MigrationInterface {
  name = "CreateLeaves1700000000001";

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE IF NOT EXISTS leaves (
        id                BIGSERIAL NOT NULL,
        employee_id       TEXT NOT NULL,
        employee_name     TEXT NOT NULL DEFAULT '',
        leave_date        DATE NOT NULL,
        leave_description TEXT NOT NULL DEFAULT '',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT leaves_pkey PRIMARY KEY (id),
        CONSTRAINT leaves_employee_id_leave_date_key UNIQUE (employee_id, leave_date)
      );
      CREATE INDEX IF NOT EXISTS leaves_date_idx ON leaves (leave_date)`);
  }

  async down(q: QueryRunner) {
    await q.query("DROP TABLE IF EXISTS leaves");
  }
}
