import { db, type DbClient } from "../database/connection";
import { auditLog } from "../database/schema";
import { getRequestContext } from "../middleware/requestContext";

const SECRET_KEYS = new Set(["passwordHash", "password", "confirmPassword", "mfaSecret", "tokenHash"]);

const clean = (value: unknown) =>
  value === undefined || value === null ? null : JSON.parse(JSON.stringify(value, (k, v) => (SECRET_KEYS.has(k) ? undefined : v)));

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  /** Override the actor, e.g. for public actions like registration. null = system/anonymous. */
  actor?: { id: string; email: string } | null;
}

/**
 * Writes an audit record. Pass the transaction to make the audit part of the same change.
 * Outside a transaction a failure is logged but does not break the request.
 */
export async function logAudit(entry: AuditEntry, client: DbClient = db): Promise<void> {
  const ctx = getRequestContext();
  const actor = entry.actor === undefined ? ctx.user : entry.actor;
  try {
    await client.insert(auditLog).values({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      oldValues: clean(entry.oldValues),
      newValues: clean(entry.newValues),
      userId: actor?.id ?? null,
      userEmail: actor?.email ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  } catch (e: any) {
    if (client !== db) throw e;
    console.error(`[audit] failed to record ${entry.action}:`, e?.message || e);
  }
}
