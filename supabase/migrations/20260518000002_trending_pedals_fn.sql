-- Returns the top pedals added to vault/wishlist in the last 7 days,
-- across all users who have not opted out of community trends.
-- SECURITY DEFINER so it can read across all user rows despite RLS.
-- Returns only aggregate data — no PII.

CREATE OR REPLACE FUNCTION public.get_trending_pedals(limit_count int DEFAULT 5)
RETURNS TABLE(
  pedal_id   uuid,
  brand      text,
  model      text,
  image_url  text,
  category   text,
  week_adds  bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    up.pedal_id,
    p.brand,
    p.model,
    p.image_url,
    p.category,
    COUNT(*) AS week_adds
  FROM user_pedals up
  JOIN pedals p ON p.id = up.pedal_id
  JOIN user_profiles prof ON prof.id = up.user_id
  WHERE up.status IN ('owned', 'wishlist')
    AND up.created_at >= NOW() - INTERVAL '7 days'
    AND prof.allow_activity_in_trends = true
  GROUP BY up.pedal_id, p.brand, p.model, p.image_url, p.category
  ORDER BY week_adds DESC
  LIMIT limit_count;
$$;

-- Allow authenticated users to call it
REVOKE ALL ON FUNCTION public.get_trending_pedals(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trending_pedals(int) TO authenticated;
