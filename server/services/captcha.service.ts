import { env } from "../config/env";
import { AppError, badRequest } from "../utils/http";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const captchaEnabled = () => !!env.TURNSTILE_SECRET_KEY && !!env.TURNSTILE_SITE_KEY;

/**
 * Verifies a Cloudflare Turnstile token. Tokens are single-use, so call this after the cheap
 * validation checks and right before saving. Does nothing when CAPTCHA is not configured.
 */
export async function requireCaptcha(token: unknown, ip?: string): Promise<void> {
  if (!captchaEnabled()) return;
  if (typeof token !== "string" || !token) {
    throw badRequest("Please complete the security check", [{ path: "captcha", message: "Please complete the security check" }]);
  }
  let result: { success: boolean; "error-codes"?: string[] };
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    result = (await res.json()) as typeof result;
  } catch (e: any) {
    console.error("[captcha] verification request failed:", e?.message || e);
    throw new AppError(503, "The security check is temporarily unavailable. Please try again.");
  }
  if (!result.success) {
    throw badRequest("The security check failed or expired. Please try again.", [{ path: "captcha", message: "Please complete the security check again" }]);
  }
}
