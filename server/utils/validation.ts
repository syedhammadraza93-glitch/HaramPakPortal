import { z } from "zod";

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "11111111", "abc12345", "abcd1234", "pakistan123", "admin123", "welcome123",
]);

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/\d/, "Password must contain at least one number")
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), "This password is too common. Choose another one");

/** Normalises Pakistani mobiles to +923XXXXXXXXX; also accepts international numbers in +E.164 form. */
export function normalisePhone(value: string): string | null {
  const d = value.replace(/[\s()-]/g, "");
  if (/^03\d{9}$/.test(d)) return `+92${d.slice(1)}`;
  if (/^923\d{9}$/.test(d)) return `+${d}`;
  if (/^\+923\d{9}$/.test(d)) return d;
  if (/^\+[1-9]\d{7,14}$/.test(d) && !d.startsWith("+92")) return d;
  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalisePhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid mobile number, e.g. 0300 1234567" });
      return z.NEVER;
    }
    return n;
  });

export const cnicSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const d = v.replace(/-/g, "");
    if (!/^\d{13}$/.test(d)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CNIC must be 13 digits, e.g. 35202-1234567-1" });
      return z.NEVER;
    }
    return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
  });

export const referenceNoSchema = z
  .string()
  .trim()
  .max(50, "Too long")
  .regex(/^[A-Za-z0-9\-/ ]+$/, "Only letters, numbers, spaces, - and / are allowed");

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(255);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const uuidSchema = z.string().uuid("Invalid id");
