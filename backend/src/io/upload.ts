/** Single-file upload (multipart field "file") kept in memory; oversize files and broken multipart bodies become 400s. */
import type { RequestHandler } from "express";
import multer from "multer";
import { ValidationError } from "./tables.js";

export function singleFile(maxBytes: number): RequestHandler {
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 10, parts: 20 } }).single("file");
  return (req, res, next) => parse(req, res, (err?: unknown) => {
    if (!err) return next();
    const tooBig = (err as { code?: string }).code === "LIMIT_FILE_SIZE";
    next(new ValidationError(tooBig ? `File is too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB)` : "Could not read the uploaded form"));
  });
}
