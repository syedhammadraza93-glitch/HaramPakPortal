// ================================================================================
// Database schema (Drizzle ORM). Each module keeps its tables in database/schema/*.schema.ts.
// drizzle.config.ts points here, so every table must be exported from this file.
// ================================================================================
export * from "./schema/identity.schema";
export * from "./schema/agency.schema";
export * from "./schema/settings.schema";
export * from "./schema/catalogue.schema";
export * from "./schema/pricing.schema";
export * from "./schema/booking.schema";
export * from "./schema/finance.schema";
export * from "./schema/communication.schema";
export * from "./schema/system.schema";

export * from "./schema/crm.schema";
