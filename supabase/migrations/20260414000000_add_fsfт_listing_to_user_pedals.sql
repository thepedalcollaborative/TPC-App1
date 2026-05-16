-- Add For Sale / For Trade listing support to user_pedals.
-- listing_status: 'for_sale' | 'for_trade' | 'for_sale_or_trade' | NULL (not listed)
-- asking_price:   seller's asking price (NULL for trade-only listings)
-- trade_wants:    free text describing what the seller wants in return
--
-- All columns are nullable with no default — existing rows are unaffected.
-- No new RLS policies needed: existing user_id = auth.uid() policies cover these columns.

ALTER TABLE public.user_pedals
  ADD COLUMN IF NOT EXISTS listing_status text
    CHECK (listing_status IN ('for_sale', 'for_trade', 'for_sale_or_trade')),
  ADD COLUMN IF NOT EXISTS asking_price   numeric(10,2),
  ADD COLUMN IF NOT EXISTS trade_wants    text;

-- Fast lookup for the FS/FT tab (only non-null rows)
CREATE INDEX IF NOT EXISTS idx_user_pedals_listing_status
  ON public.user_pedals (user_id, listing_status)
  WHERE listing_status IS NOT NULL;
