/**
 * Sets up the web server: its routes, login check, static website files and error handling.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler } from "express";
import { oktaAuth } from "./auth.js";
import { AppDataSource } from "./db.js";
import { ValidationError, buildTemplate, isTemplateKind } from "./io/tables.js";
import { adminRouter } from "./routes/admin.js";
import { leavesRouter } from "./routes/leaves.js";
import { monthsRouter } from "./routes/months.js";
import { uploadsRouter } from "./routes/uploads.js";
import { NotFoundError } from "./services/process.js";
import cors from 'cors';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cors());

  app.get("/api/health", async (_req, res) => {
    const [{ now }] = await AppDataSource.query("SELECT now() AS now");
    res.json({ ok: true, dbTime: now });
  });
  app.use("/api", oktaAuth());
  app.get("/api/me", (req, res) => void res.json({ email: req.userEmail ?? null, role: req.userRole ?? null }));
  app.get("/api/templates/:kind", async (req, res) => {
    const kind = req.params.kind.replace(/\.xlsx$/i, "");
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
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(onError);
  return app;
}
