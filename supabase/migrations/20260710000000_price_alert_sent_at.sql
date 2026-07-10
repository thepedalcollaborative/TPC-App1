-- price-alerts edge function: 24h cooldown tracker.
-- Set each time a price-drop push is sent for a wishlist item so the cron
-- (every 6h) doesn't re-alert the same item within ALERT_COOLDOWN_H.

ALTER TABLE public.user_pedals
  ADD COLUMN IF NOT EXISTS price_alert_sent_at timestamptz;
