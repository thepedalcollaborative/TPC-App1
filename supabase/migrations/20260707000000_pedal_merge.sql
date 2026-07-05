-- Pedal merge: soft-delete duplicate entries while preserving all user references.
-- merged_into tracks which canonical pedal absorbed this one.

ALTER TABLE public.pedals
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.pedals(id);

-- Exclude merged pedals from normal catalog queries via a simple convention —
-- callers filter WHERE merged_into IS NULL. The RPC below handles re-pointing refs.

CREATE OR REPLACE FUNCTION public.admin_merge_pedals(
  p_source_id uuid,   -- duplicate to absorb + soft-delete
  p_target_id uuid    -- canonical pedal to keep
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src_cw record;
  v_tgt_cw_id uuid;
BEGIN
  IF NOT coalesce((SELECT is_admin FROM user_profiles WHERE id = auth.uid()), false) THEN
    RETURN json_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF p_source_id = p_target_id THEN
    RETURN json_build_object('ok', false, 'error', 'source and target must differ');
  END IF;

  -- 1. Migrate colorways: for each source colorway, find or create a matching
  --    colorway on the target (match by name, case-insensitive), then re-point
  --    any user_pedals that reference the source colorway.
  FOR v_src_cw IN
    SELECT * FROM pedal_colorways WHERE pedal_id = p_source_id
  LOOP
    -- Try to find an existing colorway on the target with the same name
    SELECT id INTO v_tgt_cw_id
    FROM pedal_colorways
    WHERE pedal_id = p_target_id
      AND lower(trim(name)) = lower(trim(v_src_cw.name))
    LIMIT 1;

    -- If no match, insert a copy on the target
    IF v_tgt_cw_id IS NULL THEN
      INSERT INTO pedal_colorways (
        pedal_id, name, image_url, color_hex, is_default,
        limited_edition, edition_size, year_released, notes
      ) VALUES (
        p_target_id, v_src_cw.name, v_src_cw.image_url, v_src_cw.color_hex,
        false, -- don't override target's default
        v_src_cw.limited_edition, v_src_cw.edition_size, v_src_cw.year_released, v_src_cw.notes
      ) RETURNING id INTO v_tgt_cw_id;
    END IF;

    -- Re-point user_pedals that referenced the source colorway
    UPDATE user_pedals
    SET colorway_id = v_tgt_cw_id
    WHERE colorway_id = v_src_cw.id;
  END LOOP;

  -- 2. Re-point all user_pedals from source → target
  UPDATE user_pedals
  SET pedal_id = p_target_id
  WHERE pedal_id = p_source_id;

  -- 3. Migrate any photos that don't already exist on the target
  UPDATE pedal_photos
  SET pedal_id = p_target_id,
      position = position + (SELECT coalesce(max(position) + 1, 0) FROM pedal_photos WHERE pedal_id = p_target_id)
  WHERE pedal_id = p_source_id;

  -- 4. Soft-delete the source by marking merged_into
  UPDATE pedals
  SET merged_into = p_target_id
  WHERE id = p_source_id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_merge_pedals TO authenticated;
