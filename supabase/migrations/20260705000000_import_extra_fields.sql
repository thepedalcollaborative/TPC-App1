-- ── Import extra fields: MIDI manual, quick start guide, colorway details ─────
-- 1. New URL columns on pedals: midi_manual_url, quick_start_url
-- 2. New columns on pedal_colorways: limited_edition, edition_size
-- 3. Updated admin_import_pedal RPC accepting midi_manual_url, quick_start_url,
--    and a p_colorways jsonb array that inserts into pedal_colorways atomically.

-- ── 1) pedals new columns ────────────────────────────────────────────────────
ALTER TABLE public.pedals
  ADD COLUMN IF NOT EXISTS midi_manual_url  text,
  ADD COLUMN IF NOT EXISTS quick_start_url  text;

-- ── 2) pedal_colorways new columns ──────────────────────────────────────────
ALTER TABLE public.pedal_colorways
  ADD COLUMN IF NOT EXISTS limited_edition  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edition_size     integer;

-- ── 3) admin_import_pedal — add midi_manual_url, quick_start_url, colorways ─
DROP FUNCTION IF EXISTS public.admin_import_pedal(
  text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, text, boolean, integer,
  numeric, integer, text, text, text, boolean, text
);

CREATE OR REPLACE FUNCTION public.admin_import_pedal(
  p_brand              text,
  p_model              text,
  p_category           text,
  p_subcategory        text,
  p_description        text       DEFAULT NULL,
  p_image_url          text       DEFAULT NULL,
  p_manual_url         text       DEFAULT NULL,
  p_dimensions         text       DEFAULT NULL,
  p_weight             text       DEFAULT NULL,
  p_power_requirements text       DEFAULT NULL,
  p_mono_stereo        text       DEFAULT NULL,
  p_true_bypass        boolean    DEFAULT NULL,
  p_analog             boolean    DEFAULT false,
  p_in_production      boolean    DEFAULT true,
  p_midi               boolean    DEFAULT false,
  p_midi_notes         text       DEFAULT NULL,
  p_presets            boolean    DEFAULT false,
  p_preset_count       integer    DEFAULT NULL,
  p_price_usd          numeric    DEFAULT NULL,
  p_release_year       integer    DEFAULT NULL,
  p_product_url        text       DEFAULT NULL,
  p_manufacturer_sku   text       DEFAULT NULL,
  p_source_url         text       DEFAULT NULL,
  p_force              boolean    DEFAULT false,
  p_tone_dna           text       DEFAULT NULL,
  p_midi_manual_url    text       DEFAULT NULL,
  p_quick_start_url    text       DEFAULT NULL,
  p_colorways          jsonb      DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_new_id      uuid;
  v_existing_id uuid;
  v_reason      text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = v_user_id AND is_admin = true) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT p_force THEN
    IF p_product_url IS NOT NULL THEN
      SELECT id INTO v_existing_id FROM pedals WHERE product_url = p_product_url LIMIT 1;
      IF v_existing_id IS NOT NULL THEN v_reason := 'url_match'; END IF;
    END IF;

    IF v_existing_id IS NULL THEN
      SELECT id INTO v_existing_id FROM pedals
      WHERE lower(trim(brand)) = lower(trim(p_brand))
        AND lower(trim(model)) = lower(trim(p_model))
      LIMIT 1;
      IF v_existing_id IS NOT NULL THEN v_reason := 'name_match'; END IF;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      RETURN json_build_object('duplicate', true, 'existing_id', v_existing_id, 'reason', v_reason);
    END IF;
  END IF;

  INSERT INTO pedals (
    brand, model, category, subcategory, description,
    image_url, manual_url, midi_manual_url, quick_start_url,
    dimensions, weight, power_requirements, mono_stereo,
    true_bypass, analog, in_production,
    midi, midi_notes, presets, preset_count,
    price_usd, release_year, product_url, manufacturer_sku,
    tone_dna, imported_at, imported_by
  ) VALUES (
    p_brand, p_model, p_category, p_subcategory, p_description,
    p_image_url, p_manual_url, p_midi_manual_url, p_quick_start_url,
    p_dimensions, p_weight, p_power_requirements, p_mono_stereo,
    p_true_bypass, p_analog, p_in_production,
    p_midi, p_midi_notes, p_presets, p_preset_count,
    p_price_usd, p_release_year, p_product_url, p_manufacturer_sku,
    p_tone_dna, now(), v_user_id
  ) RETURNING id INTO v_new_id;

  -- Insert colorways atomically with the pedal
  IF p_colorways IS NOT NULL AND jsonb_array_length(p_colorways) > 0 THEN
    INSERT INTO pedal_colorways (
      pedal_id, name, image_url, color_hex,
      is_default, limited_edition, edition_size, year_released, notes
    )
    SELECT
      v_new_id,
      trim(cw->>'name'),
      nullif(trim(cw->>'image_url'), ''),
      nullif(trim(cw->>'color_hex'), ''),
      coalesce((cw->>'is_default')::boolean, false),
      coalesce((cw->>'limited_edition')::boolean, false),
      CASE WHEN cw->>'edition_size' ~ '^\d+$' THEN (cw->>'edition_size')::integer ELSE NULL END,
      CASE WHEN cw->>'year_released' ~ '^\d+$' THEN (cw->>'year_released')::integer ELSE NULL END,
      nullif(trim(cw->>'notes'), '')
    FROM jsonb_array_elements(p_colorways) AS cw
    WHERE trim(coalesce(cw->>'name', '')) != '';
  END IF;

  INSERT INTO pedal_import_log (pedal_id, pedal_name, manufacturer, source_url, imported_by, status)
  VALUES (v_new_id, p_model, p_brand, p_source_url, v_user_id, 'success');

  RETURN json_build_object('success', true, 'id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_import_pedal TO authenticated;
