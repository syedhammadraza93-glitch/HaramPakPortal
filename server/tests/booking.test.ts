/**
 * Phase 3 tests: bookings, seat inventory, operations workflow, quotations. Real database, in-process API.
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
const { expireSeatHolds } = await import("../services/booking.service");
const { and, desc, eq, inArray, like } = await import("drizzle-orm");
const { purgeAgencyFinance, assertNoRealRecipients } = await import("./ledgerCleanup");

const stamp = Date.now().toString(36);
const startedAt = new Date();
const mail = (n: string) => `bkg${stamp}-${n}@harampak.test`;
const PASSWORD = "Safar2026x";
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
  const [u] = await db.insert(S.users).values({ email: mail(name), fullName: `Bkg ${name}`, type: "staff", passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() }).returning();
  await db.insert(S.userRoles).values({ userId: u!.id, roleId: role!.id });
  const first = await call("POST", "/auth/login", { body: { email: mail(name), password: PASSWORD } });
  if (first.body.data.accessToken) return first.body.data.accessToken as string;
  const [otp] = await db.select().from(S.otps).where(and(eq(S.otps.email, mail(name)), eq(S.otps.isUsed, false))).orderBy(desc(S.otps.createdAt)).limit(1);
  return (await call("POST", "/auth/login/mfa", { body: { mfaToken: first.body.data.mfaToken, code: otp!.code } })).body.data.accessToken as string;
}

async function agent(name: string, status: "active" | "pending_approval") {
  const [role] = await db.select().from(S.roles).where(eq(S.roles.code, "TRAVEL_AGENT"));
  const n = Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
  const [ag] = await db
    .insert(S.agencies)
    .values({ agencyName: `Bkg ${name} ${stamp}`, authorizedPerson: `Bkg ${name}`, phone: `+92303${n}`, whatsapp: `+92303${n}`, email: mail(name), address: "Test", city: "Test", country: "Test", status, termsAcceptedAt: new Date(), termsVersion: "1", paymentTerms: "credit", creditLimit: 100_000_000 })
    .returning();
  const [u] = await db.insert(S.users).values({ email: mail(name), fullName: `Bkg ${name}`, type: "agent", agencyId: ag!.id, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() }).returning();
  await db.insert(S.userRoles).values({ userId: u!.id, roleId: role!.id });
  return { agencyId: ag!.id, token: (await call("POST", "/auth/login", { body: { email: mail(name), password: PASSWORD } })).body.data.accessToken as string };
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const pdf = () => new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")], { type: "application/pdf" });
const passenger = (name: string, extra: Record<string, unknown> = {}) => ({
  fullName: name, gender: "male", dateOfBirth: "1985-05-05", nationality: "Pakistani", passportNumber: `AB${Math.floor(Math.random() * 1e7)}`,
  passportIssueDate: "2022-01-01", passportExpiryDate: day(3650), paxType: "adult", roomType: "quad", ...extra,
});

/** Draft → passengers → passport upload for each → returns booking detail. */
async function readyDraft(token: string, pkgId: string, depId: string | null, names: string[]) {
  let r = await call("POST", "/agent/bookings", { token, body: { packageId: pkgId, departureId: depId } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.data.id;
  r = await call("PUT", `/agent/bookings/${id}`, { token, body: { passengers: names.map((n) => passenger(n)), addons: [] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const p of r.body.data.passengers) {
    const f = new FormData();
    f.append("passengerId", p.id);
    f.append("requirementId", st.passportReq);
    f.append("file", pdf(), "passport.pdf");
    assert.equal((await call("POST", `/agent/bookings/${id}/documents`, { token, form: f })).status, 201);
  }
  return id as string;
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  st.admin = await staff("admin", "SUPER_ADMIN");
  st.ops = await staff("ops", "OPERATIONS_ADMIN");
  st.a = await agent("a", "active");
  st.b = await agent("b", "active");
  st.c = await agent("c", "pending_approval");

  // Catalogue fixture: an Umrah package with 3 seats, a policy, a required passport copy and a test charge.
  const t = st.admin;
  const dest = (await call("POST", "/admin/catalogue/destinations", { token: t, body: { country: `Bkgland ${stamp}`, city: "Makkah", verticals: ["umrah"] } })).body.data;
  const hotel = (await call("POST", "/admin/catalogue/hotels", { token: t, body: { name: `Bkg Hotel ${stamp}`, destinationId: dest.id } })).body.data;
  const policy = (await call("POST", "/admin/catalogue/cancellation-policies", { token: t, body: { name: `Bkg policy ${stamp}`, slabs: [{ daysBefore: 60, chargeType: "percent", chargeValue: 50 }] } })).body.data;
  let pkg = (await call("POST", "/admin/packages", { token: t, body: { vertical: "umrah", name: `Bkg Umrah ${stamp}` } })).body.data;
  st.pkg = pkg.id;
  await call("PATCH", `/admin/packages/${pkg.id}`, { token: t, body: { name: `Bkg Umrah ${stamp}`, bookingMode: "fixed_departure", summary: "Test", durationDays: 14, durationNights: 13, destinationId: dest.id, cancellationPolicyId: policy.id, minPax: 1 } });
  await call("PUT", `/admin/packages/${pkg.id}/hotels`, { token: t, body: { hotels: [{ hotelId: hotel.id, nights: 13 }] } });
  pkg = (await call("POST", `/admin/packages/${pkg.id}/departures`, { token: t, body: { departureDate: day(40), returnDate: day(54), bookingDeadline: day(30), capacity: 3 } })).body.data;
  st.dep = pkg.departures[0].id;
  await call("PUT", `/admin/packages/${pkg.id}/rates`, { token: t, body: { rates: [{ roomType: "quad", paxType: "adult", basePrice: 100000 }, { roomType: "double", paxType: "adult", basePrice: 150000 }] } });
  await call("PUT", `/admin/packages/${pkg.id}/addons`, { token: t, body: { addons: [{ name: "Ziyarat", price: 5000, basis: "per_person" }] } });
  st.passportReq = (await call("POST", "/admin/catalogue/document-requirements", { token: t, body: { vertical: "umrah", packageId: pkg.id, name: `Passport copy ${stamp}` } })).body.data.id;
  const pub = await call("POST", `/admin/packages/${pkg.id}/status/publish`, { token: t });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  st.charge = (await call("POST", "/admin/booking-setup/charges", { token: t, body: { name: `Bkg service charge ${stamp}`, vertical: "umrah", chargeType: "percent", value: 2 } })).body.data.id;

  // On-request package for quotations
  let q = (await call("POST", "/admin/packages", { token: t, body: { vertical: "umrah", name: `Bkg Custom Umrah ${stamp}`, bookingMode: "on_request" } })).body.data;
  st.qpkg = q.id;
  await call("PATCH", `/admin/packages/${q.id}`, { token: t, body: { name: `Bkg Custom Umrah ${stamp}`, bookingMode: "on_request", summary: "Custom", durationDays: 10, destinationId: dest.id } });
  await call("PUT", `/admin/packages/${q.id}/hotels`, { token: t, body: { hotels: [{ hotelId: hotel.id, nights: 9 }] } });
  await call("PUT", `/admin/packages/${q.id}/rates`, { token: t, body: { rates: [{ roomType: "double", paxType: "adult", basePrice: 200000 }] } });
  q = await call("POST", `/admin/packages/${q.id}/status/publish`, { token: t });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  st.dest = dest.id;
  st.hotel = hotel.id;
  st.policy = policy.id;
});

after(async () => {
  const ags = (await db.select({ id: S.agencies.id }).from(S.agencies).where(like(S.agencies.email, `bkg${stamp}-%`))).map((a) => a.id);
  const bks = ags.length ? (await db.select({ id: S.bookings.id }).from(S.bookings).where(inArray(S.bookings.agencyId, ags))).map((b) => b.id) : [];
  await purgeAgencyFinance(ags);
  if (bks.length) await db.delete(S.bookings).where(inArray(S.bookings.id, bks));
  const pkgs = (await db.select({ id: S.packages.id }).from(S.packages).where(like(S.packages.name, `%${stamp}%`))).map((p) => p.id);
  if (pkgs.length) {
    await db.delete(S.priceHistory).where(inArray(S.priceHistory.packageId, pkgs));
    await db.delete(S.packages).where(inArray(S.packages.id, pkgs));
  }
  await db.delete(S.chargeRules).where(like(S.chargeRules.name, `%${stamp}%`));
  await db.delete(S.bookingStages).where(like(S.bookingStages.name, `%${stamp}%`));
  await db.delete(S.cancellationPolicies).where(like(S.cancellationPolicies.name, `%${stamp}%`));
  await db.delete(S.hotels).where(like(S.hotels.name, `%${stamp}%`));
  await db.delete(S.destinations).where(like(S.destinations.country, `%${stamp}%`));
  if (ags.length) await db.delete(S.agencies).where(inArray(S.agencies.id, ags));
  await db.delete(S.users).where(like(S.users.email, `bkg${stamp}-%`));
  for (const id of [...bks.map((b) => path.join("bookings", b)), ...pkgs.map((p) => path.join("packages", p))]) await rm(path.resolve(env.STORAGE_DIR, id), { recursive: true, force: true });
  server?.close();
  await assertNoRealRecipients(startedAt);
  await pool.end();
});

test("only approved agencies can book", async () => {
  assert.equal((await call("POST", "/agent/bookings", { token: st.c.token, body: { packageId: st.pkg, departureId: st.dep } })).status, 403);
  assert.equal((await call("POST", "/agent/bookings", { token: st.a.token, body: { packageId: st.pkg } })).status, 400, "fixed-date package needs a departure");
});

test("submission checks passports, documents and prices; price is frozen at submit", async () => {
  const t = st.a.token;
  let r = await call("POST", "/agent/bookings", { token: t, body: { packageId: st.pkg, departureId: st.dep } });
  const id = r.body.data.id;
  r = await call("PUT", `/agent/bookings/${id}`, { token: t, body: { passengers: [{ fullName: "Ali Raza", paxType: "adult", roomType: "quad" }, passenger("Sara Raza", { passportExpiryDate: day(60) })], addons: [] } });
  assert.equal(r.status, 200);
  r = await call("POST", `/agent/bookings/${id}/submit`, { token: t });
  assert.equal(r.status, 400);
  const msgs = r.body.errors.map((e: any) => e.message).join("\n");
  assert.match(msgs, /passport number is required/);
  assert.match(msgs, /must be valid until/);
  assert.match(msgs, /upload "Passport copy/);

  // Fix: complete passengers with an add-on, upload passports
  r = await call("PUT", `/agent/bookings/${id}`, { token: t, body: { passengers: [passenger("Ali Raza"), passenger("Sara Raza")], addons: [{ addonId: r.body?.data?.availableAddons?.[0]?.id ?? (await call("GET", `/agent/bookings/${id}`, { token: t })).body.data.availableAddons[0].id, quantity: 2 }], agentReference: "CUST-1" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const live = r.body.data.liveQuote;
  const fare = live.lines.find((l: any) => l.kind === "fare");
  assert.equal(fare.quantity, 2);
  const charge = live.lines.find((l: any) => l.description.startsWith(`Bkg service charge ${stamp}`));
  assert.equal(charge.amount, Math.round(live.subtotal * 0.02), "2% charge on the subtotal");
  for (const p of r.body.data.passengers) {
    const f = new FormData();
    f.append("passengerId", p.id);
    f.append("requirementId", st.passportReq);
    f.append("file", pdf(), "passport.pdf");
    await call("POST", `/agent/bookings/${id}/documents`, { token: t, form: f });
  }
  r = await call("POST", `/agent/bookings/${id}/submit`, { token: t });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.data.reference, /^BKG-\d{4}-\d{6}$/);
  assert.equal(r.body.data.status, "submitted");
  assert.equal(r.body.data.seatsHeld, 2);
  assert.equal(r.body.data.totalAmount, live.total);
  st.bookingA = id;
  st.totalA = live.total;

  // Price change after submission does not touch the booking
  await call("PUT", `/admin/packages/${st.pkg}/rates`, { token: st.admin, body: { rates: [{ roomType: "quad", paxType: "adult", basePrice: 120000 }, { roomType: "double", paxType: "adult", basePrice: 150000 }] } });
  r = await call("GET", `/agent/bookings/${id}`, { token: t });
  assert.equal(r.body.data.totalAmount, st.totalA, "frozen total");
  const [dep] = await db.select().from(S.packageDepartures).where(eq(S.packageDepartures.id, st.dep));
  assert.equal(dep!.seatsHeld, 2);
});

test("agencies cannot see each other's bookings; the last seat cannot be sold twice", async () => {
  assert.equal((await call("GET", `/agent/bookings/${st.bookingA}`, { token: st.b.token })).status, 404);
  assert.equal((await call("GET", `/admin/bookings`, { token: st.a.token })).status, 403);

  const tooMany = await readyDraft(st.b.token, st.pkg, st.dep, ["B One", "B Two"]);
  const r = await call("POST", `/agent/bookings/${tooMany}/submit`, { token: st.b.token });
  assert.equal(r.status, 409, "only 1 seat left");
  assert.match(r.body.message, /Only 1 seat left/);

  // Two agencies race for the last seat
  const fromA = await readyDraft(st.a.token, st.pkg, st.dep, ["A Racer"]);
  const fromB = await readyDraft(st.b.token, st.pkg, st.dep, ["B Racer"]);
  const results = await Promise.all([call("POST", `/agent/bookings/${fromA}/submit`, { token: st.a.token }), call("POST", `/agent/bookings/${fromB}/submit`, { token: st.b.token })]);
  const statuses = results.map((x) => x.status).sort();
  assert.deepEqual(statuses, [200, 409], "exactly one wins the last seat");
  st.racerWinner = results[0]!.status === 200 ? { id: fromA, token: st.a.token } : { id: fromB, token: st.b.token };
  const [dep] = await db.select().from(S.packageDepartures).where(eq(S.packageDepartures.id, st.dep));
  assert.equal(dep!.seatsHeld, 3, "capacity 3 never exceeded");
});

test("operations: request information, resubmit, documents, confirm, travel documents, messages, stages", async () => {
  const o = st.ops;
  const id = st.bookingA;
  let r = await call("GET", "/admin/bookings?status=queue", { token: o });
  assert.ok(r.body.data.items.some((b: any) => b.id === id));
  assert.equal((await call("POST", `/admin/bookings/${id}/status/request-info`, { token: o, body: {} })).status, 400, "reason required");
  r = await call("POST", `/admin/bookings/${id}/status/request-info`, { token: o, body: { reason: "Passport photo is blurred" } });
  assert.equal(r.body.data.status, "information_required");

  // Ops rejects one document, verifies the other
  const docs = r.body.data.documents.filter((d: any) => !d.issued);
  assert.equal((await call("PATCH", `/admin/bookings/${id}/documents/${docs[0].id}`, { token: o, body: { status: "rejected" } })).status, 400, "note needed");
  await call("PATCH", `/admin/bookings/${id}/documents/${docs[0].id}`, { token: o, body: { status: "rejected", note: "Blurred" } });
  await call("PATCH", `/admin/bookings/${id}/documents/${docs[1].id}`, { token: o, body: { status: "verified" } });

  // Agent must replace the rejected document before resubmitting
  r = await call("POST", `/agent/bookings/${id}/resubmit`, { token: st.a.token });
  assert.equal(r.status, 400);
  const f = new FormData();
  f.append("passengerId", docs[0].passengerId);
  f.append("requirementId", st.passportReq);
  f.append("file", pdf(), "passport-clear.pdf");
  assert.equal((await call("POST", `/agent/bookings/${id}/documents`, { token: st.a.token, form: f })).status, 201);
  r = await call("POST", `/agent/bookings/${id}/resubmit`, { token: st.a.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  assert.equal((await call("POST", `/admin/bookings/${id}/status/review`, { token: o })).status, 200);
  r = await call("POST", `/admin/bookings/${id}/status/confirm`, { token: o });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "confirmed");
  let [dep] = await db.select().from(S.packageDepartures).where(eq(S.packageDepartures.id, st.dep));
  assert.equal(dep!.seatsSold, 2);

  // Internal note vs message to agent
  await call("POST", `/admin/bookings/${id}/messages`, { token: o, body: { message: "Internal: VIP client", isInternal: true } });
  await call("POST", `/admin/bookings/${id}/messages`, { token: o, body: { message: "Your visas are being processed" } });
  r = await call("GET", `/agent/bookings/${id}`, { token: st.a.token });
  const texts = r.body.data.messages.map((m: any) => m.message);
  assert.ok(texts.includes("Your visas are being processed"));
  assert.ok(!texts.some((t: string) => t.startsWith("Internal")), "agents never see internal notes");

  // Stages and issued documents
  const stage = (await call("POST", "/admin/booking-setup/stages", { token: st.admin, body: { vertical: "umrah", name: `Visa applied ${stamp}`, sortOrder: 999 } })).body.data;
  assert.equal((await call("PUT", `/admin/bookings/${id}/stages/${stage.id}`, { token: o, body: { done: true, note: "Applied" } })).status, 200);
  await call("POST", `/admin/bookings/${id}/status/process`, { token: o });
  const voucher = new FormData();
  voucher.append("name", "Hotel voucher");
  voucher.append("file", pdf(), "voucher.pdf");
  r = await call("POST", `/admin/bookings/${id}/documents`, { token: o, form: voucher });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const issued = r.body.data.documents.find((d: any) => d.issued);
  r = await call("GET", `/agent/bookings/${id}`, { token: st.a.token });
  assert.ok(r.body.data.stages.find((s: any) => s.id === stage.id).done);
  const dl = await call("GET", `/agent/bookings/${id}/documents/${issued.id}`, { token: st.a.token });
  assert.equal(dl.status, 200);
  assert.match(dl.type, /pdf/);
  assert.equal((await call("GET", `/agent/bookings/${id}/documents/${issued.id}`, { token: st.b.token })).status, 404, "other agency cannot download");

  // Cancel after confirmation: policy charge (50% within 60 days) and seats released
  r = await call("POST", `/admin/bookings/${id}/status/cancel`, { token: o, body: { reason: "Client cancelled" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // The resubmission re-priced the booking at the current package price (recorded in the history).
  assert.ok(r.body.data.history.some((h: any) => /price updated/i.test(h.reason ?? "")), "price change on resubmit is recorded");
  assert.equal(r.body.data.cancellationCharge, Math.round(r.body.data.totalAmount * 0.5));
  [dep] = await db.select().from(S.packageDepartures).where(eq(S.packageDepartures.id, st.dep));
  assert.equal(dep!.seatsSold, 0, "sold seats released");
});

test("seat holds expire automatically", async () => {
  const w = st.racerWinner;
  await db.update(S.bookings).set({ holdExpiresAt: new Date(Date.now() - 60_000) }).where(eq(S.bookings.id, w.id));
  const [before] = await db.select().from(S.packageDepartures).where(eq(S.packageDepartures.id, st.dep));
  await expireSeatHolds();
  const r = await call("GET", `/agent/bookings/${w.id}`, { token: w.token });
  assert.equal(r.body.data.status, "cancelled");
  const [afterDep] = await db.select().from(S.packageDepartures).where(eq(S.packageDepartures.id, st.dep));
  assert.equal(afterDep!.seatsHeld, before!.seatsHeld - 1);
});

test("quotation request: send quotation, agent accepts, operations confirms", async () => {
  const t = st.b.token;
  let r = await call("POST", "/agent/bookings", { token: t, body: { packageId: st.qpkg } });
  assert.equal(r.status, 201);
  const id = r.body.data.id;
  assert.equal(r.body.data.isQuotation, true);
  await call("PUT", `/agent/bookings/${id}`, { token: t, body: { passengers: [{ fullName: "Quote Guest", paxType: "adult" }], requestedDates: "Mid March, 10 nights" } });
  r = await call("POST", `/agent/bookings/${id}/submit`, { token: t });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.seatsHeld, 0, "quotation requests hold no seats");

  assert.equal((await call("POST", `/admin/bookings/${id}/status/confirm`, { token: st.ops })).status, 400, "no quotation yet");
  r = await call("POST", `/admin/bookings/${id}/quotation`, { token: st.ops, body: { lines: [{ description: "Custom Umrah package", quantity: 1, unitAmount: 210000 }], validUntil: day(7), message: "As requested" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "quotation_sent");
  r = await call("POST", `/agent/bookings/${id}/quotation/accept`, { token: t });
  assert.equal(r.body.data.status, "under_review");
  r = await call("POST", `/admin/bookings/${id}/status/confirm`, { token: st.ops });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.totalAmount, 210000);
});

test("agent can cancel before confirmation; history is recorded", async () => {
  const id = await readyDraft(st.a.token, st.pkg, st.dep, ["Cancel Me"]);
  assert.equal((await call("POST", `/agent/bookings/${id}/submit`, { token: st.a.token })).status, 200);
  const r = await call("POST", `/agent/bookings/${id}/cancel`, { token: st.a.token, body: { reason: "Changed plans" } });
  assert.equal(r.body.data.status, "cancelled");
  assert.deepEqual(r.body.data.history.map((h: any) => h.toStatus).slice(0, 2), ["cancelled", "submitted"]);
});
