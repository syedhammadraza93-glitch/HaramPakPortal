import { and, eq, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { websiteSections } from "../database/schema";
import { currentUser, jwtGuard, requirePermission } from "../middleware/auth.middleware";
import { logAudit } from "../services/audit.service";
import { asyncHandler as h, conflict, forbidden, ok, parse } from "../utils/http";

const short = z.string().trim().min(1).max(200);
const copy = z.string().trim().min(1).max(3500);
const image = z.string().max(200).regex(/^\/images\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|avif)$/);
const slug = z.string().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const banner = z.object({ label: short, title: short, description: copy, image: image.or(z.literal("")) }).strict();
const hotel = z.object({ city: short, name: short, note: copy }).strict();
const packageItem = z.object({
  id: slug, title: short, category: z.enum(["Group", "Tailored"]), label: short, image,
  imageAlt: z.string().max(200), summary: copy, duration: short, departure: short, stay: short,
  itinerary: z.array(z.object({ city: short, nights: z.number().int().min(0).max(90), hotel: short, note: copy }).strict()).max(25).optional(),
  hotels: z.array(hotel).max(20).optional(),
}).strict();
export const sectionSchemas = {
  pageBanners: z.object({ about: banner, flights: banner, gallery: banner, hajj: banner, hotels: banner, services: banner, "tour-packages": banner, umrah: banner, visas: banner }).strict(),
  packages: z.array(packageItem).max(50).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, "Every package needs a unique slug"),
  homepage: z.object({ kicker: short, headline: short, emphasis: short, description: copy, featuredPackageIds: z.array(slug).max(3) }).strict(),
  faqs: z.array(z.object({ question: short, answer: copy }).strict()).max(30),
  offices: z.array(z.object({
    country: short, code: z.string().regex(/^[A-Z]{2}$/),
    phones: z.array(z.string().max(30).regex(/^\+?[\d .()-]+$/)).max(8),
    offices: z.array(z.object({ city: short, address: copy, sample: z.boolean() }).strict()).max(20),
  }).strict()).max(10),
  clients: z.array(z.object({ name: short, logo: image.optional() }).strict()).max(30),
  ziarat: z.array(z.object({
    key: z.enum(["iraq-ziarat", "iran-ziarat", "iran-iraq-ziarat", "arbaeen"]), title: short, description: copy, stops: short,
  }).strict()).max(4),
  visas: z.array(z.object({ title: short, copy }).strict()).max(12),
  contact: z.object({ description: copy, email: z.string().max(180).email(), phone: z.string().max(30).regex(/^\+?[\d .()-]+$/), internationalPhone: z.string().max(30).regex(/^\+?[\d .()-]+$/) }).strict(),
} as const;
const sectionKeys = ["packages", "homepage", "faqs", "offices", "clients", "ziarat", "visas", "contact", "pageBanners"] as const;
const sectionKey = z.enum(sectionKeys);
const versionInput = z.number().int().min(0);
const maxSectionSize = 180_000;

export const publicWebsiteRoutes = Router();
publicWebsiteRoutes.get("/content", h(async (_req, res) => {
  const rows = await db.select({ key: websiteSections.key, published: websiteSections.published }).from(websiteSections);
  const published = Object.fromEntries(rows.flatMap(({ key, published: payload }) => {
    const match = sectionKey.safeParse(key);
    if (!match.success || payload === null) return [];
    const result = sectionSchemas[match.data].safeParse(payload);
    return result.success ? [[key, result.data]] : [];
  }));
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  ok(res, published);
}));

export const adminWebsiteRoutes = Router();
adminWebsiteRoutes.use(jwtGuard, (req: Request, res: Response, next) => {
  const user = currentUser(req);
  if (user.type !== "staff" || !user.permissions.some(p => p === "website.edit" || p === "website.publish")) throw forbidden();
  res.set("Cache-Control", "private, no-store");
  next();
});
adminWebsiteRoutes.get("/", h(async (_req, res) => {
  const saved = await db.select().from(websiteSections);
  ok(res, sectionKeys.map(key => saved.find(row => row.key === key) ?? { key, draft: null, version: 0, publishedAt: null, published: null }));
}));

adminWebsiteRoutes.put("/:key", requirePermission("website.edit"), h(async (req, res) => {
  const key = parse(sectionKey, req.params.key);
  const input = parse(z.object({ version: versionInput, payload: z.unknown() }).strict(), req.body);
  const draft = parse(sectionSchemas[key], input.payload);
  if (Buffer.byteLength(JSON.stringify(draft)) > maxSectionSize) throw conflict("This section is too large");
  const row = await db.transaction(async tx => {
    const [saved] = input.version === 0
      ? await tx.insert(websiteSections).values({ key, draft }).onConflictDoNothing().returning()
      : await tx.update(websiteSections).set({ draft, updatedAt: new Date(), version: sql`${websiteSections.version} + 1` })
        .where(and(eq(websiteSections.key, key), eq(websiteSections.version, input.version))).returning();
    if (!saved) throw conflict("Another editor changed this section. Reload the latest draft.");
    await logAudit({ action: "website.draft_saved", entityType: "website_section", newValues: { key, version: saved.version } }, tx);
    return saved;
  });
  ok(res, row, "Draft saved");
}));

adminWebsiteRoutes.post("/:key/publish", requirePermission("website.publish"), h(async (req, res) => {
  const key = parse(sectionKey, req.params.key);
  const { version } = parse(z.object({ version: versionInput }).strict(), req.body);
  const row = await db.transaction(async tx => {
    const [current] = await tx.select().from(websiteSections).where(eq(websiteSections.key, key)).for("update");
    if (!current || current.version !== version) throw conflict("Save or reload the latest draft before publishing");
    const published = parse(sectionSchemas[key], current.draft);
    const [saved] = await tx.update(websiteSections).set({ published, version: version + 1, publishedAt: new Date() })
      .where(eq(websiteSections.key, key)).returning();
    await logAudit({ action: "website.published", entityType: "website_section", newValues: { key, version: saved!.version } }, tx);
    return saved;
  });
  ok(res, row, "Published");
}));
