import { and, asc, eq, isNotNull } from "drizzle-orm";
import nodemailer from "nodemailer";
import { env, isProduction } from "../config/env";
import { db, type DbClient } from "../database/connection";
import { companySettings, emailOutbox, permissions, rolePermissions, userRoles, users } from "../database/schema";
import type { PermissionCode } from "../utils/permissions";
import type { MailBrand, MailContent } from "../utils/emails/templates";
import { notifyUsers, type Alert } from "./notification.service";
import { broadcastAllowed, isTestAddress } from "../utils/emailAddress";

const MAX_ATTEMPTS = 5;

// Pooled: the SMTP connection (TLS + login) is reused for following emails instead of opened every time.
const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      pool: true,
      maxConnections: 2,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

function htmlToText(html: string): string {
  return html
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "$2 [$1]")
    .replace(/<\/(p|h2|div)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export async function getCompanyName(): Promise<string> {
  return (await getMailBrand()).name;
}

export const toMailBrand = (c: { name: string; portalName: string; primaryColor: string }): MailBrand => ({
  name: c.name,
  portalName: c.portalName,
  primaryColor: c.primaryColor,
});

/** Company name, portal name and colour from Settings, for email headers and buttons. */
export async function getMailBrand(): Promise<MailBrand> {
  const [c] = await db
    .select({ name: companySettings.name, portalName: companySettings.portalName, primaryColor: companySettings.primaryColor })
    .from(companySettings)
    .where(eq(companySettings.id, 1))
    .limit(1);
  return c ?? { name: "", portalName: "Agent Portal", primaryColor: "#0F766E" };
}

export const frontendUrl = (path: string) => `${env.FRONTEND_URL.replace(/\/$/, "")}${path}`;

/**
 * Queues an email and sends it right away. Pass the transaction so the email is only sent if the
 * business change commits; if it is not committed yet, the next run (or the 5-second loop) picks it up.
 */
export async function queueEmail(to: string, mail: MailContent, client: DbClient = db): Promise<void> {
  await client.insert(emailOutbox).values({ toEmail: to, subject: mail.subject, html: mail.html });
  scheduleFlush(client === db ? 0 : 300);
}

let flushTimer: NodeJS.Timeout | null = null;
let flushAgain = false;

/** Runs the outbox soon (debounced), instead of waiting for the background loop. */
function scheduleFlush(delayMs: number) {
  if (env.NODE_ENV === "test") return; // tests read the outbox directly; the dev server sends them
  if (running) {
    flushAgain = true;
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushEmailOutbox();
  }, delayMs);
}

/** Queues an email (and, with `alert`, an in-portal notification) to every active staff user who holds the permission. */
export async function queueEmailToPermission(permission: PermissionCode, mail: MailContent, alert?: Alert): Promise<void> {
  const staff = await db
    .selectDistinct({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(users.type, "staff"), eq(users.status, "active"), isNotNull(users.passwordHash), eq(permissions.code, permission)));
  const recipients = staff.filter((s) => broadcastAllowed(s.email));
  for (const s of recipients) await queueEmail(s.email, mail);
  if (alert) await notifyUsers(recipients.map((s) => s.id), alert).catch((e) => console.error("[notify] staff alert failed:", e?.message || e));
}

export { isTestAddress };

let running = false;

/** Sends pending emails. Without SMTP settings they are printed to the console (development). */
export async function flushEmailOutbox(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const pending = await db.select().from(emailOutbox).where(eq(emailOutbox.status, "pending")).orderBy(asc(emailOutbox.createdAt)).limit(20);
    for (const m of pending) {
      try {
        if (isTestAddress(m.toEmail)) {
          // Reserved test domains (used by automated tests and the seed admin) are never sent to the SMTP server.
          if (isProduction) console.log(`[mail] not sent (test address): ${m.toEmail} · ${m.subject}`);
          else console.log(`\n===== EMAIL (test address, not sent) =====\nTo: ${m.toEmail}\nSubject: ${m.subject}\n\n${htmlToText(m.html)}\n==========================================\n`);
          await db.update(emailOutbox).set({ status: "sent", sentAt: new Date(), attempts: m.attempts + 1, lastError: "test address: not delivered" }).where(eq(emailOutbox.id, m.id));
          continue;
        }
        if (transporter) {
          await transporter.sendMail({ from: env.MAIL_FROM, to: m.toEmail, subject: m.subject, html: m.html, text: htmlToText(m.html) });
        } else {
          console.log(`\n========== EMAIL ==========\nTo: ${m.toEmail}\nSubject: ${m.subject}\n\n${htmlToText(m.html)}\n===========================\n`);
        }
        await db
          .update(emailOutbox)
          .set({
            status: "sent",
            sentAt: new Date(),
            attempts: m.attempts + 1,
            // Record how it went out, so "sent" without SMTP is never mistaken for a delivered email.
            lastError: transporter ? null : "SMTP not configured: printed in the server console only",
          })
          .where(eq(emailOutbox.id, m.id));
        if (transporter) console.log(`[mail] sent via SMTP: ${m.toEmail} · ${m.subject}`);
      } catch (e: any) {
        const attempts = m.attempts + 1;
        await db
          .update(emailOutbox)
          .set({ attempts, lastError: String(e?.message || e).slice(0, 500), status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" })
          .where(eq(emailOutbox.id, m.id));
        console.error(`[mail] sending to ${m.toEmail} failed (attempt ${attempts}):`, e?.message || e);
      }
    }
  } catch (e: any) {
    console.error("[mail] outbox processing failed:", e?.message || e);
  } finally {
    running = false;
    // Emails queued while this run was busy go out now rather than in 5 seconds.
    if (flushAgain) {
      flushAgain = false;
      scheduleFlush(0);
    }
  }
}

export function startMailWorker(): void {
  if (!transporter) console.warn("⚠️  SMTP_HOST is not set: emails will be printed in this console instead of being sent.");
  setInterval(() => void flushEmailOutbox(), 5000).unref();
}
