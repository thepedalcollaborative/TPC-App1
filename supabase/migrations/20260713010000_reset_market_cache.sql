-- Clear cached market values so every pedal recalculates with the fixed
-- algorithm (median of a relevance-filtered sample instead of the mean of
-- the 20 cheapest listings — see market-value edge function).
DELETE FROM pedal_market_data;
