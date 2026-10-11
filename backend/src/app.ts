import { existsSync } from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler } from "express";
import { pool } from "./db.js";
import { ValidationError } from "./io/tables.js";
import { monthsRouter } from "./routes/months.js";
import { uploadsRouter } from "./routes/uploads.js";
import { NotFoundError } from "./services/process.js";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/health", async (_req, res) => {
    const { rows } = await pool.query("SELECT now() AS now");
    res.json({ ok: true, dbTime: rows[0].now });
  });
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/months", monthsRouter);

  // Production: serve the built client (set CLIENT_DIST) with SPA fallback; /api stays JSON-only.
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
