import { and, count, desc, eq, gte, ilike, lte } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { auditLog } from "../database/schema";
import { ok, parse } from "../utils/http";
import { paginationSchema } from "../utils/validation";

const querySchema = paginationSchema.extend({
  entityType: z.string().trim().max(50).optional(),
  entityId: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
  userEmail: z.string().trim().max(255).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** GET /api/admin/audit-log */
export const listAuditLog = async (req: Request, res: Response) => {
  const q = parse(querySchema, req.query);
  const like = (v: string) => `%${v.replace(/[%_]/g, "")}%`;
  const where = and(
    q.entityType ? eq(auditLog.entityType, q.entityType) : undefined,
    q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
    q.action ? ilike(auditLog.action, like(q.action)) : undefined,
    q.userEmail ? ilike(auditLog.userEmail, like(q.userEmail)) : undefined,
    q.from ? gte(auditLog.createdAt, q.from) : undefined,
    q.to ? lte(auditLog.createdAt, q.to) : undefined,
  );
  const [[total], items] = await Promise.all([
    db.select({ total: count() }).from(auditLog).where(where),
    db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
  ]);
  ok(res, { items, total: total?.total ?? 0, page: q.page, pageSize: q.pageSize });
};
