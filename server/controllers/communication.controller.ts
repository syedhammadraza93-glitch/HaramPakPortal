import { and, asc, count, desc, eq, gt, isNull, like, lte, not, or, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { agencies, announcements, companySettings, documentTemplates, notifications, pricingGroups } from "../database/schema";
import type { AuthUser } from "../services/authUser.service";
import { currentUser } from "../middleware/auth.middleware";
import { audienceOf, deliverAnnouncement } from "../services/agentAlerts.service";
import { logAudit } from "../services/audit.service";
import { DOCUMENT_TYPES } from "../utils/documentTypes";
import { badRequest, forbidden, notFound, ok, parse } from "../utils/http";
import { paginationSchema, uuidSchema } from "../utils/validation";

// ================================================================================
// Notifications (every logged-in user, own rows only)
// ================================================================================

function visibleNotifications(me: AuthUser) {
  const scope = me.type === "agent" ? me.agency?.access : undefined;
  return and(eq(notifications.userId, me.id),
    scope && !scope.bookings ? or(isNull(notifications.link), not(like(notifications.link, "/agent/bookings%"))) : undefined,
    scope && !scope.finance ? or(isNull(notifications.link), not(like(notifications.link, "/agent/ledger%"))) : undefined,
    scope && !scope.catalogue ? or(isNull(notifications.link), not(like(notifications.link, "/agent/packages%"))) : undefined);
}

/** GET /api/notifications?unread=true&page */
export const listNotifications = async (req: Request, res: Response) => {
  const me = currentUser(req);
  const q = parse(paginationSchema.extend({ unread: z.enum(["true", "false"]).optional() }), req.query);
  const where = and(visibleNotifications(me), q.unread === "true" ? isNull(notifications.readAt) : undefined);
  const [[total], [unread], items] = await Promise.all([
    db.select({ n: count() }).from(notifications).where(where),
    db.select({ n: count() }).from(notifications).where(and(visibleNotifications(me), isNull(notifications.readAt))),
    db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
  ]);
  ok(res, { items, total: total?.n ?? 0, unread: unread?.n ?? 0, page: q.page, pageSize: q.pageSize });
};

/** GET /api/notifications/unread-count (polled by the header bell) */
export const unreadCount = async (req: Request, res: Response) => {
  const me = currentUser(req);
  const [row] = await db.select({ n: count() }).from(notifications).where(and(visibleNotifications(me), isNull(notifications.readAt)));
  ok(res, { unread: row?.n ?? 0 });
};

/** POST /api/notifications/:id/read */
export const markRead = async (req: Request, res: Response) => {
  const me = currentUser(req);
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, parse(uuidSchema, req.params.id)), visibleNotifications(me), isNull(notifications.readAt)));
  ok(res, null);
};

/** POST /api/notifications/read-all */
export const markAllRead = async (req: Request, res: Response) => {
  const me = currentUser(req);
  await db.update(notifications).set({ readAt: new Date() }).where(and(visibleNotifications(me), isNull(notifications.readAt)));
  ok(res, null, "All marked as read");
};

// ================================================================================
// Announcements
// ================================================================================
const optDateTime = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Use a valid date and time" });
      return z.NEVER;
    }
    return d;
  });

const announcementSchema = z.object({
  title: z.string().trim().min(3, "Enter a title").max(200),
  body: z.string().trim().min(3, "Write the announcement").max(5000),
  audience: z.enum(["all", "agencies", "pricing_groups"]).default("all"),
  agencyIds: z.array(uuidSchema).max(1000).default([]),
  pricingGroupIds: z.array(uuidSchema).max(100).default([]),
  startsAt: optDateTime,
  endsAt: optDateTime,
  sendEmail: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

function checkAudience(d: z.infer<typeof announcementSchema>) {
  if (d.audience === "agencies" && !d.agencyIds.length) throw badRequest("Choose at least one agency", [{ path: "agencyIds", message: "Required" }]);
  if (d.audience === "pricing_groups" && !d.pricingGroupIds.length) throw badRequest("Choose at least one pricing group", [{ path: "pricingGroupIds", message: "Required" }]);
  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) throw badRequest("The end must be after the start", [{ path: "endsAt", message: "After the start" }]);
}

/** GET /api/admin/announcements */
export const listAnnouncements = async (req: Request, res: Response) => {
  const q = parse(paginationSchema, req.query);
  const [[total], rows] = await Promise.all([
    db.select({ n: count() }).from(announcements),
    db.select().from(announcements).orderBy(desc(announcements.startsAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
  ]);
  const items = await Promise.all(rows.map(async (a) => ({ ...a, recipients: (await audienceOf(a)).length })));
  ok(res, { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
};

/** GET /api/admin/announcements/options: agencies and pricing groups to choose from. */
export const announcementOptions = async (_req: Request, res: Response) => {
  const [agencyRows, groups] = await Promise.all([
    db.select({ id: agencies.id, agencyName: agencies.agencyName, agentCode: agencies.agentCode }).from(agencies).where(eq(agencies.status, "active")).orderBy(asc(agencies.agencyName)),
    db.select({ id: pricingGroups.id, name: pricingGroups.name, code: pricingGroups.code }).from(pricingGroups).orderBy(asc(pricingGroups.name)),
  ]);
  ok(res, { agencies: agencyRows, pricingGroups: groups });
};

/** POST /api/admin/announcements: delivered now, or when its start time comes. */
export const createAnnouncement = async (req: Request, res: Response) => {
  const me = currentUser(req);
  const d = parse(announcementSchema, req.body);
  checkAudience(d);
  const [a] = await db
    .insert(announcements)
    .values({ ...d, startsAt: d.startsAt ?? new Date(), createdBy: me.id, createdByName: me.fullName })
    .returning();
  await logAudit({ action: "announcement.created", entityType: "announcement", entityId: a!.id, newValues: { title: a!.title, audience: a!.audience, sendEmail: a!.sendEmail } });
  let sentTo = 0;
  if (a!.isActive && a!.startsAt <= new Date()) sentTo = await deliverAnnouncement(a!);
  ok(res, a, sentTo ? `Announcement sent to ${sentTo} agencies` : "Announcement scheduled", 201);
};

/** PUT /api/admin/announcements/:id: edits the text and dates; agents already notified are not notified again. */
export const updateAnnouncement = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const d = parse(announcementSchema, req.body);
  checkAudience(d);
  const [a] = await db.update(announcements).set({ ...d, startsAt: d.startsAt ?? new Date() }).where(eq(announcements.id, id)).returning();
  if (!a) throw notFound("Announcement not found");
  await logAudit({ action: "announcement.updated", entityType: "announcement", entityId: id, newValues: { title: a.title, isActive: a.isActive } });
  ok(res, a, "Announcement saved");
};

export const deleteAnnouncement = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [a] = await db.delete(announcements).where(eq(announcements.id, id)).returning();
  if (!a) throw notFound("Announcement not found");
  await logAudit({ action: "announcement.deleted", entityType: "announcement", entityId: id, oldValues: { title: a.title } });
  ok(res, null, "Announcement removed");
};

/** Announcements an agency can see now (agent dashboard). */
export async function activeAnnouncementsFor(agencyId: string, pricingGroupId: string | null) {
  const now = new Date();
  return db
    .select({ id: announcements.id, title: announcements.title, body: announcements.body, startsAt: announcements.startsAt })
    .from(announcements)
    .where(
      and(
        eq(announcements.isActive, true),
        lte(announcements.startsAt, now),
        or(isNull(announcements.endsAt), gt(announcements.endsAt, now)),
        or(
          eq(announcements.audience, "all"),
          and(eq(announcements.audience, "agencies"), sql`${announcements.agencyIds} @> ${JSON.stringify([agencyId])}::jsonb`),
          pricingGroupId ? and(eq(announcements.audience, "pricing_groups"), sql`${announcements.pricingGroupIds} @> ${JSON.stringify([pricingGroupId])}::jsonb`) : undefined,
        ),
      ),
    )
    .orderBy(desc(announcements.startsAt))
    .limit(10);
}

/** GET /api/agent/announcements */
export const myAnnouncements = async (req: Request, res: Response) => {
  const me = currentUser(req);
  if (me.type !== "agent" || !me.agency) throw forbidden("Agent account required");
  const [a] = await db.select({ pricingGroupId: agencies.pricingGroupId }).from(agencies).where(eq(agencies.id, me.agency.id)).limit(1);
  ok(res, await activeAnnouncementsFor(me.agency.id, a?.pricingGroupId ?? null));
};

// ================================================================================
// Settings: notification options and document templates
// ================================================================================
export const getNotificationSettings = async (_req: Request, res: Response) => {
  const [c] = await db
    .select({ emailNewPackages: companySettings.emailNewPackages, emailPriceChanges: companySettings.emailPriceChanges, balanceReminderDays: companySettings.balanceReminderDays })
    .from(companySettings)
    .where(eq(companySettings.id, 1));
  ok(res, c);
};

export const updateNotificationSettings = async (req: Request, res: Response) => {
  const d = parse(z.object({ emailNewPackages: z.boolean(), emailPriceChanges: z.boolean(), balanceReminderDays: z.coerce.number().int().min(0).max(90) }), req.body);
  await db.update(companySettings).set(d).where(eq(companySettings.id, 1));
  await logAudit({ action: "settings.notifications_updated", entityType: "company_settings", entityId: null, newValues: d });
  ok(res, d, "Notification settings saved");
};

export const listDocumentTemplates = async (_req: Request, res: Response) => {
  const rows = await db.select().from(documentTemplates);
  const byType = new Map(rows.map((r) => [r.type, r]));
  ok(res, DOCUMENT_TYPES.map((d) => ({ type: d.type, label: d.label, title: byType.get(d.type)?.title ?? d.title, introText: byType.get(d.type)?.introText ?? null, footerText: byType.get(d.type)?.footerText ?? null })));
};

export const updateDocumentTemplate = async (req: Request, res: Response) => {
  const type = String(req.params.type);
  if (!DOCUMENT_TYPES.some((d) => d.type === type)) throw notFound("Unknown document");
  const d = parse(z.object({ title: z.string().trim().min(2, "Enter a title").max(120), introText: z.string().trim().max(3000).optional().nullable(), footerText: z.string().trim().max(5000).optional().nullable() }), req.body);
  const values = { title: d.title, introText: d.introText || null, footerText: d.footerText || null, updatedBy: currentUser(req).id };
  await db.insert(documentTemplates).values({ type, ...values }).onConflictDoUpdate({ target: documentTemplates.type, set: values });
  await logAudit({ action: "settings.document_template_updated", entityType: "document_template", entityId: null, newValues: { type, ...values } });
  ok(res, { type, ...values }, "Document template saved");
};
