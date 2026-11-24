import type { Request, Response } from "express";
import { z } from "zod";
import { currentUser } from "../middleware/auth.middleware";
import {
  BOOKING_DOCS, bookingDocument, brochure, departurePassengerList, entryDocument, paymentReceipt, statementPdf, type BookingDocSlug, type GeneratedDocument,
} from "../services/documents/documents.service";
import { defaultRange } from "../services/ledger.service";
import { REPORTS, reportToPdf, reportToXlsx, runReport, type ReportKey } from "../services/report.service";
import { getCompany, todayInCompanyTz } from "../services/settings.service";
import { logAudit } from "../services/audit.service";
import { badRequest, forbidden, notFound, ok, parse } from "../utils/http";
import { uuidSchema } from "../utils/validation";

function sendFile(res: Response, data: Buffer, fileName: string, mime: string) {
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `inline; filename="${fileName.replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(data);
}
const sendPdf = (res: Response, doc: GeneratedDocument) => sendFile(res, doc.pdf, doc.fileName, "application/pdf");

const docSlug = z.enum(Object.keys(BOOKING_DOCS) as [BookingDocSlug, ...BookingDocSlug[]]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

async function range(query: unknown) {
  const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), query);
  const d = await defaultRange();
  const from = q.from ?? d.from;
  const to = q.to ?? d.to;
  if (from > to) throw badRequest("The start date is after the end date");
  return { from, to };
}

/** The agent's own active agency. */
function agencyOf(req: Request): string {
  const me = currentUser(req);
  if (me.type !== "agent" || !me.agency) throw forbidden("Agent account required");
  if (me.agency.status !== "active") throw forbidden("Documents are available once your agency is approved.");
  return me.agency.id;
}

// ================================================================================
// Agent portal (own agency only)
// ================================================================================
export const agentBookingDocument = async (req: Request, res: Response) => {
  sendPdf(res, await bookingDocument(parse(uuidSchema, req.params.id), parse(docSlug, req.params.doc), agencyOf(req)));
};
export const agentPaymentReceipt = async (req: Request, res: Response) => {
  sendPdf(res, await paymentReceipt(parse(uuidSchema, req.params.id), agencyOf(req)));
};
export const agentEntryDocument = async (req: Request, res: Response) => {
  sendPdf(res, await entryDocument(parse(uuidSchema, req.params.entryId), agencyOf(req)));
};
export const agentStatement = async (req: Request, res: Response) => {
  const agencyId = agencyOf(req);
  const { from, to } = await range(req.query);
  sendPdf(res, await statementPdf(agencyId, from, to));
};
export const agentBrochure = async (req: Request, res: Response) => {
  const agencyId = agencyOf(req);
  const { prices } = parse(z.object({ prices: z.enum(["true", "false"]).optional() }), req.query);
  sendPdf(res, await brochure(parse(uuidSchema, req.params.id), { agencyId, withPrices: prices === "true", publishedOnly: true }));
};

// ================================================================================
// Staff
// ================================================================================
export const staffBookingDocument = async (req: Request, res: Response) => {
  sendPdf(res, await bookingDocument(parse(uuidSchema, req.params.id), parse(docSlug, req.params.doc)));
};
export const staffPaymentReceipt = async (req: Request, res: Response) => {
  sendPdf(res, await paymentReceipt(parse(uuidSchema, req.params.id)));
};
export const staffEntryDocument = async (req: Request, res: Response) => {
  sendPdf(res, await entryDocument(parse(uuidSchema, req.params.entryId)));
};
export const staffStatement = async (req: Request, res: Response) => {
  const { from, to } = await range(req.query);
  sendPdf(res, await statementPdf(parse(uuidSchema, req.params.id), from, to));
};
export const staffBrochure = async (req: Request, res: Response) => {
  sendPdf(res, await brochure(parse(uuidSchema, req.params.id), {}));
};
export const staffDepartureList = async (req: Request, res: Response) => {
  sendPdf(res, await departurePassengerList(parse(uuidSchema, req.params.id)));
};

// ================================================================================
// Reports
// ================================================================================

/** GET /api/admin/reports: the reports this user may run. */
export const listReports = async (req: Request, res: Response) => {
  const perms = currentUser(req).permissions;
  const d = await defaultRange();
  ok(res, {
    defaults: { from: d.from, to: d.to, asOf: await todayInCompanyTz() },
    reports: Object.entries(REPORTS)
      .filter(([, r]) => r.needs.every((p) => perms.includes(p)))
      .map(([key, r]) => ({ key, title: r.title, description: r.description, range: r.range, groupBy: Object.entries(r.groupBy).map(([value, label]) => ({ value, label })) })),
  });
};

/** GET /api/admin/reports/:key?from&to&asOf&groupBy&format=json|xlsx|pdf */
export const getReport = async (req: Request, res: Response) => {
  const key = String(req.params.key) as ReportKey;
  const def = REPORTS[key];
  if (!def) throw notFound("Unknown report");
  const perms = currentUser(req).permissions;
  if (!def.needs.every((p) => perms.includes(p))) throw forbidden();
  const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional(), asOf: isoDate.optional(), groupBy: z.string().max(30).optional(), format: z.enum(["json", "xlsx", "pdf"]).default("json") }), req.query);
  const d = await defaultRange();
  const report = await runReport(key, { from: q.from ?? d.from, to: q.to ?? d.to, asOf: q.asOf ?? (await todayInCompanyTz()), groupBy: q.groupBy });
  if (q.format === "json") return ok(res, report);
  await logAudit({ action: "report.exported", entityType: "report", entityId: null, newValues: { report: key, format: q.format, subtitle: report.subtitle } });
  const base = `${report.title} ${report.subtitle}`.replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").trim();
  if (q.format === "xlsx") return sendFile(res, await reportToXlsx(report, (await getCompany()).name), `${base}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  sendFile(res, await reportToPdf(report), `${base}.pdf`, "application/pdf");
};
