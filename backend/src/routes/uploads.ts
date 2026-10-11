import { Router } from "express";
import multer from "multer";
import { pool } from "../db.js";
import { inferMonthBounds } from "../engine/movement.js";
import {
  ValidationError, assertMovementHeader, assertRosterHeader, eventsFromMovementTable,
  fallbackNamesFromTable, readTable, rosterFromTable, transportFromTable,
} from "../io/tables.js";
import { insertSwipeEvents, monthStart, refreshTransportOptIn } from "../services/store.js";

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

  const db = await pool.connect();
  try {
    if (kind === "transport") {
      const list = transportFromTable(table);
      if (!list.length) throw new ValidationError("Transport file contains no employees");
      await db.query("BEGIN");
      const { rows: [u] } = await db.query(
        "INSERT INTO uploads (kind, filename, row_count) VALUES ('transport', $1, $2) RETURNING id, filename", [file.originalname, list.length]);
      await db.query("DELETE FROM transport_employees");
      const col = (f: (r: (typeof list)[number]) => string) => list.map(f);
      await db.query(
        `INSERT INTO transport_employees (employee_id, department, full_name, email, business_title, contact_no, gender,
           manager_name, manager_email, working_days, shift, address_line1, address_line2, city, postal_code, upload_id)
         SELECT *, $16 FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
           $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::text[])`,
        [col((r) => r.employeeId), col((r) => r.department), col((r) => r.fullName), col((r) => r.email), col((r) => r.businessTitle),
          col((r) => r.contactNo), col((r) => r.gender), col((r) => r.managerName), col((r) => r.managerEmail), col((r) => r.workingDays),
          col((r) => r.shift), col((r) => r.addressLine1), col((r) => r.addressLine2), col((r) => r.city), col((r) => r.postalCode), u.id]);
      await refreshTransportOptIn(db); // already-processed months pick up the new list immediately
      await db.query("COMMIT");
      res.status(201).json({ id: u.id, kind, filename: u.filename, employees: list.length });
    } else if (kind === "roster") {
      assertRosterHeader(table);
      const { roster } = rosterFromTable(table);
      if (!roster.size) throw new ValidationError("Roster file contains no employees");
      await db.query("BEGIN");
      const { rows: [u] } = await db.query(
        "INSERT INTO uploads (kind, filename, row_count) VALUES ('roster', $1, $2) RETURNING *", [file.originalname, roster.size]);
      await db.query("DELETE FROM roster_employees");
      const list = [...roster.values()];
      await db.query(
        `INSERT INTO roster_employees (employee_id, name, email, department, manager_name, manager_email,
           shift_label, shift_start_min, shift_end_min, upload_id)
         SELECT *, $10 FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::int[])`,
        [list.map((e) => e.employeeId), list.map((e) => e.name), list.map((e) => e.email), list.map((e) => e.department),
          list.map((e) => e.managerName), list.map((e) => e.managerEmail), list.map((e) => e.shift?.label ?? null),
          list.map((e) => e.shift?.startMinutes ?? null), list.map((e) => e.shift?.endMinutes ?? null), u.id]);
      await db.query("COMMIT");
      res.status(201).json({ id: u.id, kind, filename: u.filename, employees: roster.size });
    } else {
      assertMovementHeader(table);
      const events = eventsFromMovementTable(table);
      if (!events.size) throw new ValidationError("Movement file contains no swipe events");
      const { year, month } = inferMonthBounds(events);
      const ms = monthStart(year, month);
      await db.query("BEGIN");
      // Re-uploading a month replaces its earlier upload (and, via cascade, that upload's swipes).
      await db.query("DELETE FROM uploads WHERE kind = 'movement' AND month = $1", [ms]);
      const { rows: [u] } = await db.query(
        "INSERT INTO uploads (kind, filename, month) VALUES ('movement', $1, $2) RETURNING id, filename", [file.originalname, ms]);
      const count = await insertSwipeEvents(db, u.id, events, fallbackNamesFromTable(table));
      await db.query("UPDATE uploads SET row_count = $1 WHERE id = $2", [count, u.id]);
      await db.query("COMMIT");
      res.status(201).json({ id: u.id, kind, filename: u.filename, month: ms, events: count });
    }
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
});

uploadsRouter.get("/", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, kind, filename, month, row_count AS \"rowCount\", status, uploaded_at AS \"uploadedAt\" FROM uploads ORDER BY id DESC");
  res.json(rows);
});
