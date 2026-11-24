CREATE TYPE "public"."announcement_audience" AS ENUM('all', 'agencies', 'pricing_groups');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"audience" "announcement_audience" DEFAULT 'all' NOT NULL,
	"agency_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pricing_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"send_email" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone,
	"created_by" uuid,
	"created_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"type" varchar(40) PRIMARY KEY NOT NULL,
	"title" varchar(120) NOT NULL,
	"intro_text" text,
	"footer_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"link" varchar(300),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "last_balance_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "email_new_packages" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "email_price_changes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "balance_reminder_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "invoice_number" varchar(30);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "invoiced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_active_idx" ON "announcements" USING btree ("is_active","starts_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_invoice_number_unique" UNIQUE("invoice_number");