import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { websiteSections } from "../database/schema";
import { currentUser, jwtGuard, requirePermission } from "../middleware/auth.middleware";
import { logAudit } from "../services/audit.service";
import { AppError, asyncHandler, conflict, forbidden, ok, parse } from "../utils/http";

const identifiers = ["appId", "businessId", "pageId", "adAccountId", "whatsappAccountId", "phoneNumberId", "instagramAccountId"] as const;
const credentials = ["appSecret", "accessToken", "pageAccessToken", "instagramAccessToken", "webhookVerifyToken"] as const;
const id = z.string().trim().regex(/^\d{0,32}$/);
const schema = z.object({
  version: z.number().int().nonnegative(),
  ids: z.object(Object.fromEntries(identifiers.map(name => [name, id])) as Record<typeof identifiers[number], typeof id>).strict(),
  secrets: z.object(Object.fromEntries(credentials.map(name => [name, z.string().trim().min(1).max(4096).nullable().optional()])) as Record<typeof credentials[number], z.ZodOptional<z.ZodNullable<z.ZodString>>>).strict(),
}).strict();

type Settings = { ids: Partial<Record<typeof identifiers[number], string>>; encrypted: Partial<Record<typeof credentials[number], string>> };
const keyName = "internal.meta.settings";
function encryptionKey() {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new AppError(503, "Integration encryption must be configured on the server");
  return Buffer.from(value, "hex");
}
function encrypt(name: string, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(keyName + ":" + name));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}
function decrypt(name: string, value: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(keyName + ":" + name));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
export async function readMetaConfiguration() {
  const [row] = await db.select().from(websiteSections).where(eq(websiteSections.key, keyName));
  const settings = (row?.draft ?? { ids: {}, encrypted: {} }) as Settings;
  return {
    ids: settings.ids,
    secrets: Object.fromEntries(credentials.flatMap(name => {
      const secret = settings.encrypted[name];
      return secret ? [[name, decrypt(name, secret)]] : [];
    })),
  };
}

function summary(settings: Settings, version: number) {
  return { version, ids: settings.ids, configured: credentials.filter(name => !!settings.encrypted[name]) };
}
export const metaSettingsRoutes = Router();
metaSettingsRoutes.use(jwtGuard, requirePermission("integration.manage"), (req, res, next) => {
  if (currentUser(req).type !== "staff") throw forbidden();
  res.set("Cache-Control", "no-store");
  next();
});
metaSettingsRoutes.get("/", asyncHandler(async (_req, res) => {
  const [row] = await db.select().from(websiteSections).where(eq(websiteSections.key, keyName));
  ok(res, summary((row?.draft ?? { ids: {}, encrypted: {} }) as Settings, row?.version ?? 0));
}));
metaSettingsRoutes.put("/", asyncHandler(async (req, res) => {
  const input = parse(schema, req.body);
  encryptionKey();
  const result = await db.transaction(async tx => {
    const [row] = await tx.select().from(websiteSections).where(eq(websiteSections.key, keyName)).for("update");
    if ((row?.version ?? 0) !== input.version) throw conflict("Settings changed. Reload and try again.");
    const encrypted = { ...(row?.draft as Settings | undefined)?.encrypted };
    for (const name of credentials) {
      const value = input.secrets[name];
      if (value === null) delete encrypted[name];
      else if (value !== undefined) encrypted[name] = encrypt(name, value);
    }
    const settings: Settings = { ids: input.ids, encrypted };
    const version = input.version + 1;
    if (row) await tx.update(websiteSections).set({ draft: settings, version, updatedAt: new Date() }).where(eq(websiteSections.key, keyName));
    else {
      const inserted = await tx.insert(websiteSections).values({ key: keyName, draft: settings, version }).onConflictDoNothing().returning();
      if (!inserted.length) throw conflict("Settings changed. Reload and try again.");
    }
    const result = summary(settings, version);
    await logAudit({ action: "integration.meta.settings_changed", entityType: "integration", newValues: { version, changedCredentials: Object.keys(input.secrets) } }, tx);
    return result;
  });
  ok(res, result);
}));
