/** Lets users upload a leave file and search employees for the leave calendar. */
import { Router } from "express";
import multer from "multer";
import { ILike, Like } from "typeorm";
import { AppDataSource } from "../db.js";
import { ValidationError, leavesFromTable, readTable } from "../io/tables.js";
import { Leave, RosterEmployee } from "../models/index.js";
import { insertChunked } from "../services/store.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
export const leavesRouter = Router();

leavesRouter.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw new ValidationError("Missing file (multipart field 'file')");
  if (!/\.(csv|xlsx)$/i.test(file.originalname)) throw new ValidationError("File must be .csv or .xlsx");
  let table: unknown[][];
  try {
    table = await readTable(file.buffer, file.originalname);
  } catch (e) {
    throw new ValidationError(`Could not read ${file.originalname}: ${(e as Error).message}`);
  }
  const list = leavesFromTable(table);
  if (!list.length) throw new ValidationError("Leave file contains no leaves");
  const months = [...new Set(list.map((l) => l.leaveDate.slice(0, 7)))].sort();
  await AppDataSource.transaction(async (m) => {
    const names = new Map((await m.find(RosterEmployee, { select: { employeeId: true, name: true } })).map((r) => [r.employeeId, r.name]));
    for (let i = 0; i < list.length; i += 1000) {
      await m.upsert(Leave, list.slice(i, i + 1000).map((l) => ({ ...l, employeeName: l.employeeName || names.get(l.employeeId) || "" })), ["employeeId", "leaveDate"]);
    }
  });
  res.status(201).json({ filename: file.originalname, leaves: list.length, employees: new Set(list.map((l) => l.employeeId)).size, months });
});

leavesRouter.get("/employees", async (req, res) => {
  const q = String(req.query.q ?? "").trim().replace(/[\\%_]/g, "\\$&");
  if (!q) return void res.json([]);
  const rows = await AppDataSource.getRepository(RosterEmployee).find({
    where: [{ name: ILike(`%${q}%`) }, { employeeId: Like(`${q}%`) }],
    select: { employeeId: true, name: true, department: true }, order: { name: "ASC" }, take: 20 });
  res.json(rows.map((r) => ({ employeeId: r.employeeId, name: r.name, department: r.department })));
});
