/**
 * Phase 1 end-to-end tests against the real database.
 * Starts the API in-process on a random port (a running dev server is not affected).
 * All data uses @harampak.test addresses (never emailed) and is deleted at the end.
 * Email codes are read straight from the otps table, as a person would read them from the email.
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
const { agencies, emailOutbox, otps, roles, userRoles, users } = await import("../database/schema");
const { env } = await import("../config/env");
const { hashPassword } = await import("../utils/crypto");
const { assertNoRealRecipients } = await import("./ledgerCleanup");
const { and, desc, eq, inArray, like } = await import("drizzle-orm");

const stamp = Date.now().toString(36);
const startedAt = new Date();
const mail = (name: string) => `e2e${stamp}-${name}@harampak.test`;
const PASSWORD = "Safar2026x";
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX"; // accepted by Cloudflare's test secret key
let base = "";
let server: ReturnType<typeof app.listen>;

const pdf = () => new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")], { type: "application/pdf" });

interface CallResult {
  status: number;
  body: any;
  cookie?: string;
  type: string;
}

async function call(method: string, url: string, opts: { token?: string; body?: unknown; form?: FormData; cookie?: string } = {}): Promise<CallResult> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + url, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: type.includes("json") ? await res.json() : null, cookie: res.headers.get("set-cookie")?.split(";")[0], type };
}

/** The newest unused emailed code for an address and purpose (what the user would read in the email). */
async function codeFor(email: string, purpose: "verification" | "two_factor" | "reset"): Promise<string> {
  const [row] = await db
    .select({ code: otps.code })
    .from(otps)
    .where(and(eq(otps.email, email), eq(otps.purpose, purpose), eq(otps.isUsed, false)))
    .orderBy(desc(otps.createdAt))
    .limit(1);
  if (!row) throw new Error(`No ${purpose} code for ${email}`);
  return row.code;
}

/** A different 6-digit code than the real one. */
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** Staff invitations still use a link: read its token from the email outbox. */
async function inviteToken(to: string): Promise<string> {
  const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, to)).orderBy(desc(emailOutbox.createdAt)).limit(5);
  for (const r of rows) {
    const m = r.html.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/);
    if (m) return m[1]!;
  }
  throw new Error(`No invitation email for ${to}`);
}

/** Password + emailed code login for users who need two-factor login. Returns the access token. */
async function loginWithCode(email: string, password = PASSWORD): Promise<string> {
  const first = await call("POST", "/auth/login", { body: { email, password } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.data.mfaRequired, true);
  const r = await call("POST", "/auth/login/mfa", { body: { mfaToken: first.body.data.mfaToken, code: await codeFor(email, "two_factor") } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.accessToken;
}

function registrationForm(name: string, overrides: Record<string, string | undefined> = {}, withCnicCopy = true): FormData {
  const n = Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
  const values: Record<string, string | undefined> = {
    agencyName: `E2E Travels ${name} ${stamp}`,
    authorizedPerson: `Test Person ${name}`,
    phone: `0301${n}`,
    whatsapp: `0301${n}`,
    email: mail(name),
    password: PASSWORD,
    confirmPassword: PASSWORD,
    address: "Office 1, Test Plaza",
    city: "Test City",
    country: "Pakistan",
    acceptTerms: "true",
    cnic: `35202${n}${Math.floor(Math.random() * 10)}`,
    captchaToken: CAPTCHA,
    ...overrides,
  };
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) if (v !== undefined) f.append(k, v);
  if (withCnicCopy) f.append("cnicCopy", pdf(), "cnic.pdf");
  return f;
}

const state: Record<string, any> = {};

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  // Fixture: a Super Admin (two-factor login is required for this role).
  const [role] = await db.select().from(roles).where(eq(roles.code, "SUPER_ADMIN"));
  const [admin] = await db
    .insert(users)
    .values({ email: mail("admin"), fullName: "E2E Admin", type: "staff", passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() })
    .returning();
  await db.insert(userRoles).values({ userId: admin!.id, roleId: role!.id });
});

after(async () => {
  // Delete everything this run created (documents, history, notes and codes cascade).
  const testAgencies = await db.select({ id: agencies.id }).from(agencies).where(like(agencies.email, `e2e${stamp}-%`));
  if (testAgencies.length) await db.delete(agencies).where(inArray(agencies.id, testAgencies.map((a) => a.id)));
  await db.delete(users).where(like(users.email, `e2e${stamp}-%`));
  await db.delete(emailOutbox).where(like(emailOutbox.toEmail, `e2e${stamp}-%`));
  for (const a of testAgencies) await rm(path.resolve(env.STORAGE_DIR, "agencies", a.id), { recursive: true, force: true });
  server?.close();
  await assertNoRealRecipients(startedAt);
  await pool.end();
});

// ---------- tests (run in order) ----------

test("health and public endpoints (branding comes from settings)", async () => {
  assert.equal((await call("GET", "/health")).status, 200);
  assert.equal((await call("GET", "/public/registration-fields")).body.data.length, 7);
  assert.ok((await call("GET", "/public/config")).body.data.captchaSiteKey, "CAPTCHA should be configured in .env for these tests");
  const company = (await call("GET", "/public/company")).body.data;
  for (const key of ["name", "portalName", "primaryColor", "accentColor", "highlightColor", "cities", "highlights"]) assert.ok(key in company, `branding has ${key}`);
});

test("sign-up validation: field errors, fake PDF, missing CAPTCHA", async () => {
  let r = await call("POST", "/public/agent-registrations", { form: registrationForm("bad", { email: "not-an-email", phone: "123", password: "short" }, false) });
  assert.equal(r.status, 400);
  const paths = r.body.errors.map((e: any) => e.path);
  for (const p of ["email", "phone", "password", "cnicCopy"]) assert.ok(paths.includes(p), `expected error for ${p}`);

  const fake = registrationForm("fake", {}, false);
  fake.append("cnicCopy", new Blob([Buffer.from("MZ not really a pdf")], { type: "application/pdf" }), "cnic.pdf");
  assert.equal((await call("POST", "/public/agent-registrations", { form: fake })).status, 400, "an EXE renamed to .pdf must be rejected");

  r = await call("POST", "/public/agent-registrations", { form: registrationForm("nocaptcha", { captchaToken: undefined }) });
  assert.equal(r.status, 400);
  assert.ok(r.body.errors.some((e: any) => e.path === "captcha"));
});

test("agencies A and B register; duplicates and unverified login are refused", async () => {
  let r = await call("POST", "/public/agent-registrations", { form: registrationForm("a") });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await call("POST", "/public/agent-registrations", { form: registrationForm("a") })).status, 409, "duplicate email");
  assert.equal((await call("POST", "/public/agent-registrations", { form: registrationForm("b") })).status, 201);

  r = await call("POST", "/auth/login", { body: { email: mail("a"), password: PASSWORD } });
  assert.equal(r.status, 401);
  assert.match(r.body.message, /verify your email/i);
});

test("email verification with the 6-digit code: wrong code, resend wait, single use", async () => {
  const code = await codeFor(mail("a"), "verification");
  let r = await call("POST", "/auth/verify-email", { body: { email: mail("a"), code: wrong(code) } });
  assert.equal(r.status, 400, "wrong code refused");
  assert.equal((await call("POST", "/auth/resend-verification", { body: { email: mail("a") } })).status, 429, "must wait before a new code");

  r = await call("POST", "/auth/verify-email", { body: { email: mail("a"), code } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call("POST", "/auth/verify-email", { body: { email: mail("a"), code } });
  assert.equal(r.status, 200, "already verified");
  assert.match(r.body.message, /already verified/i);

  const [used] = await db.select().from(otps).where(and(eq(otps.email, mail("a")), eq(otps.code, code)));
  assert.equal(used!.isUsed, true, "code is marked used in the otps table");

  assert.equal((await call("POST", "/auth/verify-email", { body: { email: mail("b"), code: await codeFor(mail("b"), "verification") } })).status, 200);
});

test("agents log in while pending and see only their own data", async () => {
  let r = await call("POST", "/auth/login", { body: { email: mail("a"), password: PASSWORD } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.user.agency.status, "pending_approval");
  state.tokA = r.body.data.accessToken;
  state.cookieA = r.cookie;
  state.tokB = (await call("POST", "/auth/login", { body: { email: mail("b"), password: PASSWORD } })).body.data.accessToken;

  r = await call("GET", "/agent/profile", { token: state.tokA });
  assert.equal(r.body.data.documents.length, 1);
  state.docA = r.body.data.documents[0].id;
  state.agencyA = r.body.data.id;

  assert.equal((await call("GET", `/agent/documents/${state.docA}`, { token: state.tokB })).status, 404, "B must not open A's document");
  const own = await call("GET", `/agent/documents/${state.docA}`, { token: state.tokA });
  assert.equal(own.status, 200);
  assert.match(own.type, /pdf/);
  assert.notEqual((await call("GET", "/agent/profile", { token: state.tokB })).body.data.id, state.agencyA);
  assert.equal((await call("GET", "/admin/agencies", { token: state.tokA })).status, 403, "agents cannot use admin APIs");
});

test("Super Admin login needs the emailed code; wrong and reused codes are refused", async () => {
  let r = await call("POST", "/auth/login", { body: { email: mail("admin"), password: PASSWORD } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.mfaRequired, true);
  assert.equal(r.body.data.accessToken, undefined, "no session before the code");
  assert.match(r.body.data.sentTo, /@harampak\.test$/);
  const mfaToken = r.body.data.mfaToken;
  const code = await codeFor(mail("admin"), "two_factor");

  assert.equal((await call("POST", "/auth/login/mfa", { body: { mfaToken, code: wrong(code) } })).status, 400);
  r = await call("POST", "/auth/login/mfa", { body: { mfaToken, code } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.user.roles.includes("SUPER_ADMIN"));
  state.tokAdmin = r.body.data.accessToken;

  // The same code cannot log in again
  const again = await call("POST", "/auth/login", { body: { email: mail("admin"), password: PASSWORD } });
  assert.equal((await call("POST", "/auth/login/mfa", { body: { mfaToken: again.body.data.mfaToken, code } })).status, 400, "used code refused");
  assert.equal((await call("POST", "/auth/login/mfa/resend", { body: { mfaToken: again.body.data.mfaToken } })).status, 429, "must wait before a new code");
  // A required role cannot switch two-factor login off
  assert.equal((await call("PUT", "/auth/mfa", { token: state.tokAdmin, body: { enabled: false, password: PASSWORD } })).status, 403);
});

test("admin reviews: request information with a reason, add a note", async () => {
  const t = state.tokAdmin;
  let r = await call("GET", `/admin/agencies?status=queue&search=${stamp}`, { token: t });
  assert.equal(r.body.data.total, 2);
  r = await call("GET", `/admin/agencies/${state.agencyA}`, { token: t });
  assert.ok(r.body.data.allowedActions.includes("approve"));

  assert.equal((await call("POST", `/admin/agencies/${state.agencyA}/status/request-info`, { token: t, body: {} })).status, 400, "reason required");
  r = await call("POST", `/admin/agencies/${state.agencyA}/status/request-info`, { token: t, body: { reason: "Please upload your DTS licence" } });
  assert.equal(r.body.data.status, "information_required");
  assert.equal((await call("POST", `/admin/agencies/${state.agencyA}/notes`, { token: t, body: { note: "Called the owner" } })).status, 201);
});

test("agent sees the reason, updates, uploads and resubmits; notes stay internal", async () => {
  const r = await call("GET", "/agent/profile", { token: state.tokA });
  assert.equal(r.body.data.statusReason, "Please upload your DTS licence");
  assert.equal(r.body.data.notes, undefined);
  assert.equal((await call("PATCH", "/agent/profile", { token: state.tokA, body: { licenceNo: "DTS-1234" } })).status, 200);
  const up = new FormData();
  up.append("docType", "licence");
  up.append("file", pdf(), "licence.pdf");
  assert.equal((await call("POST", "/agent/documents", { token: state.tokA, form: up })).status, 201);
  assert.equal((await call("POST", "/agent/profile/resubmit", { token: state.tokA })).status, 200);
});

test("approval issues an Agent ID; refresh rotates; suspension blocks at once", async () => {
  let r = await call("POST", `/admin/agencies/${state.agencyA}/status/approve`, { token: state.tokAdmin, body: {} });
  assert.equal(r.status, 200);
  assert.match(r.body.data.agentCode, /^AGT-\d{5}$/);

  r = await call("POST", "/auth/refresh", { cookie: state.cookieA });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.user.agency.status, "active");
  const tokA = r.body.data.accessToken;

  assert.equal((await call("POST", `/admin/agencies/${state.agencyA}/status/suspend`, { token: state.tokAdmin, body: { reason: "Overdue payments" } })).status, 200);
  assert.equal((await call("GET", "/agent/profile", { token: tokA })).status, 401, "existing token stops working");
  r = await call("POST", "/auth/login", { body: { email: mail("a"), password: PASSWORD } });
  assert.equal(r.status, 401);
  assert.match(r.body.message, /suspended/i);
});

test("forgot password with an emailed code", async () => {
  assert.equal((await call("POST", "/auth/forgot-password", { body: { email: mail("b") } })).status, 200);
  const code = await codeFor(mail("b"), "reset");
  const NEW = "NewPass2026x";
  assert.equal((await call("POST", "/auth/reset-password", { body: { email: mail("b"), code: wrong(code), password: NEW, confirmPassword: NEW } })).status, 400);
  const r = await call("POST", "/auth/reset-password", { body: { email: mail("b"), code, password: NEW, confirmPassword: NEW } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await call("POST", "/auth/login", { body: { email: mail("b"), password: PASSWORD } })).status, 401, "old password no longer works");
  assert.equal((await call("POST", "/auth/login", { body: { email: mail("b"), password: NEW } })).status, 200);
  assert.equal((await call("GET", "/agent/profile", { token: state.tokB })).status, 401, "sessions from before the reset are ended");
  // An unknown email gets the same answer
  assert.equal((await call("POST", "/auth/forgot-password", { body: { email: mail("nobody") } })).status, 200);
});

test("staff: Finance Manager always gets a login code; Sales Manager can opt in", async () => {
  // Finance Manager (two-factor login required for this role in Settings → Security)
  let r = await call("POST", "/admin/users", { token: state.tokAdmin, body: { email: mail("finance"), fullName: "E2E Finance", roleCodes: ["FINANCE_MANAGER"] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await call("POST", "/auth/accept-invite", { body: { token: await inviteToken(mail("finance")), password: PASSWORD, confirmPassword: PASSWORD } })).status, 200);
  const tokFin = await loginWithCode(mail("finance"));
  assert.equal((await call("GET", "/admin/dashboard", { token: tokFin })).status, 200);

  // Sales Manager (optional)
  r = await call("POST", "/admin/users", { token: state.tokAdmin, body: { email: mail("sales"), fullName: "E2E Sales", roleCodes: ["SALES_MANAGER"] } });
  await call("POST", "/auth/accept-invite", { body: { token: await inviteToken(mail("sales")), password: PASSWORD, confirmPassword: PASSWORD } });
  r = await call("POST", "/auth/login", { body: { email: mail("sales"), password: PASSWORD } });
  assert.ok(r.body.data.accessToken, "no code needed while two-factor login is off");
  let tokSales = r.body.data.accessToken;
  assert.equal((await call("PUT", "/auth/mfa", { token: tokSales, body: { enabled: true, password: "wrong" } })).status, 400, "password required");
  assert.equal((await call("PUT", "/auth/mfa", { token: tokSales, body: { enabled: true, password: PASSWORD } })).status, 200);
  tokSales = await loginWithCode(mail("sales"));

  assert.equal((await call("GET", "/admin/users", { token: tokSales })).status, 403, "cannot manage users");
  assert.equal((await call("POST", `/admin/agencies/${state.agencyA}/status/deactivate`, { token: tokSales, body: { reason: "test" } })).status, 403, "cannot deactivate");
  assert.equal((await call("GET", `/admin/agencies/${state.agencyA}`, { token: tokSales })).status, 200, "can view agencies");
  state.tokSales = tokSales;
});

test("admin deletes a staff user; self-delete and non-admins are refused", async () => {
  const list = (await call("GET", "/admin/users", { token: state.tokAdmin })).body.data;
  const sales = list.find((u: any) => u.email === mail("sales"));
  const self = list.find((u: any) => u.email === mail("admin"));
  assert.equal((await call("DELETE", `/admin/users/${self.id}`, { token: state.tokAdmin })).status, 400, "cannot delete yourself");
  assert.equal((await call("DELETE", `/admin/users/${self.id}`, { token: state.tokSales })).status, 403, "sales manager cannot delete users");
  const r = await call("DELETE", `/admin/users/${sales.id}`, { token: state.tokAdmin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await call("GET", `/admin/agencies/${state.agencyA}`, { token: state.tokSales })).status, 401, "deleted user is logged out at once");
  assert.equal((await call("POST", "/auth/login", { body: { email: mail("sales"), password: PASSWORD } })).status, 401, "deleted user cannot log in");
  const audit = await call("GET", `/admin/audit-log?entityId=${sales.id}`, { token: state.tokAdmin });
  assert.ok(audit.body.data.items.some((i: any) => i.action === "user.deleted"), "deletion is audited");
});

test("audit trail records the agency's history", async () => {
  const r = await call("GET", `/admin/audit-log?entityId=${state.agencyA}&pageSize=50`, { token: state.tokAdmin });
  const actions = r.body.data.items.map((i: any) => i.action);
  for (const a of ["agency.registered", "agency.email_verified", "agency.request_info", "agency.resubmitted", "agency.approve", "agency.suspend"]) {
    assert.ok(actions.includes(a), `missing audit action ${a}`);
  }
});

test("five wrong passwords lock the account", async () => {
  let r: CallResult | undefined;
  for (let i = 0; i < 5; i++) r = await call("POST", "/auth/login", { body: { email: mail("b"), password: "Wrong-pass-1" } });
  assert.match(r!.body.message, /locked/i);
  r = await call("POST", "/auth/login", { body: { email: mail("b"), password: "NewPass2026x" } });
  assert.equal(r.status, 401);
  assert.match(r.body.message, /try again/i);
});
