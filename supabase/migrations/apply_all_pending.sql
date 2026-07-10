-- ═══════════════════════════════════════════════════════════════════════════
-- TPC: Combined migration — apply all three pending migrations in one paste.
-- Run this in the Supabase SQL Editor (supabase.com → your project → SQL).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / IF EXISTS guards.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PART 1 (20260701): Catalog expansion — version label, manuals, gallery ──

ALTER TABLE public.pedals
  ADD COLUMN IF NOT EXISTS version_label       text,
  ADD COLUMN IF NOT EXISTS manual_url          text,
  ADD COLUMN IF NOT EXISTS manual_storage_path text;

CREATE TABLE IF NOT EXISTS public.pedal_photos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedal_id     uuid        NOT NULL REFERENCES public.pedals(id) ON DELETE CASCADE,
  url          text        NOT NULL,
  storage_path text,
  position     integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedal_photos_pedal_id ON public.pedal_photos (pedal_id, position);

ALTER TABLE public.pedal_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedal_photos_public_read"  ON public.pedal_photos;
DROP POLICY IF EXISTS "pedal_photos_admin_write"  ON public.pedal_photos;

CREATE POLICY "pedal_photos_public_read"  ON public.pedal_photos FOR SELECT USING (true);
CREATE POLICY "pedal_photos_admin_write"  ON public.pedal_photos FOR ALL
  USING      (coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false))
  WITH CHECK (coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false));

INSERT INTO storage.buckets (id, name, public)
VALUES ('pedal-manuals', 'pedal-manuals', true)
ON CONFLICT (id) DO UPDATE SET public = excluded.public;

DROP POLICY IF EXISTS "pedal_manuals_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "pedal_manuals_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "pedal_manuals_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "pedal_manuals_admin_delete" ON storage.objects;

CREATE POLICY "pedal_manuals_public_read"  ON storage.objects FOR SELECT
  USING (bucket_id = 'pedal-manuals');
CREATE POLICY "pedal_manuals_admin_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pedal-manuals'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false));
CREATE POLICY "pedal_manuals_admin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pedal-manuals'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false));
CREATE POLICY "pedal_manuals_admin_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pedal-manuals'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false));

-- ── PART 2 (20260702): Admin browser uploads for pedal-images ───────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('pedal-images', 'pedal-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "pedal_images_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "pedal_images_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "pedal_images_admin_delete" ON storage.objects;

CREATE POLICY "pedal_images_admin_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pedal-images'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false));
CREATE POLICY "pedal_images_admin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pedal-images'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false));
CREATE POLICY "pedal_images_admin_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pedal-images'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false));

-- ── PART 2+3: Final admin_add_pedal (12 params, includes storage paths) ─────

DROP FUNCTION IF EXISTS public.admin_add_pedal(text,text,text,text,text,boolean,boolean,text);
DROP FUNCTION IF EXISTS public.admin_add_pedal(text,text,text,text,text,boolean,boolean,text,text,text);
DROP FUNCTION IF EXISTS public.admin_add_pedal(text,text,text,text,text,boolean,boolean,text,text,text,text,text);

CREATE OR REPLACE FUNCTION public.admin_add_pedal(
  p_brand               text,
  p_model               text,
  p_category            text,
  p_subcategory         text,
  p_description         text    DEFAULT NULL,
  p_analog              boolean DEFAULT false,
  p_in_production       boolean DEFAULT true,
  p_image_url           text    DEFAULT NULL,
  p_version_label       text    DEFAULT NULL,
  p_manual_url          text    DEFAULT NULL,
  p_image_storage_path  text    DEFAULT NULL,
  p_manual_storage_path text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT coalesce((SELECT is_admin FROM user_profiles WHERE id = auth.uid()), false) THEN
    RETURN json_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  INSERT INTO pedals (
    brand, model, category, subcategory, description, analog, in_production,
    image_url, image_source, version_label, manual_url, image_storage_path, manual_storage_path
  ) VALUES (
    p_brand, p_model, p_category, p_subcategory, p_description,
    p_analog, p_in_production, p_image_url,
    CASE WHEN p_image_url IS NOT NULL THEN 'manufacturer' ELSE NULL END,
    p_version_label, p_manual_url, p_image_storage_path, p_manual_storage_path
  ) RETURNING id INTO new_id;
  RETURN json_build_object('ok', true, 'id', new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_add_pedal(
  text,text,text,text,text,boolean,boolean,text,text,text,text,text
) TO authenticated;

-- ── PART 2+3: Final admin_update_pedal (13 params, includes storage paths) ──

DROP FUNCTION IF EXISTS public.admin_update_pedal(uuid,text,text,text,text,text,boolean,boolean,text,text,text);
DROP FUNCTION IF EXISTS public.admin_update_pedal(uuid,text,text,text,text,text,boolean,boolean,text,text,text,text,text);

CREATE OR REPLACE FUNCTION public.admin_update_pedal(
  p_pedal_id            uuid,
  p_brand               text,
  p_model               text,
  p_category            text,
  p_subcategory         text,
  p_description         text    DEFAULT NULL,
  p_analog              boolean DEFAULT false,
  p_in_production       boolean DEFAULT true,
  p_image_url           text    DEFAULT NULL,
  p_version_label       text    DEFAULT NULL,
  p_manual_url          text    DEFAULT NULL,
  p_image_storage_path  text    DEFAULT NULL,
  p_manual_storage_path text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT coalesce((SELECT is_admin FROM user_profiles WHERE id = auth.uid()), false) THEN
    RETURN json_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  UPDATE pedals SET
    brand               = p_brand,
    model               = p_model,
    category            = p_category,
    subcategory         = p_subcategory,
    description         = p_description,
    analog              = p_analog,
    in_production       = p_in_production,
    image_url           = p_image_url,
    image_source        = CASE WHEN p_image_url IS NOT NULL THEN 'manufacturer' ELSE NULL END,
    version_label       = p_version_label,
    manual_url          = p_manual_url,
    image_storage_path  = coalesce(p_image_storage_path, pedals.image_storage_path),
    manual_storage_path = coalesce(p_manual_storage_path, pedals.manual_storage_path)
  WHERE id = p_pedal_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'pedal not found');
  END IF;
  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_pedal(
  uuid,text,text,text,text,text,boolean,boolean,text,text,text,text,text
) TO authenticated;

-- ── PART 3 (20260703): Import tool — new columns, log table, import RPC ──────

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
  ADD COLUMN IF NOT EXISTS imported_by        uuid REFERENCES auth.users(id);

CREATE TABLE IF NOT EXISTS public.pedal_import_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedal_id     uuid        REFERENCES public.pedals(id) ON DELETE SET NULL,
  pedal_name   text        NOT NULL,
  manufacturer text        NOT NULL,
  source_url   text,
  imported_by  uuid        REFERENCES auth.users(id),
  imported_at  timestamptz DEFAULT now(),
  status       text        DEFAULT 'success'
);

ALTER TABLE public.pedal_import_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_import_log" ON public.pedal_import_log;
DROP POLICY IF EXISTS "admin_insert_import_log" ON public.pedal_import_log;

CREATE POLICY "admin_select_import_log" ON public.pedal_import_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "admin_insert_import_log" ON public.pedal_import_log FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_admin = true));

CREATE OR REPLACE FUNCTION public.admin_import_pedal(
  p_brand              text,
  p_model              text,
  p_category           text,
  p_subcategory        text,
  p_description        text    DEFAULT NULL,
  p_image_url          text    DEFAULT NULL,
  p_manual_url         text    DEFAULT NULL,
  p_dimensions         text    DEFAULT NULL,
  p_weight             text    DEFAULT NULL,
  p_power_requirements text    DEFAULT NULL,
  p_mono_stereo        text    DEFAULT NULL,
  p_true_bypass        boolean DEFAULT NULL,
  p_analog             boolean DEFAULT false,
  p_in_production      boolean DEFAULT true,
  p_midi               boolean DEFAULT false,
  p_midi_notes         text    DEFAULT NULL,
  p_presets            boolean DEFAULT false,
  p_preset_count       integer DEFAULT NULL,
  p_price_usd          numeric DEFAULT NULL,
  p_release_year       integer DEFAULT NULL,
  p_product_url        text    DEFAULT NULL,
  p_manufacturer_sku   text    DEFAULT NULL,
  p_source_url         text    DEFAULT NULL,
  p_force              boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
