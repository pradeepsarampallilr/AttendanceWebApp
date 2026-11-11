/**
 * End-to-end security tests. A local fake Okta issuer (own RSA keys + JWKS) lets the real auth middleware verify real
 * signed tokens, so forged / expired / wrong-audience tokens, role escalation, cross-user access and malformed input
 * are tested against the actual app and a throw-away Postgres database.
 */
import { createServer, request as httpRequest, type Server } from "node:http";
import os from "node:os";
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = "attendance_sec_test";
const AUD = "api://default";
const CID = "0oaATTENDANCE";

let api: Server, jwksServer: Server;
let base = "", issuer = "";
let good: { privateKey: CryptoKey; publicKey: CryptoKey }, evil: { privateKey: CryptoKey; publicKey: CryptoKey };
let ds: import("typeorm").DataSource;

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A token as the fake Okta would issue it; every claim can be overridden to build attacks. */
async function token(email: string, o: { key?: CryptoKey; iss?: string; aud?: string; exp?: string | number; nbf?: number; kid?: string; claims?: object; alg?: string } = {}) {
  const jwt = new SignJWT({ email, preferred_username: email, cid: CID, ...o.claims })
    .setProtectedHeader({ alg: o.alg ?? "RS256", kid: o.kid ?? "k1" })
    .setIssuer(o.iss ?? issuer).setAudience(o.aud ?? AUD).setSubject("00u123").setIssuedAt().setExpirationTime(o.exp ?? "5m");
  if (o.nbf) jwt.setNotBefore(o.nbf);
  return jwt.sign(o.key ?? good.privateKey);
}

async function call(method: string, path: string, who?: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers };
  if (who) h.authorization = `Bearer ${who.startsWith("eyJ") ? who : await token(who)}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { payload = typeof body === "string" ? body : JSON.stringify(body); h["content-type"] ??= "application/json"; }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

const xlsx = async (header: string[], rows: unknown[][]) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const form = (fields: Record<string, string>, file?: { name: string; data: Buffer | string }) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (file) f.set("file", new Blob([typeof file.data === "string" ? file.data : new Uint8Array(file.data)]), file.name);
  return f;
};

const HR = "hr@example.com", SA = "root@example.com", MGR = "mary@example.com", EMP = "eve@example.com", OTHER = "oscar@example.com";
const MONTH = "2026-08";

beforeAll(async () => {
  good = await generateKeyPair("RS256");
  evil = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(good.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  jwksServer = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url?.endsWith("/v1/keys") ? { keys: [jwk] } : {}));
  }).listen(0);
  issuer = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/oauth2/default`;

  const admin = new pg.Client({ host: "localhost", database: "postgres", user: process.env.TEST_DB_USER ?? os.userInfo().username, password: process.env.TEST_DB_PASSWORD });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  // dotenv never overrides a variable that is already set, so a developer's .env cannot leak into these tests.
  Object.assign(process.env, {
    DB_NAME: TEST_DB, DB_USER: process.env.TEST_DB_USER ?? os.userInfo().username, DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? "",
    OKTA_ISSUER: issuer, OKTA_AUDIENCE: AUD, OKTA_CLIENT_ID: CID, OKTA_IDENTITY_CLAIM: "", CORS_ORIGIN: "", CLIENT_DIST: "", RATE_LIMIT_PER_MIN: "1000000",
  });
  const db = await import("../src/db.js");
  ds = db.AppDataSource;
  await db.migrate();
  const { loadSettings } = await import("../src/services/settings.js");
  await loadSettings();
  const { createApp } = await import("../src/app.js");
  api = createApp().listen(0);
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  // HR / superadmin / deactivated users exist before the roster; the roster upload then creates manager + employee logins.
  await ds.query(`INSERT INTO app_users (email, name, role) VALUES ($1,'HR','hr'), ($2,'Root','superadmin')`, [HR, SA]);
  await ds.query(`INSERT INTO app_users (email, name, role, is_active) VALUES ('gone@example.com','Gone','hr',false)`);

  const roster = await xlsx(
    ["Work Shift", "Shift Timing", "Emplid*", "Legal Name*", "Department", "Worker Type", "Sub-Type", "Email", "Hire Date", "Manager", "Transport", "Current Shift Timing"],
    [
      ["General", "9:00 AM - 6:30 PM", 1000, "Dave Director", "Eng", "E", "R", "dave@example.com", "", "", "", ""],
      ["General", "9:00 AM - 6:30 PM", 1001, "Mary Manager", "Eng", "E", "R", MGR, "", "Dave Director", "", ""],
      ["General", "9:00 AM - 6:30 PM", 1002, "Eve Employee", "Eng", "E", "R", EMP, "", "Mary Manager", "", ""],
      ["General", "9:00 AM - 6:30 PM", 1003, "Oscar Other", "Ops", "E", "R", OTHER, "", "Olga Other", "", ""],
      ["General", "9:00 AM - 6:30 PM", 1004, "Olga Other", "Ops", "E", "R", "olga@example.com", "", "Dave Director", "", ""],
    ]);
  const r = await call("POST", "/api/uploads", HR, form({ kind: "roster" }, { name: "roster.xlsx", data: roster }));
  expect(r.status, r.text).toBe(201);

  const mv = await xlsx(
    ["SrNo", "EmpCode*", "Name", "TransDate*", "Controller", "Door", "In 1*", "Out 1*", "In 2", "Out 2", "In 3", "Out 3", "Work Hrs"],
    ["1001", "1002", "1003"].flatMap((id, i) => ["03", "04", "05"].map((d, j) => [i * 3 + j, Number(id), "n", `${d}-08-2026`, "", "", "09:05:10", "18:35:40", "", "", "", "", ""])));
  expect((await call("POST", "/api/uploads", HR, form({ kind: "movement" }, { name: "mv.xlsx", data: mv }))).status).toBe(201);
  const p = await call("POST", `/api/months/${MONTH}/process`, HR);
  expect(p.status, p.text).toBe(200);
}, 60_000);

afterAll(async () => {
  api?.close();
  jwksServer?.close();
  await ds?.destroy();
});

// -------------------------------------------------------------------------------------------------------------------
// Every route of the API. `hr: true` = only HR / superadmin may call it. Writes use a month with no data (2030-01) so
// "allowed" callers get a 4xx rather than changing the fixture.
const M = MONTH, EMPTY = "2030-01";
const ROUTES: { method: string; path: string; hr: boolean; body?: unknown }[] = [
  { method: "GET", path: "/api/me", hr: false },
  { method: "GET", path: "/api/team", hr: false },
  { method: "GET", path: "/api/rules", hr: false },
  { method: "GET", path: "/api/templates/roster", hr: true },
  { method: "GET", path: "/api/uploads", hr: true },
  { method: "POST", path: "/api/uploads", hr: true },
  { method: "GET", path: "/api/months", hr: false },
  { method: "GET", path: `/api/months/${M}/holidays`, hr: false },
  { method: "GET", path: `/api/months/${M}/attendance`, hr: false },
  { method: "GET", path: `/api/months/${M}/anchor-day`, hr: false },
  { method: "GET", path: `/api/months/${M}/weekly`, hr: false },
  { method: "GET", path: `/api/months/${M}/audit`, hr: false },
  { method: "GET", path: `/api/months/${M}/leaves`, hr: false },
  { method: "GET", path: `/api/months/${M}/employees/1002/leaves`, hr: false },
  { method: "GET", path: `/api/months/${M}/export.xlsx`, hr: false },
  { method: "POST", path: `/api/months/${EMPTY}/process`, hr: true },
  { method: "DELETE", path: `/api/months/${EMPTY}`, hr: true },
  { method: "PUT", path: `/api/months/${EMPTY}/anchor-day`, hr: true, body: {} },
  { method: "PUT", path: `/api/months/${EMPTY}/hours`, hr: true, body: {} },
  { method: "DELETE", path: `/api/months/${EMPTY}/hours/1002/2030-01-07`, hr: true },
  { method: "PUT", path: `/api/months/${EMPTY}/holidays`, hr: true, body: { holidays: [] } },
  { method: "POST", path: `/api/months/${EMPTY}/leaves`, hr: true, body: {} },
  { method: "DELETE", path: `/api/months/${EMPTY}/leaves/999999`, hr: true },
  { method: "PUT", path: `/api/months/${EMPTY}/employees/1002/leaves`, hr: true, body: { dates: [] } },
  { method: "POST", path: "/api/leaves/upload", hr: true },
  { method: "GET", path: "/api/leaves/employees?q=ev", hr: true },
  { method: "GET", path: "/api/admin/users", hr: true },
  { method: "POST", path: "/api/admin/users", hr: true, body: {} },
  { method: "PATCH", path: "/api/admin/users/nobody@example.com", hr: true, body: {} },
  { method: "DELETE", path: "/api/admin/users/nobody@example.com", hr: true },
  { method: "GET", path: "/api/admin/audit-logs", hr: true },
  { method: "GET", path: "/api/admin/settings", hr: true },
  { method: "PUT", path: "/api/admin/settings", hr: true, body: {} },
];

describe("authentication: nothing but /api/health is reachable without a valid Okta token", () => {
  it("health is the only public API route", async () => {
    expect((await call("GET", "/api/health")).status).toBe(200);
  });

  it.each(ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))("%s without a token -> 401", async (_n, r) => {
    expect((await call(r.method, r.path, null, r.body)).status).toBe(401);
  });

  it("unknown /api paths and odd methods are 401 too, so route names do not leak", async () => {
    for (const [m, p] of [["GET", "/api/nope"], ["GET", "/api/admin"], ["TRACE", "/api/me"], ["GET", "/api/../etc/passwd"], ["GET", "/api/%2e%2e/admin/users"], ["GET", "/api/me/"], ["GET", "/API/me"]] as const) {
      const r = await call(m, p).catch(() => ({ status: 0 }));
      expect([0, 401, 404], `${m} ${p}`).toContain(r.status);
      if (p.toLowerCase().startsWith("/api")) expect(r.status, `${m} ${p}`).not.toBe(200);
    }
  });

  it("a valid token for a known user works (control)", async () => {
    const r = await call("GET", "/api/me", HR);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ email: HR, role: "hr" });
  });
});

describe("token forgery and malformed credentials are rejected (401)", () => {
  const nowS = () => Math.floor(Date.now() / 1000);
  const cases: [string, () => Promise<string>][] = [
    ["signed with a different RSA key (same kid)", () => token(HR, { key: evil.privateKey })],
    ["issued to another app in the same Okta org (wrong cid)", () => token(HR, { claims: { cid: "0oaOTHERAPP" } })],
    ["no cid claim at all", () => token(HR, { claims: { cid: undefined } })],
    ["cid as an array / object", () => token(HR, { claims: { cid: [CID] } })],
    ["unknown kid", () => token(HR, { kid: "other" })],
    ["expired", () => token(HR, { exp: nowS() - 60 })],
    ["not yet valid (nbf in the future)", () => token(HR, { nbf: nowS() + 3600 })],
    ["wrong issuer", () => token(HR, { iss: "https://evil.example.com/oauth2/default" })],
    ["wrong audience", () => token(HR, { aud: "api://other" })],
    ["alg=none, no signature", async () => `${b64({ alg: "none", typ: "JWT" })}.${b64({ iss: issuer, aud: AUD, email: HR, exp: nowS() + 600 })}.`],
    ["alg=none with a stripped real signature", async () => { const [, p, s] = (await token(HR)).split("."); return `${b64({ alg: "none" })}.${p}.${s}`; }],
    ["HS256 signed with the public key as secret (algorithm confusion)", async () => {
      const jwk = JSON.stringify(await exportJWK(good.publicKey));
      return new SignJWT({ email: HR }).setProtectedHeader({ alg: "HS256", kid: "k1" }).setIssuer(issuer).setAudience(AUD).setExpirationTime("5m").sign(new TextEncoder().encode(jwk));
    }],
    ["header swapped to RS512", async () => { const [, p, s] = (await token(HR)).split("."); return `${b64({ alg: "RS512", kid: "k1" })}.${p}.${s}`; }],
    ["payload tampered after signing (role/email swapped)", async () => { const [h, , s] = (await token(EMP)).split("."); return `${h}.${b64({ iss: issuer, aud: AUD, email: HR, exp: nowS() + 600 })}.${s}`; }],
    ["jku / jwk header injection", async () => new SignJWT({ email: HR }).setProtectedHeader({ alg: "RS256", kid: "k1", jku: "http://evil.example/keys" } as any).setIssuer(issuer).setAudience(AUD).setExpirationTime("5m").sign(evil.privateKey)],
    ["garbage", async () => "not.a.jwt"],
    ["empty segments", async () => ".."],
    ["very long garbage", async () => "a".repeat(10_000) + ".b.c"],
  ];
  it.each(cases.map(([n, f]) => [n, f] as const))("%s", async (_n, make) => {
    const t = await make();
    const r = await call("GET", "/api/me", null, undefined, { authorization: `Bearer ${t}` });
    expect(r.status).toBe(401);
  });

  it("wrong scheme, empty bearer, token only in query / cookie / other headers", async () => {
    const t = await token(HR);
    const hdrs: Record<string, string>[] = [
      { authorization: `Basic ${t}` }, { authorization: "Bearer " }, { authorization: "Bearer" }, { authorization: t },
      { "x-access-token": t }, { cookie: `token=${t}; access_token=${t}` }, { "x-forwarded-user": HR }, { "x-user-email": HR, "x-user-role": "superadmin" },
    ];
    for (const h of hdrs) expect((await call("GET", "/api/me", null, undefined, h)).status, JSON.stringify(h).slice(0, 40)).toBe(401);
    expect((await call("GET", `/api/me?access_token=${t}&token=${t}`)).status).toBe(401);
  });

  it("two Authorization headers (smuggling) cannot upgrade a bad token", async () => {
    const good1 = await token(EMP), bad = await token(HR, { key: evil.privateKey });
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(base + "/api/admin/users");
      const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname, method: "GET", headers: [["Authorization", `Bearer ${bad}`], ["Authorization", `Bearer ${good1}`]] as any }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.on("error", reject); req.end();
    });
    expect([400, 401, 403]).toContain(status);
  });

  it("a valid token for an unknown or deactivated person is 403, never data", async () => {
    expect((await call("GET", "/api/me", "stranger@example.com")).status).toBe(403);
    expect((await call("GET", "/api/me", "gone@example.com")).status).toBe(403);
    expect((await call("GET", `/api/months/${M}/attendance`, "stranger@example.com")).status).toBe(403);
  });

  it("identity claims: case / whitespace are normalised, but sub without '@' and look-alikes are not accepted", async () => {
    expect((await call("GET", "/api/me", null, undefined, { authorization: `Bearer ${await token("  HR@Example.COM ")}` })).status).toBe(200);
    for (const bad of ["hr@example.com.evil.com", "hr@example.co", "hr+x@example.com", "hr@example.com\u0000", "%68r@example.com", "hr@example.com' OR '1'='1", "hr@exam\nple.com", "*"]) {
      const r = await call("GET", "/api/me", null, undefined, { authorization: `Bearer ${await token(bad)}` });
      expect(r.status, bad).toBe(403);
    }
    const subOnly = await token("x", { claims: { email: undefined, preferred_username: undefined, sub: "hr" } });
    expect((await call("GET", "/api/me", subOnly)).status).toBe(403);
  });
});

describe("the role comes only from the server's database, never from the client", () => {
  it("role claims in the token, headers, query string and body are ignored", async () => {
    const t = await token(EMP, { claims: { role: "superadmin", roles: ["superadmin"], groups: ["Admins"], scp: ["admin"], is_admin: true } });
    const r = await call("GET", "/api/me?role=superadmin&userRole=hr", t, undefined, { "x-user-role": "superadmin", "x-role": "hr", "x-forwarded-role": "hr" });
    expect(r.json.role).toBe("employee");
    for (const route of ROUTES.filter((x) => x.hr)) {
      const x = await call(route.method, route.path, t, route.method === "GET" ? undefined : route.body ?? { role: "superadmin", userRole: "superadmin" }, { "x-user-role": "superadmin" });
      expect(x.status, `${route.method} ${route.path}`).toBe(403);
    }
  });

  it("employees and managers get 403 on every HR-only route, HR gets through (never 401/403/5xx)", async () => {
    for (const r of ROUTES) {
      for (const who of [EMP, MGR]) {
        const x = await call(r.method, r.path, who, r.body);
        if (r.hr) expect(x.status, `${who} ${r.method} ${r.path}`).toBe(403);
        else expect([401, 403, 500], `${who} ${r.method} ${r.path}`).not.toContain(x.status);
      }
      for (const who of [HR, SA]) {
        const x = await call(r.method, r.path, who, r.body);
        expect([401, 403], `${who} ${r.method} ${r.path}`).not.toContain(x.status);
        expect(x.status, `${who} ${r.method} ${r.path}: ${x.text.slice(0, 120)}`).toBeLessThan(500);
      }
    }
  });

  it("a role changed in the database takes effect on the very next request (no cached privilege)", async () => {
    await ds.query(`UPDATE app_users SET role='hr' WHERE email=$1`, [OTHER]);
    expect((await call("GET", "/api/admin/users", OTHER)).status).toBe(200);
    await ds.query(`UPDATE app_users SET role='employee' WHERE email=$1`, [OTHER]);
    expect((await call("GET", "/api/admin/users", OTHER)).status).toBe(403);
    await ds.query(`UPDATE app_users SET is_active=false WHERE email=$1`, [OTHER]);
    expect((await call("GET", "/api/me", OTHER)).status).toBe(403);
    await ds.query(`UPDATE app_users SET is_active=true WHERE email=$1`, [OTHER]);
  });
});

describe("data scoping: people only see who they are allowed to see", () => {
  const ids = (rows: any[]) => [...new Set(rows.map((r) => r.employeeId))].sort();

  it("an employee sees only their own attendance, weekly, leaves, anchor day and team", async () => {
    expect(ids((await call("GET", `/api/months/${M}/attendance`, EMP)).json)).toEqual(["1002"]);
    expect(ids((await call("GET", `/api/months/${M}/weekly`, EMP)).json)).toEqual(["1002"]);
    expect((await call("GET", `/api/months/${M}/anchor-day`, EMP)).json.employees.map((e: any) => e.employeeId)).toEqual(["1002"]);
    expect((await call("GET", "/api/team", EMP)).json).toEqual([]);
    expect((await call("GET", `/api/months/${M}/leaves`, EMP)).status).toBe(200);
  });

  it("a manager sees themselves and their reports only, not peers or their own boss", async () => {
    expect(ids((await call("GET", `/api/months/${M}/attendance`, MGR)).json)).toEqual(["1001", "1002"]);
    expect(ids((await call("GET", `/api/months/${M}/weekly`, MGR)).json)).toEqual(["1001", "1002"]);
    const team = (await call("GET", "/api/team", MGR)).json;
    expect(team.every((l: any) => ["1001", "1002"].includes(l.employeeId))).toBe(true);
  });

  it("IDOR: asking for someone else's leaves / hours / export returns nothing of theirs", async () => {
    expect((await call("GET", `/api/months/${M}/employees/1003/leaves`, EMP)).json).toEqual([]);
    expect((await call("GET", `/api/months/${M}/employees/1003/leaves`, MGR)).json).toEqual([]);
    const x = await call("GET", `/api/months/${M}/export.xlsx`, EMP);
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await (await fetch(base + `/api/months/${M}/export.xlsx`, { headers: { authorization: `Bearer ${await token(EMP)}` } })).arrayBuffer()) as any);
    const ids1 = new Set<string>();
    wb.getWorksheet("Attendance")!.eachRow((row, n) => { if (n > 2) ids1.add(String(row.getCell(1).value)); });
    expect([...ids1]).toEqual(["1002"]);
  });

  it("an employee with no roster link sees nothing rather than everything", async () => {
    await ds.query(`INSERT INTO app_users (email, name, role) VALUES ('ghost@example.com','Ghost','employee')`);
    for (const p of ["attendance", "weekly", "leaves", "audit", "anchor-day"]) {
      const r = await call("GET", `/api/months/${M}/${p}`, "ghost@example.com");
      expect(r.status, p).toBe(200);
      const rows = Array.isArray(r.json) ? r.json : r.json.employees;
      expect(rows, p).toEqual([]);
    }
  });

  it("issues not tied to one employee (id '-') are not shown to managers or employees", async () => {
    await ds.query(`INSERT INTO audit_issues (month, employee_id, issue_type, at, detail) VALUES ('2026-08-01','-','secret','2026-08-01T00:00:00','hr only')`);
    for (const who of [EMP, MGR]) expect((await call("GET", `/api/months/${M}/audit`, who)).json.some((i: any) => i.employeeId === "-")).toBe(false);
    expect((await call("GET", `/api/months/${M}/audit`, HR)).json.some((i: any) => i.employeeId === "-")).toBe(true);
  });

  it("scoped users cannot write even to their own rows", async () => {
    const body = { employeeId: "1002", workDate: "2026-08-03", hours: 8 };
    for (const who of [EMP, MGR]) {
      expect((await call("PUT", `/api/months/${M}/hours`, who, body)).status).toBe(403);
      expect((await call("PUT", `/api/months/${M}/anchor-day`, who, { employeeId: "1002", date: "2026-08-05", attended: true })).status).toBe(403);
      expect((await call("POST", `/api/months/${M}/leaves`, who, { employeeId: "1002", date: "2026-08-10" })).status).toBe(403);
    }
  });
});

describe("administration: privilege escalation is blocked", () => {
  const add = (who: string, body: object) => call("POST", "/api/admin/users", who, body);

  it("HR cannot create, promote, demote, deactivate or delete a superadmin; a superadmin can", async () => {
    expect((await add(HR, { email: "new-sa@example.com", role: "superadmin" })).status).toBe(400);
    expect((await call("PATCH", `/api/admin/users/${SA}`, HR, { role: "hr" })).status).toBe(400);
    expect((await call("PATCH", `/api/admin/users/${SA}`, HR, { isActive: false })).status).toBe(400);
    expect((await call("DELETE", `/api/admin/users/${SA}`, HR)).status).toBe(400);
    expect((await call("PATCH", `/api/admin/users/${HR}`, HR, { role: "superadmin" })).status).toBe(400);
    expect((await call("GET", "/api/me", SA)).json.role).toBe("superadmin");
    expect((await add(SA, { email: "second-sa@example.com", role: "superadmin" })).status).toBe(201);
    expect((await call("DELETE", "/api/admin/users/second-sa@example.com", SA)).status).toBe(204);
  });

  it("nobody can change their own role or lock themselves out", async () => {
    expect((await call("PATCH", `/api/admin/users/${HR}`, HR, { isActive: false })).status).toBe(400);
    expect((await call("PATCH", `/api/admin/users/${HR}`, HR, { role: "manager" })).status).toBe(400);
    expect((await call("DELETE", `/api/admin/users/${HR}`, HR)).status).toBe(400);
    expect((await call("PATCH", `/api/admin/users/${SA}`, SA, { role: "hr" })).status).toBe(400);
  });

  it("role values are whitelisted; mass assignment of other columns is ignored", async () => {
    for (const role of ["root", "admin", "SUPERADMIN", "hr ", "", null, 1, {}, [], ["hr"]]) {
      expect((await call("PATCH", `/api/admin/users/${EMP}`, HR, { role })).status, JSON.stringify(role)).toBe(400);
    }
    const r = await call("PATCH", `/api/admin/users/${EMP}`, HR, { isActive: true, email: "evil@example.com", employeeId: "1000", username: "x", createdAt: "2000-01-01", __proto__: { role: "hr" } });
    expect(r.status).toBe(200);
    const [row] = await ds.query(`SELECT * FROM app_users WHERE email=$1`, [EMP]);
    expect(row).toMatchObject({ email: EMP, employee_id: "1002", role: "employee" });
    expect(row.username).toBeNull();
    expect((await call("GET", "/api/admin/users", EMP)).status).toBe(403);
  });

  it("adding a user: role forced to hr unless a superadmin asks; bad emails / usernames rejected", async () => {
    const r = await add(HR, { email: "newhr@example.com", role: "manager" });
    expect(r.status).toBe(201);
    expect(r.json.role).toBe("hr");
    for (const email of ["", "nope", "a@b", " @x.com", "a b@c.com", "a@@b.com", 5, null, {}, ["a@b.co"], "x".repeat(300) + "@a.com"]) {
      const x = await add(HR, { email });
      expect(x.status, JSON.stringify(email).slice(0, 40)).toBeGreaterThanOrEqual(400);
      expect(x.status).toBeLessThan(500);
    }
    expect((await add(HR, { email: "u1@example.com", username: "has space" })).status).toBe(400);
    expect((await add(HR, { email: "newhr@example.com" })).status).toBe(400); // duplicate
    expect((await add(HR, { email: "NEWHR@EXAMPLE.COM" })).status).toBe(400); // duplicate in another case
    expect((await add(HR, { email: "u2@example.com", username: SA })).status).toBe(400); // username must not shadow someone's email
    expect((await add(HR, { email: "u3@example.com", username: "newhr@example.com" })).status).toBe(400);
  });

  it("roster users cannot be hand-deleted (they follow the roster)", async () => {
    expect((await call("DELETE", `/api/admin/users/${EMP}`, HR)).status).toBe(404);
  });

  it("every administrative action is recorded in the audit log with the real actor", async () => {
    const logs = (await call("GET", "/api/admin/audit-logs?pageSize=100", HR)).json.items;
    expect(logs.some((l: any) => l.action === "add user" && l.actorEmail === HR && l.actorRole === "hr")).toBe(true);
  });

  it("settings: only whole numbers inside limits, unknown keys rejected, prototype pollution does nothing", async () => {
    for (const body of [{ compliantMinHours: 0 }, { compliantMinHours: 25 }, { compliantMinHours: 1.5 }, { compliantMinHours: "7" }, { compliantMinHours: null }, { compliantMinHours: NaN },
      { compliantMinHours: [7] }, { nope: 1 }, { anchorWeekday: 5 }, { weeklyOfficeDays: 6 }, { dayAttributionBufferMin: -1 }, { maxShiftHours: 49 }]) {
      expect((await call("PUT", "/api/admin/settings", HR, body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const raw of ['{"__proto__":{"polluted":1}}', '{"constructor":{"prototype":{"polluted":1}}}']) {
      expect((await call("PUT", "/api/admin/settings", HR, raw)).status, raw).toBe(400);
    }
    expect(({} as any).polluted).toBeUndefined();
    expect((await call("PUT", "/api/admin/settings", HR, [1, 2])).status).toBeLessThan(500);
    expect((await call("PUT", "/api/admin/settings", HR, { compliantMinHours: 7 })).status).toBe(200);
  });
});

describe("robustness: hostile input never produces a 5xx, a stack trace or data leakage", () => {
  const NASTY = ["'", "' OR 1=1 --", "\"; DROP TABLE app_users; --", "%", "_", "\\", "%00", "\u0000", "../../etc/passwd", "%2e%2e%2f", "<script>alert(1)</script>", "${7*7}", "{{7*7}}", "9".repeat(400), "-1", "0", "NaN", "null", "undefined", "[]", "{}", "😀", "a".repeat(5000)];

  const noLeak = (r: { status: number; text: string }, what: string) => {
    expect(r.status, `${what}: ${r.text.slice(0, 160)}`).toBeLessThan(500);
    expect(r.text, what).not.toMatch(/\bat .*\.(ts|js):\d+|node_modules|QueryFailedError|syntax error at|SELECT .* FROM|password/i);
  };

  it("month path parameter", async () => {
    for (const n of NASTY) {
      for (const [m, p] of [["GET", "attendance"], ["GET", "anchor-day"], ["GET", "weekly"], ["GET", "audit"], ["GET", "leaves"], ["GET", "holidays"], ["GET", "export.xlsx"]] as const) {
        noLeak(await call(m, `/api/months/${encodeURIComponent(n)}/${p}`, HR), `${m} ${n.slice(0, 20)}/${p}`);
      }
      noLeak(await call("POST", `/api/months/${encodeURIComponent(n)}/process`, HR), `process ${n.slice(0, 20)}`);
      noLeak(await call("DELETE", `/api/months/${encodeURIComponent(n)}`, HR), `delete ${n.slice(0, 20)}`);
    }
  });

  it("employee id / date / numeric id path parameters", async () => {
    for (const n of NASTY) {
      const e = encodeURIComponent(n);
      noLeak(await call("GET", `/api/months/${M}/employees/${e}/leaves`, HR), `leaves ${n.slice(0, 20)}`);
      noLeak(await call("PUT", `/api/months/${M}/employees/${e}/leaves`, HR, { dates: [] }), `put leaves ${n.slice(0, 20)}`);
      noLeak(await call("DELETE", `/api/months/${M}/hours/${e}/${e}`, HR), `del hours ${n.slice(0, 20)}`);
      noLeak(await call("DELETE", `/api/months/${M}/leaves/${e}`, HR), `del leave ${n.slice(0, 20)}`);
      noLeak(await call("PATCH", `/api/admin/users/${e}`, HR, {}), `patch user ${n.slice(0, 20)}`);
      noLeak(await call("DELETE", `/api/admin/users/${e}`, HR), `del user ${n.slice(0, 20)}`);
      noLeak(await call("GET", `/api/templates/${e}`, HR), `template ${n.slice(0, 20)}`);
    }
  });

  it("query strings: search, paging and filters", async () => {
    for (const n of NASTY) {
      const e = encodeURIComponent(n);
      for (const p of [`/api/admin/users?q=${e}&role=${e}&page=${e}&pageSize=${e}`, `/api/admin/audit-logs?q=${e}&page=${e}&pageSize=${e}`, `/api/uploads?page=${e}&pageSize=${e}`, `/api/leaves/employees?q=${e}`]) {
        noLeak(await call("GET", p, HR), `${p.slice(0, 50)} ${n.slice(0, 10)}`);
      }
    }
    const big = await call("GET", "/api/admin/users?pageSize=100000&page=-5", HR);
    expect(big.json.pageSize).toBeLessThanOrEqual(100);
    expect(big.json.page).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/api/admin/users?page=99999999999999999999", HR)).status).toBeLessThan(500);
  });

  it("LIKE wildcards in search are matched literally (a '%' cannot dump everything)", async () => {
    const all = (await call("GET", "/api/admin/users?q=nothing-matches-this", HR)).json.total;
    expect(all).toBe(0);
    expect((await call("GET", "/api/admin/users?q=%25", HR)).json.total).toBe(0);
    expect((await call("GET", "/api/admin/users?q=_", HR)).json.total).toBe(0);
    expect((await call("GET", "/api/leaves/employees?q=%25", HR)).json).toEqual([]);
  });

  it("JSON bodies of every wrong shape", async () => {
    const bodies: unknown[] = ["", "null", "[]", "[[]]", "true", "1", '"str"', "{", "{\"a\":", '{"__proto__":{"x":1}}', "\u0000", { employeeId: {}, workDate: [], hours: "x", anchorDate: 1, attended: "yes", date: {}, dates: "x", holidays: "x", email: {}, role: {} }, { dates: [null, 1, {}, "2026-08-03"] }, { holidays: [null, 1, "x", {}] }, { dates: ["2026-02-30"] }];
    for (const r of ROUTES.filter((x) => x.method !== "GET" && x.method !== "DELETE" && !x.path.endsWith("uploads") && !x.path.endsWith("upload"))) {
      for (const b of bodies) {
        const path = r.path.replace(EMPTY, M);
        const x = await call(r.method, path, HR, b);
        noLeak(x, `${r.method} ${path} body=${JSON.stringify(b)?.slice(0, 40)}`);
      }
    }
  });

  it("wrong content types and oversized bodies", async () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/xml"]) {
      noLeak(await call("PUT", "/api/admin/settings", HR, "compliantMinHours=7", { "content-type": ct }), ct);
    }
    const huge = await call("PUT", "/api/admin/settings", HR, JSON.stringify({ x: "a".repeat(2_000_000) }));
    expect(huge.status).toBe(413);
    expect(huge.text).not.toMatch(/node_modules|\.js:\d+/);
  });

  it("dates that look valid but are not (impossible days, month 13, weekends) are refused", async () => {
    const put = (b: object) => call("PUT", `/api/months/${M}/hours`, HR, b);
    for (const workDate of ["2026-02-30", "2026-13-01", "2026-08-32", "2026-8-3", "0000-00-00", "2026-08-03T00:00:00Z", "2026-09-03", "2025-08-03"]) {
      expect((await put({ employeeId: "1002", workDate, hours: 8 })).status, workDate).toBe(400);
    }
    for (const hours of [-1, 25, "8", NaN, Infinity, null, [], {}, 1e308]) {
      expect((await put({ employeeId: "1002", workDate: "2026-08-03", hours })).status, String(hours)).toBe(400);
    }
    expect((await call("PUT", `/api/months/${M}/holidays`, HR, { holidays: [{ date: "2026-08-01" }] })).status).toBe(400); // Saturday
    expect((await call("POST", `/api/months/${M}/leaves`, HR, { employeeId: "1002", date: "2026-08-02" })).status).toBe(400); // Sunday
    expect((await call("POST", `/api/months/${M}/leaves`, HR, { employeeId: "1002", date: "2026-09-02" })).status).toBe(400); // other month
  });

  it("adjusting hours for a person who is not in the month is a 404, not a phantom row", async () => {
    expect((await call("PUT", `/api/months/${M}/hours`, HR, { employeeId: "does-not-exist", workDate: "2026-08-06", hours: 8 })).status).toBe(404);
  });

  it("free-text fields are length-capped (no unbounded storage)", async () => {
    const r = await call("PUT", `/api/months/${M}/hours`, HR, { employeeId: "1002", workDate: "2026-08-06", hours: 8, note: "n".repeat(100_000) });
    expect(r.status).toBeLessThan(500);
    const [row] = await ds.query(`SELECT length(note) AS n FROM manual_adjustments WHERE employee_id='1002' AND work_date='2026-08-06'`);
    expect(row.n).toBeLessThanOrEqual(500);
    expect((await call("POST", "/api/admin/users", HR, { email: "long@example.com", name: "n".repeat(100_000) })).json.name.length).toBeLessThanOrEqual(200);
    expect((await call("POST", "/api/admin/users", HR, { email: "u".repeat(5000) + "@example.com" })).status).toBeLessThan(500);
  });
});

describe("file uploads", () => {
  const up = (path: string, fields: Record<string, string>, file?: { name: string; data: Buffer | string }) => call("POST", path, HR, form(fields, file));

  it("kind and file are validated; wrong or missing values are 400", async () => {
    const f = { name: "a.csv", data: "a,b\n1,2\n" };
    for (const kind of ["", "admin", "ROSTER", "roster,movement", "__proto__", "constructor"]) expect((await up("/api/uploads", { kind }, f)).status, kind).toBe(400);
    expect((await up("/api/uploads", {})).status).toBe(400);
    expect((await up("/api/uploads", { kind: "roster" })).status).toBe(400);
  });

  it("only .csv / .xlsx; disguised, empty, binary and path-traversal names are rejected cleanly", async () => {
    for (const name of ["x.exe", "x.xlsx.exe", "x.php", "x", "x.xls", "x.csv.html", "../../etc/passwd", "x.xlsx\u0000.exe", ".csv"]) {
      const r = await up("/api/uploads", { kind: "roster" }, { name, data: "a,b" });
      expect(r.status, name).toBeGreaterThanOrEqual(400);
      expect(r.status, name).toBeLessThan(500);
    }
    for (const data of ["", "\u0000\u0001\u0002", "PK\u0003\u0004garbage", "a".repeat(10_000)]) {
      const r = await up("/api/uploads", { kind: "roster" }, { name: "x.xlsx", data });
      expect(r.status).toBe(400);
      expect(r.text).not.toMatch(/node_modules|\.js:\d+/);
    }
    expect((await up("/api/uploads", { kind: "roster" }, { name: "x.csv", data: "" })).status).toBe(400);
  });

  it("files over the size limit are refused", async () => {
    const r = await up("/api/leaves/upload", {}, { name: "big.csv", data: "a".repeat(11 * 1024 * 1024) });
    expect(r.status).toBe(400);
    const r2 = await up("/api/uploads", { kind: "roster" }, { name: "big.csv", data: "a".repeat(51 * 1024 * 1024) });
    expect(r2.status).toBe(400);
  }, 30_000);

  it("a bad roster does not wipe the existing roster or logins (upload is transactional)", async () => {
    const before = await ds.query(`SELECT count(*)::int AS n FROM roster_employees`);
    const bad = await xlsx(["a", "b"], [[1, 2]]);
    expect((await up("/api/uploads", { kind: "roster" }, { name: "r.xlsx", data: bad })).status).toBe(400);
    expect((await ds.query(`SELECT count(*)::int AS n FROM roster_employees`))[0].n).toBe(before[0].n);
    expect((await call("GET", "/api/me", EMP)).status).toBe(200);
  });

  it("a roster upload cannot create or escalate an HR / superadmin login", async () => {
    const roster = await xlsx(["Work Shift", "Shift Timing", "Emplid*", "Legal Name*", "Department", "Worker Type", "Sub-Type", "Email", "Hire Date", "Manager", "Transport", "Current Shift Timing"],
      [["General", "9:00 AM - 6:30 PM", 2000, "Hacker", "E", "", "", HR, "", "", "", ""], ["General", "9:00 AM - 6:30 PM", 2001, "Root", "E", "", "", SA, "", "", "", ""], ["General", "9:00 AM - 6:30 PM", 2002, "Eve", "E", "", "", EMP, "", "Hacker", "", ""]]);
    expect((await up("/api/uploads", { kind: "roster" }, { name: "r.xlsx", data: roster })).status).toBe(201);
    expect((await call("GET", "/api/me", HR)).json.role).toBe("hr");
    expect((await call("GET", "/api/me", SA)).json.role).toBe("superadmin");
    // Restore the fixture roster for the tests that follow.
    const again = await xlsx(["Work Shift", "Shift Timing", "Emplid*", "Legal Name*", "Department", "Worker Type", "Sub-Type", "Email", "Hire Date", "Manager", "Transport", "Current Shift Timing"],
      [["General", "9:00 AM - 6:30 PM", 1000, "Dave Director", "Eng", "", "", "dave@example.com", "", "", "", ""], ["General", "9:00 AM - 6:30 PM", 1001, "Mary Manager", "Eng", "", "", MGR, "", "Dave Director", "", ""],
        ["General", "9:00 AM - 6:30 PM", 1002, "Eve Employee", "Eng", "", "", EMP, "", "Mary Manager", "", ""], ["General", "9:00 AM - 6:30 PM", 1003, "Oscar Other", "Ops", "", "", OTHER, "", "Olga Other", "", ""],
        ["General", "9:00 AM - 6:30 PM", 1004, "Olga Other", "Ops", "", "", "olga@example.com", "", "Dave Director", "", ""]]);
    expect((await up("/api/uploads", { kind: "roster" }, { name: "r.xlsx", data: again })).status).toBe(201);
  });

  it("leaves upload validates its rows and rejects non-weekday garbage cleanly", async () => {
    const bad = await up("/api/leaves/upload", {}, { name: "l.csv", data: "Employee ID*,Leave Date*\n1002,not-a-date\n" });
    expect(bad.status).toBe(400);
    const missing = await up("/api/leaves/upload", {}, { name: "l.csv", data: "foo,bar\n1,2\n" });
    expect(missing.status).toBe(400);
    const ok = await up("/api/leaves/upload", {}, { name: "l.csv", data: "Employee ID*,Leave Date*,Description\n1002,2026-08-10,<b>x</b>\n" });
    expect(ok.status).toBe(201);
  });
});

describe("least privilege and request smuggling tricks", () => {
  it("upload file names and other HR-only details are not sent to employees or managers", async () => {
    expect((await call("GET", "/api/months", HR)).json[0].filename).toBeTruthy();
    for (const who of [EMP, MGR]) {
      const r = await call("GET", "/api/months", who);
      expect(r.status).toBe(200);
      expect(r.text).not.toMatch(/filename|\.xlsx|\.csv/);
    }
  });

  it("repeated or array-style query parameters cannot bypass validation", async () => {
    for (const p of ["/api/admin/users?q=a&q=b", "/api/admin/users?role=hr&role=employee", "/api/admin/users?role[]=hr", "/api/admin/users?page=1&page=2&pageSize[]=5", "/api/admin/users?q[$ne]=x", "/api/leaves/employees?q=a&q=b"]) {
      const r = await call("GET", p, HR);
      expect(r.status, p).toBeLessThan(500);
    }
  });

  it("HEAD, OPTIONS and unusual verbs on protected routes need a token too", async () => {
    for (const m of ["HEAD", "OPTIONS", "PATCH", "PUT", "DELETE", "POST"]) {
      const r = await call(m, `/api/months/${M}/attendance`);
      expect([401, 404, 405], m).toContain(r.status);
      expect(r.text).not.toContain("employeeId");
    }
  });

  it("the static site cannot be used to read files outside the web root or to reach /api without a token", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "spa-"));
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "index.html"), "<html>app</html>");
    writeFileSync(join(root, "secret.txt"), "TOP-SECRET");
    process.env.CLIENT_DIST = join(root, "dist");
    const { createApp } = await import("../src/app.js");
    const s = createApp().listen(0);
    process.env.CLIENT_DIST = "";
    const u = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/..%5csecret.txt", "/....//secret.txt", "/%00", "/.env", "/dist/../../secret.txt"]) {
        const r = await fetch(u + p);
        expect(await r.text(), p).not.toContain("TOP-SECRET");
      }
      expect((await fetch(u + "/api/admin/users")).status).toBe(401);
      expect((await fetch(u + "/api/me")).status).toBe(401);
      expect(await (await fetch(u + "/some/page")).text()).toContain("app"); // SPA fallback still works
    } finally { s.close(); }
  });
});

describe("transport, headers and CORS", () => {
  it("every response carries the hardening headers, including errors", async () => {
    for (const r of [await call("GET", "/api/health"), await call("GET", "/api/me"), await call("GET", "/api/me", HR), await call("GET", "/api/admin/users", EMP)]) {
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
      expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(r.headers.get("x-powered-by")).toBeNull();
    }
  });

  it("a foreign origin gets no CORS permission (so a malicious site cannot read the API with a user's token)", async () => {
    const r = await call("GET", "/api/health", null, undefined, { origin: "https://evil.example.com" });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await call("OPTIONS", "/api/admin/users", null, undefined, { origin: "https://evil.example.com", "access-control-request-method": "DELETE", "access-control-request-headers": "authorization" });
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("error responses are generic JSON: no stack traces or SQL", async () => {
    const r = await call("GET", "/api/months/garbage/attendance", HR);
    expect(r.json?.error).toBeTruthy();
    expect(r.text).not.toMatch(/node_modules|\.ts:\d+|QueryFailed/);
  });

  it("the request rate limiter answers 429 instead of letting a client hammer the server", async () => {
    // Hits the limiter directly on a fresh app so the counters of the other tests are not affected.
    process.env.RATE_LIMIT_PER_MIN = "50";
    const { createApp } = await import("../src/app.js");
    const s = createApp().listen(0);
    const u = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/health`;
    let last = 0;
    for (let i = 0; i < 60; i++) last = (await fetch(u)).status;
    s.close();
    expect(last).toBe(429);
  }, 60_000);
});

// Runs last: it edits and finally deletes the month.
describe("functional end-to-end (HR edits, each role then sees the result)", () => {
  const day = async (who: string, date: string) => (await call("GET", `/api/months/${M}/attendance`, who)).json.filter((r: any) => r.employeeId === "1002" && r.workDate === date);

  it("processing the same month twice is idempotent", async () => {
    const a = await call("POST", `/api/months/${M}/process`, HR);
    const b = await call("POST", `/api/months/${M}/process`, HR);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.json.visits).toBe(a.json.visits);
  });

  it("edit, add and revert hours; the employee sees the result flagged as adjusted", async () => {
    const edit = await call("PUT", `/api/months/${M}/hours`, HR, { employeeId: "1002", workDate: "2026-08-03", hours: 3, note: "left early" });
    expect(edit.json).toMatchObject({ ok: true, action: "edit" });
    const [row] = await day(EMP, "2026-08-03");
    expect(row).toMatchObject({ dailyTotalHours: 3, adjustment: "edit" });
    const add = await call("PUT", `/api/months/${M}/hours`, HR, { employeeId: "1002", workDate: "2026-08-06", hours: 8 });
    expect(add.json.action).toBe("add");
    expect((await day(EMP, "2026-08-06"))[0]).toMatchObject({ dailyTotalHours: 8, adjustment: "add" });
    expect((await call("DELETE", `/api/months/${M}/hours/1002/2026-08-03`, HR)).status).toBe(200);
    expect((await call("DELETE", `/api/months/${M}/hours/1002/2026-08-06`, HR)).status).toBe(200);
    expect((await day(EMP, "2026-08-03"))[0].adjustment).toBeNull();
    expect(await day(EMP, "2026-08-06")).toEqual([]);
  });

  it("Anchor-day override, holidays and leaves round-trip", async () => {
    expect((await call("PUT", `/api/months/${M}/anchor-day`, HR, { employeeId: "1002", date: "2026-08-05", attended: false })).status).toBe(200);
    const w = (await call("GET", `/api/months/${M}/anchor-day`, EMP)).json;
    expect(w.employees[0].attended["2026-08-05"]).toBe(false);
    expect((await call("PUT", `/api/months/${M}/anchor-day`, HR, { employeeId: "1002", date: "2026-08-05", attended: null })).status).toBe(200);

    const hol = await call("PUT", `/api/months/${M}/holidays`, HR, { holidays: [{ date: "2026-08-12", description: "Fest" }] });
    expect(hol.json).toEqual([{ date: "2026-08-12", description: "Fest" }]);
    expect((await call("GET", `/api/months/${M}/holidays`, EMP)).json).toEqual([{ date: "2026-08-12", description: "Fest" }]);

    expect((await call("PUT", `/api/months/${M}/employees/1002/leaves`, HR, { dates: ["2026-08-10", "2026-08-11"] })).json).toEqual(["2026-08-10", "2026-08-11"]);
    expect((await call("GET", `/api/months/${M}/employees/1002/leaves`, EMP)).json).toEqual(["2026-08-10", "2026-08-11"]);
    expect((await call("GET", `/api/months/${M}/employees/1002/leaves`, OTHER)).json).toEqual([]);
  });

  it("every change above is in the audit log, attributed to the HR user", async () => {
    for (const a of ["hours edit", "hours add", "hours revert", "anchor day adjustment", "set holidays", "set leaves", "process month"]) {
      const logs = (await call("GET", `/api/admin/audit-logs?pageSize=100&q=${encodeURIComponent(a)}`, HR)).json.items;
      expect(logs.some((l: any) => l.action === a && l.actorEmail === HR && l.actorRole === "hr"), a).toBe(true);
    }
  });

  it("changing the configured anchor day changes the dates, the Excel sheet and the rules text everywhere", async () => {
    expect((await call("PUT", "/api/admin/settings", HR, { anchorWeekday: 3 })).status).toBe(200); // Thursday
    expect((await call("POST", `/api/months/${M}/process`, HR)).status).toBe(200);
    const { dates } = (await call("GET", `/api/months/${M}/anchor-day`, HR)).json;
    expect(dates.length).toBeGreaterThanOrEqual(4);
    expect(dates.every((d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 4)).toBe(true); // Thursdays
    expect((await call("GET", "/api/rules", EMP)).json.anchorDay).toBe("Thursday");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await (await fetch(base + `/api/months/${M}/export.xlsx`, { headers: { authorization: `Bearer ${await token(HR)}` } })).arrayBuffer()) as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Attendance", "Thursday Office Attended"]);
    expect((await call("PUT", "/api/admin/settings", HR, { anchorWeekday: 2 })).status).toBe(200);
    expect((await call("POST", `/api/months/${M}/process`, HR)).status).toBe(200);
  });

  it("export works for HR, and deleting the month removes it for everyone", async () => {
    expect((await call("GET", `/api/months/${M}/export.xlsx`, HR)).status).toBe(200);
    expect((await call("DELETE", `/api/months/${M}`, HR)).status).toBe(204);
    expect((await call("GET", `/api/months/${M}/attendance`, HR)).json).toEqual([]);
    expect((await call("GET", `/api/months/${M}/export.xlsx`, HR)).status).toBe(404);
    expect((await call("GET", `/api/months/${M}/attendance`, EMP)).json).toEqual([]);
  });
});
