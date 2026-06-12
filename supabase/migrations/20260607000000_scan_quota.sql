-- Pedal scan quota (2026-06-07)
-- Scan-to-add uses Claude vision (~$0.008/scan), so it's now gated like AI
-- messages: 5 lifetime free scans for non-Pro users, unlimited for Pro.
-- Enforced server-side inside the scan-pedal edge function.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS ai_free_scans_used integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.consume_scan_quota(
  p_user_id        uuid,
  p_free_allotment integer DEFAULT 5
)
RETURNS TABLE(
  allowed        boolean,
  error          text,
  free_used      integer,
  free_allotment integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
  v_used    integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY SELECT false, 'unauthorized'::text, NULL::integer, p_free_allotment;
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'profile_not_found'::text, NULL::integer, p_free_allotment;
    RETURN;
  END IF;

  -- Pro: unlimited, no counter
  IF COALESCE(v_profile.is_premium, false) THEN
    RETURN QUERY SELECT true, NULL::text, NULL::integer, p_free_allotment;
    RETURN;
  END IF;

  -- Free tier: lifetime allotment
  v_used := COALESCE(v_profile.ai_free_scans_used, 0);

  IF v_used < p_free_allotment THEN
    v_used := v_used + 1;
    UPDATE public.user_profiles SET ai_free_scans_used = v_used WHERE id = p_user_id;
    RETURN QUERY SELECT true, NULL::text, v_used, p_free_allotment;
  ELSE
    RETURN QUERY SELECT false, 'pro_required'::text, v_used, p_free_allotment;
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION public.consume_scan_quota(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_scan_quota(uuid, integer) TO authenticated;
