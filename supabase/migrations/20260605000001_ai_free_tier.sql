-- AI free tier (2026-06-05)
-- Non-Pro users now get 3 lifetime free AI advisor messages before hitting the paywall.
-- Vault and board limits are removed — AI is the only gated feature.
--
-- Changes:
--   1) Add ai_free_messages_used column to user_profiles
--   2) Rewrite consume_ai_message_quota to handle free tier
--      (return type changes — must DROP and recreate)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Free messages counter column
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS ai_free_messages_used integer NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Rewrite consume_ai_message_quota
--    Return type gains free_used + free_allotment — must drop old version first.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.consume_ai_message_quota(uuid, integer);

CREATE FUNCTION public.consume_ai_message_quota(
  p_user_id    uuid,
  p_allotment  integer DEFAULT 50,
  p_free_allotment integer DEFAULT 3
)
RETURNS TABLE(
  allowed        boolean,
  error          text,
  used           integer,
  allotment      integer,
  used_credit    boolean,
  credits        integer,
  free_used      integer,
  free_allotment integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile   public.user_profiles%ROWTYPE;
  v_used      integer;
  v_credits   integer;
  v_reset_at  timestamptz;
  v_free_used integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY SELECT false, 'unauthorized'::text,
      NULL::integer, p_allotment, false, NULL::integer, NULL::integer, p_free_allotment;
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'profile_not_found'::text,
      NULL::integer, p_allotment, false, NULL::integer, NULL::integer, p_free_allotment;
    RETURN;
  END IF;

  -- ── Free tier (non-Pro) ────────────────────────────────────────────────────
  IF COALESCE(v_profile.is_premium, false) = false THEN
    v_free_used := COALESCE(v_profile.ai_free_messages_used, 0);

    IF v_free_used < p_free_allotment THEN
      v_free_used := v_free_used + 1;
      UPDATE public.user_profiles
        SET ai_free_messages_used = v_free_used
      WHERE id = p_user_id;

      RETURN QUERY SELECT true, NULL::text,
        NULL::integer, p_allotment, false, 0, v_free_used, p_free_allotment;
    ELSE
      -- Free trial exhausted → prompt upgrade
      RETURN QUERY SELECT false, 'pro_required'::text,
        NULL::integer, p_allotment, false, 0, v_free_used, p_free_allotment;
    END IF;
    RETURN;
  END IF;

  -- ── Pro tier ───────────────────────────────────────────────────────────────
  v_used    := COALESCE(v_profile.ai_messages_used, 0);
  v_credits := COALESCE(v_profile.ai_message_credits, 0);
  v_reset_at := v_profile.ai_allotment_reset_at;

  -- Lazy monthly reset
  IF v_reset_at IS NULL OR v_reset_at <= now() THEN
    v_used := 0;
    v_reset_at := now() + interval '30 days';
    UPDATE public.user_profiles
      SET ai_messages_used = 0, ai_allotment_reset_at = v_reset_at
    WHERE id = p_user_id;
  END IF;

  -- Spend monthly allotment first
  IF v_used < p_allotment THEN
    v_used := v_used + 1;
    UPDATE public.user_profiles SET ai_messages_used = v_used WHERE id = p_user_id;
    RETURN QUERY SELECT true, NULL::text, v_used, p_allotment, false, v_credits, NULL::integer, p_free_allotment;
    RETURN;
  END IF;

  -- Fall back to purchased credits
  IF v_credits > 0 THEN
    v_credits := v_credits - 1;
    UPDATE public.user_profiles SET ai_message_credits = v_credits WHERE id = p_user_id;
    RETURN QUERY SELECT true, NULL::text, NULL::integer, p_allotment, true, v_credits, NULL::integer, p_free_allotment;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'messages_depleted'::text,
    NULL::integer, p_allotment, false, 0, NULL::integer, p_free_allotment;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_message_quota(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_message_quota(uuid, integer, integer) TO authenticated;
