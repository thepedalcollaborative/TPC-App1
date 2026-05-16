-- Aggregate vault/gas counts for a pedal across ALL users.
-- SECURITY DEFINER bypasses RLS so the count reflects the full community,
-- not just the calling user's own rows (which is all RLS would allow).
-- The function is intentionally read-only and returns only two aggregate
-- numbers — no PII is exposed.

CREATE OR REPLACE FUNCTION public.get_pedal_social_counts(p_pedal_id uuid)
RETURNS TABLE(vault_count bigint, gas_count bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE status = 'owned')    AS vault_count,
    COUNT(*) FILTER (WHERE status = 'wishlist') AS gas_count
  FROM public.user_pedals
  WHERE pedal_id = p_pedal_id;
$$;

-- Allow any authenticated or anonymous caller to invoke it.
REVOKE ALL ON FUNCTION public.get_pedal_social_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pedal_social_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pedal_social_counts(uuid) TO anon;
