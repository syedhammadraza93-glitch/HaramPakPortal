CREATE TABLE "crm_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"first_response_minutes" integer DEFAULT 60 NOT NULL,
	"follow_up_minutes" integer DEFAULT 1440 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"details" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_lead_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"customer_name" text NOT NULL,
	"currency" text NOT NULL,
	"valid_until" text NOT NULL,
	"lines" jsonb NOT NULL,
	"terms" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid,
	"sent_at" timestamp with time zone,
	CONSTRAINT "crm_lead_quote_revision" UNIQUE("lead_id","revision")
);
--> statement-breakpoint
CREATE TABLE "crm_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"city" text,
	"service" text NOT NULL,
	"package_slug" text,
	"travel_date" text,
	"travellers" integer,
	"source" text NOT NULL,
	"campaign" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"owner_id" uuid,
	"first_response_due_at" timestamp with time zone NOT NULL,
	"first_contact_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"booking_reference" text,
	"loss_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_leads_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "website_sections" (
	"key" text PRIMARY KEY NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "crm_lead_events" ADD CONSTRAINT "crm_lead_events_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_events" ADD CONSTRAINT "crm_lead_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_quotes" ADD CONSTRAINT "crm_lead_quotes_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_quotes" ADD CONSTRAINT "crm_lead_quotes_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_lead_events_lead_date" ON "crm_lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_leads_owner_stage" ON "crm_leads" USING btree ("owner_id","stage");--> statement-breakpoint
CREATE INDEX "crm_leads_created" ON "crm_leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "crm_leads_phone" ON "crm_leads" USING btree ("phone");