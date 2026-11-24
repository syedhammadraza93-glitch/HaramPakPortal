import { eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../database/connection";
import { auditLog, roles, userRoles, users } from "../database/schema";
import { hashPassword } from "../utils/crypto";
import { SUPER_ADMIN_ROLE } from "../utils/permissions";

/**
 * On a fresh install nobody can approve agents, because every admin route needs an existing admin.
 * If INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD are set and there is no staff user yet,
 * create that one Super Admin (same pattern as pmcmworks). Safe to leave the variables set: it only acts once.
 */
export async function bootstrapFirstAdmin(): Promise<void> {
  const email = env.INITIAL_ADMIN_EMAIL?.toLowerCase();
  const password = env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) {
    const [anyStaff] = await db.select({ id: users.id }).from(users).where(eq(users.type, "staff")).limit(1);
    if (!anyStaff) console.warn("⚠️  No staff user exists. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in server/.env and restart.");
    return;
  }
  if (password.length < 8) {
    console.warn("⚠️  INITIAL_ADMIN_PASSWORD must be at least 8 characters. First admin not created.");
    return;
  }

  const [anyStaff] = await db.select({ id: users.id }).from(users).where(eq(users.type, "staff")).limit(1);
  if (anyStaff) return;

  await db.transaction(async (tx) => {
    const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, SUPER_ADMIN_ROLE)).limit(1);
    if (!role) throw new Error("SUPER_ADMIN role missing; seed did not run");
    const [user] = await tx
      .insert(users)
      .values({
        email,
        fullName: env.INITIAL_ADMIN_NAME,
        type: "staff",
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date(),
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ userId: user!.id, roleId: role.id });
    await tx.insert(auditLog).values({ action: "user.super_admin_bootstrapped", entityType: "user", entityId: user!.id, userEmail: "system" });
  });
  console.log(`✅ [BOOTSTRAP] Created initial Super Admin: ${email}. Change this password after the first login.`);
}
