/**
 * Test cleanup for finance data. Journal rows are protected by a database trigger; only a transaction that sets
 * `app.ledger_purge` may delete them, and only tests do that.
 */
import { inArray, or, sql } from "drizzle-orm";
import { rm } from "node:fs/promises";
import path from "node:path";

export async function purgeAgencyFinance(agencyIds: string[]) {
  if (!agencyIds.length) return;
  const { db } = await import("../database/connection");
  const S = await import("../database/schema");
  const { env } = await import("../config/env");
  const bookingIds = (await db.select({ id: S.bookings.id }).from(S.bookings).where(inArray(S.bookings.agencyId, agencyIds))).map((b) => b.id);
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local app.ledger_purge = 'on'`);
    const entries = (
      await tx
        .select({ id: S.journalEntries.id })
        .from(S.journalEntries)
        .where(or(inArray(S.journalEntries.agencyId, agencyIds), bookingIds.length ? inArray(S.journalEntries.bookingId, bookingIds) : undefined))
    ).map((e) => e.id);
    if (entries.length) {
      await tx.delete(S.journalLines).where(inArray(S.journalLines.entryId, entries));
      await tx.delete(S.journalEntries).where(inArray(S.journalEntries.id, entries));
    }
  });
  await db.delete(S.financeRequests).where(inArray(S.financeRequests.agencyId, agencyIds));
  const pays = (await db.select({ id: S.payments.id }).from(S.payments).where(inArray(S.payments.agencyId, agencyIds))).map((p) => p.id);
  if (pays.length) await db.delete(S.payments).where(inArray(S.payments.id, pays));
  for (const id of pays) await rm(path.resolve(env.STORAGE_DIR, "payments", id), { recursive: true, force: true });
}

/** Fails if the test run emailed or notified anyone outside the tests' own .test addresses. */
export async function assertNoRealRecipients(since: Date) {
  const { db } = await import("../database/connection");
  const { sql } = await import("drizzle-orm");
  const [n] = (await db.execute(sql`select count(*)::int as n from notifications x join users u on u.id = x.user_id where x.created_at >= ${since} and u.email not like '%.test'`)).rows as any[];
  const [m] = (await db.execute(sql`select count(*)::int as n from email_outbox where created_at >= ${since} and to_email not like '%.test'`)).rows as any[];
  if (n.n || m.n) throw new Error(`The test run reached real people: ${n.n} notifications, ${m.n} emails`);
}
