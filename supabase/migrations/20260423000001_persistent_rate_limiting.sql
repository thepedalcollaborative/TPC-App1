-- Persistent rate limiting (2026-04-23)
-- Replaces in-memory Maps in Edge Functions with a Postgres-backed sliding
-- window counter that survives cold starts and concurrent invocations.
--
-- Design:
--   rate_limit_windows(user_id, endpoint, window_start, request_count)
--   Atomic upsert increments the counter; check_rate_limit() returns true
--   when the request is within limit, false when it should be rejected (429).
--
-- Windows are per-endpoint and per-user, bucketed to the nearest N seconds.
-- An hourly cron prunes windows older than 2 hours to keep the table small.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_windows (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint      text        NOT NULL,
  window_start  timestamptz NOT NULL,
  request_count integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, endpoint, window_start)
);

-- Only service role can read/write this table directly.
ALTER TABLE public.rate_limit_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_limit_service_role_only" ON public.rate_limit_windows;
CREATE POLICY "rate_limit_service_role_only"
  ON public.rate_limit_windows
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Index for the hourly cleanup query.
CREATE INDEX IF NOT EXISTS idx_rate_limit_windows_start
  ON public.rate_limit_windows (window_start);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Atomic check-and-increment RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns TRUE  → request is within limit, proceed normally.
-- Returns FALSE → limit exceeded, return 429.
--
-- p_window_seconds: bucket size in seconds (default 60 → per-minute windows).
-- Called from Edge Functions using the service-role key so SECURITY DEFINER
-- is belt-and-suspenders; only the service role has table access anyway.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id        uuid,
  p_endpoint       text,
  p_limit          integer,
  p_window_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start  timestamptz;
  v_count         integer;
BEGIN
  -- Snap to the nearest window boundary (e.g. 60 s → current minute).
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  -- Atomically insert or increment — safe under concurrent calls.
  INSERT INTO public.rate_limit_windows (user_id, endpoint, window_start, request_count)
  VALUES (p_user_id, p_endpoint, v_window_start, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET request_count = rate_limit_windows.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- Only callable server-side (Edge Functions use service-role key).
REVOKE ALL ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Hourly cleanup cron — prune windows older than 2 hours
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'prune-rate-limit-windows',
  '0 * * * *',
  $$
    DELETE FROM public.rate_limit_windows
    WHERE window_start < now() - interval '2 hours';
  $$
);
