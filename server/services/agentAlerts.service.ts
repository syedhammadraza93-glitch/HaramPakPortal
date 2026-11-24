import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../database/connection";
import { agencies, announcements, journalLines, type Announcement } from "../database/schema";
import { mailTemplates } from "../utils/emails/templates";
import { VERTICAL_LABEL } from "../utils/labels";
import { ledgerCurrency, systemAccountId } from "./ledger.service";
import { frontendUrl, getMailBrand, queueEmail } from "./mail.service";
import { activeAgencyIds, agentUsersOf, notifyUsers, type Alert } from "./notification.service";
import { getCompany } from "./settings.service";
import { broadcastAllowed } from "../utils/emailAddress";

/** In-portal alert to every user of the agencies, and optionally an email to each agency. */
export async function alertAgencies(agencyIds: string[], alert: Alert, email: { heading: string; message: string; button: string } | null): Promise<number> {
  if (!agencyIds.length) return 0;
  const people = await agentUsersOf(agencyIds);
  await notifyUsers(people.map((u) => u.id), alert);
  if (email) {
    const brand = await getMailBrand();
    const list = await db.select({ email: agencies.email, name: agencies.authorizedPerson }).from(agencies).where(inArray(agencies.id, agencyIds));
    for (const a of list) await queueEmail(a.email, mailTemplates.notice(brand, a.name, email.heading, email.message, frontendUrl(alert.link ?? "/agent"), email.button));
  }
  return agencyIds.length;
}

/** Runs in the background so the admin's request is not slowed down by a large agent list. */
const background = (label: string, fn: () => Promise<unknown>) => void fn().catch((e) => console.error(`[alerts] ${label} failed:`, e?.message || e));

export function announceNewPackage(pkg: { id: string; name: string; vertical: keyof typeof VERTICAL_LABEL }) {
  background("new package", async () => {
    const company = await getCompany();
    const title = `New ${VERTICAL_LABEL[pkg.vertical]} package: ${pkg.name}`;
    await alertAgencies(
      await activeAgencyIds(),
      { type: "new_package", title, body: "Open it to see dates and your prices.", link: `/agent/packages/${pkg.id}` },
      company.emailNewPackages ? { heading: title, message: "A new package is now available to book in the portal. Log in to see the dates and your prices.", button: "View package" } : null,
    );
  });
}

export function announcePriceChange(pkg: { id: string; name: string }) {
  background("price change", async () => {
    const company = await getCompany();
    const title = `Prices updated: ${pkg.name}`;
    await alertAgencies(
      await activeAgencyIds(),
      { type: "price_change", title, body: "The package prices have changed. Open it to see your current prices.", link: `/agent/packages/${pkg.id}` },
      company.emailPriceChanges ? { heading: title, message: "The prices of this package have changed. Log in to see your current prices. Bookings already submitted keep their price.", button: "View package" } : null,
    );
  });
}

/** Agencies an announcement is for. */
export async function audienceOf(a: Pick<Announcement, "audience" | "agencyIds" | "pricingGroupIds">): Promise<string[]> {
  if (a.audience === "agencies") return activeAgencyIds({ agencyIds: a.agencyIds });
  if (a.audience === "pricing_groups") return activeAgencyIds({ pricingGroupIds: a.pricingGroupIds });
  return activeAgencyIds();
}

/** Notifies the audience of an announcement once (in-portal, and by email when chosen). */
export async function deliverAnnouncement(a: Announcement): Promise<number> {
  const [claimed] = await db.update(announcements).set({ notifiedAt: new Date() }).where(and(eq(announcements.id, a.id), isNull(announcements.notifiedAt))).returning();
  if (!claimed) return 0;
  return alertAgencies(
    await audienceOf(a),
    { type: "announcement", title: a.title, body: a.body.slice(0, 500), link: "/agent" },
    a.sendEmail ? { heading: a.title, message: a.body, button: "Open the portal" } : null,
  );
}

/** Announcements whose start time has come but were not delivered yet (scheduled ones). */
async function deliverDueAnnouncements() {
  const due = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.isActive, true), isNull(announcements.notifiedAt), lt(announcements.startsAt, new Date()), or(isNull(announcements.endsAt), gt(announcements.endsAt, new Date()))))
    .limit(20);
  for (const a of due) await deliverAnnouncement(a);
}

/** Reminds agencies that owe money, at most once every `balanceReminderDays` days (Settings; 0 = off). */
export async function sendBalanceReminders(): Promise<number> {
  const company = await getCompany();
  if (company.balanceReminderDays <= 0) return 0;
  const recv = await systemAccountId(db, "agency_receivable");
  const cutoff = new Date(Date.now() - company.balanceReminderDays * 86_400_000);
  const owing = await db
    .select({ id: agencies.id, email: agencies.email, name: agencies.authorizedPerson, paymentTerms: agencies.paymentTerms, days: agencies.paymentTermsDays, balance: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})` })
    .from(agencies)
    .innerJoin(journalLines, and(eq(journalLines.agencyId, agencies.id), eq(journalLines.accountId, recv)))
    .where(and(eq(agencies.status, "active"), or(isNull(agencies.lastBalanceReminderAt), lt(agencies.lastBalanceReminderAt, cutoff))))
    .groupBy(agencies.id)
    .having(sql`sum(${journalLines.debit} - ${journalLines.credit}) > 0`)
    .limit(100);
  if (!owing.length) return 0;
  const currency = await ledgerCurrency();
  const brand = await getMailBrand();
  for (const a of owing.filter((x) => broadcastAllowed(x.email))) {
    const [claimed] = await db
      .update(agencies)
      .set({ lastBalanceReminderAt: new Date() })
      .where(and(eq(agencies.id, a.id), or(isNull(agencies.lastBalanceReminderAt), lt(agencies.lastBalanceReminderAt, cutoff))))
      .returning({ id: agencies.id });
    if (!claimed) continue;
    const amount = `${currency} ${Number(a.balance).toLocaleString("en-US")}`;
    const title = `Balance due: ${amount}`;
    const message = `Your account with us shows a balance due of ${amount}.${a.paymentTerms === "credit" && a.days ? ` Our terms are payment within ${a.days} days.` : ""} Please arrange payment and submit the details in the portal. If you have already paid, please ignore this reminder.`;
    await notifyUsers((await agentUsersOf([a.id])).map((u) => u.id), { type: "balance_reminder", title, body: message, link: "/agent/ledger" });
    await queueEmail(a.email, mailTemplates.notice(brand, a.name, title, message, frontendUrl("/agent/ledger"), "View statement"));
  }
  return owing.length;
}

export function startAlertJobs(): void {
  setInterval(() => background("announcements", deliverDueAnnouncements), 60_000).unref();
  setInterval(() => background("balance reminders", sendBalanceReminders), 60 * 60_000).unref();
  setTimeout(() => background("balance reminders", sendBalanceReminders), 30_000).unref();
}
