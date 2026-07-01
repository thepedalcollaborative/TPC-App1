-- Ensure user_pedals.condition is a plain nullable text column with no check
-- constraint. The column was created manually in Supabase Studio before
-- migrations were tracked; if a check constraint exists (e.g. from the old
-- Reverb slug taxonomy), it rejects values like 'Very Good' (our UI taxonomy).
ALTER TABLE public.user_pedals
  ADD COLUMN IF NOT EXISTS condition text;

-- Drop any check constraint on condition, regardless of its name.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_pedals'::regclass
      AND contype = 'c'
      AND conname ILIKE '%condition%'
  LOOP
    EXECUTE 'ALTER TABLE public.user_pedals DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;
