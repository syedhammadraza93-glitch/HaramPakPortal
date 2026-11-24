import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import {
  agencies, agencyDocuments, agencyNotes, agencyStatusHistory, agencyStatusEnum, counters, refreshTokens, users,
  type AgencyStatus,
} from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { documentListColumns, sendAgencyDocument } from "../services/agencyDocuments.service";
import { logAudit } from "../services/audit.service";
import type { AuthUser } from "../services/authUser.service";
import { frontendUrl, getMailBrand, queueEmail } from "../services/mail.service";
import { createOtp } from "../services/otp.service";
import { mailTemplates, type MailContent } from "../utils/emails/templates";
import { badRequest, conflict, forbidden, notFound, ok, parse } from "../utils/http";
import type { PermissionCode } from "../utils/permissions";
import { paginationSchema, uuidSchema } from "../utils/validation";
import { fullUpdateSchema } from "./agent.controller";

export type AgencyAction = "approve" | "reject" | "request-info" | "suspend" | "reactivate" | "deactivate" | "reopen";

interface TransitionRule {
  from: AgencyStatus[];
  to: AgencyStatus;
  permission: (from: AgencyStatus) => PermissionCode;
  reasonRequired: boolean;
}

/** The agency status workflow: which action moves which status, and who may do it. */
export const TRANSITIONS: Record<AgencyAction, TransitionRule> = {
  approve: { from: ["pending_approval", "information_required"], to: "active", permission: () => "agent.approve", reasonRequired: false },
  reject: { from: ["pending_approval", "information_required"], to: "rejected", permission: () => "agent.approve", reasonRequired: true },
  "request-info": { from: ["pending_approval"], to: "information_required", permission: () => "agent.approve", reasonRequired: true },
  suspend: { from: ["active"], to: "suspended", permission: () => "agent.suspend", reasonRequired: true },
  reactivate: {
    from: ["suspended", "deactivated"],
    to: "active",
    permission: (from) => (from === "deactivated" ? "agent.deactivate" : "agent.suspend"),
    reasonRequired: true,
  },
  deactivate: { from: ["active", "suspended"], to: "deactivated", permission: () => "agent.deactivate", reasonRequired: true },
  reopen: { from: ["rejected"], to: "pending_approval", permission: () => "agent.approve", reasonRequired: true },
};

const BLOCKING: AgencyStatus[] = ["suspended", "rejected", "deactivated"];
const QUEUE: AgencyStatus[] = ["pending_approval", "information_required"];

const listQuerySchema = paginationSchema.extend({
  status: z.enum([...agencyStatusEnum.enumValues, "queue"]).optional(),
  search: z.string().trim().max(100).optional(),
  city: z.string().trim().max(80).optional(),
});
const reasonSchema = z.object({ reason: z.string().trim().max(1000).optional().default("") });
const noteSchema = z.object({ note: z.string().trim().min(2, "Note is required").max(2000) });
const verifySchema = z.object({ verified: z.boolean() });

export function allowedActions(user: AuthUser, status: AgencyStatus): AgencyAction[] {
  return (Object.keys(TRANSITIONS) as AgencyAction[]).filter((a) => {
    const rule = TRANSITIONS[a];
    return rule.from.includes(status) && user.permissions.includes(rule.permission(status));
  });
}

/** GET /api/admin/agencies?status=&search=&city=&page=&pageSize= */
export const listAgencies = async (req: Request, res: Response) => {
  const q = parse(listQuerySchema, req.query);
  const conditions: (SQL | undefined)[] = [];
  if (q.status === "queue") conditions.push(inArray(agencies.status, QUEUE));
  else if (q.status) conditions.push(eq(agencies.status, q.status));
  if (q.city) conditions.push(ilike(agencies.city, q.city));
  if (q.search) {
    const s = `%${q.search.replace(/[%_]/g, "")}%`;
    conditions.push(
      or(
        ilike(agencies.agencyName, s),
        ilike(agencies.authorizedPerson, s),
        ilike(agencies.email, s),
        ilike(agencies.phone, s.replace(/\s/g, "")),
        ilike(agencies.agentCode, s),
      ),
    );
  }
  const where = and(...conditions);
  const [[total], items] = await Promise.all([
    db.select({ total: count() }).from(agencies).where(where),
    db
      .select({
        id: agencies.id, agentCode: agencies.agentCode, agencyName: agencies.agencyName, authorizedPerson: agencies.authorizedPerson,
        email: agencies.email, phone: agencies.phone, city: agencies.city, status: agencies.status, createdAt: agencies.createdAt, approvedAt: agencies.approvedAt,
      })
      .from(agencies)
      .where(where)
      .orderBy(q.status === "queue" ? asc(agencies.createdAt) : desc(agencies.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
  ]);
  ok(res, { items, total: total?.total ?? 0, page: q.page, pageSize: q.pageSize });
};

/** GET /api/admin/agencies/:id */
export const getAgency = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const [agency] = await db.select().from(agencies).where(eq(agencies.id, id)).limit(1);
  if (!agency) throw notFound("Agency not found");
  const canSeeNotes = user.permissions.includes("agent.notes") || user.permissions.includes("agent.approve");
  const [documents, statusHistory, notes, agencyUsers] = await Promise.all([
    db.select(documentListColumns).from(agencyDocuments).where(eq(agencyDocuments.agencyId, id)).orderBy(asc(agencyDocuments.createdAt)),
    db.select().from(agencyStatusHistory).where(eq(agencyStatusHistory.agencyId, id)).orderBy(desc(agencyStatusHistory.createdAt)),
    canSeeNotes ? db.select().from(agencyNotes).where(eq(agencyNotes.agencyId, id)).orderBy(desc(agencyNotes.createdAt)) : Promise.resolve([]),
    db
      .select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status, emailVerifiedAt: users.emailVerifiedAt, lastLoginAt: users.lastLoginAt, lockedUntil: users.lockedUntil })
      .from(users)
      .where(eq(users.agencyId, id)),
  ]);
  ok(res, {
    ...agency,
    documents,
    statusHistory,
    notes,
    users: agencyUsers,
    allowedActions: allowedActions(user, agency.status),
    reasonRequired: Object.fromEntries(Object.entries(TRANSITIONS).map(([a, r]) => [a, r.reasonRequired])),
    canEdit: user.permissions.includes("agent.edit"),
    canAddNotes: user.permissions.includes("agent.notes"),
    canVerifyDocuments: user.permissions.includes("agent.approve"),
  });
};

/** PATCH /api/admin/agencies/:id */
export const updateAgency = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(fullUpdateSchema.strict(), req.body);
  const [before] = await db.select().from(agencies).where(eq(agencies.id, id)).limit(1);
  if (!before) throw notFound("Agency not found");
  const after = await db.transaction(async (tx) => {
    const [row] = await tx.update(agencies).set({ ...data, version: sql`${agencies.version} + 1` }).where(eq(agencies.id, id)).returning();
    await logAudit({ action: "agency.updated", entityType: "agency", entityId: id, oldValues: before, newValues: row }, tx);
    return row;
  });
  ok(res, after, "Agency updated");
};

async function statusEmail(action: AgencyAction, name: string, agentCode: string | null, reason: string): Promise<MailContent> {
  const company = await getMailBrand();
  const login = frontendUrl("/login");
  switch (action) {
    case "approve": return mailTemplates.approved(company, name, agentCode ?? "", login);
    case "reject": return mailTemplates.rejected(company, name, reason);
    case "request-info": return mailTemplates.informationRequired(company, name, reason, frontendUrl("/agent/profile"));
    case "suspend": return mailTemplates.suspended(company, name, reason);
    case "reactivate": return mailTemplates.reactivated(company, name, login);
    case "deactivate": return mailTemplates.deactivated(company, name, reason);
    case "reopen": return mailTemplates.reopened(company, name);
  }
}

/** POST /api/admin/agencies/:id/status/:action  body: { reason } */
export const changeAgencyStatus = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const action = req.params.action as AgencyAction;
  const rule = TRANSITIONS[action];
  if (!rule) throw notFound("Unknown action");
  const { reason } = parse(reasonSchema, req.body);

  const [agency] = await db.select().from(agencies).where(eq(agencies.id, id)).limit(1);
  if (!agency) throw notFound("Agency not found");
  if (!rule.from.includes(agency.status)) {
    throw badRequest(`Cannot ${action.replace("-", " ")} an agency whose status is "${agency.status.replace(/_/g, " ")}"`);
  }
  if (!user.permissions.includes(rule.permission(agency.status))) throw forbidden();
  if (rule.reasonRequired && reason.length < 3) {
    throw badRequest("A reason is required", [{ path: "reason", message: "Please enter a reason (at least 3 characters)" }]);
  }

  const updated = await db.transaction(async (tx) => {
    let agentCode = agency.agentCode;
    if (rule.to === "active" && !agentCode) {
      const [c] = await tx
        .insert(counters)
        .values({ name: "agent_code", value: 1 })
        .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
        .returning({ value: counters.value });
      agentCode = `AGT-${String(c!.value).padStart(5, "0")}`;
    }
    // Only succeeds if nobody changed the status in the meantime.
    const rows = await tx
      .update(agencies)
      .set({
        status: rule.to,
        agentCode,
        ...(action === "approve" ? { approvedAt: new Date(), approvedBy: user.id } : {}),
        version: sql`${agencies.version} + 1`,
      })
      .where(and(eq(agencies.id, id), eq(agencies.status, agency.status)))
      .returning();
    if (rows.length === 0) throw conflict("This agency was updated by someone else. Please reload.");
    await tx.insert(agencyStatusHistory).values({
      agencyId: id, fromStatus: agency.status, toStatus: rule.to, reason: reason || null, changedBy: user.id, changedByName: user.fullName,
    });
    if (BLOCKING.includes(rule.to)) {
      // Log the agency's users out everywhere.
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(isNull(refreshTokens.revokedAt), inArray(refreshTokens.userId, tx.select({ id: users.id }).from(users).where(eq(users.agencyId, id)))));
    }
    await logAudit(
      { action: `agency.${action.replace("-", "_")}`, entityType: "agency", entityId: id, oldValues: { status: agency.status }, newValues: { status: rule.to, agentCode, reason } },
      tx,
    );
    return rows[0]!;
  });

  await queueEmail(updated.email, await statusEmail(action, updated.authorizedPerson, updated.agentCode, reason));
  ok(res, { status: updated.status, agentCode: updated.agentCode }, "Status updated");
};

/** POST /api/admin/agencies/:id/notes */
export const addAgencyNote = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const { note } = parse(noteSchema, req.body);
  const [exists] = await db.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, id)).limit(1);
  if (!exists) throw notFound("Agency not found");
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(agencyNotes).values({ agencyId: id, note, createdBy: user.id, createdByName: user.fullName }).returning();
    await logAudit({ action: "agency.note_added", entityType: "agency", entityId: id, newValues: { note } }, tx);
    return row;
  });
  ok(res, created, "Note added", 201);
};

/** POST /api/admin/agencies/:id/resend-verification */
export const resendAgencyVerification = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [row] = await db.select({ agency: agencies, user: users }).from(agencies).innerJoin(users, eq(users.agencyId, agencies.id)).where(eq(agencies.id, id)).limit(1);
  if (!row) throw notFound("Agency not found");
  if (row.agency.status !== "pending_email_verification") throw badRequest("This agency is not waiting for email verification");
  const code = await createOtp(row.user.email, "verification", { skipCooldown: true });
  await queueEmail(row.user.email, mailTemplates.verificationCode(await getMailBrand(), row.user.fullName, code));
  await logAudit({ action: "agency.verification_resent", entityType: "agency", entityId: id });
  ok(res, null, "A new verification code has been emailed");
};

/** POST /api/admin/agencies/:id/users/:userId/unlock */
export const unlockAgencyUser = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const userId = parse(uuidSchema, req.params.userId);
  const rows = await db
    .update(users)
    .set({ lockedUntil: null, failedLoginCount: 0 })
    .where(and(eq(users.id, userId), eq(users.agencyId, id)))
    .returning({ id: users.id });
  if (rows.length === 0) throw notFound("User not found");
  await logAudit({ action: "user.unlocked", entityType: "user", entityId: userId });
  ok(res, null, "User unlocked");
};

/** GET /api/admin/agencies/:id/documents/:documentId */
export const downloadAgencyDocument = async (req: Request, res: Response) => {
  await sendAgencyDocument(res, parse(uuidSchema, req.params.id), parse(uuidSchema, req.params.documentId));
};

/** PATCH /api/admin/agencies/:id/documents/:documentId  body: { verified } */
export const verifyAgencyDocument = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const documentId = parse(uuidSchema, req.params.documentId);
  const { verified } = parse(verifySchema, req.body);
  const rows = await db
    .update(agencyDocuments)
    .set({ verified })
    .where(and(eq(agencyDocuments.id, documentId), eq(agencyDocuments.agencyId, id)))
    .returning({ id: agencyDocuments.id });
  if (rows.length === 0) throw notFound("Document not found");
  await logAudit({ action: verified ? "agency.document_verified" : "agency.document_unverified", entityType: "agency", entityId: id, newValues: { documentId } });
  ok(res, { verified }, verified ? "Document marked as verified" : "Document marked as not verified");
};
