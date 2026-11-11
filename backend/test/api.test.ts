/** Checks the whole web API on a fresh test database: uploads, results, manual edits, export, holidays and access list. */
import "dotenv/config";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureFile } from "./fixtures.js";

const TEST_DB = "attendance_test";

let server: Server;
let base: string;
let ds: import("typeorm").DataSource;
const query = async (sql: string, params?: unknown[]) => ({ rows: (await ds.query(sql, params)) as any[] });

async function send(kind: string, file: Parameters<typeof fixtureFile>[0], name: string = file) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new Blob([new Uint8Array(await fixtureFile(file))]), name);
  return fetch(`${base}/api/uploads`, { method: "POST", body: form });
}
const get = async (path: string) => (await fetch(`${base}/api${path}`)).json() as Promise<any>;
const post = (path: string) => fetch(`${base}/api${path}`, { method: "POST" });

beforeAll(async () => {
  // Fresh, separate database so the dev data is never touched.
  const admin = new pg.Client({ connectionString: "postgres://localhost:5432/postgres" });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  // The app connects as DB_USER, who must own the database to create tables in its public schema (Postgres 15+).
  await admin.query(`CREATE DATABASE ${TEST_DB}${process.env.DB_USER ? ` OWNER "${process.env.DB_USER}"` : ""}`);
  await admin.end();
  process.env.DB_NAME = TEST_DB;
  process.env.OKTA_ISSUER = "";

  const db = await import("../src/db.js");
  ds = db.AppDataSource;
  await db.migrate();
  const { createApp } = await import("../src/app.js");
  // These tests exercise the API directly, so they inject a fixed superadmin instead of Okta.
  server = createApp((req, _res, next) => { req.userEmail = "test@local"; req.userRole = "superadmin"; next(); }).listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  server?.close();
  await ds?.destroy();
});

describe("upload validation", () => {
  it("rejects bad requests with 400", async () => {
    const noKind = new FormData();
    noKind.set("file", new Blob(["a"]), "x.csv");
    expect((await fetch(`${base}/api/uploads`, { method: "POST", body: noKind })).status).toBe(400);
    expect((await send("movement", "roster.xlsx")).status).toBe(400); // no EmpCode header
    expect((await send("roster", "july_movement.xlsx")).status).toBe(400); // wrong columns
    expect((await send("roster", "roster.xlsx", "roster.txt")).status).toBe(400); // extension
    expect((await post("/months/2026-13/process")).status).toBe(400);
    expect((await post("/months/2026-08/process")).status).toBe(404); // nothing uploaded yet
  });
});

describe("upload + process matches golden", () => {
  it("uploads roster and both movement files (idempotently)", async () => {
    expect((await send("roster", "roster.xlsx")).status).toBe(201);
    expect((await send("movement", "july_movement.xlsx")).status).toBe(201);
    expect((await send("movement", "august_movement.xlsx")).status).toBe(201);
    const before = (await query("SELECT count(*)::int AS n FROM swipe_events")).rows[0].n;
    const again = await send("movement", "august_movement.xlsx");
    expect(again.status).toBe(201);
    expect((await query("SELECT count(*)::int AS n FROM swipe_events")).rows[0].n).toBe(before);
    const months = await get("/months");
    expect(months.map((m: any) => m.month)).toEqual(["2026-08-01", "2026-07-01"]);
    expect((await get("/uploads")).items.length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it.each(["2026-07", "2026-08"])("processes %s consistently", async (ym) => {
    expect((await post(`/months/${ym}/process`)).status).toBe(200);
    const first = await get(`/months/${ym}/attendance`);
    expect(first.length).toBeGreaterThan(0);

    // Seed manual data and make sure a reprocess leaves it alone and changes nothing else.
    await query("INSERT INTO manual_adjustments (month, employee_id, work_date, action, hours) VALUES ($1, $2, $3, 'add', 1) ON CONFLICT DO NOTHING", [`${ym}-01`, `m${ym}`, `${ym}-02`]);
    await query("INSERT INTO anchor_day_adjustments (month, employee_id, anchor_date, attended) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING", [`${ym}-01`, `m${ym}`, `${ym}-02`]);
    expect((await post(`/months/${ym}/process`)).status).toBe(200);
    expect(await get(`/months/${ym}/attendance`)).toEqual(first);

    const manual = await query("SELECT (SELECT count(*) FROM manual_adjustments WHERE employee_id = $1)::int AS a, (SELECT count(*) FROM anchor_day_adjustments WHERE employee_id = $1)::int AS w", [`m${ym}`]);
    expect(manual.rows[0]).toEqual({ a: 1, w: 1 });

    // Rows are ordered by name then date, and only the first row of a day group carries the group's size.
    const keys = first.map((r: any) => `${r.name}|${r.workDate}|${r.checkIn}`);
    expect(keys).toEqual([...keys].sort());
    for (const r of first) expect(r.visitHours === null || r.visitHours >= 0).toBe(true);

    // The anchor-day grid has every roster employee, and a day is attended exactly when that employee has a visit on it.
    const grid = await get(`/months/${ym}/anchor-day`);
    const rosterSize = (await query("SELECT count(*)::int AS n FROM roster_employees")).rows[0].n;
    expect(grid.employees.length).toBe(rosterSize);
    expect(grid.dates.length).toBeGreaterThanOrEqual(4);
    const days = new Map<string, Set<string>>();
    for (const r of first) (days.get(r.employeeId) ?? days.set(r.employeeId, new Set()).get(r.employeeId)!).add(r.workDate);
    for (const e of grid.employees) for (const w of grid.dates) {
      expect(e.attended[w]).toBe(days.get(e.employeeId)?.has(w) ?? false);
    }
  }, 120_000);

  describe("known outcomes from the fixture people", () => {
    const rowsOf = (rows: any[], id: string) => rows.filter((r) => r.employeeId === id);
    const issueTypes = (issues: any[], id: string) => issues.filter((i) => i.employeeId === id).map((i) => i.issueType);

    it("2026-08: eligibility, hours and compliance", async () => {
      const rows = await get("/months/2026-08/attendance");
      const issues = await get("/months/2026-08/audit");

      // General shift: outside the policy, so nothing is judged.
      expect(new Set(rowsOf(rows, "1001").map((r) => r.eligibility))).toEqual(new Set(["No"]));
      expect(new Set(rowsOf(rows, "1001").map((r) => r.monthCompliant))).toEqual(new Set(["NA"]));
      // Never swiped, so no rows at all.
      expect(rowsOf(rows, "1005")).toEqual([]);
      // No shift in the roster: unknown eligibility.
      expect(new Set(rowsOf(rows, "1007").map((r) => r.eligibility))).toEqual(new Set(["NA"]));

      // Night shift: 18:00 to 03:00 next day is one 9-hour visit on the day it started.
      const carol = rowsOf(rows, "1003");
      expect(carol.length).toBeGreaterThan(0);
      expect(carol.every((r) => r.visitHours === 9 && r.dailyTotalHours === 9 && r.compliant === "Yes")).toBe(true);
      expect(carol.every((r) => r.checkOut.slice(0, 10) === `${r.workDate.slice(0, 8)}${String(Number(r.workDate.slice(8)) + 1).padStart(2, "0")}`)).toBe(true);
      expect(carol[0].monthCompliant).toBe("Yes");

      // Split day: two visits share one total, and only the first row opens the group.
      const split = rowsOf(rows, "1004").filter((r) => r.workDate === "2026-08-05");
      expect(split.map((r) => [r.visitHours, r.dailyTotalHours, r.isFirstRowOfDayGroup, r.rowsInDayGroup])).toEqual([[4, 8.25, true, 2], [4.25, 8.25, false, 2]]);
      // A check-in with no checkout has no hours and is reported.
      const open = rowsOf(rows, "1004").find((r) => r.workDate === "2026-08-07");
      expect(open).toMatchObject({ checkOut: null, visitHours: null });
      expect(issueTypes(issues, "1004")).toContain("Missing checkout");

      // Short days never reach the 7 hours, so the month is not compliant.
      const frank = rowsOf(rows, "1006");
      expect(frank.some((r) => r.workDate === "2026-08-04" && r.compliant === "No")).toBe(true);
      expect(frank.every((r) => r.monthCompliant === "No")).toBe(true);

      // Swipes from someone missing in the roster are kept, flagged and left without roster details.
      const zed = rowsOf(rows, "9999");
      expect(zed.length).toBeGreaterThan(0);
      expect(zed[0]).toMatchObject({ name: "Zed Visitor", department: "", eligibility: "NA" });
      expect(issueTypes(issues, "9999")).toContain("No roster match");

      // Managers are resolved from the roster by name.
      expect(rowsOf(rows, "1003")[0]).toMatchObject({ managerName: "Bob Manager", managerEmail: "bob.manager@example.com" });
      expect(rowsOf(rows, "1001")[0]).toMatchObject({ managerName: "NA", managerEmail: "NA" });
    });

    it("2026-07: a month's first short week makes the month non-compliant", async () => {
      // July starts on a Wednesday with no earlier data, so week 1 only has 3 days and Carol only works the Wednesday.
      const rows = await get("/months/2026-07/attendance");
      const carol = rowsOf(rows, "1003");
      expect(carol.find((r) => r.workDate === "2026-07-01")).toMatchObject({ weekCompliant: "No" });
      expect(carol.find((r) => r.workDate === "2026-07-06")).toMatchObject({ weekCompliant: "Yes" });
      expect(carol.every((r) => r.monthCompliant === "No")).toBe(true);
    });

    it("a holiday lowers the days a week needs", async () => {
      // Frank's week of 2026-08-03 has one full day (Mon). Marking Tue-Thu as holidays leaves nothing to attend but the Monday.
      expect((await fetch(`${base}/api/months/2026-08/holidays`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ dates: ["2026-08-04", "2026-08-05", "2026-08-06"] }) })).status).toBe(200);
      expect((await post("/months/2026-08/process")).status).toBe(200);
      const week1 = rowsOf(await get("/months/2026-08/attendance"), "1006").find((r) => r.workDate === "2026-08-03");
      expect(week1).toMatchObject({ weekCompliant: "Yes" });
      await fetch(`${base}/api/months/2026-08/holidays`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ dates: [] }) });
      expect((await post("/months/2026-08/process")).status).toBe(200);
    });
  });
});

describe("manual edits", () => {
  const put = (path: string, body: object) => fetch(`${base}/api${path}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  it("overrides anchor days and survives reprocess; revert restores", async () => {
    const wed = await get("/months/2026-08/anchor-day");
    const e = wed.employees[0], w = wed.dates[0];
    const flip = !e.attended[w];
    expect((await put("/months/2026-08/anchor-day", { employeeId: e.employeeId, date: w, attended: flip })).status).toBe(200);
    await post("/months/2026-08/process");
    expect((await get("/months/2026-08/anchor-day")).employees[0].attended[w]).toBe(flip);
    expect((await put("/months/2026-08/anchor-day", { employeeId: e.employeeId, date: w, attended: null })).status).toBe(200);
    expect((await get("/months/2026-08/anchor-day")).employees[0].attended[w]).toBe(!flip);
    expect((await put("/months/2026-08/anchor-day", { employeeId: "nope", date: w, attended: true })).status).toBe(404);
    expect((await put("/months/2026-08/anchor-day", { employeeId: e.employeeId, date: w, attended: "x" })).status).toBe(400);
  });

  it("edits, adds, deletes and reverts daily hours", async () => {
    const rows = await get("/months/2026-08/attendance");
    const first = rows.find((r: any) => r.isFirstRowOfDayGroup && r.dailyTotalHours !== null);
    const { employeeId, workDate } = first;
    const total = (rs: any[], d: string) => rs.find((r) => r.employeeId === employeeId && r.workDate === d && r.isFirstRowOfDayGroup)?.dailyTotalHours;

    expect(await (await put("/months/2026-08/hours", { employeeId, workDate, hours: 3.5 })).json()).toEqual({ ok: true, action: "edit" });
    let now = await get("/months/2026-08/attendance");
    expect(total(now, workDate)).toBe(3.5);
    expect(now.length).toBe(rows.length);

    await put("/months/2026-08/hours", { employeeId, workDate, remove: true });
    expect(total(await get("/months/2026-08/attendance"), workDate)).toBeNull();

    const free = Array.from({ length: 28 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`)
      .find((d) => !rows.some((r: any) => r.employeeId === employeeId && r.workDate === d))!;
    expect(await (await put("/months/2026-08/hours", { employeeId, workDate: free, hours: 8 })).json()).toEqual({ ok: true, action: "add" });
    now = await get("/months/2026-08/attendance");
    expect(total(now, free)).toBe(8);
    expect(now.length).toBe(rows.length + 1);

    expect((await put("/months/2026-08/hours", { employeeId, workDate, hours: 30 })).status).toBe(400);
    expect((await put("/months/2026-08/hours", { employeeId, workDate: "2026-07-05", hours: 1 })).status).toBe(400);
    expect((await put("/months/2026-08/hours", { employeeId: "nope", workDate, hours: 1 })).status).toBe(404);

    for (const d of [workDate, free]) expect((await fetch(`${base}/api/months/2026-08/hours/${employeeId}/${d}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${base}/api/months/2026-08/hours/${employeeId}/${free}`, { method: "DELETE" })).status).toBe(404);
    expect(await get("/months/2026-08/attendance")).toEqual(rows.map((r: any) => ({ ...r, adjustment: null })));
  });
});

describe("excel export", () => {
  it("returns a workbook with both sheets and 404s for unprocessed months", async () => {
    const res = await fetch(`${base}/api/months/2026-08/export.xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Attendance", "Wednesday Office Attended"]);
    const rows = await get("/months/2026-08/attendance");
    expect(wb.getWorksheet("Attendance")!.rowCount).toBe(rows.length + 2);
    const wed = await get("/months/2026-08/anchor-day");
    expect(wb.getWorksheet("Wednesday Office Attended")!.rowCount).toBe(wed.employees.length + 1);
    expect((await fetch(`${base}/api/months/2026-01/export.xlsx`)).status).toBe(404);
  });
});

describe("transport upload", () => {
  const HEADER = "Department,LiveRamp Employee ID,Full Name,Employee Email,Business Title,Employee Contact No,Gender,LR Manager Name,"
    + "LR Manager Email,Working Days,Shift,Home Address - Street Line 1 (Building/Apartment N,Home Address - Street Line 2 (Locality/Area),City/Town,Postal Code / Zip Code";
  const sendCsv = (csv: string) => {
    const form = new FormData();
    form.set("kind", "transport");
    form.set("file", new Blob([csv]), "transport.csv");
    return fetch(`${base}/api/uploads`, { method: "POST", body: form });
  };

  it("rejects a file with missing columns", async () => {
    expect((await sendCsv("Department,Full Name\nEng,A")).status).toBe(400);
  });

  it("sets NA for general shift, Yes for listed, No for unlisted non-general staff", async () => {
    const { rows } = await query(
      "SELECT DISTINCT employee_id, eligibility FROM attendance_visits WHERE month = '2026-08-01' ORDER BY employee_id");
    const nonGeneral = rows.filter((r) => r.eligibility === "Yes");
    expect(nonGeneral.length).toBeGreaterThan(1);
    const listed = nonGeneral[0].employee_id;
    const res = await sendCsv(`${HEADER}\nEng,${listed},A B,a@x.com,Eng,999,M,Boss,b@x.com,Mon-Fri,Night,1 St,Area,City,500001`);
    expect(res.status).toBe(201);
    const { rows: out } = await query(
      "SELECT DISTINCT employee_id, eligibility, transport_opt_in AS t FROM attendance_visits WHERE month = '2026-08-01'");
    for (const r of out) {
      expect(r.t).toBe(r.eligibility !== "Yes" ? "NA" : r.employee_id === listed ? "Yes" : "No");
    }
    expect((await get("/months/2026-08/attendance"))[0]).toHaveProperty("transportOptIn");
  });
});

describe("holidays", () => {
  const put = (ym: string, body: unknown) =>
    fetch(`${base}/api/months/${ym}/holidays`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("stores, replaces and returns a month's holidays", async () => {
    expect(await get("/months/2026-08/holidays")).toEqual([]);
    expect((await put("2026-08", { dates: ["2026-08-14", "2026-08-12", "2026-08-12"] })).status).toBe(200);
    expect(await get("/months/2026-08/holidays")).toEqual([{ date: "2026-08-12", description: "" }, { date: "2026-08-14", description: "" }]);
    await put("2026-08", { dates: ["2026-08-05"] });
    expect(await get("/months/2026-08/holidays")).toEqual([{ date: "2026-08-05", description: "" }]);
    expect(await get("/months/2026-09/holidays")).toEqual([]);
  });

  it("rejects dates outside the month, weekends and bad bodies", async () => {
    expect((await put("2026-08", { dates: ["2026-09-01"] })).status).toBe(400);
    expect((await put("2026-08", { dates: ["2026-08-15"] })).status).toBe(400); // Saturday
    expect((await put("2026-08", { dates: "x" })).status).toBe(400);
  });
});

describe("access list (app_users)", () => {
  it("roster upload makes its managers the allowed list; HR is added/removed via the admin API", async () => {
    expect((await send("roster", "roster.xlsx")).status).toBe(201);
    const managers = (await query("SELECT email FROM app_users WHERE role = 'manager'")).rows.map((r) => r.email);
    const expected = (await query("SELECT DISTINCT lower(btrim(manager_email)) AS e FROM roster_employees WHERE btrim(manager_email) LIKE '%_@_%'")).rows.map((r) => r.e);
    expect(managers.sort()).toEqual(expected.sort());
    expect(managers.length).toBeGreaterThan(0);

    const add = (email: string) => fetch(`${base}/api/admin/users`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    expect((await add("  HR.One@LiveRamp.com ")).status).toBe(201);
    expect((await add("hr.one@liveramp.com")).status).toBe(400); // duplicate
    expect((await add("nope")).status).toBe(400);
    expect((await add(managers[0])).status).toBe(400); // already a manager

    await send("roster", "roster.xlsx"); // re-upload keeps HR
    const roles = ((await get("/admin/users")).items) as { email: string; role: string }[];
    expect(roles.find((u) => u.email === "hr.one@liveramp.com")?.role).toBe("hr");

    expect((await fetch(`${base}/api/admin/users/hr.one@liveramp.com`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${base}/api/admin/users/${managers[0]}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("access lookup: email OR username", () => {
  it("matches a row on either column against any identifier from the token", async () => {
    const { findUser } = await import("../src/services/users.js");
    const m = ds.manager;
    await query("INSERT INTO app_users (email, username, role) VALUES ('a.person@x.com', NULL, 'hr'), ('b.person@x.com', 'bperson', 'hr'), ('top@x.com', 'topuser', 'superadmin')");
    // token carries login + email claim; row has only an email
    expect((await findUser(m, ["jdoe", "a.person@x.com"]))?.email).toBe("a.person@x.com");
    // row matched by its username (login), email claim is something else entirely
    expect((await findUser(m, ["bperson", "other@elsewhere.com"]))?.email).toBe("b.person@x.com");
    // a row's email can match the token's *login* (login looks like an address), the case seen in the preview org
    expect((await findUser(m, ["b.person@x.com", "unrelated@x.com"]))?.email).toBe("b.person@x.com");
    // nothing matches / no identifiers
    expect(await findUser(m, ["nobody", "nobody@x.com"])).toBeNull();
    expect(await findUser(m, [])).toBeNull();
    // two rows match different identifiers: the higher role wins
    expect((await findUser(m, ["a.person@x.com", "topuser"]))?.role).toBe("superadmin");
  });

  it("admin API: optional username, rejects duplicate email or username, lower-cases, DB enforces lower-case", async () => {
    const add = (body: object) => fetch(`${base}/api/admin/users`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await add({ email: "New.HR@X.com", username: "  NewHR " });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ email: "new.hr@x.com", username: "newhr", role: "hr" });
    expect((await add({ email: "other@x.com", username: "newhr" })).status).toBe(400); // username taken
    expect((await add({ email: "x2@x.com", username: "b person" })).status).toBe(400); // spaces
    expect((await add({ email: "new.hr@x.com" })).status).toBe(400); // email taken
    expect((await add({ email: "no.username@x.com" })).status).toBe(201); // username optional
    await expect(query("INSERT INTO app_users (email, username, role) VALUES ('c@x.com', 'MixedCase', 'hr')")).rejects.toThrow();
  });
});
