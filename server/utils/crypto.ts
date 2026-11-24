import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const hashPassword = (password: string) => bcrypt.hash(password, 12);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}
