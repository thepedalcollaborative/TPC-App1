-- Add is_verified flag to pedals.
-- Admins mark a pedal verified once its data has been reviewed and confirmed accurate.

ALTER TABLE public.pedals
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;

-- Drop and recreate admin_update_pedal to include p_is_verified
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
  p_product_url        text       DEFAULT NULL,
  p_is_verified        boolean    DEFAULT NULL
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
    product_url          = p_product_url,
    is_verified          = COALESCE(p_is_verified, is_verified)
  WHERE id = p_pedal_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'pedal not found');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_pedal TO authenticated;
