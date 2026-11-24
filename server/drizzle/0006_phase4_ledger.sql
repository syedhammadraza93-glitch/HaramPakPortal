CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."credit_policy" AS ENUM('warn', 'block');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('booking_charge', 'payment', 'credit_note', 'additional_charge', 'credit_adjustment', 'refund_payout', 'opening_balance', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."finance_request_kind" AS ENUM('opening_balance', 'additional_charge', 'credit_adjustment', 'credit_note', 'refund_payout', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."finance_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'cash_deposit', 'cheque', 'cash', 'online', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'clarification', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_terms" AS ENUM('advance', 'credit');--> statement-breakpoint
CREATE TABLE "accounting_periods" (
	"month" varchar(7) PRIMARY KEY NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_by_name" varchar(150)
);
--> statement-breakpoint
CREATE TABLE "booking_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"supplier_id" uuid,
	"description" varchar(200) NOT NULL,
	"estimated_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"actual_amount" numeric(14, 2),
	"supplier_reference" varchar(100),
	"is_paid" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(30) NOT NULL,
	"kind" "finance_request_kind" NOT NULL,
	"agency_id" uuid,
	"booking_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"agency_owes" boolean DEFAULT true NOT NULL,
	"account_id" uuid,
	"reversal_of_entry_id" uuid,
	"entry_date" date,
	"reason" text NOT NULL,
	"status" "finance_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"requested_by_name" varchar(150) NOT NULL,
	"reviewed_by" uuid,
	"reviewed_by_name" varchar(150),
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_requests_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_number" varchar(30) NOT NULL,
	"entry_date" date NOT NULL,
	"type" "entry_type" NOT NULL,
	"description" varchar(300) NOT NULL,
	"agency_id" uuid,
	"booking_id" uuid,
	"payment_id" uuid,
	"request_id" uuid,
	"reversal_of_id" uuid,
	"currency" varchar(3) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_by" uuid,
	"created_by_name" varchar(150),
	"approved_by" uuid,
	"approved_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_entry_number_unique" UNIQUE("entry_number")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"agency_id" uuid,
	"debit" numeric(14, 2) DEFAULT 0 NOT NULL,
	"credit" numeric(14, 2) DEFAULT 0 NOT NULL,
	"description" varchar(300)
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" "account_type" NOT NULL,
	"system_key" varchar(40),
	"is_bank" boolean DEFAULT false NOT NULL,
	"bank_details" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_code_unique" UNIQUE("code"),
	CONSTRAINT "ledger_accounts_system_key_unique" UNIQUE("system_key")
);
--> statement-breakpoint
CREATE TABLE "payment_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"file_name" varchar(150) NOT NULL,
	"mime_type" varchar(50) NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(30) NOT NULL,
	"agency_id" uuid NOT NULL,
	"booking_id" uuid,
	"method" "payment_method" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"paid_on" date NOT NULL,
	"bank_account_id" uuid,
	"transaction_ref" varchar(100),
	"notes" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"submitted_by" uuid,
	"submitted_by_name" varchar(150),
	"submitted_by_type" varchar(10) NOT NULL,
	"reviewed_by" uuid,
	"reviewed_by_name" varchar(150),
	"reviewed_at" timestamp with time zone,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"category" varchar(60),
	"contact_name" varchar(100),
	"phone" varchar(50),
	"email" varchar(255),
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "payment_terms" "payment_terms" DEFAULT 'advance' NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "credit_limit" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "credit_policy" "credit_policy" DEFAULT 'block' NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "payment_terms_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_costs" ADD CONSTRAINT "booking_costs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_costs" ADD CONSTRAINT "booking_costs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_requests" ADD CONSTRAINT "finance_requests_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_requests" ADD CONSTRAINT "finance_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_requests" ADD CONSTRAINT "finance_requests_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attachments" ADD CONSTRAINT "payment_attachments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_ledger_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_costs_booking_idx" ON "booking_costs" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "finance_requests_status_idx" ON "finance_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "finance_requests_agency_idx" ON "finance_requests" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "journal_entries_agency_idx" ON "journal_entries" USING btree ("agency_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_booking_idx" ON "journal_entries" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "journal_entries_reversal_idx" ON "journal_entries" USING btree ("reversal_of_id");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_agency_idx" ON "journal_lines" USING btree ("agency_id","account_id");--> statement-breakpoint
CREATE INDEX "payments_agency_idx" ON "payments" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");