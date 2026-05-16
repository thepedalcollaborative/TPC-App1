-- Lock client access to privilege, entitlement, and quota columns.
--
-- RLS controls which rows a user can update. Column privileges control which
-- fields are safe for the mobile app to update inside its own row. Without this,
-- a modified client can grant itself admin/pro or reset AI usage counters.

DO $$
DECLARE
  locked_columns text[] := ARRAY[
    'is_admin',
    'is_premium',
    'pro_source',
    'ai_messages_used',
    'ai_allotment_reset_at',
    'ai_message_credits'
  ];
  col text;
BEGIN
  IF to_regclass('public.user_profiles') IS NULL THEN
    RETURN;
  END IF;

  FOREACH col IN ARRAY locked_columns LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_profiles'
        AND column_name = col
    ) THEN
      EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.user_profiles FROM anon', col);
      EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.user_profiles FROM authenticated', col);
    END IF;
  END LOOP;
END;
$$;

-- Existing self-update RLS remains for safe profile fields such as display_name,
-- push_token, and pedal_expert_profile. Trusted server-side code runs with the
-- service_role key and can still update the locked columns.
