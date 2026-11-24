import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { AuthUser } from "../services/authUser.service";

export interface RequestStore {
  ip?: string;
  userAgent?: string;
  user?: AuthUser;
}

/** Per-request context (IP, user agent, logged-in user) readable from services, e.g. for the audit log. */
export const requestContext = new AsyncLocalStorage<RequestStore>();

export const getRequestContext = (): RequestStore => requestContext.getStore() ?? {};

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  const ua = req.headers["user-agent"];
  requestContext.run({ ip: req.ip, userAgent: ua?.slice(0, 300) }, next);
}
