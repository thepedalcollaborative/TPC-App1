-- Returns a single JSON object with all vault stats for a user.
-- Called from the Profile screen. SECURITY DEFINER so it can aggregate
-- across user_pedals without the row-level security check per row.
--
-- ACCESS CONTROL: because this is SECURITY DEFINER and granted to the
-- `authenticated` role, it MUST verify the caller is requesting their OWN
-- stats. Without the auth.uid() guard, any logged-in user could read another
-- user's private vault data (total spent, most expensive pedal, brands, etc.)
-- simply by passing a different p_user_id — a horizontal-privilege (IDOR) bug.
-- This mirrors the guard used in consume_ai_message_quota / custom_shop gate.
CREATE OR REPLACE FUNCTION public.get_vault_stats(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- Caller may only read their own stats. service_role (auth.uid() IS NULL)
  -- is trusted server-side code and may pass any id.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden: cannot read another user''s vault stats'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
  SELECT json_build_object(

    -- Pedals owned more than once (any non-wishlist status)
    'repeat_offenders', (
      SELECT json_agg(json_build_object('brand', p.brand, 'model', p.model, 'times', sub.cnt) ORDER BY sub.cnt DESC)
      FROM (
        SELECT pedal_id, COUNT(*) AS cnt
        FROM user_pedals
        WHERE user_id = p_user_id AND status != 'wishlist'
        GROUP BY pedal_id
        HAVING COUNT(*) > 1
      ) sub
      JOIN pedals p ON p.id = sub.pedal_id
    ),

    -- Most expensive pedal ever purchased (by purchase_price)
    'most_expensive', (
      SELECT json_build_object('brand', p.brand, 'model', p.model, 'price', up.purchase_price)
      FROM user_pedals up
      JOIN pedals p ON p.id = up.pedal_id
      WHERE up.user_id = p_user_id
        AND up.status != 'wishlist'
        AND up.purchase_price IS NOT NULL
      ORDER BY up.purchase_price DESC
      LIMIT 1
    ),

    -- Biggest loss: (purchase_price − retired_price), only where bought > sold
    'biggest_loss', (
      SELECT json_build_object(
        'brand', p.brand,
        'model', p.model,
        'loss', up.purchase_price - up.retired_price
      )
      FROM user_pedals up
      JOIN pedals p ON p.id = up.pedal_id
      WHERE up.user_id = p_user_id
        AND up.purchase_price IS NOT NULL
        AND up.retired_price IS NOT NULL
        AND up.purchase_price > up.retired_price
      ORDER BY (up.purchase_price - up.retired_price) DESC
      LIMIT 1
    ),

    -- Quickest flip: shortest gap between acquired_date and retired_date
    'quickest_flip', (
      SELECT json_build_object(
        'brand', p.brand,
        'model', p.model,
        'days', (up.retired_date - up.acquired_date)
      )
      FROM user_pedals up
      JOIN pedals p ON p.id = up.pedal_id
      WHERE up.user_id = p_user_id
        AND up.acquired_date IS NOT NULL
        AND up.retired_date IS NOT NULL
        AND up.retired_date > up.acquired_date
      ORDER BY (up.retired_date - up.acquired_date) ASC
      LIMIT 1
    ),

    -- Longest in vault: currently owned, oldest acquired_date
    'longest_in_vault', (
      SELECT json_build_object(
        'brand', p.brand,
        'model', p.model,
        'days', (CURRENT_DATE - up.acquired_date::date)
      )
      FROM user_pedals up
      JOIN pedals p ON p.id = up.pedal_id
      WHERE up.user_id = p_user_id
        AND up.status = 'owned'
        AND up.acquired_date IS NOT NULL
      ORDER BY up.acquired_date ASC
      LIMIT 1
    ),

    -- Total spent on pedals (sum of all purchase_prices, non-wishlist)
    'total_spent', (
      SELECT COALESCE(SUM(purchase_price), 0)
      FROM user_pedals
      WHERE user_id = p_user_id
        AND status != 'wishlist'
        AND purchase_price IS NOT NULL
    ),

    -- Most common category in the current vault
    'category_obsession', (
      SELECT cat FROM (
        SELECT COALESCE(up.category_override, p.category) AS cat, COUNT(*) AS cnt
        FROM user_pedals up
        JOIN pedals p ON p.id = up.pedal_id
        WHERE up.user_id = p_user_id AND up.status = 'owned'
        GROUP BY 1
        ORDER BY cnt DESC
        LIMIT 1
      ) x
    ),

    -- Most owned brand in the current vault
    'brand_loyalty', (
      SELECT brand FROM (
        SELECT p.brand, COUNT(*) AS cnt
        FROM user_pedals up
        JOIN pedals p ON p.id = up.pedal_id
        WHERE up.user_id = p_user_id AND up.status = 'owned'
        GROUP BY p.brand
        ORDER BY cnt DESC
        LIMIT 1
      ) x
    ),

    -- All-time total pedals through their hands (non-wishlist)
    'total_through_hands', (
      SELECT COUNT(*)
      FROM user_pedals
      WHERE user_id = p_user_id AND status != 'wishlist'
    )

  )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vault_stats(uuid) TO authenticated;
