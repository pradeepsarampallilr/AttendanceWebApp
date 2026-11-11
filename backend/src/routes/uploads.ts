/** Accepts uploaded roster, movement and transport files, and lists past uploads. */
import { Router } from "express";
import multer from "multer";
import { AppDataSource } from "../db.js";
import { inferMonthBounds } from "../engine/movement.js";
import {
  ValidationError, assertMovementHeader, assertRosterHeader, eventsFromMovementTable,
  fallbackNamesFromTable, readTable, rosterFromTable, transportFromTable,
} from "../io/tables.js";
import { buildReportingLines } from "../engine/hierarchy.js";
import { logAction } from "../services/audit.js";
import { requireWrite } from "../services/access.js";
import { syncRosterUsers } from "../services/users.js";
import { ReportingLine, RosterEmployee, TransportEmployee, Upload } from "../models/index.js";
import { insertChunked, insertSwipeEvents, monthStart, refreshTransportOptIn } from "../services/store.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
export const uploadsRouter = Router();

uploadsRouter.use(requireWrite);

uploadsRouter.post("/", upload.single("file"), async (req, res) => {
  const kind = req.body?.kind;
  if (kind !== "roster" && kind !== "movement" && kind !== "transport")
    throw new ValidationError("kind must be 'roster', 'movement' or 'transport'");
  const file = req.file;
  if (!file) throw new ValidationError("Missing file (multipart field 'file')");
  if (!/\.(csv|xlsx)$/i.test(file.originalname)) throw new ValidationError("File must be .csv or .xlsx");

  let table: unknown[][];
  try {
    table = await readTable(file.buffer, file.originalname);
  } catch (e) {
    throw new ValidationError(`Could not read ${file.originalname}: ${(e as Error).message}`);
  }

  const uploadedBy = req.userEmail ?? "";
  const result = await AppDataSource.transaction(async (m) => {
    if (kind === "transport") {
      const list = transportFromTable(table);
      if (!list.length) throw new ValidationError("Transport file contains no employees");
      const u = await m.save(m.create(Upload, { kind: "transport", filename: file.originalname, rowCount: list.length, uploadedBy }));
      await m.clear(TransportEmployee); // latest upload replaces the whole table
      await insertChunked(m, TransportEmployee, list.map((r) => m.create(TransportEmployee, { ...r, uploadId: u.id })));
      await refreshTransportOptIn(m); // already-processed months pick up the new list immediately
      return { id: u.id, kind, filename: u.filename, employees: list.length };
    }
    if (kind === "roster") {
      assertRosterHeader(table);
      const { roster } = rosterFromTable(table);
      if (!roster.size) throw new ValidationError("Roster file contains no employees");
      const u = await m.save(m.create(Upload, { kind: "roster", filename: file.originalname, rowCount: roster.size, uploadedBy }));
      await m.clear(RosterEmployee);
      await insertChunked(m, RosterEmployee, [...roster.values()].map((e) => m.create(RosterEmployee, {
        employeeId: e.employeeId, name: e.name, email: e.email, department: e.department,
        managerName: e.managerName, managerEmail: e.managerEmail,
        shiftLabel: e.shift?.label ?? null, shiftStartMin: e.shift?.startMinutes ?? null, shiftEndMin: e.shift?.endMinutes ?? null,
        uploadId: u.id })));
      // Rebuild who-reports-to-whom from the manager names, then give every employee and manager a login.
      const lines = buildReportingLines([...roster.values()]);
      await m.clear(ReportingLine);
      await insertChunked(m, ReportingLine, lines.map((l) => m.create(ReportingLine, l)));
      await syncRosterUsers(m, [...roster.values()], new Set(lines.map((l) => l.managerId)));
      return { id: u.id, kind, filename: u.filename, employees: roster.size };
    }
    assertMovementHeader(table);
    const events = eventsFromMovementTable(table);
    if (!events.size) throw new ValidationError("Movement file contains no swipe events");
    const { year, month } = inferMonthBounds(events);
    const ms = monthStart(year, month);
    await m.delete(Upload, { kind: "movement", month: ms });
    const u = await m.save(m.create(Upload, { kind: "movement", filename: file.originalname, month: ms, uploadedBy }));
    const count = await insertSwipeEvents(m, u.id, events, fallbackNamesFromTable(table));
    await m.update(Upload, u.id, { rowCount: count });
    return { id: u.id, kind, filename: u.filename, month: ms, events: count };
  });
  await logAction(req, `upload ${kind}`, "upload", `${file.originalname} (#${result.id})`);
  res.status(201).json(result);
});

/** Upload history, newest first, one page at a time: ?page=1&pageSize=10. */
uploadsRouter.get("/", async (req, res) => {
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const page = Math.max(1, Number(req.query.page) || 1);
  const [items, total] = await AppDataSource.getRepository(Upload).findAndCount({
    order: { id: "DESC" }, skip: (page - 1) * pageSize, take: pageSize });
  res.json({ items, total, page, pageSize });
});
