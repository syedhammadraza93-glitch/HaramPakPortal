import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { refreshTokens, roles, userRoles, users } from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { logAudit } from "../services/audit.service";
import { frontendUrl, getMailBrand, queueEmail } from "../services/mail.service";
import { createToken } from "../services/token.service";
import { mailTemplates } from "../utils/emails/templates";
import { badRequest, conflict, forbidden, notFound, ok, parse } from "../utils/http";
import { AGENT_ROLE, SUPER_ADMIN_ROLE } from "../utils/permissions";
import { emailSchema, phoneSchema, uuidSchema } from "../utils/validation";

const optionalPhone = phoneSchema.or(z.literal("")).nullable().optional().transform((v) => (v ? v : null));

const createSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2, "Name is required").max(150),
  phone: optionalPhone,
  roleCodes: z.array(z.string()).min(1, "Select at least one role"),
});

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(150).optional(),
  phone: optionalPhone,
  roleCodes: z.array(z.string()).min(1, "Select at least one role").optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

/** Staff users with their roles, without password hashes. */
async function staffUsers(ids?: string[]) {
  const rows = await db
    .select({
      id: users.id, email: users.email, fullName: users.fullName, phone: users.phone, status: users.status,
      lastLoginAt: users.lastLoginAt, lockedUntil: users.lockedUntil, createdAt: users.createdAt, mfaEnabled: users.mfaEnabled,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
    })
    .from(users)
    .where(and(eq(users.type, "staff"), ids ? inArray(users.id, ids) : undefined))
    .orderBy(asc(users.createdAt));
  if (rows.length === 0) return [];
  const roleRows = await db
    .select({ userId: userRoles.userId, code: roles.code, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, rows.map((r) => r.id)));
  return rows.map(({ hasPassword, ...r }) => ({
    ...r,
    invitationPending: !hasPassword,
    roles: roleRows.filter((x) => x.userId === r.id).map(({ code, name }) => ({ code, name })),
  }));
}

async function resolveRoles(codes: string[]) {
  if (codes.includes(AGENT_ROLE)) throw badRequest("Staff users cannot have the Travel Agent role");
  const unique = [...new Set(codes)];
  const found = await db.select({ id: roles.id, code: roles.code }).from(roles).where(inArray(roles.code, unique));
  if (found.length !== unique.length) throw badRequest("One or more roles do not exist");
  return found;
}

async function sendInvite(email: string, name: string, token: string) {
  await queueEmail(email, mailTemplates.staffInvite(await getMailBrand(), name, frontendUrl(`/reset-password?token=${token}&invite=1`)));
}

/** GET /api/admin/users */
export const listUsers = async (_req: Request, res: Response) => {
  ok(res, await staffUsers());
};

/** POST /api/admin/users: creates the user and emails an invitation to set a password. */
export const createUser = async (req: Request, res: Response) => {
  const actor = currentUser(req);
  const data = parse(createSchema, req.body);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
  if (exists) throw conflict("A user with this email already exists", [{ path: "email", message: "Email already in use" }]);
  const roleRows = await resolveRoles(data.roleCodes);
  if (roleRows.some((r) => r.code === SUPER_ADMIN_ROLE) && !actor.roles.includes(SUPER_ADMIN_ROLE)) {
    throw forbidden("Only a Super Admin can create Super Admin users");
  }

  const { id, token } = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: data.email, fullName: data.fullName, phone: data.phone, type: "staff", createdBy: actor.id })
      .returning({ id: users.id });
    await tx.insert(userRoles).values(roleRows.map((r) => ({ userId: user!.id, roleId: r.id })));
    await logAudit({ action: "user.created", entityType: "user", entityId: user!.id, newValues: { email: data.email, fullName: data.fullName, roles: data.roleCodes } }, tx);
    return { id: user!.id, token: await createToken(user!.id, "invite", tx) };
  });
  await sendInvite(data.email, data.fullName, token);
  ok(res, (await staffUsers([id]))[0], "User created and invitation sent", 201);
};

/** PATCH /api/admin/users/:id */
export const updateUser = async (req: Request, res: Response) => {
  const actor = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const data = parse(updateSchema, req.body);
  const [before] = await staffUsers([id]);
  if (!before) throw notFound("User not found");

  if (id === actor.id) {
    if (data.status === "disabled") throw badRequest("You cannot disable your own account");
    if (data.roleCodes && actor.roles.includes(SUPER_ADMIN_ROLE) && !data.roleCodes.includes(SUPER_ADMIN_ROLE)) {
      throw badRequest("You cannot remove the Super Admin role from yourself");
    }
  }
  const touchesSuperAdmin = before.roles.some((r) => r.code === SUPER_ADMIN_ROLE) || data.roleCodes?.includes(SUPER_ADMIN_ROLE);
  if (touchesSuperAdmin && !actor.roles.includes(SUPER_ADMIN_ROLE)) throw forbidden("Only a Super Admin can change Super Admin users");
  const roleRows = data.roleCodes ? await resolveRoles(data.roleCodes) : null;

  await db.transaction(async (tx) => {
    if (roleRows) {
      await tx.delete(userRoles).where(eq(userRoles.userId, id));
      await tx.insert(userRoles).values(roleRows.map((r) => ({ userId: id, roleId: r.id })));
    }
    const changes = {
      ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
      ...("phone" in req.body ? { phone: data.phone } : {}),
      ...(data.status ? { status: data.status } : {}),
    };
    await tx.update(users).set({ ...changes, version: sql`${users.version} + 1` }).where(eq(users.id, id));
    if (data.status === "disabled") {
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
    }
    await logAudit({ action: "user.updated", entityType: "user", entityId: id, oldValues: before, newValues: { ...changes, roles: data.roleCodes } }, tx);
  });
  ok(res, (await staffUsers([id]))[0], "User updated");
};

/** POST /api/admin/users/:id/unlock */
export const unlockUser = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const rows = await db
    .update(users)
    .set({ lockedUntil: null, failedLoginCount: 0 })
    .where(and(eq(users.id, id), eq(users.type, "staff")))
    .returning({ id: users.id });
  if (rows.length === 0) throw notFound("User not found");
  await logAudit({ action: "user.unlocked", entityType: "user", entityId: id });
  ok(res, null, "User unlocked");
};

/** POST /api/admin/users/:id/resend-invite */
export const resendInvite = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [user] = await db.select().from(users).where(and(eq(users.id, id), eq(users.type, "staff"))).limit(1);
  if (!user) throw notFound("User not found");
  if (user.passwordHash) throw badRequest("This user has already set a password");
  await sendInvite(user.email, user.fullName, await createToken(user.id, "invite"));
  await logAudit({ action: "user.invite_resent", entityType: "user", entityId: id });
  ok(res, null, "Invitation sent");
};

/**
 * DELETE /api/admin/users/:id: permanently removes a staff user (roles, sessions and tokens go with it).
 * The audit log keeps the user's email on every past action, so history stays traceable.
 */
export const deleteUser = async (req: Request, res: Response) => {
  const actor = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  if (id === actor.id) throw badRequest("You cannot delete your own account");
  const [target] = await staffUsers([id]);
  if (!target) throw notFound("User not found");

  if (target.roles.some((r) => r.code === SUPER_ADMIN_ROLE)) {
    if (!actor.roles.includes(SUPER_ADMIN_ROLE)) throw forbidden("Only a Super Admin can delete a Super Admin");
    const [others] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.code, SUPER_ADMIN_ROLE), eq(users.status, "active"), sql`${users.id} <> ${id}`, sql`${users.passwordHash} is not null`));
    if (!others || others.n === 0) throw badRequest("This is the last active Super Admin and cannot be deleted");
  }

  await db.transaction(async (tx) => {
    await logAudit({ action: "user.deleted", entityType: "user", entityId: id, oldValues: target }, tx);
    await tx.delete(users).where(and(eq(users.id, id), eq(users.type, "staff")));
  });
  ok(res, null, `${target.fullName} was deleted`);
};
