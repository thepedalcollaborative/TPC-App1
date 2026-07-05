-- Approve a pending user-submitted colorway
CREATE OR REPLACE FUNCTION public.admin_approve_colorway(
  p_colorway_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT coalesce((SELECT is_admin FROM user_profiles WHERE id = auth.uid()), false) THEN
    RETURN json_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  UPDATE pedal_colorways
  SET is_pending = false, duplicate_of = null
  WHERE id = p_colorway_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'colorway not found');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_colorway TO authenticated;
