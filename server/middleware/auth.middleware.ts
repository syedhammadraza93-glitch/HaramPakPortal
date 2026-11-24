import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { loadAuthUser, type AuthUser } from "../services/authUser.service";
import { forbidden, unauthorized } from "../utils/http";
import type { PermissionCode } from "../utils/permissions";
import type { AgencyAccess } from "../database/schema";
import { requestContext } from "./requestContext";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60 });
}

/**
 * Verifies the Bearer access token and reloads the user from the database on every request,
 * so suspensions and role changes take effect immediately.
 */
export async function jwtGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized("Please log in");

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), env.JWT_SECRET) as jwt.JwtPayload;
    } catch {
      throw unauthorized("Session expired");
    }
    if (typeof payload.sub !== "string") throw unauthorized("Session expired");

    const user = await loadAuthUser(payload.sub);
    if (!user) throw unauthorized("Your account is not active");
    if (user.passwordChangedAt && (payload.iat ?? 0) * 1000 < user.passwordChangedAt.getTime() - 1000) {
      throw unauthorized("Session expired");
    }

    req.user = user;
    const store = requestContext.getStore();
    if (store) store.user = user;

    next();
  } catch (e) {
    next(e);
  }
}

/** User must hold ALL listed permissions. Use after jwtGuard. */
export const requirePermission =
  (...required: PermissionCode[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(unauthorized());
    if (required.some((p) => !user.permissions.includes(p))) return next(forbidden());
    next();
  };

/** Returns the logged-in user; only call in routes protected by jwtGuard. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export const requireAgencyAccess = (module: keyof AgencyAccess) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const user = currentUser(req);
    if (user.type !== "agent" || user.agency?.status !== "active" || !user.agency.access[module]) {
      return next(forbidden("Your agency does not have access to this feature"));
    }
    next();
  };
