-- Add unique constraint on signal_type so the weekly upsert works cleanly.
ALTER TABLE public.community_signals_cache
  DROP CONSTRAINT IF EXISTS community_signals_cache_signal_type_key;
ALTER TABLE public.community_signals_cache
  ADD CONSTRAINT community_signals_cache_signal_type_key UNIQUE (signal_type);

-- Schedule the community-digest function every Monday at 9am UTC.
-- pg_cron must be enabled on the project (Dashboard → Extensions → pg_cron).
SELECT cron.schedule(
  'community-digest-weekly',
  '0 9 * * 1',
  $$
    SELECT net.http_post(
      url       := current_setting('app.supabase_url', true) || '/functions/v1/community-digest',
      headers   := jsonb_build_object(
        'Content-Type',   'application/json',
        'x-supabase-cron', '1',
        'Authorization',  'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body      := '{}'::jsonb
    );
  $$
);
