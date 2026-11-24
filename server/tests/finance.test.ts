/**
 * Phase 4 tests: ledger, payments, credit control, maker-checker, refunds, month closing. Real database, in-process API.
 * Everything created here is marked with a unique stamp and deleted at the end.
 */
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

const { default: app } = await import("../app");
const { db, pool } = await import("../database/connection");
const S = await import("../database/schema");
const { hashPassword } = await import("../utils/crypto");
const { and, desc, eq, inArray, like, sql } = await import("drizzle-orm");
const { purgeAgencyFinance, assertNoRealRecipients } = await import("./ledgerCleanup");

const stamp = Date.now().toString(36);
const startedAt = new Date();
const mail = (n: string) => `fin${stamp}-${n}@harampak.test`;
const PASSWORD = "Safar2026x";
const OLD_MONTH = "2001-01";
let base = "";
let server: ReturnType<typeof app.listen>;
const st: Record<string, any> = {};

async function call(method: string, url: string, opts: { token?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + url, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: type.includes("json") ? ((await res.json()) as any) : null, type };
}

async function staff(name: string, roleCode: string) {
  const [role] = await db.select().from(S.roles).where(eq(S.roles.code, roleCode));
  const [u] = await db.insert(S.users).values({ email: mail(name), fullName: `Fin ${name}`, type: "staff", passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() }).returning();
  await db.insert(S.userRoles).values({ userId: u!.id, roleId: role!.id });
  const first = await call("POST", "/auth/login", { body: { email: mail(name), password: PASSWORD } });
  if (first.body.data.accessToken) return first.body.data.accessToken as string;
  const [otp] = await db.select().from(S.otps).where(and(eq(S.otps.email, mail(name)), eq(S.otps.isUsed, false))).orderBy(desc(S.otps.createdAt)).limit(1);
  return (await call("POST", "/auth/login/mfa", { body: { mfaToken: first.body.data.mfaToken, code: otp!.code } })).body.data.accessToken as string;
}

async function agent(name: string) {
  const [role] = await db.select().from(S.roles).where(eq(S.roles.code, "TRAVEL_AGENT"));
  const n = Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
  const [ag] = await db
    .insert(S.agencies)
    .values({ agencyName: `Fin ${name} ${stamp}`, agentCode: `F${stamp}${name}`.slice(0, 20), authorizedPerson: `Fin ${name}`, phone: `+92304${n}`, whatsapp: `+92304${n}`, email: mail(name), address: "Test", city: "Test", country: "Test", status: "active", termsAcceptedAt: new Date(), termsVersion: "1" })
    .returning();
  const [u] = await db.insert(S.users).values({ email: mail(name), fullName: `Fin ${name}`, type: "agent", agencyId: ag!.id, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() }).returning();
  await db.insert(S.userRoles).values({ userId: u!.id, roleId: role!.id });
  return { agencyId: ag!.id, token: (await call("POST", "/auth/login", { body: { email: mail(name), password: PASSWORD } })).body.data.accessToken as string };
}

/** Database errors arrive wrapped by drizzle; match the message of the underlying cause. */
const dbError = (re: RegExp) => (e: any) => re.test(String(e?.cause?.message ?? e?.message));
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const pdf = () => new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")], { type: "application/pdf" });

/** Submitted booking for one adult; returns { id, total }. */
async function submittedBooking(token: string) {
  let r = await call("POST", "/agent/bookings", { token, body: { packageId: st.pkg, departureId: st.dep } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.data.id as string;
  r = await call("PUT", `/agent/bookings/${id}`, {
    token,
    body: {
      passengers: [{ fullName: "Test Pilgrim", gender: "male", dateOfBirth: "1980-01-01", nationality: "Pakistani", passportNumber: `FN${Math.floor(Math.random() * 1e7)}`, passportIssueDate: "2022-01-01", passportExpiryDate: day(3650), paxType: "adult", roomType: "quad" }],
      addons: [],
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call("POST", `/agent/bookings/${id}/submit`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id, total: Number(r.body.data.totalAmount) };
}

async function balanceOf(agencyId: string) {
  const r = await call("GET", `/admin/finance/agencies/${agencyId}`, { token: st.fin1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.credit.balance as number;
}

function paymentForm(fields: Record<string, string>, withFile = true) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (withFile) f.append("files", pdf(), "receipt.pdf");
  return f;
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  st.admin = await staff("admin", "SUPER_ADMIN");
  st.ops = await staff("ops", "OPERATIONS_ADMIN");
  st.fin1 = await staff("fin1", "FINANCE_MANAGER");
  st.fin2 = await staff("fin2", "FINANCE_MANAGER");
  st.a = await agent("a");
  st.b = await agent("b");

  const t = st.admin;
  const dest = (await call("POST", "/admin/catalogue/destinations", { token: t, body: { country: `Finland ${stamp}`, city: "Makkah", verticals: ["umrah"] } })).body.data;
  const hotel = (await call("POST", "/admin/catalogue/hotels", { token: t, body: { name: `Fin Hotel ${stamp}`, destinationId: dest.id } })).body.data;
  const policy = (await call("POST", "/admin/catalogue/cancellation-policies", { token: t, body: { name: `Fin policy ${stamp}`, slabs: [{ daysBefore: 60, chargeType: "percent", chargeValue: 25 }] } })).body.data;
  let pkg = (await call("POST", "/admin/packages", { token: t, body: { vertical: "umrah", name: `Fin Umrah ${stamp}` } })).body.data;
  st.pkg = pkg.id;
  await call("PATCH", `/admin/packages/${pkg.id}`, { token: t, body: { name: `Fin Umrah ${stamp}`, bookingMode: "fixed_departure", summary: "Test", durationDays: 14, durationNights: 13, destinationId: dest.id, cancellationPolicyId: policy.id, minPax: 1 } });
  await call("PUT", `/admin/packages/${pkg.id}/hotels`, { token: t, body: { hotels: [{ hotelId: hotel.id, nights: 13 }] } });
  pkg = (await call("POST", `/admin/packages/${pkg.id}/departures`, { token: t, body: { departureDate: day(40), returnDate: day(54), bookingDeadline: day(30), capacity: 20 } })).body.data;
  st.dep = pkg.departures[0].id;
  await call("PUT", `/admin/packages/${pkg.id}/rates`, { token: t, body: { rates: [{ roomType: "quad", paxType: "adult", basePrice: 100000 }] } });
  const pub = await call("POST", `/admin/packages/${pkg.id}/status/publish`, { token: t });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  st.dest = dest.id;
  st.hotel = hotel.id;
  st.policy = policy.id;

  const bank = await call("POST", "/admin/finance/accounts", { token: st.fin1, body: { name: `Fin Bank ${stamp}`, code: `9${stamp}`.slice(0, 12), bankDetails: "Account title: Test\nIBAN: PK00TEST" } });
  assert.equal(bank.status, 201, JSON.stringify(bank.body));
  st.bank = bank.body.data.id;
});

after(async () => {
  const ags = (await db.select({ id: S.agencies.id }).from(S.agencies).where(like(S.agencies.email, `fin${stamp}-%`))).map((a) => a.id);
  await purgeAgencyFinance(ags);
  if (ags.length) await db.delete(S.bookings).where(inArray(S.bookings.agencyId, ags));
  await db.delete(S.accountingPeriods).where(eq(S.accountingPeriods.month, OLD_MONTH));
  await db.delete(S.ledgerAccounts).where(like(S.ledgerAccounts.name, `Fin Bank ${stamp}%`));
  await db.delete(S.suppliers).where(like(S.suppliers.name, `%${stamp}%`));
  const pkgs = (await db.select({ id: S.packages.id }).from(S.packages).where(like(S.packages.name, `%${stamp}%`))).map((p) => p.id);
  if (pkgs.length) {
    await db.delete(S.priceHistory).where(inArray(S.priceHistory.packageId, pkgs));
    await db.delete(S.packages).where(inArray(S.packages.id, pkgs));
  }
  await db.delete(S.cancellationPolicies).where(like(S.cancellationPolicies.name, `%${stamp}%`));
  await db.delete(S.hotels).where(like(S.hotels.name, `%${stamp}%`));
  await db.delete(S.destinations).where(like(S.destinations.country, `%${stamp}%`));
  if (ags.length) await db.delete(S.agencies).where(inArray(S.agencies.id, ags));
  await db.delete(S.users).where(like(S.users.email, `fin${stamp}-%`));
  server?.close();
  await assertNoRealRecipients(startedAt);
  await pool.end();
});

test("advance agency: confirm is blocked until a payment is verified; statement shows charge and payment", async () => {
  const { id, total } = await submittedBooking(st.a.token);
  st.bookingA = id;
  st.totalA = total;

  // Advance terms with no deposit: Operations cannot confirm.
  let r = await call("GET", `/admin/bookings/${id}`, { token: st.ops });
  assert.equal(r.body.data.credit.check.withinCredit, false);
  r = await call("POST", `/admin/bookings/${id}/status/confirm`, { token: st.ops });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "CREDIT_LIMIT");
  assert.equal((await call("POST", `/admin/bookings/${id}/status/confirm`, { token: st.ops, body: { overrideCredit: true, reason: "VIP client" } })).status, 403, "only Finance can override");

  r = await call("POST", `/admin/bookings/${id}/status/await-payment`, { token: st.ops });
  assert.equal(r.body.data.status, "awaiting_payment");

  // The agent sees the bank account and pays; a receipt is required.
  r = await call("GET", "/agent/finance/summary", { token: st.a.token });
  assert.ok(r.body.data.banks.some((b: any) => b.id === st.bank));
  assert.equal(r.body.data.awaitingPayment[0].id, id);
  const fields = { bookingId: id, method: "bank_transfer", amount: String(total), paidOn: day(0), bankAccountId: st.bank, transactionRef: "TRX-1" };
  assert.equal((await call("POST", "/agent/finance/payments", { token: st.a.token, form: paymentForm(fields, false) })).status, 400, "receipt required");
  assert.equal((await call("POST", "/agent/finance/payments", { token: st.a.token, form: paymentForm({ ...fields, paidOn: day(2) }) })).status, 400, "no future date");
  r = await call("POST", "/agent/finance/payments", { token: st.a.token, form: paymentForm(fields) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const pay = r.body.data;
  assert.equal(pay.status, "pending");
  assert.equal((await call("GET", `/agent/bookings/${id}`, { token: st.a.token })).body.data.status, "payment_pending_verification");
  assert.equal(await balanceOf(st.a.agencyId), 0, "nothing posted before verification");

  // Other agencies cannot see it.
  assert.equal((await call("GET", `/agent/finance/payments/${pay.id}`, { token: st.b.token })).status, 404);
  assert.equal((await call("GET", `/agent/finance/payments/${pay.id}/attachments/${pay.attachments[0].id}`, { token: st.b.token })).status, 404);

  // Finance asks a question, the agent replies with another receipt, Finance verifies.
  r = await call("POST", `/admin/finance/payments/${pay.id}/clarify`, { token: st.fin1, body: { note: "Please send the bank stamp copy" } });
  assert.equal(r.body.data.status, "clarification");
  const reply = new FormData();
  reply.append("note", "Stamped copy attached");
  reply.append("files", pdf(), "stamped.pdf");
  r = await call("POST", `/agent/finance/payments/${pay.id}/reply`, { token: st.a.token, form: reply });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "pending");
  assert.equal(r.body.data.attachments.length, 2);
  r = await call("POST", `/admin/finance/payments/${pay.id}/verify`, { token: st.fin1, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "verified");
  assert.ok(r.body.data.entryNumber);
  assert.equal(await balanceOf(st.a.agencyId), -total, "agency has the payment in credit");
  assert.equal((await call("POST", `/admin/finance/payments/${pay.id}/verify`, { token: st.fin2, body: {} })).status, 409, "cannot verify twice");

  // Booking is back with Operations and can now be confirmed; the charge uses up the deposit.
  r = await call("GET", `/admin/bookings/${id}`, { token: st.ops });
  assert.equal(r.body.data.status, "under_review");
  assert.equal(r.body.data.credit.check.withinCredit, true);
  r = await call("POST", `/admin/bookings/${id}/status/confirm`, { token: st.ops });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await balanceOf(st.a.agencyId), 0);

  r = await call("GET", `/agent/finance/statement?from=${day(-1)}&to=${day(0)}`, { token: st.a.token });
  assert.equal(r.status, 200);
  const s = r.body.data;
  assert.equal(s.lines.length, 2);
  assert.deepEqual(s.lines.map((l: any) => l.type).sort(), ["booking_charge", "payment"]);
  assert.equal(s.totalDebit, total);
  assert.equal(s.totalCredit, total);
  assert.equal(s.closingBalance, 0);
  assert.equal((await call("GET", `/agent/finance/statement`, { token: st.b.token })).body.data.lines.length, 0, "statement is per agency");
});

test("journal rows cannot be changed or deleted, and unbalanced entries are refused by the database", async () => {
  const [entry] = await db.select().from(S.journalEntries).where(eq(S.journalEntries.agencyId, st.a.agencyId)).limit(1);
  assert.ok(entry);
  await assert.rejects(db.update(S.journalEntries).set({ description: "tampered" }).where(eq(S.journalEntries.id, entry.id)), dbError(/cannot be changed/));
  await assert.rejects(db.delete(S.journalLines).where(eq(S.journalLines.entryId, entry.id)), dbError(/cannot be changed/));
  await assert.rejects(db.update(S.journalLines).set({ debit: 1 }).where(eq(S.journalLines.entryId, entry.id)), dbError(/cannot be changed/));
  const [recv] = await db.select().from(S.ledgerAccounts).where(eq(S.ledgerAccounts.systemKey, "agency_receivable"));
  await assert.rejects(
    db.transaction(async (tx) => {
      const [e] = await tx.insert(S.journalEntries).values({ entryNumber: `T-${stamp}`, entryDate: day(0), type: "additional_charge", description: "unbalanced", currency: "PKR", amount: 100, agencyId: st.a.agencyId }).returning();
      await tx.insert(S.journalLines).values({ entryId: e!.id, accountId: recv!.id, agencyId: st.a.agencyId, debit: 100, credit: 0 });
    }),
    dbError(/does not balance/),
  );
  // The trial balance still balances.
  const r = await call("GET", "/admin/finance/accounts", { token: st.fin1 });
  assert.equal(r.body.data.totals.debit, r.body.data.totals.credit);
});

test("maker-checker: a second finance user approves charges; reversals undo them once", async () => {
  let r = await call("POST", "/admin/finance/requests", { token: st.fin1, body: { kind: "additional_charge", agencyId: st.a.agencyId, amount: 5000, reason: "Visa re-processing fee", description: "Visa re-processing fee" } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const reqId = r.body.data.id;
  assert.equal(await balanceOf(st.a.agencyId), 0, "nothing posted while pending");
  assert.equal((await call("POST", "/admin/finance/requests", { token: st.ops, body: { kind: "additional_charge", agencyId: st.a.agencyId, amount: 1, reason: "Not finance" } })).status, 403);
  r = await call("POST", `/admin/finance/requests/${reqId}/approve`, { token: st.fin1, body: {} });
  assert.equal(r.status, 403, "requester cannot approve own request");
  r = await call("POST", `/admin/finance/requests/${reqId}/approve`, { token: st.fin2, body: { note: "OK" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const entryId = r.body.data.entryId;
  assert.equal(await balanceOf(st.a.agencyId), 5000);
  assert.equal((await call("POST", `/admin/finance/requests/${reqId}/approve`, { token: st.admin, body: {} })).status, 409, "already approved");

  // Opening balance only once per agency.
  r = await call("POST", "/admin/finance/requests", { token: st.fin1, body: { kind: "opening_balance", agencyId: st.b.agencyId, amount: 20000, agencyOwes: true, reason: "Balance from old system" } });
  assert.equal(r.status, 201);
  assert.equal((await call("POST", "/admin/finance/requests", { token: st.fin2, body: { kind: "opening_balance", agencyId: st.b.agencyId, amount: 1, reason: "Duplicate try" } })).status, 409);
  assert.equal((await call("POST", `/admin/finance/requests/${r.body.data.id}/reject`, { token: st.fin2, body: { note: "Wrong figure" } })).status, 200);
  assert.equal(await balanceOf(st.b.agencyId), 0);

  // Reverse the charge.
  r = await call("POST", "/admin/finance/requests", { token: st.fin2, body: { kind: "reversal", reversalOfEntryId: entryId, reason: "Charged by mistake" } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await call("POST", "/admin/finance/requests", { token: st.fin1, body: { kind: "reversal", reversalOfEntryId: entryId, reason: "Second try" } })).status, 409, "one pending reversal");
  r = await call("POST", `/admin/finance/requests/${r.body.data.id}/approve`, { token: st.fin1, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await balanceOf(st.a.agencyId), 0);
  assert.equal((await call("POST", "/admin/finance/requests", { token: st.fin1, body: { kind: "reversal", reversalOfEntryId: entryId, reason: "Third try" } })).status, 409, "already reversed");
  r = await call("GET", `/admin/finance/journal/${entryId}`, { token: st.fin1 });
  assert.ok(r.body.data.reversedBy);
});

test("cancelling a confirmed booking raises a credit note; approval refunds the booking; refund payout settles it", async () => {
  const id = st.bookingA;
  const total = st.totalA;
  let r = await call("POST", `/admin/bookings/${id}/status/cancel`, { token: st.ops, body: { reason: "Client cancelled" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.message, /Credit note FR-/);
  const charge = Number(r.body.data.cancellationCharge);
  assert.equal(charge, Math.round(total * 0.25));
  r = await call("GET", `/admin/finance/requests?status=pending&agencyId=${st.a.agencyId}`, { token: st.fin1 });
  const cn = r.body.data.items.find((i: any) => i.kind === "credit_note" && i.bookingId === id);
  assert.ok(cn);
  assert.equal(Number(cn.amount), total - charge);
  assert.equal((await call("POST", `/admin/finance/requests/${cn.id}/approve`, { token: st.fin1, body: {} })).status, 200, "system-raised request: any approver");
  assert.equal(await balanceOf(st.a.agencyId), -(total - charge));
  assert.equal((await call("GET", `/agent/bookings/${id}`, { token: st.a.token })).body.data.status, "refunded");

  // Refund payout cannot exceed the agency's credit.
  r = await call("POST", "/admin/finance/requests", { token: st.fin1, body: { kind: "refund_payout", agencyId: st.a.agencyId, amount: total, accountId: st.bank, reason: "Refund to agent" } });
  assert.equal(r.status, 201);
  assert.equal((await call("POST", `/admin/finance/requests/${r.body.data.id}/approve`, { token: st.fin2, body: {} })).status, 400);
  await call("POST", `/admin/finance/requests/${r.body.data.id}/reject`, { token: st.fin1, body: { note: "Withdrawn" } });
  r = await call("POST", "/admin/finance/requests", { token: st.fin1, body: { kind: "refund_payout", agencyId: st.a.agencyId, amount: total - charge, accountId: st.bank, reason: "Refund to agent" } });
  assert.equal((await call("POST", `/admin/finance/requests/${r.body.data.id}/approve`, { token: st.fin2, body: {} })).status, 200);
  assert.equal(await balanceOf(st.a.agencyId), 0);
});

test("credit agency: two confirmations at once cannot both use the last credit; warn policy and Finance override", async () => {
  const one = await submittedBooking(st.b.token);
  const two = await submittedBooking(st.b.token);
  let r = await call("PUT", `/admin/finance/agencies/${st.b.agencyId}/credit`, { token: st.fin1, body: { paymentTerms: "credit", creditLimit: Math.round(one.total * 1.5), creditPolicy: "block", paymentTermsDays: 30 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.available, Math.round(one.total * 1.5));
  assert.equal((await call("PUT", `/admin/finance/agencies/${st.b.agencyId}/credit`, { token: st.ops, body: { paymentTerms: "credit", creditLimit: 1, creditPolicy: "warn", paymentTermsDays: 0 } })).status, 403);

  const results = await Promise.all([one, two].map((b) => call("POST", `/admin/bookings/${b.id}/status/confirm`, { token: st.ops })));
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409], JSON.stringify(results.map((x) => x.body.message)));
  const blocked = results[0]!.status === 409 ? one : two;
  assert.equal(await balanceOf(st.b.agencyId), one.total);

  // Finance (here the super admin, who also manages bookings) may override with a reason.
  assert.equal((await call("POST", `/admin/bookings/${blocked.id}/status/confirm`, { token: st.admin, body: { overrideCredit: true, reason: "" } })).status, 400, "reason required");
  r = await call("POST", `/admin/bookings/${blocked.id}/status/confirm`, { token: st.admin, body: { overrideCredit: true, reason: "Agent pays Friday" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.history.some((h: any) => /Credit override/.test(h.reason ?? "")));
  assert.equal(await balanceOf(st.b.agencyId), one.total + two.total);

  // Warn policy: confirmation goes through with a note.
  await call("PUT", `/admin/finance/agencies/${st.b.agencyId}/credit`, { token: st.fin1, body: { paymentTerms: "credit", creditLimit: 0, creditPolicy: "warn", paymentTermsDays: 0 } });
  const three = await submittedBooking(st.b.token);
  r = await call("POST", `/admin/bookings/${three.id}/status/confirm`, { token: st.ops });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.history.some((h: any) => /warning only/.test(h.reason ?? "")));

  r = await call("GET", `/admin/finance/agencies?filter=over_limit&search=${stamp}`, { token: st.fin1 });
  const row = r.body.data.items.find((i: any) => i.id === st.b.agencyId);
  assert.ok(row, JSON.stringify(r.body));
  assert.equal(row.balance, await balanceOf(st.b.agencyId), "balance list matches the agency ledger");

  // Trial balance carries real totals and still balances.
  r = await call("GET", "/admin/finance/accounts", { token: st.fin1 });
  assert.ok(r.body.data.totals.debit > 0);
  assert.equal(r.body.data.totals.debit, r.body.data.totals.credit);
  const recv = r.body.data.items.find((a: any) => a.systemKey === "agency_receivable");
  assert.ok(recv.debit > 0, "receivable account shows postings");

  // Agent can find bookings by passenger name.
  r = await call("GET", "/agent/bookings?search=Pilgrim", { token: st.b.token });
  assert.ok(r.body.data.items.length >= 3, JSON.stringify(r.body.data.items.length));
  assert.ok(r.body.data.items.every((i: any) => i.leadPassenger === "Test Pilgrim"));
});

test("closed months refuse entries; staff-recorded payments need a second person; costs stay internal", async () => {
  assert.equal((await call("POST", "/admin/finance/periods", { token: st.fin1, body: { month: day(0).slice(0, 7) } })).status, 400, "current month cannot be closed");
  assert.equal((await call("POST", "/admin/finance/periods", { token: st.ops, body: { month: OLD_MONTH } })).status, 403);
  let r = await call("POST", "/admin/finance/periods", { token: st.fin1, body: { month: OLD_MONTH } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call("POST", "/admin/finance/requests", { token: st.fin1, body: { kind: "additional_charge", agencyId: st.b.agencyId, amount: 100, entryDate: `${OLD_MONTH}-15`, reason: "Back-dated charge" } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /closed/);
  const [recv] = await db.select().from(S.ledgerAccounts).where(eq(S.ledgerAccounts.systemKey, "agency_receivable"));
  await assert.rejects(
    db.transaction(async (tx) => {
      const [e] = await tx.insert(S.journalEntries).values({ entryNumber: `T2-${stamp}`, entryDate: `${OLD_MONTH}-10`, type: "additional_charge", description: "old", currency: "PKR", amount: 1, agencyId: st.b.agencyId }).returning();
      await tx.insert(S.journalLines).values([{ entryId: e!.id, accountId: recv!.id, agencyId: st.b.agencyId, debit: 1, credit: 0 }, { entryId: e!.id, accountId: st.bank, debit: 0, credit: 1 }]);
    }),
    dbError(/closed/),
  );
  assert.equal((await call("POST", `/admin/finance/periods/${OLD_MONTH}/reopen`, { token: st.fin1, body: { reason: "Test reopen" } })).status, 200);

  // Cash received at the office: recorded by one finance user, verified by another.
  const before = await balanceOf(st.b.agencyId);
  r = await call("POST", "/admin/finance/payments", { token: st.fin1, form: paymentForm({ agencyId: st.b.agencyId, method: "cash", amount: "10000", paidOn: day(0), bankAccountId: st.bank }, false) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.canVerify, undefined);
  assert.equal((await call("POST", `/admin/finance/payments/${r.body.data.id}/verify`, { token: st.fin1, body: {} })).status, 403);
  assert.equal((await call("POST", `/admin/finance/payments/${r.body.data.id}/verify`, { token: st.fin2, body: {} })).status, 200);
  assert.equal(await balanceOf(st.b.agencyId), before - 10000);

  // Supplier costs and margin are visible to Finance only.
  const sup = (await call("POST", "/admin/finance/suppliers", { token: st.fin1, body: { name: `Fin Hotel Supplier ${stamp}`, category: "Hotel" } })).body.data;
  const [bk] = await db.select().from(S.bookings).where(and(eq(S.bookings.agencyId, st.b.agencyId), eq(S.bookings.status, "confirmed"))).limit(1);
  r = await call("POST", `/admin/finance/bookings/${bk!.id}/costs`, { token: st.fin1, body: { supplierId: sup.id, description: "Hotel nights", estimatedAmount: 60000 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await call("GET", `/admin/finance/bookings/${bk!.id}`, { token: st.fin1 });
  assert.equal(r.body.data.totalCost, 60000);
  assert.equal(r.body.data.margin, Number(bk!.totalAmount) - 60000);
  assert.equal((await call("GET", `/admin/finance/bookings/${bk!.id}`, { token: st.b.token })).status, 403);
  const agentView = await call("GET", `/agent/bookings/${bk!.id}`, { token: st.b.token });
  assert.ok(!JSON.stringify(agentView.body).includes("Hotel nights"), "costs never reach the agent");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(S.journalEntries).where(eq(S.journalEntries.agencyId, st.b.agencyId));
  assert.ok(n >= 4);
});
