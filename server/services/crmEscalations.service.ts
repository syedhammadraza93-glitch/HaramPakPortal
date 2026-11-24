import { and, isNull, lt, lte, notInArray, or } from "drizzle-orm";
import { db } from "../database/connection";
import { notifyUsers, staffWithPermission } from "./notification.service";
import { crmSettings, leadEvents, leads } from "../database/schema";

export const closedLeadStages = ["booked", "lost"] as const;

export async function getCrmSettings() {
  const [row] = await db.select().from(crmSettings).limit(1);
  return row ?? { id: 1, firstResponseMinutes: 60, followUpMinutes: 1440 };
}

export async function escalateOverdueLeads(now = new Date()) {
  return db.transaction(async tx => {
    const overdue = await tx.update(leads).set({ escalatedAt: now }).where(and(
      isNull(leads.escalatedAt),
      notInArray(leads.stage, [...closedLeadStages]),
      or(
        and(isNull(leads.firstContactAt), lte(leads.firstResponseDueAt, now)),
        lt(leads.nextFollowUpAt, now),
      ),
    )).returning({ id: leads.id, firstContactAt: leads.firstContactAt, firstResponseDueAt: leads.firstResponseDueAt });
    if (overdue.length) {
      const events = overdue.map(lead => ({
        leadId: lead.id,
        kind: "escalation",
        details: !lead.firstContactAt && lead.firstResponseDueAt <= now
          ? "First response deadline missed"
          : "Follow-up deadline missed",
      }));
      await tx.insert(leadEvents).values(events);
      const managers = (await staffWithPermission("crm.manage", tx)).map(user => user.id);
      for (const event of events) {
        await notifyUsers(managers, {
          type: "crm_escalation",
          title: event.details,
          link: "/admin/crm/leads/" + event.leadId,
        }, tx);
      }
    }
    return overdue.length;
  });
}

export function startCrmJobs() {
  const sweep = () => void escalateOverdueLeads().catch(error => console.error("[crm] escalation sweep failed", error.code ?? "unknown"));
  sweep();
  setInterval(sweep, 60_000).unref();
}
