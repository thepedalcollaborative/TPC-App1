-- Fix: admin_update_pedal referenced pedals.updated_at, which does not exist.
-- Used by TPC.ai to answer detailed questions about a specific pedal.


-- Extend admin_update_pedal to accept and save manual_text
CREATE OR REPLACE FUNCTION admin_update_pedal(
  p_pedal_id           uuid,
  p_brand              text,
  p_model              text,
  p_category           text,
  p_subcategory        text,
  p_description        text    DEFAULT NULL,
  p_analog             boolean DEFAULT NULL,
  p_in_production      boolean DEFAULT NULL,
  p_image_url          text    DEFAULT NULL,
  p_image_storage_path text    DEFAULT NULL,
  p_version_label      text    DEFAULT NULL,
  p_manual_url         text    DEFAULT NULL,
  p_manual_storage_path text   DEFAULT NULL,
  p_tone_dna           text    DEFAULT NULL,
  p_midi_manual_url    text    DEFAULT NULL,
  p_quick_start_url    text    DEFAULT NULL,
  p_dimensions         text    DEFAULT NULL,
  p_weight             text    DEFAULT NULL,
  p_power_requirements text    DEFAULT NULL,
  p_mono_stereo        text    DEFAULT NULL,
  p_true_bypass        boolean DEFAULT NULL,
  p_midi               boolean DEFAULT NULL,
  p_midi_notes         text    DEFAULT NULL,
  p_presets            boolean DEFAULT NULL,
  p_preset_count       int     DEFAULT NULL,
  p_price_usd          numeric DEFAULT NULL,
  p_release_year       int     DEFAULT NULL,
  p_manufacturer_sku   text    DEFAULT NULL,
  p_product_url        text    DEFAULT NULL,
  p_is_verified        boolean DEFAULT NULL,
  p_manual_text        text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT is_admin INTO v_is_admin FROM user_profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;

  UPDATE pedals SET
    brand              = p_brand,
    model              = p_model,
    category           = p_category,
    subcategory        = p_subcategory,
    description        = p_description,
    analog             = p_analog,
    in_production      = p_in_production,
    image_url          = p_image_url,
    image_storage_path = p_image_storage_path,
    version_label      = p_version_label,
    manual_url         = p_manual_url,
    manual_storage_path = p_manual_storage_path,
    tone_dna           = p_tone_dna,
    midi_manual_url    = p_midi_manual_url,
    quick_start_url    = p_quick_start_url,
    dimensions         = p_dimensions,
    weight             = p_weight,
    power_requirements = p_power_requirements,
    mono_stereo        = p_mono_stereo,
    true_bypass        = p_true_bypass,
    midi               = p_midi,
    midi_notes         = p_midi_notes,
    presets            = p_presets,
    preset_count       = p_preset_count,
    price_usd          = p_price_usd,
    release_year       = p_release_year,
    manufacturer_sku   = p_manufacturer_sku,
    product_url        = p_product_url,
    is_verified        = p_is_verified,
    manual_text        = p_manual_text
  WHERE id = p_pedal_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
