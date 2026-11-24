import { asc, count, eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { permissions, rolePermissions, roles, userRoles } from "../database/schema";
import { logAudit } from "../services/audit.service";
import { badRequest, conflict, notFound, ok, parse } from "../utils/http";
import { LOCKED_ROLES } from "../utils/permissions";
import { uuidSchema } from "../utils/validation";

const createSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{2,40}$/, "Use capital letters, numbers and underscores, e.g. VISA_OFFICER"),
  name: z.string().trim().min(2, "Name is required").max(100),
  description: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  permissions: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  permissions: z.array(z.string()).optional(),
});

async function permissionIds(codes: string[]): Promise<string[]> {
  const unique = [...new Set(codes)];
  if (unique.includes("portal.agent")) throw badRequest("The agent portal permission cannot be given to staff roles");
  if (unique.length === 0) return [];
  const rows = await db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.code, unique));
  if (rows.length !== unique.length) throw badRequest("One or more permissions do not exist");
  return rows.map((r) => r.id);
}

/** GET /api/admin/roles */
export const listRoles = async (_req: Request, res: Response) => {
  const [roleRows, links, usage] = await Promise.all([
    db.select().from(roles).orderBy(asc(roles.createdAt)),
    db.select({ roleId: rolePermissions.roleId, code: permissions.code }).from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)),
    db.select({ roleId: userRoles.roleId, total: count() }).from(userRoles).groupBy(userRoles.roleId),
  ]);
  ok(
    res,
    roleRows.map((r) => ({
      ...r,
      locked: LOCKED_ROLES.includes(r.code),
      userCount: usage.find((u) => u.roleId === r.id)?.total ?? 0,
      permissions: links.filter((l) => l.roleId === r.id).map((l) => l.code),
    })),
  );
};

/** GET /api/admin/permissions */
export const listPermissions = async (_req: Request, res: Response) => {
  ok(res, await db.select().from(permissions).orderBy(asc(permissions.module), asc(permissions.code)));
};

/** POST /api/admin/roles */
export const createRole = async (req: Request, res: Response) => {
  const data = parse(createSchema, req.body);
  const [exists] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, data.code)).limit(1);
  if (exists) throw conflict("A role with this code already exists", [{ path: "code", message: "Code already in use" }]);
  const ids = await permissionIds(data.permissions);
  const role = await db.transaction(async (tx) => {
    const [row] = await tx.insert(roles).values({ code: data.code, name: data.name, description: data.description }).returning();
    if (ids.length) await tx.insert(rolePermissions).values(ids.map((permissionId) => ({ roleId: row!.id, permissionId })));
    await logAudit({ action: "role.created", entityType: "role", entityId: row!.id, newValues: data }, tx);
    return row;
  });
  ok(res, role, "Role created", 201);
};

/** PATCH /api/admin/roles/:id */
export const updateRole = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(updateSchema, req.body);
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) throw notFound("Role not found");
  if (LOCKED_ROLES.includes(role.code)) throw badRequest("This built-in role cannot be changed");
  const ids = data.permissions ? await permissionIds(data.permissions) : null;
  const before = await db.select({ code: permissions.code }).from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(eq(rolePermissions.roleId, id));

  const updated = await db.transaction(async (tx) => {
    if (ids) {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      if (ids.length) await tx.insert(rolePermissions).values(ids.map((permissionId) => ({ roleId: id, permissionId })));
    }
    const [row] = await tx
      .update(roles)
      .set({ ...(data.name ? { name: data.name } : {}), ...("description" in req.body ? { description: data.description } : {}) })
      .where(eq(roles.id, id))
      .returning();
    await logAudit(
      { action: "role.updated", entityType: "role", entityId: id, oldValues: { name: role.name, permissions: before.map((p) => p.code) }, newValues: data },
      tx,
    );
    return row;
  });
  ok(res, updated, "Role updated");
};
