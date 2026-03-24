-- Advisor memory: stores a rolling plain-text summary of what the AI has
-- learned about each player across sessions (tone preferences, gear discussed,
-- rejections, rig details, etc.)
-- One row per user, upserted after each Advisor session.

create table if not exists advisor_memory (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  summary    text        not null default '',
  updated_at timestamptz not null default now(),
  unique(user_id)
);

alter table advisor_memory enable row level security;

create policy "Users can manage their own memory"
  on advisor_memory
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
