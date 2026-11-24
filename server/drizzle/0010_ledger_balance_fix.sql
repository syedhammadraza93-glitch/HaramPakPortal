-- The balance check is shared by journal_entries and journal_lines; read the entry id per table
-- (a CASE over NEW.id / NEW.entry_id fails because plpgsql resolves both record fields).
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_entry uuid;
  v_amount numeric;
  v_debit numeric;
  v_credit numeric;
  v_lines int;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    v_entry := NEW.id;
  ELSE
    v_entry := NEW.entry_id;
  END IF;
  SELECT amount INTO v_amount FROM journal_entries WHERE id = v_entry;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO v_debit, v_credit, v_lines
    FROM journal_lines WHERE entry_id = v_entry;
  IF v_lines < 2 OR v_debit <> v_credit OR v_debit <> v_amount THEN
    RAISE EXCEPTION 'Journal entry % does not balance (lines %, debit %, credit %, amount %)', v_entry, v_lines, v_debit, v_credit, v_amount
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$fn$;
