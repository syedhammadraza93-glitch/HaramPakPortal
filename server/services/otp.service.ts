import { and, desc, eq, sql } from "drizzle-orm";
import { randomInt, timingSafeEqual } from "node:crypto";
import { db, type DbClient } from "../database/connection";
import { otps, type OtpPurpose } from "../database/schema";
import { AppError, badRequest } from "../utils/http";

/** Same design as pmcmworks: 6-digit codes in the otps table, emailed to the user. */
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** Minimum wait before another code can be sent to the same email for the same purpose. */
export const OTP_RESEND_SECONDS = 30;

const codeError = (message: string) => badRequest(message, [{ path: "code", message }]);

/**
 * Creates a new code (older unused codes for the same email and purpose stop working) and returns it.
 * Throws 429 if a code was sent less than OTP_RESEND_SECONDS ago, unless `skipCooldown` is set.
 */
export async function createOtp(email: string, purpose: OtpPurpose, opts: { skipCooldown?: boolean; client?: DbClient } = {}): Promise<string> {
  const client = opts.client ?? db;
  if (!opts.skipCooldown) {
    const [last] = await client
      .select({ createdAt: otps.createdAt })
      .from(otps)
      .where(and(eq(otps.email, email), eq(otps.purpose, purpose)))
      .orderBy(desc(otps.createdAt))
      .limit(1);
    const wait = last ? OTP_RESEND_SECONDS - Math.floor((Date.now() - last.createdAt.getTime()) / 1000) : 0;
    if (wait > 0) throw new AppError(429, `Please wait ${wait} seconds before requesting a new code.`);
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await client.update(otps).set({ isUsed: true }).where(and(eq(otps.email, email), eq(otps.purpose, purpose), eq(otps.isUsed, false)));
  await client.insert(otps).values({ email, code, purpose, expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) });
  return code;
}

/**
 * Checks the newest unused code for this email and purpose, and marks it used when it matches.
 * Wrong guesses are counted; after OTP_MAX_ATTEMPTS the code stops working.
 */
export async function verifyOtp(email: string, purpose: OtpPurpose, code: string, client: DbClient = db): Promise<void> {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) throw codeError("Enter the 6-digit code from the email");

  const [otp] = await client
    .select()
    .from(otps)
    .where(and(eq(otps.email, email), eq(otps.purpose, purpose), eq(otps.isUsed, false)))
    .orderBy(desc(otps.createdAt))
    .limit(1);
  if (!otp || otp.expiresAt < new Date()) throw codeError("This code has expired. Please request a new one.");

  const match = otp.code.length === clean.length && timingSafeEqual(Buffer.from(otp.code), Buffer.from(clean));
  if (!match) {
    const attempts = otp.attempts + 1;
    await client
      .update(otps)
      .set({ attempts, isUsed: attempts >= OTP_MAX_ATTEMPTS })
      .where(eq(otps.id, otp.id));
    throw codeError(attempts >= OTP_MAX_ATTEMPTS ? "Too many wrong attempts. Please request a new code." : "The code is not correct");
  }

  // Only one request can use a code, even if two arrive at the same time.
  const used = await client
    .update(otps)
    .set({ isUsed: true })
    .where(and(eq(otps.id, otp.id), eq(otps.isUsed, false)))
    .returning({ id: otps.id });
  if (used.length === 0) throw codeError("This code has already been used. Please request a new one.");
}

/** "salmanqodix12@gmail.com" → "sa•••••••••12@gmail.com" (shown on the code screen). */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  if (user.length <= 3) return `${user[0] ?? ""}•••@${domain}`;
  return `${user.slice(0, 2)}${"•".repeat(Math.max(3, user.length - 4))}${user.slice(-2)}@${domain}`;
}

/** Deletes codes older than a day (called from time to time). */
export async function purgeOldOtps(): Promise<void> {
  await db.delete(otps).where(sql`${otps.createdAt} < now() - interval '1 day'`);
}
