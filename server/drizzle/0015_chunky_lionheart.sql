ALTER TABLE "hotels" ADD COLUMN "area" varchar(120);--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "road" varchar(120);--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "location_aliases" varchar(400);--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "distance_reference" varchar(150);--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "distance_verified_on" date;--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "shuttle_available" boolean;