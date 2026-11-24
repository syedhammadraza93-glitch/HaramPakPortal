import { and, eq, notInArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../database/connection";
import { agencies, agencyStatusHistory, roles, userRoles, users } from "../database/schema";
import { discardDocuments, insertDocuments, storeDocuments, type PendingDocument } from "../services/agencyDocuments.service";
import { logAudit } from "../services/audit.service";
import { requireCaptcha } from "../services/captcha.service";
import { queueEmail, toMailBrand } from "../services/mail.service";
import { getCompany, getRegistrationFields } from "../services/settings.service";
import { createOtp } from "../services/otp.service";
import { hashPassword } from "../utils/crypto";
import { mailTemplates } from "../utils/emails/templates";
import { conflict, ok, validationFailed, zodErrors, type FieldError } from "../utils/http";
import { AGENT_ROLE } from "../utils/permissions";
import { FILE_FIELDS, MAX_OTHER_DOCS, OTHER_DOCS_FIELD, TEXT_FIELDS } from "../utils/registrationFields";
import { cnicSchema, emailSchema, passwordSchema, phoneSchema, referenceNoSchema } from "../utils/validation";

/** Always-present sign-up fields. Configurable fields are checked against the admin's settings below. */
const registrationSchema = z
  .object({
    agencyName: z.string().trim().min(2, "Agency name is required").max(150),
    authorizedPerson: z.string().trim().min(2, "Authorized person is required").max(100),
    phone: phoneSchema,
    whatsapp: phoneSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    address: z.string().trim().min(5, "Address is required").max(300),
    city: z.string().trim().min(2, "City is required").max(80),
    country: z.string().trim().min(2).max(80).default("Pakistan"),
    acceptTerms: z.literal("true", { errorMap: () => ({ message: "You must accept the terms and conditions" }) }),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

const configurableTextSchemas: Record<string, z.ZodTypeAny> = {
  cnic: cnicSchema,
  ntn: referenceNoSchema,
  businessRegNo: referenceNoSchema,
  licenceNo: referenceNoSchema,
};

/** Agencies in these statuses do not block a new registration with the same phone or CNIC. */
const CLOSED: ("rejected" | "deactivated")[] = ["rejected", "deactivated"];

type FileMap = Record<string, Express.Multer.File[] | undefined>;

/** POST /api/public/agent-registrations (multipart form) */
export const registerAgency = async (req: Request, res: Response) => {
  const body: Record<string, unknown> = req.body ?? {};
  const files = (req.files ?? {}) as FileMap;
  const errors: FieldError[] = [];

  const fields = await getRegistrationFields();
  const modes = Object.fromEntries(fields.map((f) => [f.field, f.mode]));
  const labels = Object.fromEntries(fields.map((f) => [f.field, f.label]));

  // 1. Base fields
  const base = registrationSchema.safeParse(body);
  if (!base.success) errors.push(...zodErrors(base.error));

  // 2. Configurable text fields
  const extra: Record<string, string | null> = { cnic: null, ntn: null, businessRegNo: null, licenceNo: null };
  for (const def of TEXT_FIELDS) {
    const mode = modes[def.field];
    const raw = typeof body[def.field] === "string" ? (body[def.field] as string).trim() : "";
    if (mode === "hidden") continue;
    if (!raw) {
      if (mode === "required") errors.push({ path: def.field, message: `${labels[def.field]} is required` });
      continue;
    }
    const parsed = configurableTextSchemas[def.field]!.safeParse(raw);
    if (parsed.success) extra[def.field] = parsed.data as string;
    else errors.push(...zodErrors(parsed.error).map((e) => ({ ...e, path: def.field })));
  }

  // 3. Configurable documents
  const pending: PendingDocument[] = [];
  for (const def of FILE_FIELDS) {
    const mode = modes[def.field];
    const file = files[def.field]?.[0];
    if (mode === "hidden") continue;
    if (!file) {
      if (mode === "required") errors.push({ path: def.field, message: `${labels[def.field]} is required` });
      continue;
    }
    pending.push({ file, docType: def.docType! });
  }
  const others = files[OTHER_DOCS_FIELD] ?? [];
  if (others.length > MAX_OTHER_DOCS) errors.push({ path: OTHER_DOCS_FIELD, message: `You can attach up to ${MAX_OTHER_DOCS} other documents` });
  others.slice(0, MAX_OTHER_DOCS).forEach((file) => pending.push({ file, docType: "other" }));

  if (errors.length || !base.success) throw validationFailed(errors);
  const data = base.data;

  // 4. Duplicates
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
  if (existingUser) {
    throw conflict("An account with this email already exists.", [{ path: "email", message: "This email is already registered. Try logging in or resetting your password." }]);
  }
  const [samePhone] = await db.select({ id: agencies.id }).from(agencies).where(and(eq(agencies.phone, data.phone), notInArray(agencies.status, CLOSED))).limit(1);
  if (samePhone) throw conflict("This phone number is already registered.", [{ path: "phone", message: "An agency with this phone number is already registered" }]);
  if (extra.cnic) {
    const [sameCnic] = await db.select({ id: agencies.id }).from(agencies).where(and(eq(agencies.cnic, extra.cnic), notInArray(agencies.status, CLOSED))).limit(1);
    if (sameCnic) throw conflict("This CNIC is already registered.", [{ path: "cnic", message: "An agency with this CNIC is already registered" }]);
  }

  // 5. CAPTCHA (single-use token, so checked only once everything else is valid)
  await requireCaptcha(body.captchaToken, req.ip);

  // 6. Save files, then create agency + user + history + documents in one transaction
  const agencyId = randomUUID();
  const stored = await storeDocuments(agencyId, pending);
  const passwordHash = await hashPassword(data.password);
  const company = await getCompany();

  let token: string;
  try {
    token = await db.transaction(async (tx) => {
      const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, AGENT_ROLE)).limit(1);
      if (!role) throw new Error("TRAVEL_AGENT role is missing");
      const [agency] = await tx
        .insert(agencies)
        .values({
          id: agencyId,
          agencyName: data.agencyName,
          authorizedPerson: data.authorizedPerson,
          phone: data.phone,
          whatsapp: data.whatsapp,
          email: data.email,
          address: data.address,
          city: data.city,
          country: data.country,
          cnic: extra.cnic,
          ntn: extra.ntn,
          businessRegNo: extra.businessRegNo,
          licenceNo: extra.licenceNo,
          status: "pending_email_verification",
          termsAcceptedAt: new Date(),
          termsVersion: company.termsVersion,
        })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({
          email: data.email,
          passwordHash,
          passwordChangedAt: new Date(),
          fullName: data.authorizedPerson,
          phone: data.phone,
          type: "agent",
          agencyId,
        })
        .returning();
      await tx.insert(userRoles).values({ userId: user!.id, roleId: role.id });
      await tx.insert(agencyStatusHistory).values({
        agencyId, toStatus: "pending_email_verification", reason: "Online registration", changedBy: user!.id, changedByName: user!.fullName,
      });
      await insertDocuments(agencyId, stored, user!.id, tx);
      await logAudit(
        { action: "agency.registered", entityType: "agency", entityId: agencyId, newValues: { ...agency, documents: stored.map((s) => s.fileName) }, actor: { id: user!.id, email: user!.email } },
        tx,
      );
      return createOtp(user!.email, "verification", { skipCooldown: true, client: tx });
    });
  } catch (e) {
    await discardDocuments(stored);
    throw e;
  }

  await queueEmail(data.email, mailTemplates.verificationCode(toMailBrand(company), data.authorizedPerson, token));
  ok(res, { email: data.email }, "Registration received. Enter the 6-digit code we emailed you to verify your address.", 201);
};
