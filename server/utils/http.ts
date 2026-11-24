import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodError, ZodTypeAny, z } from "zod";

export interface FieldError {
  path: string;
  message: string;
}

/** An error with an HTTP status that is safe to show to the user. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: FieldError[],
    /** Machine-readable reason the frontend can react to, e.g. MFA_SETUP_REQUIRED. */
    public readonly code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, errors?: FieldError[]) => new AppError(400, message, errors);
export const unauthorized = (message = "Please log in") => new AppError(401, message);
export const forbidden = (message = "You do not have permission to do this") => new AppError(403, message);
export const notFound = (message = "Not found") => new AppError(404, message);
export const conflict = (message: string, errors?: FieldError[]) => new AppError(409, message, errors);

export const zodErrors = (error: ZodError): FieldError[] =>
  error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

export const validationFailed = (errors: FieldError[]) => new AppError(400, "Please correct the highlighted fields", errors);

/** Validates input with a Zod schema; throws a 400 with field errors when invalid. */
export function parse<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw validationFailed(zodErrors(result.error));
  return result.data;
}

/** Passes errors from async controllers to the error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Standard success response: { success: true, message?, data } */
export function ok(res: Response, data: unknown, message?: string, status = 200) {
  res.status(status).json({ success: true, ...(message ? { message } : {}), data });
}
