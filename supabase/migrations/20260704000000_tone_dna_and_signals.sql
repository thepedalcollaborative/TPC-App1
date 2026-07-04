-- ── tone_dna + TPC community signals ─────────────────────────────────────────
-- 1. tone_dna column on pedals — Claude-generated 2-3 sentence opinionated
--    description of what the pedal sounds like and who it's for.
--    Auto-populated during import; editable by admins.
-- 2. tpc_community_signals view — anonymized aggregate signals from user behavior.
--    Used by the tpc-advisor edge function to surface real demand data.
-- 3. admin_import_pedal updated to accept p_tone_dna.

-- ── 1) tone_dna column ──────────────────────────────────────────────────────
ALTER TABLE public.pedals
  ADD COLUMN IF NOT EXISTS tone_dna text;

-- ── 2) Community signals view ────────────────────────────────────────────────
-- Aggregates user_pedals counts per pedal. Only counts, never individual users.
-- The edge function applies a minimum threshold before surfacing any signal.
CREATE OR REPLACE VIEW public.tpc_community_signals AS
SELECT
  p.id          AS pedal_id,
  p.brand,
  p.model,
  p.category,
  COUNT(*) FILTER (
    WHERE up.status = 'owned'
      AND up.created_at > now() - interval '30 days'
  )::integer                                              AS recent_acquisitions,
  COUNT(*) FILTER (WHERE up.status = 'wishlist')::integer AS wishlist_count,
  COUNT(*) FILTER (WHERE up.status = 'owned')::integer    AS total_owners
FROM public.user_pedals up
JOIN public.pedals p ON p.id = up.pedal_id
GROUP BY p.id, p.brand, p.model, p.category;

-- ── 3) admin_import_pedal — add p_tone_dna ──────────────────────────────────
-- Drop current version and recreate with the new param.
-- All other params and logic are identical.
DROP FUNCTION IF EXISTS public.admin_import_pedal(
  text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, text, boolean, integer,
  numeric, integer, text, text, text, boolean
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
  p_tone_dna           text       DEFAULT NULL
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
    image_url, manual_url,
    dimensions, weight, power_requirements, mono_stereo,
    true_bypass, analog, in_production,
    midi, midi_notes, presets, preset_count,
    price_usd, release_year, product_url, manufacturer_sku,
    tone_dna, imported_at, imported_by
  ) VALUES (
    p_brand, p_model, p_category, p_subcategory, p_description,
    p_image_url, p_manual_url,
    p_dimensions, p_weight, p_power_requirements, p_mono_stereo,
    p_true_bypass, p_analog, p_in_production,
    p_midi, p_midi_notes, p_presets, p_preset_count,
    p_price_usd, p_release_year, p_product_url, p_manufacturer_sku,
    p_tone_dna, now(), v_user_id
  ) RETURNING id INTO v_new_id;

  INSERT INTO pedal_import_log (pedal_id, pedal_name, manufacturer, source_url, imported_by, status)
  VALUES (v_new_id, p_model, p_brand, p_source_url, v_user_id, 'success');

  RETURN json_build_object('success', true, 'id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_import_pedal TO authenticated;
