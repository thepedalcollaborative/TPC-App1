-- Create pedal_market_data table for caching Reverb market values
CREATE TABLE IF NOT EXISTS public.pedal_market_data (
  pedal_id      uuid PRIMARY KEY REFERENCES public.pedals(id) ON DELETE CASCADE,
  avg_used_list numeric,
  avg_used_sold numeric,
  market_value  numeric,
  sample_count  integer default 0,
  updated_at    timestamptz default now()
);

ALTER TABLE public.pedal_market_data ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pedal_market_data'
    AND policyname = 'Anyone can read market data'
  ) THEN
    CREATE POLICY "Anyone can read market data"
      ON public.pedal_market_data
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pedal_market_data'
    AND policyname = 'Service role can upsert market data'
  ) THEN
    CREATE POLICY "Service role can upsert market data"
      ON public.pedal_market_data
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
