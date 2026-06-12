-- Expand the pedals.category CHECK constraint to include new granular categories.
-- Safely finds and drops the existing constraint by scanning pg_constraint,
-- then adds the updated one.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.pedals'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%category%'
  LOOP
    EXECUTE 'ALTER TABLE public.pedals DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE public.pedals
  ADD CONSTRAINT pedals_category_check
  CHECK (category IN (
    -- Original
    'drive','boost','compressor','eq','delay','reverb','modulation',
    'looper','pitch','utility','ambient','synth','other','multifx','modeler',
    -- Expanded
    'fuzz','distortion','chorus','phaser','flanger','tremolo',
    'wah','octave','volume','noisegate','buffer','preamp'
  ));
