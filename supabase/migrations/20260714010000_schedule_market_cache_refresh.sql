-- Enable extensions needed for scheduled HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA net;

-- Refresh stale market values for all active pedals twice a day (3am + 3pm UTC).
-- The job calls the refresh-market-cache edge function which handles its own
-- deduplication and rate limiting — safe to run on a tight schedule.
SELECT cron.schedule(
  'refresh-market-cache',
  '0 3,15 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://skejiotfywhmnvsivfsk.supabase.co/functions/v1/refresh-market-cache',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "tpc-market-cron-a3f7b291"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
