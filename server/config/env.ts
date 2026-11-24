import "dotenv/config";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5002),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  PUBLIC_WEBSITE_URL: z.string().url().optional(),
  INITIAL_ADMIN_EMAIL: optional,
  INITIAL_ADMIN_PASSWORD: optional,
  INITIAL_ADMIN_NAME: z.string().default("System Administrator"),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  MAIL_FROM: z.string().default("Agent Portal <no-reply@example.com>"),
  STORAGE_DIR: z.string().default("./storage"),
  TURNSTILE_SITE_KEY: optional,
  TURNSTILE_SECRET_KEY: optional,
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    console.error(`❌ Invalid configuration in server/.env:\n${lines.join("\n")}`);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === "production";
/** Browsers drop "Secure" cookies on plain http, so mark cookies Secure only when the portal is served over https. */
export const secureCookies = env.FRONTEND_URL.startsWith("https://");
