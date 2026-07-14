-- Multi-source valuation: store per-source values alongside the blend so the
-- app can show provenance ("based on N sales") and we can tune weights later.
ALTER TABLE pedal_market_data
  ADD COLUMN IF NOT EXISTS guide_value     int,
  ADD COLUMN IF NOT EXISTS tpc_sales_value int,
  ADD COLUMN IF NOT EXISTS tpc_sales_count int DEFAULT 0;
