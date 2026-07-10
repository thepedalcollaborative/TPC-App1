-- Catalog expansion: version label, manuals, multiple product photos.
-- Goal: build out a self-hosted pedal catalog (name, mfg, version, description,
-- product photos, manual) so the app hits Reverb less often. Entries are still
-- filled in manually via the Admin Console for now — no bulk importer yet.

-- ── 1) New columns on pedals ────────────────────────────────────────────────
-- version_label covers hardware revisions (DS-1X), firmware versions, and any
-- other "which variant is this" text admins want to record. Cosmetic/limited
-- edition variants continue to live in pedal_colorways — this is not a
-- replacement for that.
ALTER TABLE public.pedals
  ADD COLUMN IF NOT EXISTS version_label        text,
  ADD COLUMN IF NOT EXISTS manual_url           text,
  ADD COLUMN IF NOT EXISTS manual_storage_path  text;

-- ── 2) Multiple product photos per pedal ────────────────────────────────────
-- pedals.image_url/image_storage_path remains the single "primary" photo used
-- throughout the app; pedal_photos holds the full gallery for the detail view.
CREATE TABLE IF NOT EXISTS public.pedal_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedal_id      uuid NOT NULL REFERENCES public.pedals(id) ON DELETE CASCADE,
  url           text NOT NULL,
  storage_path  text,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedal_photos_pedal_id ON public.pedal_photos (pedal_id, position);

ALTER TABLE public.pedal_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedal_photos_public_read" ON public.pedal_photos;
CREATE POLICY "pedal_photos_public_read"
  ON public.pedal_photos FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "pedal_photos_admin_write" ON public.pedal_photos;
CREATE POLICY "pedal_photos_admin_write"
  ON public.pedal_photos FOR ALL
  USING (coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false))
  WITH CHECK (coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false));

-- ── 3) pedal-manuals storage bucket ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('pedal-manuals', 'pedal-manuals', true)
ON CONFLICT (id) DO UPDATE SET public = excluded.public;

DROP POLICY IF EXISTS "pedal_manuals_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "pedal_manuals_admin_insert"  ON storage.objects;
DROP POLICY IF EXISTS "pedal_manuals_admin_update"  ON storage.objects;
DROP POLICY IF EXISTS "pedal_manuals_admin_delete"  ON storage.objects;

CREATE POLICY "pedal_manuals_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'pedal-manuals');

CREATE POLICY "pedal_manuals_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pedal-manuals'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false)
  );

CREATE POLICY "pedal_manuals_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'pedal-manuals'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false)
  );

CREATE POLICY "pedal_manuals_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pedal-manuals'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false)
  );

-- ── 4) admin_add_pedal — extend with version_label / manual_url ────────────
DROP FUNCTION IF EXISTS public.admin_add_pedal(text, text, text, text, text, boolean, boolean, text);

CREATE OR REPLACE FUNCTION public.admin_add_pedal(
  p_brand         text,
  p_model         text,
  p_category      text,
  p_subcategory   text,
  p_description   text    DEFAULT NULL,
  p_analog        boolean DEFAULT false,
  p_in_production boolean DEFAULT true,
  p_image_url     text    DEFAULT NULL,
  p_version_label text    DEFAULT NULL,
  p_manual_url    text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT coalesce((SELECT is_admin FROM user_profiles WHERE id = auth.uid()), false) THEN
    RETURN json_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  INSERT INTO pedals (
    brand, model, category, subcategory, description, analog, in_production,
    image_url, image_source, version_label, manual_url
  )
  VALUES (
    p_brand, p_model, p_category, p_subcategory, p_description,
    p_analog, p_in_production, p_image_url,
    CASE WHEN p_image_url IS NOT NULL THEN 'manufacturer' ELSE NULL END,
    p_version_label, p_manual_url
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('ok', true, 'id', new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_add_pedal(
  text, text, text, text, text, boolean, boolean, text, text, text
) TO authenticated;

-- ── 5) admin_update_pedal — new. The Admin Console previously ran a direct
-- client-side `.update()` against pedals, which has no RLS UPDATE policy
-- (pedals only grants public SELECT) — so catalog edits were silently
-- rejected. This RPC replaces that call.
CREATE OR REPLACE FUNCTION public.admin_update_pedal(
  p_pedal_id      uuid,
  p_brand         text,
  p_model         text,
  p_category      text,
  p_subcategory   text,
  p_description   text    DEFAULT NULL,
  p_analog        boolean DEFAULT false,
  p_in_production boolean DEFAULT true,
  p_image_url     text    DEFAULT NULL,
  p_version_label text    DEFAULT NULL,
  p_manual_url    text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT coalesce((SELECT is_admin FROM user_profiles WHERE id = auth.uid()), false) THEN
    RETURN json_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  UPDATE pedals SET
    brand          = p_brand,
    model          = p_model,
    category       = p_category,
    subcategory    = p_subcategory,
    description    = p_description,
    analog         = p_analog,
    in_production  = p_in_production,
    image_url      = p_image_url,
    image_source   = CASE WHEN p_image_url IS NOT NULL THEN 'manufacturer' ELSE NULL END,
    version_label  = p_version_label,
    manual_url     = p_manual_url
  WHERE id = p_pedal_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'pedal not found');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_pedal(
  uuid, text, text, text, text, text, boolean, boolean, text, text, text
) TO authenticated;
