import { asc, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { bookingStages, chargeRules, companySettings, verticalEnum } from "../database/schema";
import { logAudit } from "../services/audit.service";
import { getCompany } from "../services/settings.service";
import { badRequest, notFound, ok, parse } from "../utils/http";
import { uuidSchema } from "../utils/validation";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

// ---------------- Taxes and charges ----------------
const chargeSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    vertical: z.enum(verticalEnum.enumValues).nullable().optional().transform((v) => v ?? null),
    chargeType: z.enum(["percent", "fixed"]),
    value: z.coerce.number().min(0).max(100_000_000),
    basis: z.enum(["per_person", "per_booking"]).default("per_booking"),
    isActive: z.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  })
  .refine((c) => c.chargeType !== "percent" || c.value <= 100, { path: ["value"], message: "A percentage cannot be more than 100" });

export const listCharges = async (_req: Request, res: Response) => {
  ok(res, await db.select().from(chargeRules).orderBy(asc(chargeRules.sortOrder), asc(chargeRules.name)));
};

export const createCharge = async (req: Request, res: Response) => {
  const data = parse(chargeSchema, req.body);
  const [row] = await db.insert(chargeRules).values(data).returning();
  await logAudit({ action: "pricing.charge_created", entityType: "charge_rule", entityId: row!.id, newValues: row });
  ok(res, row, "Charge added. It applies to bookings submitted from now on.", 201);
};

export const updateCharge = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(chargeSchema, req.body);
  const [row] = await db.update(chargeRules).set(data).where(eq(chargeRules.id, id)).returning();
  if (!row) throw notFound("Charge not found");
  await logAudit({ action: "pricing.charge_updated", entityType: "charge_rule", entityId: id, newValues: row });
  ok(res, row, "Charge saved. Bookings already submitted keep their price.");
};

export const deleteCharge = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [row] = await db.delete(chargeRules).where(eq(chargeRules.id, id)).returning();
  if (!row) throw notFound("Charge not found");
  await logAudit({ action: "pricing.charge_deleted", entityType: "charge_rule", entityId: id, oldValues: row });
  ok(res, null, "Charge deleted");
};

// ---------------- Booking stages ----------------
const stageSchema = z.object({
  vertical: z.enum(verticalEnum.enumValues),
  name: z.string().trim().min(2, "Name is required").max(120),
  description: optionalText(1000),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});

export const listStages = async (req: Request, res: Response) => {
  const vertical = req.query.vertical ? parse(z.enum(verticalEnum.enumValues), req.query.vertical) : null;
  ok(res, await db.select().from(bookingStages).where(vertical ? eq(bookingStages.vertical, vertical) : undefined).orderBy(asc(bookingStages.vertical), asc(bookingStages.sortOrder)));
};

export const createStage = async (req: Request, res: Response) => {
  const [row] = await db.insert(bookingStages).values(parse(stageSchema, req.body)).returning();
  await logAudit({ action: "booking.stage_created", entityType: "booking_stage", entityId: row!.id, newValues: row });
  ok(res, row, "Stage added", 201);
};

export const updateStage = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [row] = await db.update(bookingStages).set(parse(stageSchema, req.body)).where(eq(bookingStages.id, id)).returning();
  if (!row) throw notFound("Stage not found");
  await logAudit({ action: "booking.stage_updated", entityType: "booking_stage", entityId: id, newValues: row });
  ok(res, row, "Stage saved");
};

export const deleteStage = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [row] = await db.delete(bookingStages).where(eq(bookingStages.id, id)).returning();
  if (!row) throw notFound("Stage not found");
  await logAudit({ action: "booking.stage_deleted", entityType: "booking_stage", entityId: id, oldValues: row });
  ok(res, null, "Stage deleted");
};

// ---------------- Booking settings ----------------
const settingsSchema = z.object({
  seatHoldHours: z.coerce.number().int().min(1, "At least 1 hour").max(720),
  passportValidityMonths: z.coerce.number().int().min(0).max(24),
});

export const getBookingSettings = async (_req: Request, res: Response) => {
  const c = await getCompany();
  ok(res, { seatHoldHours: c.seatHoldHours, passportValidityMonths: c.passportValidityMonths });
};

export const updateBookingSettings = async (req: Request, res: Response) => {
  const data = parse(settingsSchema, req.body);
  const before = await getCompany();
  if (!before) throw badRequest("Company settings missing");
  await db.update(companySettings).set(data).where(eq(companySettings.id, 1));
  await logAudit({ action: "settings.bookings_updated", entityType: "settings", entityId: "bookings", oldValues: { seatHoldHours: before.seatHoldHours, passportValidityMonths: before.passportValidityMonths }, newValues: data });
  ok(res, data, "Booking settings saved");
};
