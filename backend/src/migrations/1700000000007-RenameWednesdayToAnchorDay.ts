/** The anchor day is configurable, so the Wednesday tables and columns are renamed to anchor-day names (data is kept). */
import type { MigrationInterface, QueryRunner } from "typeorm";

export class RenameWednesdayToAnchorDay1700000000007 implements MigrationInterface {
  name = "RenameWednesdayToAnchorDay1700000000007";

  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE wednesday_attendance RENAME TO anchor_day_attendance;
      ALTER TABLE anchor_day_attendance RENAME COLUMN wednesday TO anchor_date;
      ALTER TABLE anchor_day_attendance RENAME CONSTRAINT wednesday_attendance_pkey TO anchor_day_attendance_pkey;
      ALTER TABLE wednesday_adjustments RENAME TO anchor_day_adjustments;
      ALTER TABLE anchor_day_adjustments RENAME COLUMN wednesday TO anchor_date;
      ALTER TABLE anchor_day_adjustments RENAME CONSTRAINT wednesday_adjustments_pkey TO anchor_day_adjustments_pkey`);
  }

  async down(q: QueryRunner) {
    await q.query(`
      ALTER TABLE anchor_day_adjustments RENAME CONSTRAINT anchor_day_adjustments_pkey TO wednesday_adjustments_pkey;
      ALTER TABLE anchor_day_adjustments RENAME COLUMN anchor_date TO wednesday;
      ALTER TABLE anchor_day_adjustments RENAME TO wednesday_adjustments;
      ALTER TABLE anchor_day_attendance RENAME CONSTRAINT anchor_day_attendance_pkey TO wednesday_attendance_pkey;
      ALTER TABLE anchor_day_attendance RENAME COLUMN anchor_date TO wednesday;
      ALTER TABLE anchor_day_attendance RENAME TO wednesday_attendance`);
  }
}
