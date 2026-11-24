/**
 * Phase 5 tests: documents (PDF), notifications, announcements, dashboards, reports. Real database, in-process API.
 * Everything created here is marked with a unique stamp and deleted at the end.
 */
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";

const { default: app } = await import("../app");
const { db, pool } = await import("../database/connection");
const S = await import("../database/schema");
const { env } = await import("../config/env");
const { hashPassword } = await import("../utils/crypto");
const { closePdfBrowser } = await import("../services/pdf.service");
const { sendBalanceReminders } = await import("../services/agentAlerts.service");
const { and, desc, eq, inArray, like } = await import("drizzle-orm");
const { purgeAgencyFinance } = await import("./ledgerCleanup");

const stamp = Date.now().toString(36);
const mail = (n: string) => `p5${stamp}-${n}@harampak.test`;
const PASSWORD = "Safar2026x";
let base = "";
let server: ReturnType<typeof app.listen>;
const st: Record<string, any> = {};
let originalInvoiceTitle: { title: string; introText: string | null; footerText: string | null } | null = null;

async function call(method: string, url: string, opts: { token?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + url, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json")) return { status: res.status, body: (await res.json()) as any, type, bytes: null as Buffer | null };
  return { status: res.status, body: null as any, type, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function staff(name: string, roleCode: string) {
  const [role] = await db.select().from(S.roles).where(eq(S.roles.code, roleCode));
  const [u] = await db.insert(S.users).values({ email: mail(name), fullName: `P5 ${name}`, type: "staff", passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() }).returning();
  await db.insert(S.userRoles).values({ userId: u!.id, roleId: role!.id });
  const first = await call("POST", "/auth/login", { body: { email: mail(name), password: PASSWORD } });
  if (first.body.data.accessToken) return { token: first.body.data.accessToken as string, id: u!.id };
  const [otp] = await db.select().from(S.otps).where(and(eq(S.otps.email, mail(name)), eq(S.otps.isUsed, false))).orderBy(desc(S.otps.createdAt)).limit(1);
  return { token: (await call("POST", "/auth/login/mfa", { body: { mfaToken: first.body.data.mfaToken, code: otp!.code } })).body.data.accessToken as string, id: u!.id };
}

async function agent(name: string, extra: Partial<typeof S.agencies.$inferInsert> = {}) {
  const [role] = await db.select().from(S.roles).where(eq(S.roles.code, "TRAVEL_AGENT"));
  const n = Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
  const [ag] = await db
    .insert(S.agencies)
    .values({ agencyName: `P5 ${name} ${stamp}`, agentCode: `P${stamp}${name}`.slice(0, 20), authorizedPerson: `P5 ${name}`, phone: `+92305${n}`, whatsapp: `+92305${n}`, email: mail(name), address: "Test", city: "Test", country: "Test", status: "active", termsAcceptedAt: new Date(), termsVersion: "1", ...extra })
    .returning();
  const [u] = await db.insert(S.users).values({ email: mail(name), fullName: `P5 ${name}`, type: "agent", agencyId: ag!.id, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() }).returning();
  await db.insert(S.userRoles).values({ userId: u!.id, roleId: role!.id });
  return { agencyId: ag!.id, userId: u!.id, token: (await call("POST", "/auth/login", { body: { email: mail(name), password: PASSWORD } })).body.data.accessToken as string };
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const pdfBlob = () => new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")], { type: "application/pdf" });
const isPdf = (r: { status: number; type: string; bytes: Buffer | null }, label: string) => {
  assert.equal(r.status, 200, `${label}: ${r.status}`);
  assert.match(r.type, /application\/pdf/, label);
  assert.equal(r.bytes!.subarray(0, 4).toString(), "%PDF", label);
  assert.ok(r.bytes!.length > 2000, `${label} has content`);
};

async function notificationsOf(userId: string) {
  return db.select().from(S.notifications).where(eq(S.notifications.userId, userId)).orderBy(desc(S.notifications.createdAt));
}

/** Background alerts (package publish) finish shortly after the request returns. */
async function eventually(check: () => Promise<boolean>, label: string) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`timed out waiting for: ${label}`);
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  st.admin = await staff("admin", "SUPER_ADMIN");
  st.ops = await staff("ops", "OPERATIONS_ADMIN");
  st.fin1 = await staff("fin1", "FINANCE_MANAGER");
  st.fin2 = await staff("fin2", "FINANCE_MANAGER");
  st.a = await agent("a", { paymentTerms: "credit", creditLimit: 100_000_000 });
  st.b = await agent("b");

  const t = st.admin.token;
  const dest = (await call("POST", "/admin/catalogue/destinations", { token: t, body: { country: `Pfland ${stamp}`, city: "Makkah", verticals: ["umrah"] } })).body.data;
  const hotel = (await call("POST", "/admin/catalogue/hotels", { token: t, body: { name: `P5 Hotel ${stamp}`, destinationId: dest.id, starRating: 5, distanceToHaramM: 200 } })).body.data;
  let pkg = (await call("POST", "/admin/packages", { token: t, body: { vertical: "umrah", name: `P5 Umrah ${stamp}` } })).body.data;
  st.pkg = pkg.id;
  await call("PATCH", `/admin/packages/${pkg.id}`, { token: t, body: { name: `P5 Umrah ${stamp}`, bookingMode: "fixed_departure", summary: "Test package", description: "Fifteen days in Makkah and Madinah.", durationDays: 15, durationNights: 14, destinationId: dest.id, minPax: 1, inclusions: ["Visa", "Hotel"], exclusions: ["Air ticket"] } });
  await call("PUT", `/admin/packages/${pkg.id}/hotels`, { token: t, body: { hotels: [{ hotelId: hotel.id, nights: 14 }] } });
  await call("PUT", `/admin/packages/${pkg.id}/itinerary`, { token: t, body: { days: [{ dayNumber: 1, title: "Arrival in Makkah", description: "Transfer to the hotel" }] } });
  pkg = (await call("POST", `/admin/packages/${pkg.id}/departures`, { token: t, body: { departureDate: day(45), returnDate: day(60), bookingDeadline: day(30), capacity: 20 } })).body.data;
  st.dep = pkg.departures[0].id;
  await call("PUT", `/admin/packages/${pkg.id}/rates`, { token: t, body: { rates: [{ roomType: "quad", paxType: "adult", basePrice: 200000 }, { roomType: "double", paxType: "adult", basePrice: 260000 }] } });
  const pub = await call("POST", `/admin/packages/${pkg.id}/status/publish`, { token: t });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  st.dest = dest.id;
  st.hotel = hotel.id;
  st.bank = (await call("POST", "/admin/finance/accounts", { token: st.fin1.token, body: { name: `P5 Bank ${stamp}`, code: `8${stamp}`.slice(0, 12), bankDetails: "IBAN PK00TEST" } })).body.data.id;
});

after(async () => {
  const ags = (await db.select({ id: S.agencies.id }).from(S.agencies).where(like(S.agencies.email, `p5${stamp}-%`))).map((a) => a.id);
  await purgeAgencyFinance(ags);
  const bks = ags.length ? (await db.select({ id: S.bookings.id }).from(S.bookings).where(inArray(S.bookings.agencyId, ags))).map((b) => b.id) : [];
  if (bks.length) await db.delete(S.bookings).where(inArray(S.bookings.id, bks));
  await db.delete(S.announcements).where(like(S.announcements.title, `%${stamp}%`));
  await db.delete(S.ledgerAccounts).where(like(S.ledgerAccounts.name, `P5 Bank ${stamp}%`));
  if (originalInvoiceTitle) await db.update(S.documentTemplates).set(originalInvoiceTitle).where(eq(S.documentTemplates.type, "sales_invoice"));
  const pkgs = (await db.select({ id: S.packages.id }).from(S.packages).where(like(S.packages.name, `%${stamp}%`))).map((p) => p.id);
  if (pkgs.length) {
    await db.delete(S.priceHistory).where(inArray(S.priceHistory.packageId, pkgs));
    await db.delete(S.packages).where(inArray(S.packages.id, pkgs));
  }
  await db.delete(S.hotels).where(like(S.hotels.name, `%${stamp}%`));
  await db.delete(S.destinations).where(like(S.destinations.country, `%${stamp}%`));
  if (ags.length) await db.delete(S.agencies).where(inArray(S.agencies.id, ags));
  await db.delete(S.users).where(like(S.users.email, `p5${stamp}-%`));
  for (const id of bks) await rm(path.resolve(env.STORAGE_DIR, "bookings", id), { recursive: true, force: true });
  await closePdfBrowser();
  server?.close();
  await pool.end();
});

test("publishing a package alerts agents in the portal", async () => {
  await eventually(async () => (await notificationsOf(st.a.userId)).some((n) => n.type === "new_package" && n.link === `/agent/packages/${st.pkg}`), "new package alert");
  const r = await call("GET", "/notifications/unread-count", { token: st.a.token });
  assert.ok(r.body.data.unread >= 1);
});

test("booking documents follow the booking stage, carry an invoice number and stay private to the agency", async () => {
  let r = await call("POST", "/agent/bookings", { token: st.a.token, body: { packageId: st.pkg, departureId: st.dep } });
  const id = r.body.data.id;
  st.booking = id;
  r = await call("PUT", `/agent/bookings/${id}`, {
    token: st.a.token,
    body: { passengers: [{ fullName: "Ahmed Test", gender: "male", dateOfBirth: "1980-01-01", nationality: "Pakistani", passportNumber: `PK${Math.floor(Math.random() * 1e7)}`, passportIssueDate: "2022-01-01", passportExpiryDate: day(3650), paxType: "adult", roomType: "quad" }], addons: [] },
  });
  assert.deepEqual(r.body.data.documentsAvailable, [], "drafts have no documents");
  r = await call("POST", `/agent/bookings/${id}/submit`, { token: st.a.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  st.total = Number(r.body.data.totalAmount);
  assert.deepEqual(r.body.data.documentsAvailable, ["proforma", "passenger-list"]);
  isPdf(await call("GET", `/agent/documents/bookings/${id}/proforma`, { token: st.a.token }), "pro forma");
  assert.equal((await call("GET", `/agent/documents/bookings/${id}/invoice`, { token: st.a.token })).status, 404, "no invoice before confirmation");
  assert.equal((await call("GET", `/agent/documents/bookings/${id}/proforma`, { token: st.b.token })).status, 404, "other agency cannot download");

  r = await call("POST", `/admin/bookings/${id}/status/confirm`, { token: st.ops.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.data.invoiceNumber, /^INV-\d{4}-\d{6}$/);
  assert.deepEqual(r.body.data.documentsAvailable, ["invoice", "confirmation", "voucher", "passenger-list"]);
  for (const doc of ["invoice", "confirmation", "voucher", "passenger-list"]) {
    isPdf(await call("GET", `/agent/documents/bookings/${id}/${doc}`, { token: st.a.token }), `agent ${doc}`);
  }
  isPdf(await call("GET", `/admin/documents/bookings/${id}/invoice`, { token: st.ops.token }), "staff invoice");
  isPdf(await call("GET", `/admin/documents/departures/${st.dep}/passenger-list`, { token: st.ops.token }), "departure list");
  assert.equal((await call("GET", `/admin/documents/bookings/${id}/invoice`, { token: st.a.token })).status, 403, "agents cannot use staff routes");

  // The agent was told in the portal.
  const alerts = await notificationsOf(st.a.userId);
  assert.ok(alerts.some((n) => n.type === "booking_update" && n.link === `/agent/bookings/${id}` && /Confirmed/.test(n.title)));
});

test("payment receipt, statement documents and brochure", async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ method: "bank_transfer", amount: "50000", paidOn: day(0), bankAccountId: st.bank, transactionRef: "TRX-P5" })) f.append(k, v);
  f.append("files", pdfBlob(), "receipt.pdf");
  let r = await call("POST", "/agent/finance/payments", { token: st.a.token, form: f });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const payId = r.body.data.id;
  assert.ok((await notificationsOf(st.fin1.id)).some((n) => n.type === "payment" && n.link === `/admin/finance/payments/${payId}`), "finance alerted in the portal");
  assert.equal((await call("GET", `/agent/documents/payments/${payId}/receipt`, { token: st.a.token })).status, 404, "no receipt before verification");
  assert.equal((await call("POST", `/admin/finance/payments/${payId}/verify`, { token: st.fin1.token, body: {} })).status, 200);
  isPdf(await call("GET", `/agent/documents/payments/${payId}/receipt`, { token: st.a.token }), "receipt");
  assert.ok((await notificationsOf(st.a.userId)).some((n) => n.type === "payment_update"));

  r = await call("GET", `/agent/finance/statement?from=${day(-1)}&to=${day(0)}`, { token: st.a.token });
  for (const line of r.body.data.lines) isPdf(await call("GET", `/agent/documents/entries/${line.entryId}`, { token: st.a.token }), `entry ${line.type}`);
  assert.equal((await call("GET", `/agent/documents/entries/${r.body.data.lines[0].entryId}`, { token: st.b.token })).status, 404);
  isPdf(await call("GET", `/agent/documents/statement?from=${day(-1)}&to=${day(0)}`, { token: st.a.token }), "agent statement");
  isPdf(await call("GET", `/admin/documents/agencies/${st.a.agencyId}/statement`, { token: st.fin1.token }), "staff statement");
  isPdf(await call("GET", `/agent/documents/packages/${st.pkg}/brochure?prices=true`, { token: st.a.token }), "brochure with prices");
  isPdf(await call("GET", `/admin/documents/packages/${st.pkg}/brochure`, { token: st.admin.token }), "staff brochure");
});

test("document templates are editable in Settings", async () => {
  const list = await call("GET", "/admin/settings/documents", { token: st.admin.token });
  const inv = list.body.data.find((d: any) => d.type === "sales_invoice");
  originalInvoiceTitle = { title: inv.title, introText: inv.introText, footerText: inv.footerText };
  let r = await call("PUT", "/admin/settings/documents/sales_invoice", { token: st.admin.token, body: { title: `Tax invoice ${stamp}`, introText: "Thank you", footerText: "Terms apply" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call("GET", "/admin/settings/documents", { token: st.admin.token });
  assert.equal(r.body.data.find((d: any) => d.type === "sales_invoice").title, `Tax invoice ${stamp}`);
  assert.equal((await call("PUT", "/admin/settings/documents/unknown", { token: st.admin.token, body: { title: "X" } })).status, 404);
  assert.equal((await call("PUT", "/admin/settings/documents/sales_invoice", { token: st.ops.token, body: { title: "X" } })).status, 403);
});

test("announcements reach only their audience; notifications can be read", async () => {
  let r = await call("POST", "/admin/announcements", { token: st.admin.token, body: { title: `Only for A ${stamp}`, body: "Office closed on Friday", audience: "agencies", agencyIds: [st.a.agencyId] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.message, /sent to 1 agencies/);
  assert.equal((await call("POST", "/admin/announcements", { token: st.admin.token, body: { title: `Empty ${stamp}`, body: "x x x", audience: "agencies", agencyIds: [] } })).status, 400);
  assert.equal((await call("POST", "/admin/announcements", { token: st.ops.token, body: { title: `Ops ${stamp}`, body: "Not allowed" } })).status, 403);

  const dashA = await call("GET", "/agent/dashboard", { token: st.a.token });
  const dashB = await call("GET", "/agent/dashboard", { token: st.b.token });
  assert.ok(dashA.body.data.announcements.some((a: any) => a.title === `Only for A ${stamp}`));
  assert.ok(!dashB.body.data.announcements.some((a: any) => a.title === `Only for A ${stamp}`));
  assert.ok((await notificationsOf(st.a.userId)).some((n) => n.type === "announcement"));
  assert.ok(!(await notificationsOf(st.b.userId)).some((n) => n.type === "announcement" && n.title.includes(stamp)));

  r = await call("GET", "/notifications?unread=true", { token: st.a.token });
  assert.ok(r.body.data.unread > 0);
  const first = r.body.data.items[0].id;
  await call("POST", `/notifications/${first}/read`, { token: st.a.token });
  // Someone else's notification cannot be marked.
  await call("POST", `/notifications/${first}/read`, { token: st.b.token });
  await call("POST", "/notifications/read-all", { token: st.a.token });
  assert.equal((await call("GET", "/notifications/unread-count", { token: st.a.token })).body.data.unread, 0);
});

test("dashboards show the agency's position and the admin's sections", async () => {
  let r = await call("GET", "/agent/dashboard", { token: st.a.token });
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(d.credit.balance, st.total - 50000);
  assert.equal(d.bookingGroups.confirmed, 1);
  assert.ok(d.recentEntries.length >= 2);
  assert.equal(d.upcomingTrips[0].id, st.booking);

  r = await call("GET", "/admin/dashboard", { token: st.admin.token });
  assert.equal(r.status, 200);
  for (const k of ["agencies", "bookings", "sales", "finance", "capacity"]) assert.ok(r.body.data[k], `admin sees ${k}`);
  assert.ok(r.body.data.sales.thisMonth.umrah >= st.total);
  assert.ok(r.body.data.capacity.some((c: any) => c.id === st.dep && c.seatsSold === 1));
  assert.equal((await call("GET", "/admin/dashboard", { token: st.a.token })).status, 403);
});

test("reports match the ledger and export to Excel and PDF", async () => {
  let r = await call("GET", "/admin/reports", { token: st.ops.token });
  assert.ok(r.body.data.reports.some((x: any) => x.key === "sales"));
  r = await call("GET", `/admin/reports/sales?groupBy=agent&from=${day(-1)}&to=${day(0)}`, { token: st.admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = r.body.data.rows.find((x: any) => String(x.group).includes(`P5 a ${stamp}`));
  assert.ok(row, "agency A in sales");
  assert.equal(row.gross, st.total);
  assert.equal(row.net, st.total);
  assert.equal(row.bookings, 1);

  r = await call("GET", `/admin/reports/collections?groupBy=agent&from=${day(-1)}&to=${day(0)}`, { token: st.admin.token });
  assert.equal(r.body.data.rows.find((x: any) => String(x.group).includes(`P5 a ${stamp}`)).net, 50000);

  r = await call("GET", `/admin/reports/receivables`, { token: st.admin.token });
  const rec = r.body.data.rows.find((x: any) => String(x.group).includes(`P5 a ${stamp}`));
  assert.equal(rec.balance, st.total - 50000);
  assert.equal(rec.b0, st.total - 50000, "all of it is under 30 days old");

  r = await call("GET", `/admin/reports/profit?groupBy=booking&from=${day(-1)}&to=${day(0)}`, { token: st.admin.token });
  assert.ok(r.body.data.rows.some((x: any) => x.revenue === st.total));
  assert.equal((await call("GET", `/admin/reports/sales?groupBy=nonsense`, { token: st.admin.token })).status, 400);
  assert.equal((await call("GET", `/admin/reports/sales`, { token: st.a.token })).status, 403);

  const xlsx = await call("GET", `/admin/reports/sales?groupBy=vertical&from=${day(-1)}&to=${day(0)}&format=xlsx`, { token: st.admin.token });
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.type, /spreadsheetml/);
  assert.equal(xlsx.bytes!.subarray(0, 2).toString(), "PK", "xlsx is a zip file");
  isPdf(await call("GET", `/admin/reports/receivables?format=pdf`, { token: st.admin.token }), "report pdf");
});

test("balance reminders go to agencies that owe money, once per interval", async () => {
  const before = (await notificationsOf(st.a.userId)).filter((n) => n.type === "balance_reminder").length;
  await sendBalanceReminders();
  const afterFirst = (await notificationsOf(st.a.userId)).filter((n) => n.type === "balance_reminder").length;
  assert.equal(afterFirst, before + 1);
  await sendBalanceReminders();
  assert.equal((await notificationsOf(st.a.userId)).filter((n) => n.type === "balance_reminder").length, afterFirst, "not sent again within the interval");
  assert.equal((await notificationsOf(st.b.userId)).filter((n) => n.type === "balance_reminder").length, 0, "nothing owed, no reminder");
});

test("a test run never notifies or emails the real people in the database", async () => {
  const { sql } = await import("drizzle-orm");
  const since = new Date(Number.parseInt(stamp, 36) - 1000);
  const [n] = (await db.execute(sql`select count(*)::int as n from notifications x join users u on u.id = x.user_id where x.created_at >= ${since} and u.email not like '%.test'`)).rows as any[];
  const [m] = (await db.execute(sql`select count(*)::int as n from email_outbox where created_at >= ${since} and to_email not like '%.test'`)).rows as any[];
  assert.equal(n.n, 0, "notifications to real users");
  assert.equal(m.n, 0, "emails to real addresses");
});
