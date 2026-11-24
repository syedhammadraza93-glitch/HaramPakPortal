import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../database/connection";
import { users, type User } from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { logAudit } from "../services/audit.service";
import { getTwoFactorPolicy, mfaRequiredFor } from "../services/authUser.service";
import { verifyOtp } from "../services/otp.service";
import { verifyPassword } from "../utils/crypto";
import { badRequest, forbidden, ok, parse, unauthorized } from "../utils/http";
import { lockedMessage, recordFailedLogin, recordSuccessfulLogin, sendLoginCode, startSession } from "./auth.controller";

const loginMfaSchema = z.object({ mfaToken: z.string().min(10), code: z.string().trim().min(6, "Enter the 6-digit code").max(7) });
const tokenSchema = z.object({ mfaToken: z.string().min(10) });
const toggleSchema = z.object({ enabled: z.boolean(), password: z.string().min(1, "Password is required") });

/** Reads the short-lived token from the first login step and returns the user. */
async function userFromMfaToken(mfaToken: string): Promise<User> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(mfaToken, env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw unauthorized("This login attempt has expired. Please enter your password again.");
  }
  if (payload.purpose !== "mfa" || typeof payload.sub !== "string") throw unauthorized("Please log in again.");
  const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
  if (!user || user.status !== "active") throw unauthorized("Please log in again.");
  if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized(lockedMessage(user.lockedUntil));
  return user;
}

/** POST /api/auth/login/mfa  { mfaToken, code }: second login step with the emailed code. */
export const loginWithMfa = async (req: Request, res: Response) => {
  const body = parse(loginMfaSchema, req.body);
  const user = await userFromMfaToken(body.mfaToken);
  try {
    await verifyOtp(user.email, "two_factor", body.code);
  } catch (e) {
    // Wrong codes also count towards the account lockout.
    const lockMessage = await recordFailedLogin(user, "bad_login_code");
    if (lockMessage) throw unauthorized(lockMessage);
    throw e;
  }
  await recordSuccessfulLogin(user);
  ok(res, await startSession(res, user.id));
};

/** POST /api/auth/login/mfa/resend  { mfaToken }: emails a new login code (30-second wait between codes). */
export const resendLoginCode = async (req: Request, res: Response) => {
  const { mfaToken } = parse(tokenSchema, req.body);
  const user = await userFromMfaToken(mfaToken);
  ok(res, await sendLoginCode(user), "A new code has been sent.");
};

/** GET /api/auth/mfa */
export const getMfaStatus = async (req: Request, res: Response) => {
  const me = currentUser(req);
  ok(res, { enabled: me.mfaEnabled, required: me.mfaRequired, available: me.mfaAvailable });
};

/** PUT /api/auth/mfa  { enabled, password }: turn emailed login codes on or off (not for roles that require them). */
export const setMfa = async (req: Request, res: Response) => {
  const me = currentUser(req);
  const { enabled, password } = parse(toggleSchema, req.body);
  const policy = await getTwoFactorPolicy();
  if (!policy.enabled) throw forbidden("Two-factor login is switched off for the portal (Settings → Security).");
  if (!enabled && mfaRequiredFor(policy, me.roles)) throw forbidden("Your role requires two-factor login, so it cannot be turned off.");
  const [user] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw badRequest("Password is incorrect", [{ path: "password", message: "Password is incorrect" }]);
  }
  await db.update(users).set({ mfaEnabled: enabled }).where(eq(users.id, me.id));
  await logAudit({ action: enabled ? "auth.mfa_enabled" : "auth.mfa_disabled", entityType: "user", entityId: me.id });
  ok(res, { enabled }, enabled ? "Two-factor login is on. You will get a code by email at every login." : "Two-factor login is off.");
};
