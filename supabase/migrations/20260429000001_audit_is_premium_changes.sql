-- Audit trigger: log every change to is_premium so we can identify the source.
--
-- Every time is_premium is written (to any value), a row is inserted into
-- is_premium_audit with:
--   - old / new values
--   - session_user + current_user (identifies the Postgres role)
--   - application_name (often "supabase-edge-runtime", "gotrue", etc.)
--   - client addr / port (identifies the network source)
--   - backend pid (ties to Postgres logs)
--
-- Query to see recent writes:
--   SELECT * FROM public.is_premium_audit ORDER BY changed_at DESC LIMIT 50;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Audit table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.is_premium_audit (
  id              bigserial    PRIMARY KEY,
  user_id         uuid         NOT NULL,
  old_value       boolean,
  new_value       boolean,
  session_user_pg text,          -- postgres role making the call
  current_user_pg text,          -- effective role (SECURITY DEFINER functions change this)
  application_nm  text,          -- e.g. "supabase-edge-runtime", "gotrue"
  client_addr     inet,
  client_port     integer,
  backend_pid     integer,
  changed_at      timestamptz  NOT NULL DEFAULT now()
);

-- Only service_role can read this table (prevents users from reading audit log).
ALTER TABLE public.is_premium_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "is_premium_audit_service_only" ON public.is_premium_audit;
CREATE POLICY "is_premium_audit_service_only"
  ON public.is_premium_audit
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Trigger function
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_is_premium_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fire on any is_premium change (including same-to-same, to catch all writes).
  INSERT INTO public.is_premium_audit (
    user_id,
    old_value,
    new_value,
    session_user_pg,
    current_user_pg,
    application_nm,
    client_addr,
    client_port,
    backend_pid
  ) VALUES (
    NEW.id,
    OLD.is_premium,
    NEW.is_premium,
    session_user::text,
    current_user::text,
    current_setting('application_name', true),
    inet_client_addr(),
    inet_client_port(),
    pg_backend_pid()
  );
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Attach trigger to user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_is_premium ON public.user_profiles;
CREATE TRIGGER trg_audit_is_premium
  AFTER UPDATE OF is_premium ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_is_premium_change();
