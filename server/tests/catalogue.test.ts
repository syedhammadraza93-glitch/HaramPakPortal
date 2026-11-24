/**
 * Phase 2 tests: catalogue, prices per agency, visibility rules. Real database, in-process API.
 * Everything created here is marked with a unique stamp and deleted at the end.
 *
 *   npm test
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
const { assertNoRealRecipients } = await import("./ledgerCleanup");
const { env } = await import("../config/env");
const { hashPassword } = await import("../utils/crypto");
const { applyGroup, groupForAgency } = await import("../services/pricing.service");
const { and, desc, eq, inArray, like } = await import("drizzle-orm");

const stamp = Date.now().toString(36);
const startedAt = new Date();
const mail = (name: string) => `cat${stamp}-${name}@harampak.test`;
const PASSWORD = "Safar2026x";
let base = "";
let server: ReturnType<typeof app.listen>;
const state: Record<string, any> = {};

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
  const [u] = await db.insert(S.users).values({ email: mail(name), fullName: `Cat ${name}`, type: "staff", passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() }).returning();
  await db.insert(S.userRoles).values({ userId: u!.id, roleId: role!.id });
  const first = await call("POST", "/auth/login", { body: { email: mail(name), password: PASSWORD } });
  if (first.body.data.accessToken) return first.body.data.accessToken as string;
  const [otp] = await db.select().from(S.otps).where(and(eq(S.otps.email, mail(name)), eq(S.otps.isUsed, false))).orderBy(desc(S.otps.createdAt)).limit(1);
  const r = await call("POST", "/auth/login/mfa", { body: { mfaToken: first.body.data.mfaToken, code: otp!.code } });
  return r.body.data.accessToken as string;
}

async function agent(name: string, status: "active" | "pending_approval") {
  const [role] = await db.select().from(S.roles).where(eq(S.roles.code, "TRAVEL_AGENT"));
  const n = Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
  const [ag] = await db
    .insert(S.agencies)
    .values({
      agencyName: `Cat ${name} ${stamp}`, authorizedPerson: `Cat ${name}`, phone: `+92302${n}`, whatsapp: `+92302${n}`, email: mail(name),
      address: "Test address", city: "Test", country: "Test", status, termsAcceptedAt: new Date(), termsVersion: "1",
    })
    .returning();
  const [u] = await db
    .insert(S.users)
    .values({ email: mail(name), fullName: `Cat ${name}`, type: "agent", agencyId: ag!.id, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() })
    .returning();
  await db.insert(S.userRoles).values({ userId: u!.id, roleId: role!.id });
  const r = await call("POST", "/auth/login", { body: { email: mail(name), password: PASSWORD } });
  return { agencyId: ag!.id, token: r.body.data.accessToken as string };
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  state.admin = await staff("admin", "SUPER_ADMIN");
  state.ops = await staff("ops", "OPERATIONS_ADMIN");
  state.a = await agent("a", "active");
  state.b = await agent("b", "active");
  state.c = await agent("c", "pending_approval");
});

after(async () => {
  const pkgIds = (await db.select({ id: S.packages.id }).from(S.packages).where(like(S.packages.name, `%${stamp}%`))).map((p) => p.id);
  if (pkgIds.length) {
    await db.delete(S.priceHistory).where(inArray(S.priceHistory.packageId, pkgIds));
    await db.delete(S.packages).where(inArray(S.packages.id, pkgIds));
  }
  await db.delete(S.documentRequirements).where(like(S.documentRequirements.name, `%${stamp}%`));
  await db.delete(S.cancellationPolicies).where(like(S.cancellationPolicies.name, `%${stamp}%`));
  await db.delete(S.hotels).where(like(S.hotels.name, `%${stamp}%`));
  await db.delete(S.destinations).where(like(S.destinations.country, `%${stamp}%`));
  await db.delete(S.visaRates).where(like(S.visaRates.name, `%${stamp}%`));
  await db.delete(S.agencies).where(like(S.agencies.email, `cat${stamp}-%`));
  await db.delete(S.pricingGroups).where(like(S.pricingGroups.code, `CAT${stamp.toUpperCase()}%`));
  await db.delete(S.users).where(like(S.users.email, `cat${stamp}-%`));
  for (const id of pkgIds) await rm(path.resolve(env.STORAGE_DIR, "packages", id), { recursive: true, force: true });
  server?.close();
  await assertNoRealRecipients(startedAt);
  await pool.end();
});

test("catalogue setup: destination, hotel, cancellation policy, checklist", async () => {
  const t = state.admin;
  let r = await call("POST", "/admin/catalogue/destinations", { token: t, body: { country: `Testland ${stamp}`, city: "Makkah", verticals: ["umrah", "hajj"] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  state.dest = r.body.data.id;
  assert.equal((await call("POST", "/admin/catalogue/destinations", { token: t, body: { country: `Testland ${stamp}`, city: "makkah", verticals: ["umrah"] } })).status, 409, "duplicate city");

  r = await call("POST", "/admin/catalogue/hotels", { token: t, body: { name: `Hotel ${stamp}`, destinationId: state.dest, starRating: 5, distanceToHaramM: 300 } });
  assert.equal(r.status, 201);
  state.hotel = r.body.data.id;

  r = await call("POST", "/admin/catalogue/cancellation-policies", {
    token: t,
    body: { name: `Policy ${stamp}`, slabs: [{ daysBefore: 30, chargeType: "percent", chargeValue: 25 }, { daysBefore: 7, chargeType: "percent", chargeValue: 100 }] },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.slabs.length, 2);
  state.policy = r.body.data.id;
  assert.equal((await call("POST", "/admin/catalogue/cancellation-policies", { token: t, body: { name: `Bad ${stamp}`, slabs: [{ daysBefore: 5, chargeType: "percent", chargeValue: 150 }] } })).status, 400);

  r = await call("POST", "/admin/catalogue/document-requirements", { token: t, body: { vertical: "umrah", name: `Passport ${stamp}` } });
  assert.equal(r.status, 201);
  assert.equal((await call("DELETE", `/admin/catalogue/destinations/${state.dest}`, { token: t })).status, 400, "destination in use cannot be deleted");
});

test("package: draft cannot be published until complete", async () => {
  const t = state.admin;
  let r = await call("POST", "/admin/packages", { token: t, body: { vertical: "umrah", name: `Umrah Economy ${stamp}`, category: "Economy" } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.data.code, /^UMR-\d{4}$/);
  state.pkg = r.body.data.id;

  r = await call("POST", `/admin/packages/${state.pkg}/status/publish`, { token: t });
  assert.equal(r.status, 400);
  assert.ok(r.body.errors.length >= 3, "lists what is missing");

  r = await call("PATCH", `/admin/packages/${state.pkg}`, {
    token: t,
    body: {
      name: `Umrah Economy ${stamp}`, category: "Economy", bookingMode: "fixed_departure", summary: "15 days, 3-star hotels",
      durationDays: 15, durationNights: 14, destinationId: state.dest, visaIncluded: true, transportIncluded: true,
      inclusions: ["Visa", "Transport"], exclusions: ["Air ticket"], cancellationPolicyId: state.policy,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call("PUT", `/admin/packages/${state.pkg}/hotels`, { token: t, body: { hotels: [{ hotelId: state.hotel, nights: 10 }] } });
  assert.equal(r.status, 200);
  r = await call("POST", `/admin/packages/${state.pkg}/departures`, { token: t, body: { departureDate: day(40), returnDate: day(55), bookingDeadline: day(30), capacity: 45 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  state.dep = r.body.data.departures[0].id;
  assert.equal((await call("POST", `/admin/packages/${state.pkg}/departures`, { token: t, body: { departureDate: day(40), returnDate: day(30) } })).status, 400, "return before departure");

  // Operations can edit the catalogue but not prices
  assert.equal((await call("PUT", `/admin/packages/${state.pkg}/rates`, { token: state.ops, body: { rates: [] } })).status, 403);

  r = await call("PUT", `/admin/packages/${state.pkg}/rates`, {
    token: t,
    body: {
      rates: [
        { roomType: "quad", paxType: "adult", basePrice: 250000, retailPrice: 275000 },
        { roomType: "double", paxType: "adult", basePrice: 300000 },
        { roomType: "quad", paxType: "child_with_bed", basePrice: 200000 },
      ],
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.rates.length, 3);
  state.quadAdult = r.body.data.rates.find((x: any) => x.roomType === "quad" && x.paxType === "adult").id;
  r = await call("PUT", `/admin/packages/${state.pkg}/addons`, { token: t, body: { addons: [{ name: "Extra Ziyarat", price: 15000, basis: "per_person" }] } });
  assert.equal(r.status, 200);

  const png = Buffer.from("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA6364F8FFBF1E000500020001E3F6A20000000049454E44AE426082", "hex");
  const form = new FormData();
  form.append("files", new Blob([png], { type: "image/png" }), "cover.png");
  r = await call("POST", `/admin/packages/${state.pkg}/images`, { token: t, form });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  state.imageUrl = r.body.data.images[0].url;

  r = await call("POST", `/admin/packages/${state.pkg}/status/publish`, { token: t });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "published");
});

test("each agency sees its own price: pricing group, default group, special price", async () => {
  const t = state.admin;
  let r = await call("POST", "/admin/pricing-groups", { token: t, body: { code: `CAT${stamp.toUpperCase()}GOLD`, name: "Gold test", adjustmentType: "percent", adjustmentValue: -10 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await call("PATCH", `/admin/agencies/${state.a.agencyId}/commercial`, { token: t, body: { pricingGroupId: r.body.data.id, agentCategory: "A" } })).status, 200);

  // A: Gold (-10%)
  r = await call("GET", `/agent/catalogue/packages?search=${stamp}`, { token: state.a.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.total, 1);
  assert.equal(r.body.data.items[0].fromPrice, 225000);
  // B: no group → the default group (whatever the company set up)
  const expectedB = applyGroup(250000, await groupForAgency(state.b.agencyId));
  r = await call("GET", `/agent/catalogue/packages?search=${stamp}`, { token: state.b.token });
  assert.equal(r.body.data.items[0].fromPrice, expectedB);

  // Special price for B only
  r = await call("PUT", `/admin/packages/${state.pkg}/special-prices/${state.b.agencyId}`, { token: t, body: { prices: [{ rateId: state.quadAdult, price: 240000 }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const detailB = (await call("GET", `/agent/catalogue/packages/${state.pkg}`, { token: state.b.token })).body.data;
  assert.equal(detailB.prices.find((p: any) => p.id === state.quadAdult).price, 240000);
  const detailA = (await call("GET", `/agent/catalogue/packages/${state.pkg}`, { token: state.a.token })).body.data;
  assert.equal(detailA.prices.find((p: any) => p.id === state.quadAdult).price, 225000, "A is not affected by B's special price");
  assert.equal(detailA.prices.find((p: any) => p.id === state.quadAdult).retailPrice, 275000);
  for (const p of detailA.prices) assert.equal("basePrice" in p, false, "agents never see the base price");
  assert.equal(detailA.departures[0].seatsLeft, 45);
  assert.equal(detailA.departures[0].bookable, true);
  assert.equal(detailA.cancellationPolicy.slabs.length, 2);
  assert.ok(detailA.documentRequirements.some((d: any) => d.name === `Passport ${stamp}`));

  const img = await fetch(base.replace(/\/api$/, "") + state.imageUrl);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
});

test("visibility: pending agencies and unpublished packages", async () => {
  assert.equal((await call("GET", "/agent/catalogue/packages", { token: state.c.token })).status, 403, "pending agency cannot see packages or prices");
  assert.equal((await call("GET", "/admin/packages", { token: state.a.token })).status, 403, "agents cannot use the admin catalogue");

  assert.equal((await call("POST", `/admin/packages/${state.pkg}/status/unpublish`, { token: state.admin })).status, 200);
  assert.equal((await call("GET", `/agent/catalogue/packages/${state.pkg}`, { token: state.a.token })).status, 404);
  assert.equal((await call("GET", `/agent/catalogue/packages?search=${stamp}`, { token: state.a.token })).body.data.total, 0);
  assert.equal((await call("POST", `/admin/packages/${state.pkg}/status/publish`, { token: state.admin })).status, 200);
});

test("price changes are recorded in the price history", async () => {
  const r = await call("PUT", `/admin/packages/${state.pkg}/rates`, {
    token: state.admin,
    body: {
      rates: [
        { roomType: "quad", paxType: "adult", basePrice: 260000, retailPrice: 275000 },
        { roomType: "double", paxType: "adult", basePrice: 300000 },
      ],
    },
  });
  assert.equal(r.status, 200);
  const h = (await call("GET", `/admin/packages/${state.pkg}/price-history`, { token: state.admin })).body.data;
  assert.ok(h.some((e: any) => e.oldValue === 250000 && e.newValue === 260000), "base price change");
  assert.ok(h.some((e: any) => /removed/.test(e.description) && e.oldValue === 200000), "removed price");
  assert.ok(h.some((e: any) => e.agencyId === state.b.agencyId && e.newValue === 240000), "special price");
});

test("visa rates: overlapping dates refused, agents see current rates", async () => {
  const t = state.admin;
  const name = `Umrah visa ${stamp}`;
  let r = await call("POST", "/admin/visa-rates", { token: t, body: { name, category: "Adult", visaFee: 45000, serviceFee: 5000, effectiveFrom: day(-10) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const rateId = r.body.data.id;
  assert.equal((await call("POST", "/admin/visa-rates", { token: t, body: { name, category: "Adult", visaFee: 47000, effectiveFrom: day(5) } })).status, 400, "overlap");
  assert.equal((await call("PUT", `/admin/visa-rates/${rateId}`, { token: t, body: { name, category: "Adult", visaFee: 47000, serviceFee: 5000, effectiveFrom: day(-10) } })).status, 400, "price of a started rate cannot change");

  r = await call("GET", "/agent/catalogue/visa-rates", { token: state.a.token });
  const mine = r.body.data.find((v: any) => v.name === name);
  assert.equal(mine.total, 50000);
});

test("duplicate creates a draft with the same prices", async () => {
  const r = await call("POST", `/admin/packages/${state.pkg}/duplicate`, { token: state.admin });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const copy = (await call("GET", `/admin/packages/${r.body.data.id}`, { token: state.admin })).body.data;
  assert.equal(copy.status, "draft");
  assert.equal(copy.rates.length, 2);
  assert.equal(copy.departures.length, 0, "departures are not copied");
  assert.equal(copy.hotels.length, 1);
});
