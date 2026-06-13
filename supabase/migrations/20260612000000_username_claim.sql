-- Username claim / change RPC.
-- Validates format, enforces uniqueness, and updates the caller's own row.
-- Called by AccountSettingsScreen when a user sets or changes their username.

-- ── Unique constraint (safe to run multiple times) ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_username_key'
      AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_username_key UNIQUE (username);
  END IF;
END;
$$;

-- ── claim_username(p_username) ────────────────────────────────────────────────
-- Returns: { ok: true, username: "..." }
--       or { ok: false, error: "invalid" | "taken" | "unauthorized" }
CREATE OR REPLACE FUNCTION public.claim_username(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_user_id uuid := auth.uid();
  v_clean   text := lower(trim(p_username));
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 3–20 chars, lowercase letters / numbers / underscores only
  IF v_clean !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  -- Unique check (excluding self so users can "re-save" their own username)
  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE username = v_clean AND id <> v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'taken');
  END IF;

  UPDATE public.user_profiles
    SET username = v_clean
  WHERE id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'username', v_clean);
END;
$func$;

REVOKE ALL ON FUNCTION public.claim_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_username(text) TO authenticated;
