/**
 * Sets up the web server: its routes, login check, static website files and error handling.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { oktaAuth } from "./auth.js";
import { ValidationError, buildTemplate, isTemplateKind } from "./io/tables.js";
import { adminRouter } from "./routes/admin.js";
import { leavesRouter } from "./routes/leaves.js";
import { monthsRouter } from "./routes/months.js";
import { uploadsRouter } from "./routes/uploads.js";
import { NotFoundError } from "./services/process.js";
import cors from "cors";
import { getRules } from "./engine/rules.js";
import { myEmployeeId, requireWrite, teamLines } from "./services/access.js";

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.okta.com https://*.oktapreview.com; frame-ancestors 'none'; base-uri 'self'",
  });
  next();
};

/** Fixed-window request cap per client address (in memory, so per server process). */
function rateLimit(perMinute: number): RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req, res, next) => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const key = req.ip ?? "";
    const h = hits.get(key) ?? { n: 0, reset: now + 60_000 };
    hits.set(key, h);
    if (++h.n > perMinute) return void res.status(429).json({ error: "Too many requests, try again in a minute" });
    next();
  };
}

/** `auth` is for tests to inject a fixed user; production always uses Okta (nothing in the environment can swap it). */
export function createApp(auth: RequestHandler = oktaAuth()) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: "1mb" }));
  // Browsers on other origins are refused unless listed in CORS_ORIGIN (comma separated). The built site is same-origin.
  const origins = (process.env.CORS_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false }));
  app.use("/api", rateLimit(Number(process.env.RATE_LIMIT_PER_MIN) || 600));

  app.get("/api/health", (_req, res) => void res.json({ ok: true }));
  app.use("/api", auth);
  app.get("/api/me", async (req, res) => void res.json({ email: req.userEmail ?? null, role: req.userRole ?? null, employeeId: await myEmployeeId(req) }));
  /** Reporting lines the caller may see (manager above employee, at any depth), with the manager's roster name. */
  app.get("/api/team", async (req, res) => void res.json(await teamLines(req)));
  app.get("/api/rules", (_req, res) => void res.json(getRules()));
  app.get("/api/templates/:kind", requireWrite, async (req, res) => {
    const kind = String(req.params.kind).replace(/\.xlsx$/i, "");
    if (!isTemplateKind(kind)) throw new NotFoundError(`Unknown template: ${kind}`);
    res.attachment(`${kind}-template.xlsx`).type("xlsx").send(await buildTemplate(kind));
  });
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/months", monthsRouter);
  app.use("/api/leaves", leavesRouter);
  app.use("/api/admin", adminRouter);

  const dist = process.env.CLIENT_DIST && path.resolve(process.env.CLIENT_DIST);
  if (dist && existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => (req.method === "GET" && !req.path.startsWith("/api") ? res.sendFile(path.join(dist, "index.html")) : next()));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ValidationError || err instanceof RangeError) return void res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return void res.status(404).json({ error: err.message });
    if (err?.name === "MulterError") return void res.status(400).json({ error: err.message });
    // Body-parser failures (bad JSON, body too large) carry their own 4xx status.
    const status = err?.status ?? err?.statusCode;
    if (err?.expose && status >= 400 && status < 500) return void res.status(status).json({ error: status === 413 ? "Request body is too large" : "Malformed request" });
    // Postgres "data exception" (class 22): the client sent a value the column cannot hold (NUL byte, text for a number, ...).
    if (String(err?.driverError?.code ?? "").startsWith("22")) return void res.status(400).json({ error: "Invalid value in request" });
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(onError);
  return app;
}
