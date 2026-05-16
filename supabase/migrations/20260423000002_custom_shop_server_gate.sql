-- Server-side Custom Shop gate (2026-04-23)
-- Moves the free-tier Custom Shop run limit from AsyncStorage (tamper-able)
-- to a server-enforced Postgres counter.
--
-- Free users get 1 lifetime Custom Shop run.
-- Pro users are always allowed (unlimited).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Column
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS custom_shop_runs integer NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Atomic gate + increment RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns:
--   allowed=true, runs_used=N  → proceed; isFirstRun when runs_used=1
--   allowed=false, error='limit_reached' → show paywall
--   allowed=false, error='unauthorized'  → bad JWT
--
-- FOR UPDATE prevents concurrent double-dip on the free run.

CREATE OR REPLACE FUNCTION public.consume_custom_shop_run(p_user_id uuid)
RETURNS TABLE(allowed boolean, error text, runs_used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
BEGIN
  -- Caller must be acting on their own row.
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY SELECT false, 'unauthorized', NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'profile_not_found', NULL::integer;
    RETURN;
  END IF;

  -- Pro users: always allowed, no counter needed.
  IF COALESCE(v_profile.is_premium, false) = true THEN
    RETURN QUERY SELECT true, NULL::text, COALESCE(v_profile.custom_shop_runs, 0);
    RETURN;
  END IF;

  -- Free users: 1 lifetime run.
  IF COALESCE(v_profile.custom_shop_runs, 0) >= 1 THEN
    RETURN QUERY SELECT false, 'limit_reached', COALESCE(v_profile.custom_shop_runs, 0);
    RETURN;
  END IF;

  -- Consume the free run atomically.
  UPDATE public.user_profiles
    SET custom_shop_runs = COALESCE(custom_shop_runs, 0) + 1
  WHERE id = p_user_id;

  RETURN QUERY SELECT true, NULL::text, 1;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_custom_shop_run(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_custom_shop_run(uuid) TO authenticated;
