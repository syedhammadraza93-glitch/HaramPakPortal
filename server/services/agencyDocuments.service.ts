import { and, eq } from "drizzle-orm";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "../database/connection";
import { agencyDocuments, type DocumentType } from "../database/schema";
import { inspectUpload, safeFileName } from "../utils/files";
import { notFound } from "../utils/http";
import { removeFile, saveFile, streamFile } from "./storage.service";

export interface PendingDocument {
  file: Express.Multer.File;
  docType: DocumentType;
}

export interface StoredDocument {
  id: string;
  docType: DocumentType;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

export const documentListColumns = {
  id: agencyDocuments.id,
  docType: agencyDocuments.docType,
  fileName: agencyDocuments.fileName,
  mimeType: agencyDocuments.mimeType,
  sizeBytes: agencyDocuments.sizeBytes,
  verified: agencyDocuments.verified,
  createdAt: agencyDocuments.createdAt,
};

/** Validates every file first, then writes them to private storage. Returns rows ready to insert. */
export async function storeDocuments(agencyId: string, docs: PendingDocument[]): Promise<StoredDocument[]> {
  const checked = docs.map((d) => ({ ...d, info: inspectUpload(d.file) }));
  const stored: StoredDocument[] = [];
  try {
    for (const d of checked) {
      const id = randomUUID();
      const storageKey = `agencies/${agencyId}/${id}.${d.info.ext}`;
      await saveFile(storageKey, d.file.buffer);
      stored.push({ id, docType: d.docType, fileName: safeFileName(d.file.originalname), storageKey, mimeType: d.info.mime, sizeBytes: d.file.size });
    }
  } catch (e) {
    await discardDocuments(stored);
    throw e;
  }
  return stored;
}

/** Removes stored files when the database change that referenced them failed. */
export async function discardDocuments(stored: StoredDocument[]): Promise<void> {
  await Promise.all(stored.map((s) => removeFile(s.storageKey).catch(() => undefined)));
}

export async function insertDocuments(agencyId: string, stored: StoredDocument[], uploadedBy: string | null, tx: Tx): Promise<void> {
  if (stored.length === 0) return;
  await tx.insert(agencyDocuments).values(stored.map((s) => ({ ...s, agencyId, uploadedBy })));
}

/** Streams a document. Requiring the agencyId is what stops one agency from opening another agency's files. */
export async function sendAgencyDocument(res: Response, agencyId: string, documentId: string): Promise<void> {
  const [doc] = await db
    .select()
    .from(agencyDocuments)
    .where(and(eq(agencyDocuments.id, documentId), eq(agencyDocuments.agencyId, agencyId)))
    .limit(1);
  if (!doc) throw notFound("Document not found");
  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader("Content-Length", String(doc.sizeBytes));
  res.setHeader("Content-Disposition", `inline; filename="${doc.fileName.replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  const stream = streamFile(doc.storageKey);
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).json({ success: false, message: "File is missing from storage" });
    else res.end();
  });
  stream.pipe(res);
}
