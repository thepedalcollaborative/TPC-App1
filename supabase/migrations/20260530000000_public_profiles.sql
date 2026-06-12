-- Public profile opt-in and read-only RPC.
--
-- Users choose to make their profile shareable via a toggle in settings.
-- The RPC is granted to `anon` so the web edge function can fetch it
-- without requiring authentication (non-users visiting a shared link).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_public_profile boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_public_profile(username)
-- Returns safe, public-facing data for a username whose owner has opted in.
-- Returns NULL if the user doesn't exist or hasn't made their profile public.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_profile(p_username text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_profile user_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile
  FROM user_profiles
  WHERE username = lower(trim(p_username))
    AND is_public_profile = true;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'display_name',  v_profile.display_name,
    'username',      v_profile.username,
    'member_since',  to_char(v_profile.created_at, 'Mon YYYY'),
    'tone_identity', v_profile.pedal_expert_profile->>'tone_identity',
    'genres',        v_profile.pedal_expert_profile->'genres',
    'playing_style', v_profile.pedal_expert_profile->>'playing_style',

    -- Owned pedal count
    'owned_count', (
      SELECT COUNT(*)
      FROM user_pedals
      WHERE user_id = v_profile.id AND status = 'owned'
    ),

    -- Up to 24 owned pedals (brand, model, category, image)
    'pedals', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'brand',     p.brand,
            'model',     p.model,
            'category',  COALESCE(up.category_override, p.category),
            'image_url', p.image_url
          )
          ORDER BY up.created_at DESC
        ),
        '[]'::json
      )
      FROM user_pedals up
      JOIN pedals p ON p.id = up.pedal_id
      WHERE up.user_id = v_profile.id
        AND up.status  = 'owned'
      LIMIT 24
    ),

    -- Board count
    'board_count', (
      SELECT COUNT(*)
      FROM boards
      WHERE user_id = v_profile.id
    )
  );
END;
$$;

-- Accessible to anonymous visitors (shared links) and authenticated users
GRANT EXECUTE ON FUNCTION public.get_public_profile(text) TO anon, authenticated;
