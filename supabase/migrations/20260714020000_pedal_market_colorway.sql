-- Add per-condition caching (guard — may already exist from 20260624 migration).
ALTER TABLE public.pedal_market_data
  ADD COLUMN IF NOT EXISTS condition text NOT NULL DEFAULT 'used';

-- Add colorway_id so limited editions and colorway variants get their own
-- cached valuation row, separate from the base pedal.
ALTER TABLE public.pedal_market_data
  ADD COLUMN IF NOT EXISTS colorway_id uuid REFERENCES public.pedal_colorways(id) ON DELETE SET NULL;

-- Replace the old single-column unique constraints with a functional unique index
-- that treats NULL colorway_id as '' so (pedal_id, condition, no-colorway) is unique.
ALTER TABLE public.pedal_market_data
  DROP CONSTRAINT IF EXISTS pedal_market_data_pedal_condition_key;

ALTER TABLE public.pedal_market_data
  DROP CONSTRAINT IF EXISTS pedal_market_data_pedal_id_condition_key;

DROP INDEX IF EXISTS public.pedal_market_data_base_uniq;
DROP INDEX IF EXISTS public.pedal_market_data_colorway_uniq;

CREATE UNIQUE INDEX pedal_market_data_unique_idx
  ON public.pedal_market_data (pedal_id, condition, COALESCE(colorway_id::text, ''));
