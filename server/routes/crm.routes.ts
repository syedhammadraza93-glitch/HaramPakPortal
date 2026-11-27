import { and, asc, inArray, count, desc, eq, ilike, isNotNull, max, or, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { destinations, hotels, crmSettings, leadEvents, leadQuotes, leads, leadSources, leadStages, permissions, rolePermissions, userRoles, users } from "../database/schema";
import { currentUser, jwtGuard, requirePermission } from "../middleware/auth.middleware";
import { websiteEnquiryLimiter } from "../middleware/rateLimit";
import { closedLeadStages, escalateOverdueLeads, getCrmSettings } from "../services/crmEscalations.service";
import { renderLeadQuotePdf } from "../services/leadQuotePdf.service";
import { asyncHandler as h, badRequest, conflict, forbidden, notFound, ok, parse } from "../utils/http";

const text = (length: number) => z.string().trim().max(length);
const uid = z.string().uuid();
const contact = z.object({
  name: text(120).min(2),
  phone: text(40).regex(/^\+?[0-9() .-]+$/).transform(value => value.replace(/[^\d+]/g, ""))
    .pipe(z.string().regex(/^\+?\d{7,15}$/)),
  email: z.union([text(180).email(), z.literal("")]).optional(),
  city: text(100).optional(),
  service: text(120).min(2),
  packageSlug: text(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  travelDate: text(80).optional(),
  travellers: z.number().int().min(1).max(200).optional(),
  campaign: text(180).optional(),
  note: text(1500).optional(),
});
const publicFields = contact.extend({ submissionId: uid }).strict();
const staffFields = contact.extend({ source: z.enum(leadSources) }).strict();
const work = requirePermission("crm.work");
const manage = requirePermission("crm.work", "crm.manage");

function staffOnly(req: Request, _res: Response, next: () => void) {
  if (currentUser(req).type !== "staff") throw forbidden();
  next();
}

function leadFilter(req: Request, id?: string) {
  const user = currentUser(req);
  return and(id ? eq(leads.id, id) : undefined, user.permissions.includes("crm.manage") ? undefined : eq(leads.ownerId, user.id));
}

const label = (id: string) => "HP-" + id.toUpperCase();
const closeStage = (stage: typeof leadStages[number]) => closedLeadStages.some(item => item === stage);
const minutesFrom = (time: Date, minutes: number) => new Date(time.getTime() + minutes * 60_000);

async function intake(req: Request, res: Response, publicRequest: boolean) {
  const actor = publicRequest ? null : currentUser(req);
  const input = publicRequest ? parse(publicFields, req.body) : parse(staffFields, req.body);
  const { firstResponseMinutes } = await getCrmSettings();
  const now = new Date();
  const { note, ...values } = input;
  const submissionId = "submissionId" in values ? values.submissionId : null;
  const leadId = await db.transaction(async tx => {
    const [row] = await tx.insert(leads).values({
      ...values,
      submissionId,
      email: values.email || null,
      source: "source" in values ? values.source : "website",
      ownerId: actor?.id,
      firstResponseDueAt: minutesFrom(now, firstResponseMinutes),
    }).onConflictDoNothing({ target: leads.submissionId }).returning({ id: leads.id });
    if (!row) {
      const [existing] = await tx.select({ id: leads.id, phone: leads.phone, name: leads.name })
        .from(leads).where(eq(leads.submissionId, submissionId!));
      if (!existing || existing.phone !== values.phone || existing.name !== values.name) throw conflict("Start a new enquiry and try again.");
      return existing.id;
    }
    await tx.insert(leadEvents).values([
      { leadId: row.id, actorId: actor?.id, kind: "created", details: publicRequest ? "Received from the public website" : "Entered by staff" },
      ...(note ? [{ leadId: row.id, actorId: actor?.id, kind: "note", details: note }] : []),
    ]);
    return row.id;
  });
  res.set("Cache-Control", "no-store");
  ok(res, publicRequest ? { reference: label(leadId) } : { id: leadId, reference: label(leadId) }, undefined, 201);
}

export const websiteLeadRoutes = Router();
websiteLeadRoutes.post("/", websiteEnquiryLimiter, h((req, res) => intake(req, res, true)));

export const crmRoutes = Router();
crmRoutes.use(jwtGuard, staffOnly, work, (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

crmRoutes.get("/leads", h(async (req, res) => {
  const q = parse(z.object({ search: text(100).optional(), stage: z.enum(leadStages).optional(), escalated: z.literal("true").optional(), page: z.coerce.number().int().min(1).max(10000).default(1) }), req.query);
  const term = q.search ? "%" + q.search.replace(/[\\%_]/g, "\\$&") + "%" : undefined;
  const where = and(leadFilter(req), q.stage ? eq(leads.stage, q.stage) : undefined,
    q.escalated ? isNotNull(leads.escalatedAt) : undefined,
    term ? or(ilike(leads.name, term), ilike(leads.phone, term), ilike(leads.service, term)) : undefined);
  const [items, totals] = await Promise.all([
    db.select({ lead: leads, ownerName: users.fullName }).from(leads).leftJoin(users, eq(leads.ownerId, users.id))
      .where(where).orderBy(desc(leads.createdAt), desc(leads.id)).limit(50).offset((q.page - 1) * 50),
    db.select({ total: count() }).from(leads).where(where),
  ]);
  ok(res, { items: items.map(({ lead, ownerName }) => ({ ...lead, reference: label(lead.id), ownerName })), total: totals[0]?.total ?? 0 });
}));

crmRoutes.post("/leads", h((req, res) => intake(req, res, false)));
crmRoutes.get("/owners", manage, h(async (_req, res) => {
  const owners = await db.selectDistinct({ id: users.id, name: users.fullName }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(users.type, "staff"), eq(users.status, "active"), eq(permissions.code, "crm.work")))
    .orderBy(users.fullName);
  ok(res, owners);
}));

crmRoutes.get("/rules", manage, h(async (_req, res) => ok(res, await getCrmSettings())));
crmRoutes.put("/rules", manage, h(async (req, res) => {
  const data = parse(z.object({ firstResponseMinutes: z.number().int().min(1).max(10080), followUpMinutes: z.number().int().min(1).max(43200) }).strict(), req.body);
  await db.insert(crmSettings).values({ id: 1, ...data }).onConflictDoUpdate({ target: crmSettings.id, set: data });
  ok(res, data);
}));
crmRoutes.post("/sweep", manage, h(async (_req, res) => ok(res, { escalated: await escalateOverdueLeads() })));

crmRoutes.get("/metrics", h(async (req, res) => {
  const [stages, sources, owners, campaigns, timing] = await Promise.all([
    db.select({ key: leads.stage, count: count() }).from(leads).where(leadFilter(req)).groupBy(leads.stage),
    db.select({ key: leads.source, stage: leads.stage, count: count() }).from(leads).where(leadFilter(req)).groupBy(leads.source, leads.stage),
    db.select({ key: users.fullName, ownerId: leads.ownerId, stage: leads.stage, count: count() }).from(leads)
      .leftJoin(users, eq(leads.ownerId, users.id)).where(leadFilter(req)).groupBy(users.fullName, leads.ownerId, leads.stage),
    db.select({ key: leads.campaign, stage: leads.stage, count: count() }).from(leads)
      .where(and(leadFilter(req), isNotNull(leads.campaign))).groupBy(leads.campaign, leads.stage).orderBy(desc(count())).limit(100),
    db.select({
      averageResponseMinutes: sql<number | null>`avg(extract(epoch from (${leads.firstContactAt} - ${leads.createdAt})) / 60)`.mapWith(Number),
      escalated: sql<number>`count(*) filter (where ${leads.escalatedAt} is not null)`.mapWith(Number),
    }).from(leads).where(leadFilter(req)),
  ]);
  ok(res, { stages, sources, owners, campaigns, timing: timing[0] });
}));

async function scopedLead(req: Request) {
  const id = parse(uid, req.params.id);
  const [lead] = await db.select().from(leads).where(leadFilter(req, id));
  if (!lead) throw notFound("Lead not found");
  return lead;
}

crmRoutes.get("/leads/:id/hotel-catalogue", h(async (req, res) => {
  await scopedLead(req);
  const rows = await db.select({
    id: hotels.id, name: hotels.name, city: destinations.city, area: hotels.area, road: hotels.road,
    locationAliases: hotels.locationAliases, starRating: hotels.starRating,
    distanceToHaramM: hotels.distanceToHaramM, distanceReference: hotels.distanceReference,
    distanceVerifiedOn: hotels.distanceVerifiedOn, shuttleAvailable: hotels.shuttleAvailable,
    isActive: hotels.isActive,
  }).from(hotels).innerJoin(destinations, eq(destinations.id, hotels.destinationId))
    .where(and(inArray(sql`lower(${destinations.city})`, ["makkah", "mecca", "madinah", "madina", "medina"]),
      or(and(eq(hotels.isActive, true), eq(destinations.isActive, true)), ilike(hotels.name, "TEST · %"))))
    .orderBy(asc(hotels.name));
  ok(res, rows);
}));

crmRoutes.get("/leads/:id", h(async (req, res) => {
  const lead = await scopedLead(req);
  const [events, quotes] = await Promise.all([
    db.select({ id: leadEvents.id, kind: leadEvents.kind, details: leadEvents.details, createdAt: leadEvents.createdAt, actor: users.fullName })
      .from(leadEvents).leftJoin(users, eq(leadEvents.actorId, users.id)).where(eq(leadEvents.leadId, lead.id))
      .orderBy(desc(leadEvents.createdAt)).limit(200),
    db.select().from(leadQuotes).where(eq(leadQuotes.leadId, lead.id)).orderBy(desc(leadQuotes.revision)),
  ]);
  ok(res, { lead: { ...lead, reference: label(lead.id) }, events, quotes });
}));

const update = z.object({
  version: z.number().int().min(0),
  contact: contact.pick({ name: true, phone: true, email: true, city: true, service: true, travelDate: true, travellers: true }).strict().optional(),
  stage: z.enum(leadStages).optional(),
  ownerId: uid.nullable().optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  bookingReference: text(80).optional(),
  lossReason: text(300).optional(),
}).strict();
crmRoutes.patch("/leads/:id", h(async (req, res) => {
  const data = parse(update, req.body);
  const actor = currentUser(req);
  if (data.ownerId !== undefined && !actor.permissions.includes("crm.manage")) throw forbidden();
  if (data.ownerId) {
    const [owner] = await db.select({ id: users.id }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(and(eq(users.id, data.ownerId), eq(users.type, "staff"), eq(users.status, "active"), eq(permissions.code, "crm.work"))).limit(1);
    if (!owner) throw badRequest("Choose an active sales team member");
  }
  const id = parse(uid, req.params.id);
  const rules = await getCrmSettings();
  const result = await db.transaction(async tx => {
    const [previous] = await tx.select().from(leads).where(leadFilter(req, id)).for("update");
    if (!previous) throw notFound("Lead not found");
    if (data.version !== previous.version) throw conflict("This lead changed. Refresh and try again.");
    if (closeStage(previous.stage) && data.stage && data.stage !== previous.stage && !actor.permissions.includes("crm.manage")) throw forbidden("A manager can reopen closed leads");
    const stage = data.stage ?? previous.stage;
    const bookingReference = stage === "booked" ? data.bookingReference ?? previous.bookingReference : null;
    const lossReason = stage === "lost" ? data.lossReason ?? previous.lossReason : null;
    if (stage === "booked" && !bookingReference) throw badRequest("Enter the confirmed booking reference");
    if (stage === "lost" && !lossReason) throw badRequest("Enter a reason for closing this lead as lost");
    if (stage === "quoted" && previous.stage !== "quoted") {
      const [sent] = await tx.select({ id: leadQuotes.id }).from(leadQuotes)
        .where(and(eq(leadQuotes.leadId, id), isNotNull(leadQuotes.sentAt))).limit(1);
      if (!sent) throw badRequest("Mark a quote as sent before moving the lead to Quoted");
    }
    const now = new Date();
    const changed = stage !== previous.stage;
    const firstContactAt = previous.firstContactAt ?? (stage === "contacted" ? now : null);
    const next = closeStage(stage) ? null
      : data.nextFollowUpAt !== undefined ? (data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null)
      : changed && stage !== "new" ? minutesFrom(now, rules.followUpMinutes) : previous.nextFollowUpAt;
    const ownerId = data.ownerId === undefined ? previous.ownerId : data.ownerId;
    const contactUpdate = data.contact ? { ...data.contact, email: data.contact.email || null, city: data.contact.city || null, travelDate: data.contact.travelDate || null } : {};
    const [row] = await tx.update(leads).set({
      ...contactUpdate, ownerId, stage, bookingReference, lossReason, firstContactAt, nextFollowUpAt: next,
      escalatedAt: closeStage(stage) || next?.getTime() !== previous.nextFollowUpAt?.getTime() || firstContactAt !== previous.firstContactAt ? null : previous.escalatedAt,
      updatedAt: now, version: previous.version + 1,
    }).where(eq(leads.id, id)).returning();
    const entries: { kind: string; details: string }[] = [];
    if (data.contact) entries.push({ kind: "contact_details", details: "Contact and travel details updated" });
    if (changed || bookingReference !== previous.bookingReference || lossReason !== previous.lossReason) {
      entries.push({ kind: "stage", details: [stage === previous.stage ? stage : previous.stage + " → " + stage, bookingReference, lossReason].filter(Boolean).join(" · ") });
    }
    if (ownerId !== previous.ownerId) {
      const [owner] = ownerId ? await tx.select({ name: users.fullName }).from(users).where(eq(users.id, ownerId)) : [];
      entries.push({ kind: "assignment", details: owner ? "Assigned to " + owner.name : "Moved to the unassigned queue" });
    }
    if (next?.getTime() !== previous.nextFollowUpAt?.getTime()) entries.push({ kind: "follow_up", details: next ? "Follow-up scheduled for " + next.toISOString() : "Follow-up cleared" });
    if (entries.length) await tx.insert(leadEvents).values(entries.map(entry => ({ leadId: id, actorId: actor.id, ...entry })));
    return row!;
  });
  ok(res, result);
}));

crmRoutes.post("/leads/:id/events", h(async (req, res) => {
  const id = parse(uid, req.params.id);
  const data = parse(z.object({ kind: z.enum(["note", "call", "whatsapp", "office_visit", "email"]), details: text(1500).min(1), reachedCustomer: z.boolean().default(false) }).strict(), req.body);
  if (data.kind === "note" && data.reachedCustomer) throw badRequest("Record a customer contact activity");
  const rules = await getCrmSettings();
  await db.transaction(async tx => {
    const [lead] = await tx.select().from(leads).where(leadFilter(req, id)).for("update");
    if (!lead) throw notFound("Lead not found");
    const actorId = currentUser(req).id;
    const now = new Date();
    await tx.insert(leadEvents).values({ leadId: id, actorId, kind: data.kind, details: data.details });
    if (data.reachedCustomer && !closeStage(lead.stage)) {
      await tx.update(leads).set({
        stage: lead.stage === "new" ? "contacted" : lead.stage,
        firstContactAt: lead.firstContactAt ?? now, nextFollowUpAt: minutesFrom(now, rules.followUpMinutes),
        escalatedAt: null, updatedAt: now, version: lead.version + 1,
      }).where(eq(leads.id, id));
      if (lead.stage === "new") await tx.insert(leadEvents).values({ leadId: id, actorId, kind: "stage", details: "new → contacted" });
    }
  });
  ok(res, null, "Activity saved", 201);
}));

const quoteInput = z.object({
  currency: z.enum(["PKR", "SAR", "USD", "CAD", "GBP", "EUR"]),
  validUntil: z.string().date().refine(value => value >= new Date().toISOString().slice(0, 10), "Validity must be today or later"),
  lines: z.array(z.object({ label: text(180).min(1), quantity: z.number().int().min(1).max(1000), unitMinor: z.number().int().min(0).max(1_000_000_000) }).strict()).min(1).max(30),
  terms: text(2000),
}).strict();
crmRoutes.post("/leads/:id/quotes", h(async (req, res) => {
  const id = parse(uid, req.params.id);
  const data = parse(quoteInput, req.body);
  const actorId = currentUser(req).id;
  const quote = await db.transaction(async tx => {
    const [lead] = await tx.select().from(leads).where(leadFilter(req, id)).for("update");
    if (!lead) throw notFound("Lead not found");
    if (closeStage(lead.stage)) throw conflict("Reopen the lead before creating another quote");
    const [last] = await tx.select({ revision: max(leadQuotes.revision) }).from(leadQuotes).where(eq(leadQuotes.leadId, id));
    const revision = (last?.revision ?? 0) + 1;
    const [row] = await tx.insert(leadQuotes).values({ ...data, leadId: id, revision, customerName: lead.name, issuedBy: actorId }).returning();
    await tx.insert(leadEvents).values({ leadId: id, actorId, kind: "quote", details: "Quote revision " + revision + " created" });
    return row;
  });
  ok(res, quote, "Quote created", 201);
}));

crmRoutes.post("/leads/:id/quotes/:quoteId/sent", h(async (req, res) => {
  const id = parse(uid, req.params.id);
  const quoteId = parse(uid, req.params.quoteId);
  const { followUpMinutes } = await getCrmSettings();
  await db.transaction(async tx => {
    const [lead] = await tx.select().from(leads).where(leadFilter(req, id)).for("update");
    if (!lead) throw notFound("Lead not found");
    if (closeStage(lead.stage)) throw conflict("Reopen the lead before recording a sent quote");
    const now = new Date();
    const [quote] = await tx.select().from(leadQuotes).where(and(eq(leadQuotes.leadId, id), eq(leadQuotes.id, quoteId)));
    if (!quote) throw notFound("Quote not found");
    if (quote.sentAt) return;
    if (quote.validUntil < now.toISOString().slice(0, 10)) throw conflict("Create a new quote revision with a valid expiry date");
    await tx.update(leadQuotes).set({ sentAt: now }).where(eq(leadQuotes.id, quoteId));
    await tx.update(leads).set({
      stage: "quoted", nextFollowUpAt: minutesFrom(now, followUpMinutes), escalatedAt: null,
      updatedAt: now, version: lead.version + 1,
    }).where(eq(leads.id, id));
    const actorId = currentUser(req).id;
    await tx.insert(leadEvents).values([
      { leadId: id, actorId, kind: "quote", details: "Quote revision " + quote.revision + " marked sent" },
      ...(lead.stage === "quoted" ? [] : [{ leadId: id, actorId, kind: "stage", details: lead.stage + " → quoted" }]),
    ]);
  });
  ok(res, null, "Quote marked sent");
}));

crmRoutes.get("/leads/:id/quotes/:quoteId/pdf", h(async (req, res) => {
  const lead = await scopedLead(req);
  const [quote] = await db.select().from(leadQuotes).where(and(eq(leadQuotes.leadId, lead.id), eq(leadQuotes.id, parse(uid, req.params.quoteId))));
  if (!quote) throw notFound("Quote not found");
  const number = `${label(lead.id)}-Q${quote.revision}`;
  const pdf = await renderLeadQuotePdf(number, quote);
  res.set("Content-Disposition", `attachment; filename="${number}.pdf"`).type("application/pdf").send(pdf);
}));
