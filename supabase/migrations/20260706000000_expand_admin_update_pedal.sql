-- Expand admin_update_pedal to cover all fields added by the import tool.
-- Also adds admin_upsert_colorway and admin_delete_colorway for the catalog editor.

-- ── Drop all overloads of admin_update_pedal ─────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM pg_proc
    WHERE proname = 'admin_update_pedal'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_pedal(
  p_pedal_id           uuid,
  p_brand              text,
  p_model              text,
  p_category           text,
  p_subcategory        text,
  p_description        text       DEFAULT NULL,
  p_analog             boolean    DEFAULT false,
  p_in_production      boolean    DEFAULT true,
  p_image_url          text       DEFAULT NULL,
  p_image_storage_path text       DEFAULT NULL,
  p_version_label      text       DEFAULT NULL,
  p_manual_url         text       DEFAULT NULL,
  p_manual_storage_path text      DEFAULT NULL,
  p_tone_dna           text       DEFAULT NULL,
  p_midi_manual_url    text       DEFAULT NULL,
  p_quick_start_url    text       DEFAULT NULL,
  p_dimensions         text       DEFAULT NULL,
  p_weight             text       DEFAULT NULL,
  p_power_requirements text       DEFAULT NULL,
  p_mono_stereo        text       DEFAULT NULL,
  p_true_bypass        boolean    DEFAULT NULL,
  p_midi               boolean    DEFAULT false,
  p_midi_notes         text       DEFAULT NULL,
  p_presets            boolean    DEFAULT false,
  p_preset_count       integer    DEFAULT NULL,
  p_price_usd          numeric    DEFAULT NULL,
  p_release_year       integer    DEFAULT NULL,
  p_manufacturer_sku   text       DEFAULT NULL,
  p_product_url        text       DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT coalesce((SELECT is_admin FROM user_profiles WHERE id = auth.uid()), false) THEN
    RETURN json_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  UPDATE pedals SET
    brand                = p_brand,
    model                = p_model,
    category             = p_category,
    subcategory          = p_subcategory,
    description          = p_description,
    analog               = p_analog,
    in_production        = p_in_production,
    image_url            = p_image_url,
    image_source         = CASE WHEN p_image_url IS NOT NULL THEN 'manufacturer' ELSE NULL END,
    image_storage_path   = p_image_storage_path,
    version_label        = p_version_label,
    manual_url           = p_manual_url,
    manual_storage_path  = p_manual_storage_path,
    tone_dna             = p_tone_dna,
    midi_manual_url      = p_midi_manual_url,
    quick_start_url      = p_quick_start_url,
    dimensions           = p_dimensions,
    weight               = p_weight,
    power_requirements   = p_power_requirements,
    mono_stereo          = p_mono_stereo,
    true_bypass          = p_true_bypass,
    midi                 = p_midi,
    midi_notes           = p_midi_notes,
    presets              = p_presets,
    preset_count         = p_preset_count,
    price_usd            = p_price_usd,
    release_year         = p_release_year,
    manufacturer_sku     = p_manufacturer_sku,
    product_url          = p_product_url
  WHERE id = p_pedal_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'pedal not found');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_pedal TO authenticated;

-- ── admin_upsert_colorway ─────────────────────────────────────────────────────
-- Pass p_colorway_id = NULL to INSERT, or an existing UUID to UPDATE.

CREATE OR REPLACE FUNCTION public.admin_upsert_colorway(
  p_pedal_id       uuid,
  p_colorway_id    uuid       DEFAULT NULL,
  p_name           text       DEFAULT NULL,
  p_image_url      text       DEFAULT NULL,
  p_color_hex      text       DEFAULT NULL,
  p_is_default     boolean    DEFAULT false,
  p_limited_edition boolean   DEFAULT false,
  p_edition_size   integer    DEFAULT NULL,
  p_year_released  integer    DEFAULT NULL,
  p_notes          text       DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT coalesce((SELECT is_admin FROM user_profiles WHERE id = auth.uid()), false) THEN
    RETURN json_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF p_colorway_id IS NULL THEN
    INSERT INTO pedal_colorways (
      pedal_id, name, image_url, color_hex, is_default,
      limited_edition, edition_size, year_released, notes
    ) VALUES (
      p_pedal_id, p_name, nullif(trim(coalesce(p_image_url,'')), ''),
      nullif(trim(coalesce(p_color_hex,'')), ''), p_is_default,
      p_limited_edition, p_edition_size, p_year_released,
      nullif(trim(coalesce(p_notes,'')), '')
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE pedal_colorways SET
      name            = p_name,
      image_url       = nullif(trim(coalesce(p_image_url,'')), ''),
      color_hex       = nullif(trim(coalesce(p_color_hex,'')), ''),
      is_default      = p_is_default,
      limited_edition = p_limited_edition,
      edition_size    = p_edition_size,
      year_released   = p_year_released,
      notes           = nullif(trim(coalesce(p_notes,'')), '')
    WHERE id = p_colorway_id AND pedal_id = p_pedal_id;
    v_id := p_colorway_id;
  END IF;

  RETURN json_build_object('ok', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_colorway TO authenticated;

-- ── admin_delete_colorway ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_delete_colorway(
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

  DELETE FROM pedal_colorways WHERE id = p_colorway_id;
  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_colorway TO authenticated;
