import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, type DbClient } from "../database/connection";
import { agencies, notifications, permissions, rolePermissions, userRoles, users } from "../database/schema";
import type { PermissionCode } from "../utils/permissions";
import { broadcastAllowed } from "../utils/emailAddress";

/** An in-portal alert. `link` is a portal path such as /agent/bookings/<id>. */
export interface Alert {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

const clip = (a: Alert) => ({ type: a.type.slice(0, 40), title: a.title.slice(0, 200), body: a.body ?? null, link: a.link?.slice(0, 300) ?? null });

export async function notifyUsers(userIds: string[], alert: Alert, client: DbClient = db): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  const row = clip(alert);
  // Large audiences (announcements to every agent) are inserted in chunks.
  for (let i = 0; i < ids.length; i += 500) {
    await client.insert(notifications).values(ids.slice(i, i + 500).map((userId) => ({ userId, ...row })));
  }
}

/** Active agent users of the given agencies. */
export async function agentUsersOf(agencyIds: string[], client: DbClient = db): Promise<{ id: string; email: string; fullName: string; agencyId: string | null }[]> {
  if (!agencyIds.length) return [];
  return client
    .select({ id: users.id, email: users.email, fullName: users.fullName, agencyId: users.agencyId })
    .from(users)
    .where(and(eq(users.type, "agent"), eq(users.status, "active"), inArray(users.agencyId, agencyIds)));
}

/** In-portal alert for every user of one agency. Never throws: an alert must not break the action that caused it. */
export async function notifyAgency(agencyId: string, alert: Alert, client: DbClient = db): Promise<void> {
  try {
    const list = await agentUsersOf([agencyId], client);
    await notifyUsers(list.map((u) => u.id), alert, client);
  } catch (e: any) {
    console.error("[notify] agency alert failed:", e?.message || e);
  }
}

/** Active agencies (optionally only some pricing groups or ids). */
export async function activeAgencyIds(filter: { agencyIds?: string[]; pricingGroupIds?: string[] } = {}): Promise<string[]> {
  const rows = await db
    .select({ id: agencies.id, email: agencies.email })
    .from(agencies)
    .where(
      and(
        eq(agencies.status, "active"),
        filter.agencyIds ? inArray(agencies.id, filter.agencyIds.length ? filter.agencyIds : ["00000000-0000-0000-0000-000000000000"]) : undefined,
        filter.pricingGroupIds ? inArray(agencies.pricingGroupId, filter.pricingGroupIds.length ? filter.pricingGroupIds : ["00000000-0000-0000-0000-000000000000"]) : undefined,
      ),
    );
  return rows.filter((r) => broadcastAllowed(r.email)).map((r) => r.id);
}

/** Active staff users holding a permission. */
export async function staffWithPermission(permission: PermissionCode, client: DbClient = db): Promise<{ id: string; email: string }[]> {
  const rows = await client
    .selectDistinct({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(users.type, "staff"), eq(users.status, "active"), isNotNull(users.passwordHash), eq(permissions.code, permission)));
  return rows.filter((r) => broadcastAllowed(r.email));
}

export async function notifyPermission(permission: PermissionCode, alert: Alert): Promise<void> {
  try {
    await notifyUsers((await staffWithPermission(permission)).map((s) => s.id), alert);
  } catch (e: any) {
    console.error("[notify] staff alert failed:", e?.message || e);
  }
}
