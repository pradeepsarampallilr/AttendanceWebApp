/** Single-file upload (multipart field "file") kept in memory; oversize files and broken multipart bodies become 400s. */
import "dotenv/config";
import type { RequestHandler } from "express";
import multer from "multer";
import { ValidationError } from "./tables.js";

const MB = 1024 * 1024;

/** Largest file in bytes: roster / movement / transport (MAX_UPLOAD_MB, default 50) and leaves (fixed 10 MB). */
export const uploadLimits = () => ({ data: (Number(process.env.MAX_UPLOAD_MB) || 50) * MB, leaves: 10 * MB });

/** Room for the multipart boundaries and the `kind` field around the file itself. */
const FORM_OVERHEAD = 64 * 1024;

export function singleFile(maxBytes: number): RequestHandler {
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 10, parts: 20 } }).single("file");
  const tooLarge = new ValidationError(`File is too large (limit ${Math.round(maxBytes / MB)} MB)`);
  return (req, res, next) => {
    // The declared size is known up front, so a file that cannot fit is refused without parsing the body.
    if (Number(req.headers["content-length"]) > maxBytes + FORM_OVERHEAD) return next(tooLarge);
    parse(req, res, (err?: unknown) => {
      if (!err) return next();
      next((err as { code?: string }).code === "LIMIT_FILE_SIZE" ? tooLarge : new ValidationError("Could not read the uploaded form"));
    });
  };
}
