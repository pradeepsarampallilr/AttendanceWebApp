/** Gives every employee already in the stored roster a login, as a roster upload now does. Existing rows keep their role. */
import type { MigrationInterface, QueryRunner } from "typeorm";

export class BackfillRosterUsers1700000000006 implements MigrationInterface {
  name = "BackfillRosterUsers1700000000006";

  async up(q: QueryRunner) {
    await q.query(`
      INSERT INTO app_users (email, name, role, employee_id)
      SELECT DISTINCT ON (lower(trim(r.email)))
        lower(trim(r.email)), r.name,
        CASE WHEN EXISTS (SELECT 1 FROM reporting_lines l WHERE l.manager_id = r.employee_id) THEN 'manager' ELSE 'employee' END,
        r.employee_id
      FROM roster_employees r
      WHERE trim(r.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
      ORDER BY lower(trim(r.email)), r.employee_id
      ON CONFLICT (email) DO UPDATE SET employee_id = EXCLUDED.employee_id`);
  }

  async down() {
    // Nothing to undo: the rows are indistinguishable from ones a roster upload creates.
  }
}
