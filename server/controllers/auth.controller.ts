import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env, secureCookies } from "../config/env";
import { db } from "../database/connection";
import { agencies, agencyStatusHistory, loginAttempts, refreshTokens, users, type User } from "../database/schema";
import { currentUser, signAccessToken } from "../middleware/auth.middleware";
import { getRequestContext } from "../middleware/requestContext";
import { logAudit } from "../services/audit.service";
import { getTwoFactorPolicy, loadAuthUser, mfaActiveFor, toMe } from "../services/authUser.service";
import { frontendUrl, getMailBrand, queueEmail, queueEmailToPermission } from "../services/mail.service";
import { createOtp, maskEmail, verifyOtp } from "../services/otp.service";
import { consumeToken } from "../services/token.service";
import { hashPassword, randomToken, sha256, verifyPassword } from "../utils/crypto";
import { mailTemplates } from "../utils/emails/templates";
import { badRequest, notFound, ok, parse, unauthorized } from "../utils/http";
import { emailSchema, passwordSchema, uuidSchema } from "../utils/validation";

export const REFRESH_COOKIE = "hp_rt";
const COOKIE_PATH = "/api/auth";
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** A rotated refresh token used again within this window (two tabs refreshing at once) is not treated as theft. */
const REUSE_GRACE_MS = 10_000;

const BLOCKED_MESSAGES: Record<string, string> = {
  pending_email_verification: "Please verify your email first. Enter the code we emailed you.",
  suspended: "Your agency account is suspended. Please contact our team.",
  rejected: "Your agency application was not approved. Please contact our sales team.",
  deactivated: "Your agency account has been deactivated.",
};

const codeField = z.string().trim().min(6, "Enter the 6-digit code").max(7);
const loginSchema = z.object({ email: z.string().trim().min(1, "Email is required"), password: z.string().min(1, "Password is required") });
const emailOnlySchema = z.object({ email: emailSchema });
const verifySchema = z.object({ email: emailSchema, code: codeField });
const resetSchema = z
  .object({ email: emailSchema, code: codeField, password: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });
const inviteSchema = z
  .object({ token: z.string().min(10, "Invalid link"), password: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });
const changeSchema = z
  .object({ currentPassword: z.string().min(1, "Current password is required"), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

// ---------- helpers ----------

const revokeAllSessions = (userId: string) =>
  db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));

/** Creates a refresh token (httpOnly cookie) and an access token, and returns the session body. */
export async function startSession(res: Response, userId: string, previous?: { userAgent: string | null; ip: string | null }) {
  const user = await loadAuthUser(userId);
  if (!user) throw unauthorized("Your account is not active");
  const ctx = getRequestContext();
  const refresh = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(refresh),
    userAgent: ctx.userAgent ?? previous?.userAgent ?? null,
    ip: ctx.ip ?? previous?.ip ?? null,
    expiresAt,
  });
  res.cookie(REFRESH_COOKIE, refresh, { httpOnly: true, secure: secureCookies, sameSite: "lax", path: COOKIE_PATH, expires: expiresAt });
  return { accessToken: signAccessToken(userId), user: toMe(user) };
}

const clearRefreshCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });

/** Records a failed login step and locks the account after too many failures. Returns the lock message, if locked. */
export async function recordFailedLogin(user: { id: string; email: string; failedLoginCount: number }, reason: string): Promise<string | undefined> {
  const { ip, userAgent } = getRequestContext();
  const count = user.failedLoginCount + 1;
  const lock = count >= MAX_FAILED_LOGINS;
  await db
    .update(users)
    .set({ failedLoginCount: lock ? 0 : count, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
    .where(eq(users.id, user.id));
  await db.insert(loginAttempts).values({ email: user.email, userId: user.id, success: false, reason, ip: ip ?? null, userAgent: userAgent ?? null });
  if (lock) await logAudit({ action: "user.locked", entityType: "user", entityId: user.id, actor: null });
  return lock ? `Too many failed attempts. Your account is locked for ${LOCK_MINUTES} minutes.` : undefined;
}

export async function recordSuccessfulLogin(user: { id: string; email: string }) {
  const { ip, userAgent } = getRequestContext();
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await db.insert(loginAttempts).values({ email: user.email, userId: user.id, success: true, ip: ip ?? null, userAgent: userAgent ?? null });
}

export const lockedMessage = (lockedUntil: Date) => {
  const mins = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000);
  return `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
};

/** Emails a 6-digit login code and returns the short-lived token for the second login step. */
export async function sendLoginCode(user: User, opts: { skipCooldown?: boolean } = {}) {
  const code = await createOtp(user.email, "two_factor", opts);
  await queueEmail(user.email, mailTemplates.loginCode(await getMailBrand(), user.fullName, code));
  const mfaToken = jwt.sign({ sub: user.id, purpose: "mfa" }, env.JWT_SECRET, { expiresIn: 600 });
  return { mfaRequired: true as const, mfaToken, sentTo: maskEmail(user.email) };
}

async function roleCodesOf(userId: string): Promise<string[]> {
  const rows = await db.execute<{ code: string }>(sql`select r.code from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${userId}`);
  return rows.rows.map((r) => r.code);
}

async function sendVerificationCode(user: { email: string; fullName: string }, opts: { skipCooldown?: boolean } = {}) {
  const code = await createOtp(user.email, "verification", opts);
  await queueEmail(user.email, mailTemplates.verificationCode(await getMailBrand(), user.fullName, code));
}

// ---------- login / sessions ----------

export const login = async (req: Request, res: Response) => {
  const body = parse(loginSchema, req.body);
  const email = body.email.trim().toLowerCase();
  const { ip, userAgent } = getRequestContext();
  const [row] = await db.select({ user: users, agency: agencies }).from(users).leftJoin(agencies, eq(users.agencyId, agencies.id)).where(eq(users.email, email)).limit(1);
  const user = row?.user;

  const fail = async (reason: string, message = "Invalid email or password"): Promise<never> => {
    await db.insert(loginAttempts).values({ email, userId: user?.id ?? null, success: false, reason, ip: ip ?? null, userAgent: userAgent ?? null });
    throw unauthorized(message);
  };

  if (!user || !user.passwordHash) return fail(user ? "no_password" : "unknown_user");
  if (user.lockedUntil && user.lockedUntil > new Date()) return fail("locked", lockedMessage(user.lockedUntil));

  if (!(await verifyPassword(user.passwordHash, body.password))) {
    const lockMessage = await recordFailedLogin(user, "bad_password");
    throw unauthorized(lockMessage ?? "Invalid email or password");
  }

  if (user.status !== "active") return fail("disabled", "This account is disabled. Please contact the administrator.");
  if (user.type === "agent") {
    if (!user.emailVerifiedAt) return fail("email_not_verified", BLOCKED_MESSAGES.pending_email_verification);
    const blocked = row?.agency ? BLOCKED_MESSAGES[row.agency.status] : "Agency not found";
    if (blocked) return fail(`agency_${row?.agency?.status ?? "missing"}`, blocked);
  }

  // Two-factor login (Settings → Security): emailed code for required roles and for users who turned it on, unless switched off.
  if (mfaActiveFor(await getTwoFactorPolicy(), user.mfaEnabled, await roleCodesOf(user.id))) {
    ok(res, await sendLoginCode(user, { skipCooldown: true }));
    return;
  }

  await recordSuccessfulLogin(user);
  ok(res, await startSession(res, user.id));
};

export const refresh = async (req: Request, res: Response) => {
  try {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw unauthorized("Please log in");
    const [record] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token))).limit(1);
    if (!record) throw unauthorized("Please log in");

    if (record.revokedAt) {
      if (Date.now() - record.revokedAt.getTime() > REUSE_GRACE_MS) {
        // An old (rotated) token was used again: possible theft. End all of this user's sessions.
        await revokeAllSessions(record.userId);
        await logAudit({ action: "auth.refresh_token_reuse", entityType: "user", entityId: record.userId, actor: null });
      }
      throw unauthorized("Please log in");
    }
    if (record.expiresAt < new Date()) throw unauthorized("Session expired. Please log in again.");

    // Rotate: revoke the old token (only if nobody else did first), then issue a new one.
    const rotated = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), lastUsedAt: new Date() })
      .where(and(eq(refreshTokens.id, record.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (rotated.length === 0) throw unauthorized("Please log in");

    ok(res, await startSession(res, record.userId, record));
  } catch (e) {
    clearRefreshCookie(res);
    throw e;
  }
};

export const logout = async (req: Request, res: Response) => {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.tokenHash, sha256(token)), isNull(refreshTokens.revokedAt)));
  }
  clearRefreshCookie(res);
  ok(res, null, "Logged out");
};

export const logoutAll = async (req: Request, res: Response) => {
  const user = currentUser(req);
  await revokeAllSessions(user.id);
  await logAudit({ action: "auth.logout_all", entityType: "user", entityId: user.id });
  clearRefreshCookie(res);
  ok(res, null, "Logged out of all devices");
};

export const getCurrentUser = async (req: Request, res: Response) => {
  ok(res, toMe(currentUser(req)));
};

export const listSessions = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  const currentHash = token ? sha256(token) : null;
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
    .orderBy(desc(refreshTokens.createdAt));
  ok(res, rows.map((r) => ({ id: r.id, userAgent: r.userAgent, ip: r.ip, createdAt: r.createdAt, expiresAt: r.expiresAt, current: r.tokenHash === currentHash })));
};

export const revokeSession = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, id), eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  if (revoked.length === 0) throw notFound("Session not found");
  ok(res, null, "Session ended");
};

// ---------- email verification (6-digit code) ----------

/** POST /api/auth/verify-email  { email, code } */
export const verifyEmail = async (req: Request, res: Response) => {
  const { email, code } = parse(verifySchema, req.body);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw badRequest("This code has expired. Please request a new one.", [{ path: "code", message: "This code has expired. Please request a new one." }]);
  if (user.emailVerifiedAt) {
    ok(res, null, "Your email is already verified.");
    return;
  }

  const agency = await db.transaction(async (tx) => {
    await verifyOtp(email, "verification", code, tx);
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    if (!user.agencyId) return null;
    const moved = await tx
      .update(agencies)
      .set({ status: "pending_approval", version: sql`${agencies.version} + 1` })
      .where(and(eq(agencies.id, user.agencyId), eq(agencies.status, "pending_email_verification")))
      .returning();
    const a = moved[0];
    if (!a) return null;
    await tx.insert(agencyStatusHistory).values({
      agencyId: a.id, fromStatus: "pending_email_verification", toStatus: "pending_approval",
      reason: "Email verified", changedBy: user.id, changedByName: user.fullName,
    });
    await logAudit({ action: "agency.email_verified", entityType: "agency", entityId: a.id, actor: { id: user.id, email: user.email } }, tx);
    return a;
  });

  if (agency) {
    const brand = await getMailBrand();
    await queueEmail(agency.email, mailTemplates.applicationReceived(brand, agency.authorizedPerson));
    await queueEmailToPermission("agent.approve", mailTemplates.newRegistrationAdmin(brand, agency.agencyName, agency.city, frontendUrl(`/admin/agencies/${agency.id}`)), { type: "registration", title: `New agency application: ${agency.agencyName}`, body: agency.city, link: `/admin/agencies/${agency.id}` });
  }
  ok(res, null, "Your email has been verified. Your application is now under review.");
};

/** POST /api/auth/resend-verification  { email } */
export const resendVerification = async (req: Request, res: Response) => {
  const { email } = parse(emailOnlySchema, req.body);
  const [row] = await db.select({ user: users, agency: agencies }).from(users).leftJoin(agencies, eq(users.agencyId, agencies.id)).where(eq(users.email, email)).limit(1);
  if (row && !row.user.emailVerifiedAt && row.user.type === "agent" && row.agency?.status === "pending_email_verification") {
    await sendVerificationCode(row.user);
  }
  ok(res, null, "If your registration is waiting for verification, a new code has been sent.");
};

// ---------- passwords ----------

/** POST /api/auth/forgot-password  { email }: emails a 6-digit reset code. */
export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = parse(emailOnlySchema, req.body);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // Same answer either way, so this endpoint cannot be used to find out which emails are registered.
  if (user && user.status === "active" && user.passwordHash) {
    const code = await createOtp(user.email, "reset");
    await queueEmail(user.email, mailTemplates.passwordResetCode(await getMailBrand(), user.fullName, code));
    await logAudit({ action: "auth.password_reset_requested", entityType: "user", entityId: user.id, actor: null });
  }
  ok(res, null, "If an account exists for this email, we have sent a 6-digit code to it.");
};

async function setNewPassword(user: User, password: string, action: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, version: sql`${users.version} + 1`, ...extra })
      .where(eq(users.id, user.id));
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
    await logAudit({ action, entityType: "user", entityId: user.id, actor: { id: user.id, email: user.email } }, tx);
  });
  await queueEmail(user.email, mailTemplates.passwordChanged(await getMailBrand(), user.fullName));
}

/** POST /api/auth/reset-password  { email, code, password, confirmPassword } */
export const resetPassword = async (req: Request, res: Response) => {
  const body = parse(resetSchema, req.body);
  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!user || user.status !== "active" || !user.passwordHash) {
    throw badRequest("This code has expired. Please request a new one.", [{ path: "code", message: "This code has expired. Please request a new one." }]);
  }
  await verifyOtp(user.email, "reset", body.code);
  await setNewPassword(user, body.password, "auth.password_reset");
  ok(res, null, "Your password has been changed. You can now log in.");
};

/** POST /api/auth/accept-invite  { token, password, confirmPassword }: new staff member sets a password. */
export const acceptInvite = async (req: Request, res: Response) => {
  const body = parse(inviteSchema, req.body);
  const user = await db.transaction(async (tx) => (await consumeToken(body.token, ["invite"], tx)).user);
  if (user.status !== "active") throw badRequest("This account is disabled.");
  // Accepting an invitation proves the staff member owns the email address.
  await setNewPassword(user, body.password, "user.invite_accepted", user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() });
  ok(res, null, "Your password has been set. You can now log in.");
};

export const changePassword = async (req: Request, res: Response) => {
  const authUser = currentUser(req);
  const body = parse(changeSchema, req.body);
  const [user] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
    throw badRequest("Current password is incorrect", [{ path: "currentPassword", message: "Current password is incorrect" }]);
  }
  if (body.currentPassword === body.newPassword) {
    throw badRequest("New password must be different", [{ path: "newPassword", message: "New password must be different from the current one" }]);
  }
  await setNewPassword(user, body.newPassword, "auth.password_changed");
  // Keep this device logged in with a fresh session; other devices were logged out.
  ok(res, await startSession(res, user.id), "Password changed");
};
