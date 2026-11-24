import { and, asc, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { agencies, agencyDocuments, agencyStatusHistory, users, type AgencyStatus } from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { discardDocuments, documentListColumns, insertDocuments, sendAgencyDocument, storeDocuments } from "../services/agencyDocuments.service";
import { logAudit } from "../services/audit.service";
import { frontendUrl, getMailBrand, queueEmailToPermission } from "../services/mail.service";
import { badRequest, conflict, forbidden, ok, parse } from "../utils/http";
import { mailTemplates } from "../utils/emails/templates";
import { cnicSchema, phoneSchema, referenceNoSchema, uuidSchema } from "../utils/validation";

/** Contact fields an active agency may change itself. */
export const contactUpdateSchema = z
  .object({
    authorizedPerson: z.string().trim().min(2).max(100),
    phone: phoneSchema,
    whatsapp: phoneSchema,
    address: z.string().trim().min(5).max(300),
    city: z.string().trim().min(2).max(80),
    country: z.string().trim().min(2).max(80),
  })
  .partial();

const optionalRef = referenceNoSchema.or(z.literal("")).nullable().transform((v) => (v ? v : null));

/** All fields an agency may change while its application needs more information (also used by staff edits). */
export const fullUpdateSchema = contactUpdateSchema.extend({
  agencyName: z.string().trim().min(2).max(150).optional(),
  cnic: cnicSchema.or(z.literal("")).nullable().transform((v) => (v ? v : null)).optional(),
  ntn: optionalRef.optional(),
  businessRegNo: optionalRef.optional(),
  licenceNo: optionalRef.optional(),
});

const docTypeSchema = z.object({ docType: z.enum(["cnic_copy", "licence", "registration_cert", "other"]) });

const UPLOAD_STATUSES: AgencyStatus[] = ["pending_approval", "information_required", "active"];
const CONTACT_FIELDS = Object.keys(contactUpdateSchema.shape);
const FULL_FIELDS = Object.keys(fullUpdateSchema.shape);

const editableFields = (status: AgencyStatus) =>
  status === "information_required" ? FULL_FIELDS : status === "active" ? CONTACT_FIELDS : [];

/** Every agent endpoint uses the agency from the logged-in session, never an id from the request. */
function agencyIdOf(req: Request): string {
  const user = currentUser(req);
  if (user.type !== "agent" || !user.agency) throw forbidden("Agent account required");
  return user.agency.id;
}

async function loadAgency(agencyId: string) {
  const [agency] = await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  if (!agency) throw forbidden("Agency not found");
  return agency;
}

/** GET /api/agent/profile */
export const getProfile = async (req: Request, res: Response) => {
  const agencyId = agencyIdOf(req);
  const [agency, documents, latest] = await Promise.all([
    loadAgency(agencyId),
    db.select(documentListColumns).from(agencyDocuments).where(eq(agencyDocuments.agencyId, agencyId)).orderBy(asc(agencyDocuments.createdAt)),
    db.select().from(agencyStatusHistory).where(eq(agencyStatusHistory.agencyId, agencyId)).orderBy(desc(agencyStatusHistory.createdAt)).limit(1),
  ]);
  const { version: _v, approvedBy: _a, pricingGroupId: _group, agentCategory: _category, lastBalanceReminderAt: _reminder, ...profile } = agency;
  ok(res, {
    ...profile,
    documents,
    statusReason: latest[0] && ["information_required", "suspended"].includes(agency.status) ? latest[0].reason : null,
    editableFields: editableFields(agency.status),
    canUploadDocuments: UPLOAD_STATUSES.includes(agency.status),
    canResubmit: agency.status === "information_required",
  });
};

/** PATCH /api/agent/profile */
export const updateProfile = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const agencyId = agencyIdOf(req);
  const agency = await loadAgency(agencyId);
  if (editableFields(agency.status).length === 0) throw forbidden("Your profile cannot be changed in the current status");

  const schema = agency.status === "information_required" ? fullUpdateSchema : contactUpdateSchema;
  const data = parse(schema.strict(), req.body) as z.infer<typeof fullUpdateSchema>;
  if (Object.keys(data).length === 0) throw badRequest("Nothing to update");

  if (data.phone && data.phone !== agency.phone) {
    const [dup] = await db
      .select({ id: agencies.id })
      .from(agencies)
      .where(and(eq(agencies.phone, data.phone), ne(agencies.id, agencyId), notInArray(agencies.status, ["rejected", "deactivated"])))
      .limit(1);
    if (dup) throw conflict("This phone number is already registered.", [{ path: "phone", message: "Another agency uses this phone number" }]);
  }

  await db.transaction(async (tx) => {
    // Optimistic lock: fails if the profile changed since it was loaded.
    const updated = await tx
      .update(agencies)
      .set({ ...data, version: sql`${agencies.version} + 1` })
      .where(and(eq(agencies.id, agencyId), eq(agencies.version, agency.version)))
      .returning();
    if (updated.length === 0) throw conflict("Your profile was changed elsewhere. Please reload and try again.");
    if (data.authorizedPerson) await tx.update(users).set({ fullName: data.authorizedPerson }).where(eq(users.id, user.id));
    await logAudit({ action: "agency.profile_updated_by_agent", entityType: "agency", entityId: agencyId, oldValues: agency, newValues: updated[0] }, tx);
  });
  ok(res, null, "Profile updated");
};

/** POST /api/agent/profile/resubmit */
export const resubmitApplication = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const agencyId = agencyIdOf(req);
  const agency = await db.transaction(async (tx) => {
    const moved = await tx
      .update(agencies)
      .set({ status: "pending_approval", version: sql`${agencies.version} + 1` })
      .where(and(eq(agencies.id, agencyId), eq(agencies.status, "information_required")))
      .returning();
    if (moved.length === 0) throw badRequest("Your application is not waiting for more information");
    await tx.insert(agencyStatusHistory).values({
      agencyId, fromStatus: "information_required", toStatus: "pending_approval",
      reason: "Agent resubmitted application", changedBy: user.id, changedByName: user.fullName,
    });
    await logAudit({ action: "agency.resubmitted", entityType: "agency", entityId: agencyId }, tx);
    return moved[0]!;
  });
  await queueEmailToPermission("agent.approve", mailTemplates.newRegistrationAdmin(await getMailBrand(), agency.agencyName, agency.city, frontendUrl(`/admin/agencies/${agency.id}`)), { type: "registration", title: `Application resubmitted: ${agency.agencyName}`, link: `/admin/agencies/${agency.id}` });
  ok(res, null, "Your application has been resubmitted for review.");
};

/** POST /api/agent/documents (multipart: file + docType) */
export const uploadDocument = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const agencyId = agencyIdOf(req);
  const { docType } = parse(docTypeSchema, req.body);
  if (!req.file) throw badRequest("Please choose a file to upload");
  const agency = await loadAgency(agencyId);
  if (!UPLOAD_STATUSES.includes(agency.status)) throw forbidden("Documents cannot be uploaded in the current status");

  const stored = await storeDocuments(agencyId, [{ file: req.file, docType }]);
  try {
    await db.transaction(async (tx) => {
      await insertDocuments(agencyId, stored, user.id, tx);
      await logAudit({ action: "agency.document_uploaded", entityType: "agency", entityId: agencyId, newValues: { docType, fileName: stored[0]!.fileName } }, tx);
    });
  } catch (e) {
    await discardDocuments(stored);
    throw e;
  }
  ok(res, { id: stored[0]!.id }, "Document uploaded", 201);
};

/** GET /api/agent/documents/:id */
export const downloadDocument = async (req: Request, res: Response) => {
  await sendAgencyDocument(res, agencyIdOf(req), parse(uuidSchema, req.params.id));
};
