import { eq } from "drizzle-orm";
import { db } from "../database/connection";
import { companySettings, registrationFieldSettings, type FieldMode } from "../database/schema";
import { REGISTRATION_FIELDS } from "../utils/registrationFields";

export interface RegistrationFieldView {
  field: string;
  label: string;
  kind: "text" | "file";
  mode: FieldMode;
}

export async function getRegistrationFields(): Promise<RegistrationFieldView[]> {
  const rows = await db.select().from(registrationFieldSettings);
  const byField = new Map(rows.map((r) => [r.field, r]));
  return REGISTRATION_FIELDS.map((def) => ({
    field: def.field,
    label: byField.get(def.field)?.label ?? def.label,
    kind: def.kind,
    mode: byField.get(def.field)?.mode ?? def.defaultMode,
  }));
}

export type Company = typeof companySettings.$inferSelect;

/** The company row. The seed always creates it; if it is somehow missing, create an empty one. */
export async function getCompany(): Promise<Company> {
  const [row] = await db.select().from(companySettings).where(eq(companySettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db.insert(companySettings).values({ id: 1, name: "" }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(companySettings).where(eq(companySettings.id, 1)))[0]!;
}

/** Today's date (YYYY-MM-DD) in the company's time zone from Settings. */
export async function todayInCompanyTz(): Promise<string> {
  const { timezone } = await getCompany();
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Public branding for the portal (no internal settings). */
export function toBranding(c: Company) {
  return {
    name: c.name,
    portalName: c.portalName,
    tagline: c.tagline,
    heroTitle: c.heroTitle,
    aboutText: c.aboutText,
    highlights: c.highlights,
    footerText: c.footerText,
    address: c.address,
    phone: c.phone,
    email: c.email,
    website: c.website,
    primaryColor: c.primaryColor,
    accentColor: c.accentColor,
    highlightColor: c.highlightColor,
    cities: c.cities,
    termsVersion: c.termsVersion,
    currency: c.currency,
    /** Versioned so browsers reload the logo after it changes. */
    logoUrl: c.logoKey ? `/api/public/logo?v=${c.updatedAt.getTime()}` : null,
  };
}
