-- AI message gating: per-user allotment tracking
-- Used by the check-and-gate-message edge function.
--
-- ai_messages_used:       count of Pro allotment messages used this month (resets monthly)
-- ai_message_credits:     purchased top-up credits — never expire, never reset
-- ai_allotment_reset_at:  next allotment reset date; set on first message & subscription renewal
--
-- Lazy reset: check-and-gate-message resets ai_messages_used when reset_at is null or in the past.
-- Eager reset: revenuecat-webhook resets ai_messages_used on every RENEWAL event.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS ai_messages_used      integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_message_credits    integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_allotment_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS pro_source            text;         -- 'apple' | 'stripe' | 'patreon' | NULL
