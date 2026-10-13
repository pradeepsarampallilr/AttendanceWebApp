/** Adds an optional username column to the app users table. */
import type { MigrationInterface, QueryRunner } from "typeorm";

/** Second identifier for a user: the Okta username (login). A token matches a row on email OR username. */
export class AddAppUserUsername1700000000003 implements MigrationInterface {
  name = "AddAppUserUsername1700000000003";

  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username TEXT;
      ALTER TABLE app_users ADD CONSTRAINT app_users_username_lower_check CHECK (username IS NULL OR username = lower(username));
      CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_key ON app_users (username) WHERE username IS NOT NULL`);
  }

  async down(q: QueryRunner) {
    await q.query(`
      DROP INDEX IF EXISTS app_users_username_key;
      ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_username_lower_check;
      ALTER TABLE app_users DROP COLUMN IF EXISTS username`);
  }
}
