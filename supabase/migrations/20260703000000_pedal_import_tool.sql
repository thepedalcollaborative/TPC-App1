-- ── Pedal Import Tool Schema ──────────────────────────────────────────────────
-- Adds extended metadata columns to pedals, creates the import log table,
-- and creates the admin_import_pedal RPC used by the web import tool.

-- 1. Extend the pedals table with new columns
ALTER TABLE public.pedals
  ADD COLUMN IF NOT EXISTS dimensions         text,
  ADD COLUMN IF NOT EXISTS weight             text,
  ADD COLUMN IF NOT EXISTS power_requirements text,
  ADD COLUMN IF NOT EXISTS mono_stereo        text CHECK (mono_stereo IN ('mono', 'stereo', 'mono_in_stereo_out')),
  ADD COLUMN IF NOT EXISTS midi               boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS midi_notes         text,
  ADD COLUMN IF NOT EXISTS presets            boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS preset_count       integer,
  ADD COLUMN IF NOT EXISTS price_usd          numeric(8, 2),
  ADD COLUMN IF NOT EXISTS release_year       integer,
  ADD COLUMN IF NOT EXISTS product_url        text UNIQUE,
  ADD COLUMN IF NOT EXISTS manufacturer_sku   text,
  ADD COLUMN IF NOT EXISTS imported_at        timestamptz,
  ADD COLUMN IF NOT EXISTS imported_by        uuid REFERENCES auth.users (id);

-- 2. Import log table
CREATE TABLE IF NOT EXISTS public.pedal_import_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedal_id     uuid REFERENCES public.pedals (id) ON DELETE SET NULL,
  pedal_name   text NOT NULL,
  manufacturer text NOT NULL,
  source_url   text,
  imported_by  uuid REFERENCES auth.users (id),
  imported_at  timestamptz DEFAULT now(),
  status       text DEFAULT 'success'
);

ALTER TABLE public.pedal_import_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_import_log" ON public.pedal_import_log;
CREATE POLICY "admin_select_import_log" ON public.pedal_import_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

DROP POLICY IF EXISTS "admin_insert_import_log" ON public.pedal_import_log;
CREATE POLICY "admin_insert_import_log" ON public.pedal_import_log
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- 3. admin_import_pedal RPC
--    SECURITY DEFINER so it can bypass the pedals SELECT-only RLS policy.
--    Returns JSON: { success, id } on insert, or { duplicate, existing_id, reason? } if duplicate detected and p_force=false.
CREATE OR REPLACE FUNCTION public.admin_import_pedal(
  p_brand             text,
  p_model             text,
  p_category          text,
  p_subcategory       text,
  p_description       text       DEFAULT NULL,
  p_image_url         text       DEFAULT NULL,
  p_manual_url        text       DEFAULT NULL,
  p_dimensions        text       DEFAULT NULL,
  p_weight            text       DEFAULT NULL,
  p_power_requirements text      DEFAULT NULL,
  p_mono_stereo       text       DEFAULT NULL,
  p_true_bypass       boolean    DEFAULT NULL,
  p_analog            boolean    DEFAULT false,
  p_in_production     boolean    DEFAULT true,
  p_midi              boolean    DEFAULT false,
  p_midi_notes        text       DEFAULT NULL,
  p_presets           boolean    DEFAULT false,
  p_preset_count      integer    DEFAULT NULL,
  p_price_usd         numeric    DEFAULT NULL,
  p_release_year      integer    DEFAULT NULL,
  p_product_url       text       DEFAULT NULL,
  p_manufacturer_sku  text       DEFAULT NULL,
  p_source_url        text       DEFAULT NULL,
  p_force             boolean    DEFAULT false
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
    -- Check by product_url
    IF p_product_url IS NOT NULL THEN
      SELECT id INTO v_existing_id FROM pedals WHERE product_url = p_product_url LIMIT 1;
      IF v_existing_id IS NOT NULL THEN
        v_reason := 'url_match';
      END IF;
    END IF;

    -- Check by brand + model if no URL match yet
    IF v_existing_id IS NULL THEN
      SELECT id INTO v_existing_id FROM pedals
      WHERE lower(trim(brand)) = lower(trim(p_brand))
        AND lower(trim(model)) = lower(trim(p_model))
      LIMIT 1;
      IF v_existing_id IS NOT NULL THEN
        v_reason := 'name_match';
      END IF;
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
    imported_at, imported_by
  ) VALUES (
    p_brand, p_model, p_category, p_subcategory, p_description,
    p_image_url, p_manual_url,
    p_dimensions, p_weight, p_power_requirements, p_mono_stereo,
    p_true_bypass, p_analog, p_in_production,
    p_midi, p_midi_notes, p_presets, p_preset_count,
    p_price_usd, p_release_year, p_product_url, p_manufacturer_sku,
    now(), v_user_id
  ) RETURNING id INTO v_new_id;

  INSERT INTO pedal_import_log (pedal_id, pedal_name, manufacturer, source_url, imported_by, status)
  VALUES (v_new_id, p_model, p_brand, p_source_url, v_user_id, 'success');

  RETURN json_build_object('success', true, 'id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_import_pedal TO authenticated;
