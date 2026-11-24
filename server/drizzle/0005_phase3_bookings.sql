CREATE TYPE "public"."actor_type" AS ENUM('staff', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."booking_doc_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('draft', 'submitted', 'under_review', 'information_required', 'quotation_sent', 'awaiting_payment', 'payment_pending_verification', 'confirmed', 'processing', 'documents_issued', 'completed', 'cancelled', 'rejected', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."price_line_kind" AS ENUM('fare', 'addon', 'charge', 'quotation', 'adjustment');--> statement-breakpoint
CREATE TABLE "booking_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"addon_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "booking_addons_unique" UNIQUE("booking_id","addon_id")
);
--> statement-breakpoint
CREATE TABLE "booking_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"passenger_id" uuid,
	"requirement_id" uuid,
	"name" varchar(150) NOT NULL,
	"issued" boolean DEFAULT false NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"file_name" varchar(150) NOT NULL,
	"mime_type" varchar(50) NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" "booking_doc_status" DEFAULT 'pending' NOT NULL,
	"review_note" varchar(300),
	"uploaded_by" uuid,
	"uploaded_by_type" "actor_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "booking_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"author_type" "actor_type" NOT NULL,
	"author_id" uuid,
	"author_name" varchar(150) NOT NULL,
	"message" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_passengers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"gender" "gender",
	"date_of_birth" date,
	"nationality" varchar(60),
	"passport_number" varchar(30),
	"passport_issue_date" date,
	"passport_expiry_date" date,
	"pax_type" "pax_type" DEFAULT 'adult' NOT NULL,
	"room_type" "room_type",
	"phone" varchar(30),
	"notes" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_price_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "price_line_kind" NOT NULL,
	"description" varchar(250) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_stage_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_by" uuid,
	"completed_by_name" varchar(150),
	"note" varchar(300),
	CONSTRAINT "booking_stage_progress_unique" UNIQUE("booking_id","stage_id")
);
--> statement-breakpoint
CREATE TABLE "booking_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vertical" "vertical" NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_status" "booking_status",
	"to_status" "booking_status" NOT NULL,
	"reason" text,
	"actor_type" "actor_type" NOT NULL,
	"changed_by" uuid,
	"changed_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(30),
	"agency_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"departure_id" uuid,
	"vertical" "vertical" NOT NULL,
	"package_code" varchar(20) NOT NULL,
	"package_name" varchar(200) NOT NULL,
	"departure_date" date,
	"return_date" date,
	"status" "booking_status" DEFAULT 'draft' NOT NULL,
	"is_quotation" boolean DEFAULT false NOT NULL,
	"requested_dates" varchar(200),
	"agent_notes" text,
	"agent_reference" varchar(60),
	"pax_count" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT 0 NOT NULL,
	"charges_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"quote_valid_until" date,
	"seats_held" integer DEFAULT 0 NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"seats_sold" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancellation_charge" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bookings_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "charge_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"vertical" "vertical",
	"charge_type" "adjustment_type" NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"basis" charge_basis DEFAULT 'per_booking' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "seat_hold_hours" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "passport_validity_months" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_addon_id_package_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."package_addons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_documents" ADD CONSTRAINT "booking_documents_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_documents" ADD CONSTRAINT "booking_documents_passenger_id_booking_passengers_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."booking_passengers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_documents" ADD CONSTRAINT "booking_documents_requirement_id_document_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."document_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_passengers" ADD CONSTRAINT "booking_passengers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_price_lines" ADD CONSTRAINT "booking_price_lines_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_stage_progress" ADD CONSTRAINT "booking_stage_progress_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_stage_progress" ADD CONSTRAINT "booking_stage_progress_stage_id_booking_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."booking_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_departure_id_package_departures_id_fk" FOREIGN KEY ("departure_id") REFERENCES "public"."package_departures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_documents_booking_idx" ON "booking_documents" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_messages_booking_idx" ON "booking_messages" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "booking_passengers_booking_idx" ON "booking_passengers" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_price_lines_booking_idx" ON "booking_price_lines" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_status_history_booking_idx" ON "booking_status_history" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "bookings_agency_idx" ON "bookings" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_departure_idx" ON "bookings" USING btree ("departure_id");