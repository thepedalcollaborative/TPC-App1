-- Stores recently-released / trending pedals harvested from Reverb.
-- The tpc-advisor edge function injects a compact snapshot of this table
-- into the system prompt so Claude has real-time awareness of new gear.

CREATE TABLE IF NOT EXISTS public.recent_pedals (
  id            TEXT        PRIMARY KEY,   -- brand|model slug
  brand         TEXT        NOT NULL,
  model         TEXT        NOT NULL,
  category      TEXT,
  avg_price     NUMERIC,
  listing_count INTEGER     NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recent_pedals ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write (queried server-side only)
CREATE POLICY "service_role_only" ON public.recent_pedals
  USING (auth.role() = 'service_role');

-- Nightly refresh via pg_cron → calls the refresh-pedal-feed edge function
SELECT cron.schedule(
  'refresh-pedal-feed-nightly',
  '0 3 * * *',   -- 3 AM UTC every day
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/refresh-pedal-feed',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
