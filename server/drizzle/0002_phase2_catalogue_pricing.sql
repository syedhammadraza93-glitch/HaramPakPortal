CREATE TYPE "public"."booking_mode" AS ENUM('fixed_departure', 'on_request');--> statement-breakpoint
CREATE TYPE "public"."charge_basis" AS ENUM('per_person', 'per_booking');--> statement-breakpoint
CREATE TYPE "public"."departure_status" AS ENUM('open', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."package_status" AS ENUM('draft', 'published', 'unpublished', 'archived');--> statement-breakpoint
CREATE TYPE "public"."pax_type" AS ENUM('adult', 'child_with_bed', 'child_no_bed', 'infant');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('sharing', 'quad', 'triple', 'double', 'single');--> statement-breakpoint
CREATE TYPE "public"."vertical" AS ENUM('umrah', 'hajj', 'tourism');--> statement-breakpoint
CREATE TYPE "public"."adjustment_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" varchar(80) NOT NULL,
	"city" varchar(80) NOT NULL,
	"verticals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destinations_country_city_unique" UNIQUE("country","city")
);
--> statement-breakpoint
CREATE TABLE "document_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vertical" "vertical" NOT NULL,
	"package_id" uuid,
	"name" varchar(150) NOT NULL,
	"description" text,
	"is_required" boolean DEFAULT true NOT NULL,
	"applies_to" varchar(30) DEFAULT 'all' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"destination_id" uuid NOT NULL,
	"star_rating" integer,
	"distance_to_haram_m" integer,
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"price" numeric(12, 2) NOT NULL,
	"basis" charge_basis DEFAULT 'per_person' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_departures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"departure_date" date NOT NULL,
	"return_date" date,
	"booking_deadline" date,
	"capacity" integer,
	"seats_held" integer DEFAULT 0 NOT NULL,
	"seats_sold" integer DEFAULT 0 NOT NULL,
	"status" "departure_status" DEFAULT 'open' NOT NULL,
	"notes" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_hotels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"hotel_id" uuid NOT NULL,
	"nights" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "package_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"file_name" varchar(150) NOT NULL,
	"mime_type" varchar(50) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_images_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "package_itinerary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"title" varchar(150) NOT NULL,
	"description" text,
	"city" varchar(80)
);
--> statement-breakpoint
CREATE TABLE "package_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"departure_id" uuid,
	"room_type" "room_type" NOT NULL,
	"pax_type" "pax_type" NOT NULL,
	"base_price" numeric(12, 2) NOT NULL,
	"retail_price" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_rates_unique" UNIQUE NULLS NOT DISTINCT("package_id","departure_id","room_type","pax_type")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"vertical" "vertical" NOT NULL,
	"name" varchar(200) NOT NULL,
	"category" varchar(80),
	"status" "package_status" DEFAULT 'draft' NOT NULL,
	"booking_mode" "booking_mode" DEFAULT 'fixed_departure' NOT NULL,
	"summary" varchar(300),
	"description" text,
	"duration_days" integer,
	"duration_nights" integer,
	"destination_id" uuid,
	"season_year" integer,
	"visa_included" boolean DEFAULT false NOT NULL,
	"air_ticket_included" boolean DEFAULT false NOT NULL,
	"transport_included" boolean DEFAULT false NOT NULL,
	"ziyarat_included" boolean DEFAULT false NOT NULL,
	"meal_plan" varchar(80),
	"hotel_category" varchar(50),
	"min_pax" integer DEFAULT 1 NOT NULL,
	"max_group_size" integer,
	"inclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cancellation_policy_id" uuid,
	"currency" varchar(3) DEFAULT 'PKR' NOT NULL,
	"brochure_key" varchar(300),
	"brochure_name" varchar(150),
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "packages_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"rate_id" uuid,
	"agency_id" uuid,
	"description" varchar(200) NOT NULL,
	"old_value" numeric(12, 2),
	"new_value" numeric(12, 2),
	"changed_by" uuid,
	"changed_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agency_rate_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"rate_id" uuid NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"note" varchar(200),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_rate_overrides_unique" UNIQUE("agency_id","rate_id")
);
--> statement-breakpoint
CREATE TABLE "cancellation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_slabs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"days_before" integer NOT NULL,
	"charge_type" "adjustment_type" NOT NULL,
	"charge_value" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"adjustment_type" "adjustment_type" DEFAULT 'percent' NOT NULL,
	"adjustment_value" numeric(12, 2) DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_groups_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "visa_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"category" varchar(80) NOT NULL,
	"visa_fee" numeric(12, 2) NOT NULL,
	"service_fee" numeric(12, 2) DEFAULT 0 NOT NULL,
	"other_charges" numeric(12, 2) DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'PKR' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "pricing_group_id" uuid;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "agent_category" varchar(50);--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_addons" ADD CONSTRAINT "package_addons_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_departures" ADD CONSTRAINT "package_departures_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_hotels" ADD CONSTRAINT "package_hotels_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_hotels" ADD CONSTRAINT "package_hotels_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_images" ADD CONSTRAINT "package_images_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_itinerary" ADD CONSTRAINT "package_itinerary_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_rates" ADD CONSTRAINT "package_rates_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_rates" ADD CONSTRAINT "package_rates_departure_id_package_departures_id_fk" FOREIGN KEY ("departure_id") REFERENCES "public"."package_departures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_cancellation_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("cancellation_policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_rate_overrides" ADD CONSTRAINT "agency_rate_overrides_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_rate_overrides" ADD CONSTRAINT "agency_rate_overrides_rate_id_package_rates_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."package_rates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_slabs" ADD CONSTRAINT "cancellation_slabs_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hotels_destination_idx" ON "hotels" USING btree ("destination_id");--> statement-breakpoint
CREATE INDEX "package_addons_package_idx" ON "package_addons" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_departures_package_date_idx" ON "package_departures" USING btree ("package_id","departure_date");--> statement-breakpoint
CREATE INDEX "package_hotels_package_idx" ON "package_hotels" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_images_package_idx" ON "package_images" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_itinerary_package_idx" ON "package_itinerary" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_rates_package_idx" ON "package_rates" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "packages_vertical_status_idx" ON "packages" USING btree ("vertical","status");--> statement-breakpoint
CREATE INDEX "price_history_package_idx" ON "price_history" USING btree ("package_id","created_at");--> statement-breakpoint
CREATE INDEX "agency_rate_overrides_rate_idx" ON "agency_rate_overrides" USING btree ("rate_id");--> statement-breakpoint
CREATE INDEX "cancellation_slabs_policy_idx" ON "cancellation_slabs" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "visa_rates_effective_idx" ON "visa_rates" USING btree ("effective_from");--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_pricing_group_id_pricing_groups_id_fk" FOREIGN KEY ("pricing_group_id") REFERENCES "public"."pricing_groups"("id") ON DELETE set null ON UPDATE no action;