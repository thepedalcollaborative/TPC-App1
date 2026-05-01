-- Fix cron job created in 20260501000001 — use app.service_key to match existing convention
SELECT cron.unschedule('refresh-pedal-feed-nightly');

SELECT cron.schedule(
  'refresh-pedal-feed-nightly',
  '0 3 * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/refresh-pedal-feed',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_key'),
        'Content-Type',  'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
