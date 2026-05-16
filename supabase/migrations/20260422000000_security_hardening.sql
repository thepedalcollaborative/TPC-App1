-- Security hardening (2026-04-22)
-- 1) Atomic AI advisor message gating
-- 2) Lock down Patreon token table from client reads

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Atomic quota + credit consumption
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_ai_message_quota(
  p_user_id uuid,
  p_allotment integer DEFAULT 50
)
RETURNS TABLE(
  allowed boolean,
  error text,
  used integer,
  allotment integer,
  used_credit boolean,
  credits integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
  v_used integer;
  v_credits integer;
  v_reset_at timestamptz;
BEGIN
  -- Caller must operate on their own user row.
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY SELECT false, 'unauthorized', NULL::integer, p_allotment, false, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'profile_not_found', NULL::integer, p_allotment, false, NULL::integer;
    RETURN;
  END IF;

  IF COALESCE(v_profile.is_premium, false) = false THEN
    RETURN QUERY SELECT false, 'pro_required', NULL::integer, p_allotment, false, COALESCE(v_profile.ai_message_credits, 0);
    RETURN;
  END IF;

  v_used := COALESCE(v_profile.ai_messages_used, 0);
  v_credits := COALESCE(v_profile.ai_message_credits, 0);
  v_reset_at := v_profile.ai_allotment_reset_at;

  -- Lazy monthly reset.
  IF v_reset_at IS NULL OR v_reset_at <= now() THEN
    v_used := 0;
    v_reset_at := now() + interval '30 days';
    UPDATE public.user_profiles
      SET ai_messages_used = 0,
          ai_allotment_reset_at = v_reset_at
    WHERE id = p_user_id;
  END IF;

  -- Spend monthly allotment first.
  IF v_used < p_allotment THEN
    v_used := v_used + 1;
    UPDATE public.user_profiles
      SET ai_messages_used = v_used
    WHERE id = p_user_id;

    RETURN QUERY SELECT true, NULL::text, v_used, p_allotment, false, v_credits;
    RETURN;
  END IF;

  -- Fall back to purchased credits.
  IF v_credits > 0 THEN
    v_credits := v_credits - 1;
    UPDATE public.user_profiles
      SET ai_message_credits = v_credits
    WHERE id = p_user_id;

    RETURN QUERY SELECT true, NULL::text, NULL::integer, p_allotment, true, v_credits;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'messages_depleted', NULL::integer, p_allotment, false, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_message_quota(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_message_quota(uuid, integer) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Patreon connections: remove client visibility of OAuth tokens
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.patreon_connections') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.patreon_connections ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "patreon_connections_select_own" ON public.patreon_connections;
  DROP POLICY IF EXISTS "patreon_connections_insert_own" ON public.patreon_connections;
  DROP POLICY IF EXISTS "patreon_connections_update_own" ON public.patreon_connections;
  DROP POLICY IF EXISTS "patreon_connections_delete_own" ON public.patreon_connections;

  CREATE POLICY "patreon_connections_service_role_all"
    ON public.patreon_connections
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END;
$$;
