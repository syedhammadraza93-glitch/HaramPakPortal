ALTER TABLE "hotels" ADD COLUMN "indicative_nightly_sar" numeric(12, 2);
--> statement-breakpoint
UPDATE hotels
SET name = substr(name, length('TEST · ') + 1),
    indicative_nightly_sar = substring(notes from '^TEST DATA · SAR ([0-9]+[.]?[0-9]*)')::numeric,
    notes = 'Indicative nightly rate. Confirm with the supplier before booking. ' || substring(notes from 'Published hotel reference:.*$'),
    is_active = true,
    updated_at = now()
WHERE name LIKE 'TEST · %'
  AND notes ~ '^TEST DATA · SAR [0-9]+[.]?[0-9]* per room per night [(]assumed[)].*Published hotel reference:';
