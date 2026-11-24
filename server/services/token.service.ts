import { and, eq, isNull } from "drizzle-orm";
import { db, type DbClient, type Tx } from "../database/connection";
import { users, verificationTokens, type TokenType, type User } from "../database/schema";
import { randomToken, sha256 } from "../utils/crypto";
import { badRequest } from "../utils/http";

export const TOKEN_TTL_MS: Record<TokenType, number> = {
  email_verify: 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
  invite: 72 * 60 * 60 * 1000,
};

/** Creates a one-time token (only its hash is stored) and invalidates older unused tokens of the same type. */
export async function createToken(userId: string, type: TokenType, client: DbClient = db): Promise<string> {
  const raw = randomToken();
  await client
    .update(verificationTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(verificationTokens.userId, userId), eq(verificationTokens.type, type), isNull(verificationTokens.usedAt)));
  await client.insert(verificationTokens).values({
    userId,
    type,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]),
  });
  return raw;
}

/** Marks a token as used and returns its user. Throws if the token is invalid, used or expired. */
export async function consumeToken(raw: string, types: TokenType[], tx: Tx): Promise<{ user: User; type: TokenType }> {
  const [row] = await tx
    .select({ token: verificationTokens, user: users })
    .from(verificationTokens)
    .innerJoin(users, eq(users.id, verificationTokens.userId))
    .where(eq(verificationTokens.tokenHash, sha256(raw)))
    .limit(1);
  if (!row || !types.includes(row.token.type) || row.token.usedAt || row.token.expiresAt < new Date()) {
    throw badRequest("This link is invalid or has expired. Please request a new one.");
  }
  const used = await tx
    .update(verificationTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(verificationTokens.id, row.token.id), isNull(verificationTokens.usedAt)))
    .returning({ id: verificationTokens.id });
  if (used.length === 0) throw badRequest("This link has already been used.");
  return { user: row.user, type: row.token.type };
}
