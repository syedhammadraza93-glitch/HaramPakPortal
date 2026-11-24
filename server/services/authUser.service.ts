import { eq } from "drizzle-orm";
import { db } from "../database/connection";
import { agencies, companySettings, permissions, rolePermissions, roles, userRoles, users, type AgencyAccess, type AgencyStatus, type UserType } from "../database/schema";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  type: UserType;
  roles: string[];
  permissions: string[];
  agency: { id: string; name: string; agentCode: string | null; status: AgencyStatus; access: AgencyAccess } | null;
  /** Emailed login codes are asked for at login (the user's own choice, or required for their role). */
  mfaEnabled: boolean;
  /** The role requires two-factor login, so the user cannot turn it off. */
  mfaRequired: boolean;
  /** Two-factor login is switched on for the portal (Settings → Security). */
  mfaAvailable: boolean;
  /** Internal: access tokens issued before this are rejected. Not sent to the browser. */
  passwordChangedAt: Date | null;
}

/** Settings → Security: whether two-factor login is on for the portal, and which roles must use it. */
export interface TwoFactorPolicy {
  enabled: boolean;
  roles: string[];
}

export async function getTwoFactorPolicy(): Promise<TwoFactorPolicy> {
  const [row] = await db
    .select({ enabled: companySettings.twoFactorEnabled, roles: companySettings.twoFactorRoles })
    .from(companySettings)
    .where(eq(companySettings.id, 1))
    .limit(1);
  return { enabled: row?.enabled ?? true, roles: row?.roles ?? [] };
}

/** True when two-factor login is on and any of the roles must use it. */
export const mfaRequiredFor = (policy: TwoFactorPolicy, roleCodes: string[]) => policy.enabled && roleCodes.some((r) => policy.roles.includes(r));

/** True when this user must enter an emailed code at login. */
export const mfaActiveFor = (policy: TwoFactorPolicy, userChoseMfa: boolean, roleCodes: string[]) =>
  policy.enabled && (userChoseMfa || mfaRequiredFor(policy, roleCodes));

/** Agency statuses in which agency users cannot log in at all. */
export const BLOCKED_AGENCY_STATUSES: AgencyStatus[] = ["pending_email_verification", "suspended", "rejected", "deactivated"];

/**
 * Loads a user with roles, permissions, agency and the two-factor policy (queries in parallel). Returns null when the
 * user may not use the system: disabled, no password yet, agent email not verified, or agency blocked.
 */
export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const [rows, roleRows, policy] = await Promise.all([
    db.select({ user: users, agency: agencies }).from(users).leftJoin(agencies, eq(users.agencyId, agencies.id)).where(eq(users.id, userId)).limit(1),
    db
      .select({ role: roles.code, permission: permissions.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId)),
    getTwoFactorPolicy(),
  ]);
  const row = rows[0];
  if (!row) return null;
  const { user, agency } = row;
  if (user.status !== "active" || !user.passwordHash) return null;
  if (user.type === "agent" && (!user.emailVerifiedAt || !agency || BLOCKED_AGENCY_STATUSES.includes(agency.status))) return null;

  const roleCodes = [...new Set(roleRows.map((r) => r.role))];
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    type: user.type,
    mfaEnabled: mfaActiveFor(policy, user.mfaEnabled, roleCodes),
    mfaRequired: mfaRequiredFor(policy, roleCodes),
    mfaAvailable: policy.enabled,
    roles: roleCodes,
    permissions: [...new Set(roleRows.map((r) => r.permission).filter((p): p is string => !!p))],
    agency: agency ? { id: agency.id, name: agency.agencyName, agentCode: agency.agentCode, status: agency.status, access: agency.portalAccess } : null,
    passwordChangedAt: user.passwordChangedAt,
  };
}

/** The user object sent to the frontend. */
export function toMe(user: AuthUser) {
  const { passwordChangedAt: _internal, ...me } = user;
  return me;
}
