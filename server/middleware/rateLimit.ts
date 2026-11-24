import rateLimit from "express-rate-limit";
import { env } from "../config/env";

const limiter = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message },
    // Automated tests make many requests from one IP; account lockout is still enforced.
    skip: () => env.NODE_ENV === "test",
  });

/** General API limit per IP. */
export const apiLimiter = limiter(60_000, 300, "Too many requests. Please slow down.");
/** Login: 20 attempts per minute per IP (agents in one office share an IP; per-account lockout stops guessing). */
export const loginLimiter = limiter(60_000, 20, "Too many login attempts. Please wait a minute and try again.");
/** Email-verification and password-reset links: 20 per minute per IP. */
export const tokenLimiter = limiter(60_000, 20, "Too many requests. Please wait a minute and try again.");
/** Forgot password / resend verification: 5 per 15 minutes per IP. */
export const emailLimiter = limiter(15 * 60_000, 10, "Too many requests. Please try again in a few minutes.");
/** Agent sign-up: 5 per hour per IP. */
export const registrationLimiter = limiter(60 * 60_000, 5, "Too many registrations from this network. Please try again later.");

export const websiteEnquiryLimiter = limiter(15 * 60_000, 12, "Too many enquiries. Please try again later.");
