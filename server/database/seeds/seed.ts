import { eq, inArray } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { db, pool } from "../connection";
import { companySettings, permissions, registrationFieldSettings, rolePermissions, roles } from "../schema";
import { BUILT_IN_ROLES, PERMISSIONS } from "../../utils/permissions";
import { SYSTEM_ACCOUNTS } from "../../utils/systemAccounts";
import { DOCUMENT_TYPES } from "../../utils/documentTypes";
import { documentTemplates, ledgerAccounts } from "../schema";
import { REGISTRATION_FIELDS } from "../../utils/registrationFields";

/**
 * Idempotent reference data: permissions, built-in roles, sign-up field settings and the company row.
 * Runs on every server start (index.ts) and can be run by hand with `npm run db:seed`.
 * Built-in roles are reset to their defined permissions; admin-changed sign-up modes are kept.
 */
export async function seedReferenceData(): Promise<void> {
  await db.transaction(async (tx) => {
    for (const p of PERMISSIONS) {
      await tx
        .insert(permissions)
        .values({ code: p.code, module: p.module, description: p.description })
        .onConflictDoUpdate({ target: permissions.code, set: { module: p.module, description: p.description } });
    }
    const permRows = await tx.select({ id: permissions.id, code: permissions.code }).from(permissions);
    const permIds = new Map(permRows.map((p) => [p.code, p.id]));

    for (const r of BUILT_IN_ROLES) {
      const [role] = await tx
        .insert(roles)
        .values({ code: r.code, name: r.name, description: r.description, isSystem: true })
        .onConflictDoUpdate({ target: roles.code, set: { name: r.name, description: r.description, isSystem: true } })
        .returning({ id: roles.id });
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role!.id));
      if (r.permissions.length) {
        await tx.insert(rolePermissions).values(r.permissions.map((code) => ({ roleId: role!.id, permissionId: permIds.get(code)! })));
      }
    }

    // Remove permissions that no longer exist in code (their role links cascade).
    const known = PERMISSIONS.map((p) => p.code as string);
    const stale = permRows.filter((p) => !known.includes(p.code)).map((p) => p.id);
    if (stale.length) await tx.delete(permissions).where(inArray(permissions.id, stale));

    for (const f of REGISTRATION_FIELDS) {
      await tx
        .insert(registrationFieldSettings)
        .values({ field: f.field, label: f.label, mode: f.defaultMode, sortOrder: f.sortOrder })
        .onConflictDoUpdate({ target: registrationFieldSettings.field, set: { label: f.label, sortOrder: f.sortOrder } });
    }

    // Ledger accounts the posting rules need. Only created if missing; their names stay editable.
    for (const a of SYSTEM_ACCOUNTS) {
      await tx.insert(ledgerAccounts).values({ code: a.code, name: a.name, type: a.type, systemKey: a.key, sortOrder: a.sortOrder }).onConflictDoNothing();
    }

    // Document templates (titles and terms are edited in Settings → Documents).
    for (const d of DOCUMENT_TYPES) await tx.insert(documentTemplates).values({ type: d.type, title: d.title }).onConflictDoNothing();

    // Company and branding are entered by the admin in Settings. A fresh install only gets a placeholder row.
    await tx
      .insert(companySettings)
      .values({ id: 1, name: process.env.INITIAL_COMPANY_NAME?.trim() || "Company name" })
      .onConflictDoNothing();
  });
}

// Allow `npm run db:seed`
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  seedReferenceData()
    .then(() => console.log(`✅ Seeded ${PERMISSIONS.length} permissions, ${BUILT_IN_ROLES.length} roles, ${REGISTRATION_FIELDS.length} sign-up fields.`))
    .catch((e) => {
      console.error("❌ Seed failed:", e?.message || e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
