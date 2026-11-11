/** Lets users upload a leave file and search employees for the leave calendar. */
import { Router } from "express";
import { ILike, Like } from "typeorm";
import { AppDataSource } from "../db.js";
import { ValidationError, leavesFromTable, readUploadedTable } from "../io/tables.js";
import { singleFile } from "../io/upload.js";
import { Leave, RosterEmployee, Upload } from "../models/index.js";
import { requireWrite } from "../services/access.js";
import { logAction } from "../services/audit.js";
import { escapeLike } from "../services/store.js";

const upload = singleFile(10 * 1024 * 1024);
export const leavesRouter = Router();
leavesRouter.use(requireWrite);

leavesRouter.post("/upload", upload, async (req, res) => {
  const file = req.file!; // readUploadedTable rejects a missing file
  const list = leavesFromTable(await readUploadedTable(file));
  if (!list.length) throw new ValidationError("Leave file contains no leaves");
  const months = [...new Set(list.map((l) => l.leaveDate.slice(0, 7)))].sort();
  await AppDataSource.transaction(async (m) => {
    const names = new Map((await m.find(RosterEmployee, { select: { employeeId: true, name: true } })).map((r) => [r.employeeId, r.name]));
    await m.insert(Upload, { kind: "leaves", filename: file.originalname, rowCount: list.length, uploadedBy: req.userEmail ?? "" });
    for (let i = 0; i < list.length; i += 1000) {
      await m.upsert(Leave, list.slice(i, i + 1000).map((l) => ({ ...l, employeeName: l.employeeName || names.get(l.employeeId) || "" })), ["employeeId", "leaveDate"]);
    }
  });
  await logAction(req, "upload leaves", "upload", `${file.originalname}: ${list.length} leave days`);
  res.status(201).json({ filename: file.originalname, leaves: list.length, employees: new Set(list.map((l) => l.employeeId)).size, months });
});

leavesRouter.get("/employees", async (req, res) => {
  const q = escapeLike(req.query.q);
  if (!q) return void res.json([]);
  const rows = await AppDataSource.getRepository(RosterEmployee).find({
    where: [{ name: ILike(`%${q}%`) }, { employeeId: Like(`${q}%`) }],
    select: { employeeId: true, name: true, department: true }, order: { name: "ASC" }, take: 20 });
  res.json(rows.map((r) => ({ employeeId: r.employeeId, name: r.name, department: r.department })));
});
