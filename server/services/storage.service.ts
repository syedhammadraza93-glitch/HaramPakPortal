import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";

/**
 * Private file storage on local disk for now; the same functions will be backed by an S3-compatible bucket later.
 * Files are never served statically, only through endpoints that check permissions.
 */
const root = path.resolve(env.STORAGE_DIR);

function resolveKey(key: string): string {
  const file = path.resolve(root, key);
  if (!file.startsWith(root + path.sep)) throw new Error("Invalid storage key");
  return file;
}

export async function saveFile(key: string, data: Buffer): Promise<void> {
  const file = resolveKey(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export function streamFile(key: string): ReadStream {
  return createReadStream(resolveKey(key));
}

export async function removeFile(key: string): Promise<void> {
  await rm(resolveKey(key), { force: true });
}
