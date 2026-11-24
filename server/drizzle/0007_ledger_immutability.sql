-- Ledger integrity is enforced by the database, not only by the application.
-- 1. Posted journal rows can never be updated. Deleting is refused too, except inside a transaction that sets
--    `app.ledger_purge = 'on'` (used only by automated test cleanup; a person with that level of DB access could drop
--    the trigger anyway).
-- 2. Every journal entry must balance (total debit = total credit = entry amount) with at least two lines.
-- 3. Entries cannot be dated in a closed month.

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amounts_chk"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_amount_chk" CHECK ("amount" > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION ledger_block_changes() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.ledger_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Ledger entries cannot be changed or deleted. Post a reversal or an adjustment instead.'
    USING ERRCODE = 'P0001';
END;
$fn$;--> statement-breakpoint

CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_block_changes();--> statement-breakpoint
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION ledger_block_changes();--> statement-breakpoint
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_block_changes();--> statement-breakpoint
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_block_changes();--> statement-breakpoint

CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_entry uuid := CASE WHEN TG_TABLE_NAME = 'journal_entries' THEN NEW.id ELSE NEW.entry_id END;
  v_amount numeric;
  v_debit numeric;
  v_credit numeric;
  v_lines int;
BEGIN
  SELECT amount INTO v_amount FROM journal_entries WHERE id = v_entry;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO v_debit, v_credit, v_lines
    FROM journal_lines WHERE entry_id = v_entry;
  IF v_lines < 2 OR v_debit <> v_credit OR v_debit <> v_amount THEN
    RAISE EXCEPTION 'Journal entry % does not balance (lines %, debit %, credit %, amount %)', v_entry, v_lines, v_debit, v_credit, v_amount
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$fn$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();--> statement-breakpoint

CREATE OR REPLACE FUNCTION ledger_check_open_period() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting_periods WHERE month = to_char(NEW.entry_date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'The month % is closed. Date the entry in an open month.', to_char(NEW.entry_date, 'YYYY-MM')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint

CREATE TRIGGER journal_entries_open_period BEFORE INSERT ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_check_open_period();
