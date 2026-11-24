import { boolean, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import { agencies } from "./agency.schema";

// ================================================================================
// Enums
// ================================================================================
export const userTypeEnum = pgEnum("user_type", ["staff", "agent"]);
export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);
export const tokenTypeEnum = pgEnum("token_type", ["email_verify", "password_reset", "invite"]);

// ================================================================================
// Users: internal staff and agency users share one login table
// ================================================================================
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    /** Null until an invited staff member sets a password. */
    passwordHash: varchar("password_hash", { length: 255 }),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    type: userTypeEnum("type").notNull(),
    status: userStatusEnum("status").default("active").notNull(),
    agencyId: uuid("agency_id").references((): AnyPgColumn => agencies.id, { onDelete: "set null" }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").default(0).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Access tokens issued before this moment are rejected. */
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    /** Two-factor login: a 6-digit code is emailed at every login (Settings → Security can require it for roles or switch it off). */
    mfaEnabled: boolean("mfa_enabled").default(false).notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    version: integer("version").default(0).notNull(),
  },
  (t) => [index("users_agency_id_idx").on(t.agencyId)],
);

// ================================================================================
// Roles & permissions
// ================================================================================
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  code: varchar("code", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  module: varchar("module", { length: 50 }).notNull(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

// ================================================================================
// Sessions, login attempts, one-time tokens
// ================================================================================
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    userAgent: varchar("user_agent", { length: 300 }),
    ip: varchar("ip", { length: 64 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("refresh_tokens_user_id_idx").on(t.userId)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    userId: uuid("user_id"),
    success: boolean("success").notNull(),
    reason: varchar("reason", { length: 60 }),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("login_attempts_email_created_idx").on(t.email, t.createdAt)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: tokenTypeEnum("type").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("verification_tokens_user_type_idx").on(t.userId, t.type)],
);

// ================================================================================
// One-time email codes (same design as pmcmworks): sign-up verification, login 2FA, password reset
// ================================================================================
export const otps = pgTable(
  "otps",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    email: varchar("email", { length: 255 }).notNull().references(() => users.email, { onDelete: "cascade", onUpdate: "cascade" }),
    code: varchar("code", { length: 6 }).notNull(),
    /** "verification" | "two_factor" | "reset" */
    purpose: varchar("purpose", { length: 50 }).notNull(),
    isUsed: boolean("is_used").default(false).notNull(),
    /** Wrong guesses; the code stops working after 5. */
    attempts: integer("attempts").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("otps_email_idx").on(t.email)],
);

export type User = typeof users.$inferSelect;
export type OtpPurpose = "verification" | "two_factor" | "reset";
export type TokenType = (typeof tokenTypeEnum.enumValues)[number];
export type UserType = (typeof userTypeEnum.enumValues)[number];
