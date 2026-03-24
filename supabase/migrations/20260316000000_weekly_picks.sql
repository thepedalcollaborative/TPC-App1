-- ─── weekly_picks ────────────────────────────────────────────────────────────
-- Stores one AI-generated pedal recommendation per user per ISO week.
-- The edge function checks this table before calling Claude — cache-first.
--
-- week_key format: "YYYY-WNN"  (e.g. "2026-W12")
-- Unique constraint on (user_id, week_key) prevents duplicate generation.

create table if not exists weekly_picks (
  id           uuid        default gen_random_uuid() primary key,
  user_id      uuid        not null references user_profiles(id) on delete cascade,
  brand        text        not null,
  model        text        not null,
  why          text        not null,
  category     text,
  week_key     text        not null,           -- "2026-W12"
  generated_at timestamptz default now() not null,

  unique (user_id, week_key)
);

-- Indexes
create index if not exists weekly_picks_user_week
  on weekly_picks (user_id, week_key desc);

-- RLS
alter table weekly_picks enable row level security;

create policy "Users can read their own weekly picks"
  on weekly_picks for select
  using (auth.uid() = user_id);

-- Service role (edge function) handles inserts — no RLS needed for insert.
-- The edge function verifies the user's Pro status via user_profiles before inserting.
