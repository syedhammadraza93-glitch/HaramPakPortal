ALTER TABLE "company_settings" ADD COLUMN "portal_name" varchar(80) DEFAULT 'Agent Portal' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "tagline" varchar(150);--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "hero_title" varchar(150);--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "about_text" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "highlights" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "footer_text" varchar(200);--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "logo_key" varchar(300);--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "logo_mime" varchar(50);--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "primary_color" varchar(7) DEFAULT '#0F766E' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "accent_color" varchar(7) DEFAULT '#DC2626' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "highlight_color" varchar(7) DEFAULT '#F59E0B' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "cities" jsonb DEFAULT '[]'::jsonb NOT NULL;