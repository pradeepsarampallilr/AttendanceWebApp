/** A signed-in manager sees exactly their own subtree: attendance rows, reporting lines and nobody above them. */
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FIX = new URL("../../fixtures/", import.meta.url);
const TEST_DB = "attendance_test_manager";
let ds: import("typeorm").DataSource;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: "postgres://localhost:5432/postgres" });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  process.env.DB_NAME = TEST_DB;
  process.env.OKTA_ISSUER = "";
  process.env.ALLOW_INSECURE_DEV_AUTH = "true";
  const db = await import("../src/db.js");
  ds = db.AppDataSource;
  await db.migrate();
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  const base = `http://localhost:${(server.address() as import("node:net").AddressInfo).port}`;
  const send = async (kind: string, file: string) => {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", new Blob([readFileSync(new URL(file, FIX))]), file);
    return fetch(`${base}/api/uploads`, { method: "POST", body: form });
  };
  await send("roster", "roster.xlsx");
  await send("movement", "august_movement.xlsx");
  await fetch(`${base}/api/months/2026-08/process`, { method: "POST" });
  server.close();
}, 90_000);

afterAll(async () => { await ds?.destroy(); });

describe("manager scope", () => {
  it("lists only the manager and people below them, in lines and attendance", async () => {
    const { visibleEmployees, teamLines } = await import("../src/services/access.js");
    const { attendanceRows } = await import("../src/routes/months.js");
    const all = await teamLines({ userRole: "hr" });
    // The manager with the biggest tree who also has someone above them.
    const managers = [...new Set(all.map((l) => l.managerId))];
    const withBoss = managers.filter((id) => all.some((l) => l.employeeId === id));
    expect(withBoss.length).toBeGreaterThan(0);
    const me = withBoss.sort((a, b) => all.filter((l) => l.managerId === b).length - all.filter((l) => l.managerId === a).length)[0];
    const below = all.filter((l) => l.managerId === me).map((l) => l.employeeId);

    const ids = (await visibleEmployees({ userRole: "manager", userEmployeeId: me }))!;
    expect(new Set(ids)).toEqual(new Set([me, ...below]));

    const lines = await teamLines({ userRole: "manager", userEmployeeId: me });
    const above = all.filter((l) => l.employeeId === me).map((l) => l.managerId);
    expect(lines.some((l) => above.includes(l.managerId))).toBe(false);
    expect(lines.filter((l) => l.managerId === me).map((l) => l.employeeId).sort()).toEqual([...below].sort());

    // A login without an employee id is found through its email.
    const [{ email }] = await ds.query("SELECT email FROM roster_employees WHERE employee_id = $1", [me]);
    expect(new Set(await visibleEmployees({ userRole: "manager", userEmail: email }))).toEqual(new Set(ids));

    const rows = await attendanceRows("2026-08", ids);
    const seen = new Set(rows.map((r: any) => r.employeeId));
    expect([...seen].every((id) => ids.includes(id as string))).toBe(true);
    console.log({ me, below: below.length, withAttendance: below.filter((id) => seen.has(id)).length, meHasRows: seen.has(me) });
  });
});
