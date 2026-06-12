-- Advisor gate hardening (2026-06-07)
-- Closes the quota bypass where a modified client could call tpc-advisor
-- directly, skipping the check-and-gate-message pre-check.
--
-- New flow:
--   • tpc-advisor consumes consume_ai_message_quota itself for chat calls.
--   • Custom Shop calls carry a single-run "ticket" issued by custom-shop-gate
--     after it consumes the run quota. One ticket allows up to 8 advisor calls
--     (analysis + interview questions + final pick + retries) for 20 minutes.
--   • Memory summarization calls require is_premium (checked in tpc-advisor).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Ticket table — service role only
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.custom_shop_tickets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calls_remaining integer     NOT NULL DEFAULT 8,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '20 minutes'
);

ALTER TABLE public.custom_shop_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_shop_tickets_service_role_only" ON public.custom_shop_tickets;
CREATE POLICY "custom_shop_tickets_service_role_only"
  ON public.custom_shop_tickets
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_custom_shop_tickets_expires
  ON public.custom_shop_tickets (expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Create ticket — called by custom-shop-gate after run quota is consumed
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_custom_shop_ticket(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_id uuid;
BEGIN
  -- Opportunistic cleanup keeps the table tiny without a cron job
  DELETE FROM public.custom_shop_tickets WHERE expires_at < now();

  INSERT INTO public.custom_shop_tickets (user_id)
  VALUES (p_user_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$func$;

REVOKE ALL ON FUNCTION public.create_custom_shop_ticket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_custom_shop_ticket(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Consume one call from a ticket — called by tpc-advisor
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_custom_shop_ticket(
  p_ticket  uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  UPDATE public.custom_shop_tickets
    SET calls_remaining = calls_remaining - 1
  WHERE id = p_ticket
    AND user_id = p_user_id
    AND calls_remaining > 0
    AND expires_at > now();

  RETURN FOUND;
END;
$func$;

REVOKE ALL ON FUNCTION public.consume_custom_shop_ticket(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_custom_shop_ticket(uuid, uuid) TO service_role;
