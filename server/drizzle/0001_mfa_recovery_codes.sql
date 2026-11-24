ALTER TABLE "users" ADD COLUMN "mfa_recovery_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_last_step" integer;