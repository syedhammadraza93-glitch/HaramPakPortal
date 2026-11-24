CREATE TABLE "otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"code" varchar(6) NOT NULL,
	"purpose" varchar(50) NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "otps" ADD CONSTRAINT "otps_email_users_email_fk" FOREIGN KEY ("email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "otps_email_idx" ON "otps" USING btree ("email");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "mfa_secret";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "mfa_recovery_codes";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "mfa_last_step";