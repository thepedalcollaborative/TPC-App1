-- Enable direct browser uploads from the admin web portal (tpc-web /admin).
-- Previously the only way to get an image into 'pedal-images' was the
-- pedal-image edge function running as service role. Admins now need to
-- drag-and-drop files straight from the browser using their own session,
-- which requires an RLS policy — plus RPC support for storing the resulting
-- storage path.

-- ── 1) Ensure pedal-images bucket is public (defensive — should already be) ─
INSERT INTO storage.buckets (id, name, public)
VALUES ('pedal-images', 'pedal-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ── 2) Admin-write storage policies for pedal-images ────────────────────────
DROP POLICY IF EXISTS "pedal_images_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "pedal_images_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "pedal_images_admin_delete" ON storage.objects;

CREATE POLICY "pedal_images_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pedal-images'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false)
  );

CREATE POLICY "pedal_images_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'pedal-images'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false)
  );

CREATE POLICY "pedal_images_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pedal-images'
    AND coalesce((SELECT is_admin FROM public.user_profiles WHERE id = auth.uid()), false)
  );

-- ── 3) Extend admin_add_pedal / admin_update_pedal with image_storage_path ──
-- The web portal knows the storage path immediately after upload (it wrote
-- the file itself) so it can pass it straight through instead of relying on
-- an edge function to re-derive it.
DROP FUNCTION IF EXISTS public.admin_add_pedal(
  text, text, text, text, text, boolean, boolean, text, text, text
);

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
    image_url, image_source, version_label, manual_url,
    image_storage_path, manual_storage_path
  )
  VALUES (
    p_brand, p_model, p_category, p_subcategory, p_description,
    p_analog, p_in_production, p_image_url,
    CASE WHEN p_image_url IS NOT NULL THEN 'manufacturer' ELSE NULL END,
    p_version_label, p_manual_url,
    p_image_storage_path, p_manual_storage_path
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('ok', true, 'id', new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_add_pedal(
  text, text, text, text, text, boolean, boolean, text, text, text, text, text
) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_update_pedal(
  uuid, text, text, text, text, text, boolean, boolean, text, text, text
);

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
    version_label        = p_version_label,
    manual_url           = p_manual_url,
    image_storage_path   = coalesce(p_image_storage_path, pedals.image_storage_path),
    manual_storage_path  = coalesce(p_manual_storage_path, pedals.manual_storage_path)
  WHERE id = p_pedal_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'pedal not found');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_pedal(
  uuid, text, text, text, text, text, boolean, boolean, text, text, text, text, text
) TO authenticated;
