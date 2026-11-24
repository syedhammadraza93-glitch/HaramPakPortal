import { asc, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../database/connection";
import { companySettings, registrationFieldSettings, roles } from "../database/schema";
import { logAudit } from "../services/audit.service";
import { captchaEnabled } from "../services/captcha.service";
import { getCompany, getRegistrationFields, toBranding } from "../services/settings.service";
import { removeFile, saveFile, streamFile } from "../services/storage.service";
import { inspectUpload } from "../utils/files";
import { badRequest, notFound, ok, parse } from "../utils/http";
import { REGISTRATION_FIELDS } from "../utils/registrationFields";

const fieldModesSchema = z.object({
  fields: z.array(z.object({ field: z.string(), mode: z.enum(["required", "optional", "hidden"]) })).min(1),
});

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

const lines = (maxItems: number, maxLen: number) =>
  z
    .array(z.string().trim().max(maxLen))
    .max(maxItems)
    .transform((a) => [...new Set(a.filter(Boolean))]);

const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #00944A");

const companySchema = z.object({
  name: z.string().trim().min(2, "Company name is required").max(150),
  address: optionalText(300),
  phone: optionalText(50),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).nullable().optional().transform((v) => (v ? v : null)),
  website: optionalText(200),
  termsVersion: z.string().trim().min(1, "Terms version is required").max(20),
});

const brandingSchema = z.object({
  portalName: z.string().trim().min(2, "Portal name is required").max(80),
  tagline: optionalText(150),
  heroTitle: optionalText(150),
  aboutText: optionalText(1000),
  highlights: lines(6, 150),
  footerText: optionalText(200),
  primaryColor: hexColor,
  accentColor: hexColor,
  highlightColor: hexColor,
  cities: lines(300, 80),
});

const securitySchema = z.object({
  twoFactorEnabled: z.boolean(),
  twoFactorRoles: z.array(z.string().trim().min(1).max(60)).max(100).transform((a) => [...new Set(a)]),
});

async function saveCompany(action: string, data: Partial<typeof companySettings.$inferInsert>) {
  const before = await getCompany();
  return db.transaction(async (tx) => {
    const [row] = await tx.update(companySettings).set(data).where(eq(companySettings.id, 1)).returning();
    await logAudit({ action, entityType: "settings", entityId: "company", oldValues: before, newValues: row }, tx);
    return row!;
  });
}

// ---------- public ----------

/** GET /api/public/registration-fields: used by the sign-up form. */
export const getPublicRegistrationFields = async (_req: Request, res: Response) => {
  ok(res, await getRegistrationFields());
};

/** GET /api/public/company: branding and contact details for the portal. */
export const getPublicCompany = async (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-cache");
  ok(res, toBranding(await getCompany()));
};

/** GET /api/public/config: settings the browser needs (the CAPTCHA site key is public by design). */
export const getPublicConfig = async (_req: Request, res: Response) => {
  ok(res, { captchaSiteKey: captchaEnabled() ? env.TURNSTILE_SITE_KEY : null });
};

/** GET /api/public/logo */
export const getPublicLogo = async (_req: Request, res: Response) => {
  const c = await getCompany();
  if (!c.logoKey) throw notFound("No logo uploaded");
  res.setHeader("Content-Type", c.logoMime ?? "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  // The portal (another origin in development) shows the logo in <img>.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  const stream = streamFile(c.logoKey);
  stream.on("error", () => (res.headersSent ? res.end() : res.status(404).json({ success: false, message: "Logo file is missing" })));
  stream.pipe(res);
};

// ---------- admin ----------

/** GET /api/admin/settings/registration-fields */
export const getAdminRegistrationFields = async (_req: Request, res: Response) => {
  ok(res, await getRegistrationFields());
};

/** PUT /api/admin/settings/registration-fields */
export const updateRegistrationFields = async (req: Request, res: Response) => {
  const { fields } = parse(fieldModesSchema, req.body);
  const before = await getRegistrationFields();
  const known = new Map(REGISTRATION_FIELDS.map((f) => [f.field, f]));
  await db.transaction(async (tx) => {
    for (const u of fields) {
      const def = known.get(u.field);
      if (!def) continue;
      await tx
        .insert(registrationFieldSettings)
        .values({ field: u.field, label: def.label, mode: u.mode, sortOrder: def.sortOrder })
        .onConflictDoUpdate({ target: registrationFieldSettings.field, set: { mode: u.mode } });
    }
    await logAudit({ action: "settings.registration_fields_updated", entityType: "settings", entityId: "registration_fields", oldValues: before, newValues: fields }, tx);
  });
  ok(res, await getRegistrationFields(), "Sign-up fields saved");
};

/** GET /api/admin/settings/company: company details + branding. */
export const getAdminCompany = async (_req: Request, res: Response) => {
  const c = await getCompany();
  ok(res, { ...c, logoUrl: toBranding(c).logoUrl });
};

/** PUT /api/admin/settings/company */
export const updateCompany = async (req: Request, res: Response) => {
  const row = await saveCompany("settings.company_updated", parse(companySchema, req.body));
  ok(res, row, "Company details saved");
};

/** PUT /api/admin/settings/branding */
export const updateBranding = async (req: Request, res: Response) => {
  const row = await saveCompany("settings.branding_updated", parse(brandingSchema, req.body));
  ok(res, toBranding(row), "Branding saved");
};

const securityView = async (c: { twoFactorEnabled: boolean; twoFactorRoles: string[] }) => ({
  twoFactorEnabled: c.twoFactorEnabled,
  twoFactorRoles: c.twoFactorRoles,
  roles: await db.select({ code: roles.code, name: roles.name }).from(roles).orderBy(asc(roles.createdAt)),
});

/** GET /api/admin/settings/security: two-factor login switch, the roles that must use it, and all roles to choose from. */
export const getSecuritySettings = async (_req: Request, res: Response) => {
  ok(res, await securityView(await getCompany()));
};

/** PUT /api/admin/settings/security  { twoFactorEnabled, twoFactorRoles } */
export const updateSecuritySettings = async (req: Request, res: Response) => {
  const data = parse(securitySchema, req.body);
  const known = new Set((await db.select({ code: roles.code }).from(roles)).map((r) => r.code));
  const unknown = data.twoFactorRoles.filter((code) => !known.has(code));
  if (unknown.length) throw badRequest(`Unknown role: ${unknown.join(", ")}`);
  const row = await saveCompany("settings.security_updated", data);
  ok(res, await securityView(row), data.twoFactorEnabled ? "Security settings saved" : "Two-factor login is now off for everyone");
};

/** POST /api/admin/settings/logo (multipart field "file": PNG, JPG or WebP, max 5 MB) */
export const uploadLogo = async (req: Request, res: Response) => {
  if (!req.file) throw badRequest("Please choose an image");
  const info = inspectUpload(req.file);
  if (info.mime === "application/pdf") throw badRequest("The logo must be a PNG, JPG or WebP image");
  const before = await getCompany();
  const key = `branding/logo-${Date.now()}.${info.ext}`;
  await saveFile(key, req.file.buffer);
  const row = await saveCompany("settings.logo_updated", { logoKey: key, logoMime: info.mime });
  if (before.logoKey && before.logoKey !== key) await removeFile(before.logoKey).catch(() => undefined);
  ok(res, toBranding(row), "Logo updated");
};

/** DELETE /api/admin/settings/logo */
export const deleteLogo = async (_req: Request, res: Response) => {
  const before = await getCompany();
  const row = await saveCompany("settings.logo_removed", { logoKey: null, logoMime: null });
  if (before.logoKey) await removeFile(before.logoKey).catch(() => undefined);
  ok(res, toBranding(row), "Logo removed");
};
