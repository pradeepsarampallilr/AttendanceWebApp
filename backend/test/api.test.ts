import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "../node_modules/@types/pg/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FIX = new URL("../../fixtures/", import.meta.url);
const GOLD = new URL("../../golden/", import.meta.url);
const TEST_DB = "attendance_test";

let server: Server;
let base: string;
let pool: pg.Pool;

async function send(kind: string, file: string, name = file) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new Blob([readFileSync(new URL(file, FIX))]), name);
  return fetch(`${base}/api/uploads`, { method: "POST", body: form });
}
const get = async (path: string) => (await fetch(`${base}/api${path}`)).json() as Promise<any>;
const post = (path: string) => fetch(`${base}/api${path}`, { method: "POST" });

beforeAll(async () => {
  // Fresh, separate database so the dev data is never touched.
  const admin = new pg.Client({ connectionString: "postgres://localhost:5432/postgres" });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  process.env.DB_NAME = TEST_DB;

  const db = await import("../src/db.js");
  pool = db.pool;
  await db.migrate();
  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  server?.close();
  await pool?.end();
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
    const before = (await pool.query("SELECT count(*)::int AS n FROM swipe_events")).rows[0].n;
    const again = await send("movement", "august_movement.xlsx");
    expect(again.status).toBe(201);
    expect((await pool.query("SELECT count(*)::int AS n FROM swipe_events")).rows[0].n).toBe(before);
    const months = await get("/months");
    expect(months.map((m: any) => m.month)).toEqual(["2026-08-01", "2026-07-01"]);
    expect((await get("/uploads")).length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it.each([["2026-07", "july"], ["2026-08", "august"]])("processes %s", async (ym, name) => {
    const gold = JSON.parse(readFileSync(new URL(`${name}.json`, GOLD), "utf8"));
    expect((await post(`/months/${ym}/process`)).status).toBe(200);
    // Seed manual data and make sure a reprocess leaves it alone.
    await pool.query("INSERT INTO manual_adjustments (month, employee_id, work_date, action, hours) VALUES ($1, $2, $3, 'add', 1) ON CONFLICT DO NOTHING", [`${ym}-01`, `m${ym}`, `${ym}-02`]);
    await pool.query("INSERT INTO wednesday_overrides (month, employee_id, wednesday, attended) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING", [`${ym}-01`, `m${ym}`, `${ym}-02`]);
    expect((await post(`/months/${ym}/process`)).status).toBe(200);

    const rows = await get(`/months/${ym}/attendance`);
    expect(rows.length).toBe(gold.rows.length);
    const mine = rows.map((r: any) => ({
      employee_id: r.employeeId, name: r.name, email: r.email, department: r.department,
      manager_name: r.managerName, manager_email: r.managerEmail, week: r.week,
      week_attended_days: r.weekAttendedDays, work_date: r.workDate, check_in: r.checkIn, check_out: r.checkOut,
      visit_hours: r.visitHours, daily_total_hours: r.dailyTotalHours, shift_label: r.shiftLabel,
      eligibility: r.eligibility, compliant: r.compliant, week_compliant: r.weekCompliant,
      month_compliant: r.monthCompliant, is_first_row_of_day_group: r.isFirstRowOfDayGroup,
      rows_in_day_group: r.rowsInDayGroup,
    }));
    expect(mine).toEqual(gold.rows);

    const audit = await get(`/months/${ym}/audit`);
    const pairIssues = audit.filter((i: any) => !["No roster match", "Manager email unresolved"].includes(i.issueType))
      .map((i: any) => [i.employeeId, i.issueType, i.at, i.detail]).sort();
    expect(pairIssues).toEqual(gold.issues);

    const wed = await get(`/months/${ym}/wednesday`);
    const rosterSize = (await pool.query("SELECT count(*)::int AS n FROM roster_employees")).rows[0].n;
    expect(wed.employees.length).toBe(rosterSize);
    expect(wed.wednesdays.length).toBeGreaterThanOrEqual(4);
    const yes = new Map<string, Set<string>>();
    for (const r of rows) (yes.get(r.employeeId) ?? yes.set(r.employeeId, new Set()).get(r.employeeId)!).add(r.workDate);
    for (const e of wed.employees) for (const w of wed.wednesdays) {
      expect(e.attended[w]).toBe(yes.get(e.employeeId)?.has(w) ?? false);
    }

    const manual = await pool.query("SELECT (SELECT count(*) FROM manual_adjustments WHERE employee_id = $1)::int AS a, (SELECT count(*) FROM wednesday_overrides WHERE employee_id = $1)::int AS w", [`m${ym}`]);
    expect(manual.rows[0]).toEqual({ a: 1, w: 1 });
  }, 120_000);
});

describe("manual edits", () => {
  const put = (path: string, body: object) => fetch(`${base}/api${path}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  it("overrides Wednesdays and survives reprocess; revert restores", async () => {
    const wed = await get("/months/2026-08/wednesday");
    const e = wed.employees[0], w = wed.wednesdays[0];
    const flip = !e.attended[w];
    expect((await put("/months/2026-08/wednesday", { employeeId: e.employeeId, wednesday: w, attended: flip })).status).toBe(200);
    await post("/months/2026-08/process");
    expect((await get("/months/2026-08/wednesday")).employees[0].attended[w]).toBe(flip);
    expect((await put("/months/2026-08/wednesday", { employeeId: e.employeeId, wednesday: w, attended: null })).status).toBe(200);
    expect((await get("/months/2026-08/wednesday")).employees[0].attended[w]).toBe(!flip);
    expect((await put("/months/2026-08/wednesday", { employeeId: "nope", wednesday: w, attended: true })).status).toBe(404);
    expect((await put("/months/2026-08/wednesday", { employeeId: e.employeeId, wednesday: w, attended: "x" })).status).toBe(400);
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
    const wed = await get("/months/2026-08/wednesday");
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
    const { rows } = await pool.query(
      "SELECT DISTINCT employee_id, eligibility FROM attendance_visits WHERE month = '2026-08-01' ORDER BY employee_id");
    const nonGeneral = rows.filter((r) => r.eligibility === "Yes");
    expect(nonGeneral.length).toBeGreaterThan(1);
    const listed = nonGeneral[0].employee_id;
    const res = await sendCsv(`${HEADER}\nEng,${listed},A B,a@x.com,Eng,999,M,Boss,b@x.com,Mon-Fri,Night,1 St,Area,City,500001`);
    expect(res.status).toBe(201);
    const { rows: out } = await pool.query(
      "SELECT DISTINCT employee_id, eligibility, transport_opt_in AS t FROM attendance_visits WHERE month = '2026-08-01'");
    for (const r of out) {
      expect(r.t).toBe(r.eligibility === "No" ? "NA" : r.employee_id === listed ? "Yes" : "No");
    }
    expect((await get("/months/2026-08/attendance"))[0]).toHaveProperty("transportOptIn");
  });
});

describe("holidays", () => {
  const put = (ym: string, body: unknown) =>
    fetch(`${base}/api/months/${ym}/holidays`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("stores, replaces and returns a month's holidays", async () => {
    expect(await get("/months/2026-08/holidays")).toEqual([]);
    expect((await put("2026-08", { dates: ["2026-08-15", "2026-08-12", "2026-08-12"] })).status).toBe(200);
    expect(await get("/months/2026-08/holidays")).toEqual(["2026-08-12", "2026-08-15"]);
    await put("2026-08", { dates: ["2026-08-05"] });
    expect(await get("/months/2026-08/holidays")).toEqual(["2026-08-05"]);
    expect(await get("/months/2026-09/holidays")).toEqual([]);
  });

  it("rejects dates outside the month, weekends and bad bodies", async () => {
    expect((await put("2026-08", { dates: ["2026-09-01"] })).status).toBe(400);
    expect((await put("2026-08", { dates: ["2026-08-15"] })).status).toBe(400); // Saturday
    expect((await put("2026-08", { dates: "x" })).status).toBe(400);
  });
});
