-- Login rate limiting (2026-06-05)
-- Tracks failed sign-in attempts per email address with a sliding window.
-- After 5 failures in 15 minutes the auth-login Edge Function returns 429.
-- Keyed by email (not user_id) because the caller is not yet authenticated.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id           bigserial   PRIMARY KEY,
  email        text        NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  succeeded    boolean     NOT NULL DEFAULT false
);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Only service_role (Edge Functions) can touch this table.
DROP POLICY IF EXISTS "login_attempts_service_role_only" ON public.login_attempts;
CREATE POLICY "login_attempts_service_role_only"
  ON public.login_attempts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time
  ON public.login_attempts (email, attempted_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Check RPC — returns TRUE (allowed) or FALSE (rate-limited)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_login_rate_limit(
  p_email          text,
  p_window_seconds integer DEFAULT 900,  -- 15 minutes
  p_max_failures   integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_failures integer;
BEGIN
  SELECT COUNT(*) INTO v_recent_failures
  FROM public.login_attempts
  WHERE email = lower(p_email)
    AND succeeded = false
    AND attempted_at > now() - (p_window_seconds || ' seconds')::interval;

  RETURN v_recent_failures < p_max_failures;
END;
$$;

REVOKE ALL ON FUNCTION public.check_login_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_login_rate_limit(text, integer, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Record RPC — called after every attempt
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_login_attempt(
  p_email   text,
  p_success boolean
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.login_attempts (email, succeeded)
  VALUES (lower(p_email), p_success);
$$;

REVOKE ALL ON FUNCTION public.record_login_attempt(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_attempt(text, boolean) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Hourly cleanup — keep the table small
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'prune-login-attempts',
  '30 * * * *',
  $$DELETE FROM public.login_attempts WHERE attempted_at < now() - interval '24 hours';$$
);
