-- Add per-condition caching to pedal_market_data.
-- Previously market value was cached per pedal (all conditions pooled).
-- Now each (pedal_id, condition) pair gets its own row so a 'Good' pedal
-- isn't valued against 'Excellent' and 'Poor' listings.

alter table public.pedal_market_data
  add column if not exists condition text not null default 'used';

-- Drop the old single-column unique constraint so we can replace it
alter table public.pedal_market_data
  drop constraint if exists pedal_market_data_pedal_id_key;

-- New compound unique constraint used by the upsert
alter table public.pedal_market_data
  add constraint pedal_market_data_pedal_condition_key
  unique (pedal_id, condition);
