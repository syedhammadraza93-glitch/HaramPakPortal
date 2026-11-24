import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { AppError } from "../utils/http";

const GENERIC = "The request could not be completed. Please try again or contact the administrator.";

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: "A file is larger than 5 MB",
  LIMIT_FILE_COUNT: "Too many files",
  LIMIT_UNEXPECTED_FILE: "Unexpected file field",
  LIMIT_FIELD_COUNT: "Too many fields",
};

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
}

/**
 * Final error handler. AppError messages are shown to the user; anything else (database errors,
 * bugs) returns a generic message so SQL, stack traces or file paths never reach the client.
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}), ...(err.errors ? { errors: err.errors } : {}) });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ success: false, message: MULTER_MESSAGES[err.code] ?? "File upload failed" });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ success: false, message: "Invalid JSON body" });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ success: false, message: "Request is too large" });
    return;
  }

  // Ledger rules enforced by database triggers (immutable entries, closed months): their messages are written for users.
  const pg = err?.cause?.code ? err.cause : err;
  if (pg?.code === "P0001" && typeof pg.message === "string") {
    res.status(409).json({ success: false, message: pg.message });
    return;
  }

  console.error(`❌ ${req.method} ${req.originalUrl}:`, err?.stack || err);
  res.status(500).json({ success: false, message: GENERIC });
}
