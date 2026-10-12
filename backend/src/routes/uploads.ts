import { Router } from "express";
import multer from "multer";
import { AppDataSource } from "../db.js";
import { inferMonthBounds } from "../engine/movement.js";
import {
  ValidationError, assertMovementHeader, assertRosterHeader, eventsFromMovementTable,
  fallbackNamesFromTable, readTable, rosterFromTable, transportFromTable,
} from "../io/tables.js";
import { RosterEmployee, TransportEmployee, Upload } from "../models/index.js";
import { insertChunked, insertSwipeEvents, monthStart, refreshTransportOptIn } from "../services/store.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
export const uploadsRouter = Router();

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

  // One transaction per upload: any failure (validation included) rolls the whole thing back.
  const result = await AppDataSource.transaction(async (m) => {
    if (kind === "transport") {
      const list = transportFromTable(table);
      if (!list.length) throw new ValidationError("Transport file contains no employees");
      const u = await m.save(m.create(Upload, { kind: "transport", filename: file.originalname, rowCount: list.length }));
      await m.clear(TransportEmployee); // latest upload replaces the whole table
      await insertChunked(m, TransportEmployee, list.map((r) => m.create(TransportEmployee, { ...r, uploadId: u.id })));
      await refreshTransportOptIn(m); // already-processed months pick up the new list immediately
      return { id: u.id, kind, filename: u.filename, employees: list.length };
    }
    if (kind === "roster") {
      assertRosterHeader(table);
      const { roster } = rosterFromTable(table);
      if (!roster.size) throw new ValidationError("Roster file contains no employees");
      const u = await m.save(m.create(Upload, { kind: "roster", filename: file.originalname, rowCount: roster.size }));
      await m.clear(RosterEmployee);
      await insertChunked(m, RosterEmployee, [...roster.values()].map((e) => m.create(RosterEmployee, {
        employeeId: e.employeeId, name: e.name, email: e.email, department: e.department,
        managerName: e.managerName, managerEmail: e.managerEmail,
        shiftLabel: e.shift?.label ?? null, shiftStartMin: e.shift?.startMinutes ?? null, shiftEndMin: e.shift?.endMinutes ?? null,
        uploadId: u.id })));
      return { id: u.id, kind, filename: u.filename, employees: roster.size };
    }
    assertMovementHeader(table);
    const events = eventsFromMovementTable(table);
    if (!events.size) throw new ValidationError("Movement file contains no swipe events");
    const { year, month } = inferMonthBounds(events);
    const ms = monthStart(year, month);
    // Re-uploading a month replaces its earlier upload (and, via cascade, that upload's swipes).
    await m.delete(Upload, { kind: "movement", month: ms });
    const u = await m.save(m.create(Upload, { kind: "movement", filename: file.originalname, month: ms }));
    const count = await insertSwipeEvents(m, u.id, events, fallbackNamesFromTable(table));
    await m.update(Upload, u.id, { rowCount: count });
    return { id: u.id, kind, filename: u.filename, month: ms, events: count };
  });
  res.status(201).json(result);
});

uploadsRouter.get("/", async (_req, res) => {
  res.json(await AppDataSource.getRepository(Upload).find({ order: { id: "DESC" } }));
});
