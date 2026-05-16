-- ─────────────────────────────────────────────────────────────────────────────
-- Nightly catalog image enrichment via pg_cron
-- Runs at 2 AM UTC every day.
-- Processes up to 40 pedals per run (no-image pedals first, ordered by gas_count
-- so the most-swiped pedals in GAS or Pass get images first).
--
-- Prerequisites:
--   1. Run migration 20260407000000_image_quality.sql first
--   2. Create a PUBLIC Supabase Storage bucket named "pedal-images"
--      (Supabase Dashboard → Storage → New bucket → Name: pedal-images → Public: ON)
--   3. Deploy edge functions: pedal-image, enrich-catalog
--   4. Set REVERB_TOKEN in Supabase Edge Function secrets
-- ─────────────────────────────────────────────────────────────────────────────

SELECT cron.schedule(
  'enrich-catalog-nightly',
  '0 2 * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/enrich-catalog',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_key'),
        'Content-Type',  'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Weekly upgrade pass: re-check 'reverb_listing' images for better alternatives.
-- Runs at 3 AM UTC every Sunday.
SELECT cron.schedule(
  'enrich-catalog-upgrade-weekly',
  '0 3 * * 0',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/enrich-catalog?upgrade=true',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_key'),
        'Content-Type',  'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
