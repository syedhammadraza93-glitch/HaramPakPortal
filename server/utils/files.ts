import { badRequest } from "./http";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface InspectedFile {
  mime: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  ext: "pdf" | "png" | "jpg" | "webp";
}

/** Checks size and detects the real file type from its first bytes (the browser-sent type is not trusted). */
export function inspectUpload(file: Express.Multer.File): InspectedFile {
  if (file.size > MAX_UPLOAD_BYTES) throw badRequest(`${file.originalname} is larger than 5 MB`);
  const b = file.buffer;
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: "application/pdf", ext: "pdf" };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  throw badRequest(`${file.originalname}: only PDF, JPG, PNG or WebP files are allowed`);
}

export const safeFileName = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
