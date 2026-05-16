-- Auth/Profile + Storage hardening
-- Ensures:
-- 1) user_profiles row is auto-created for every auth.users signup
-- 2) user-pedal-photos bucket exists
-- 3) RLS policies allow each user to manage only their own photos

-- ── 1) Auto-create user_profiles rows ────────────────────────────────────────
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill any existing auth users missing a profile row.
insert into public.user_profiles (id)
select u.id
from auth.users u
left join public.user_profiles p on p.id = u.id
where p.id is null;

-- ── 2) Ensure storage bucket exists ─────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('user-pedal-photos', 'user-pedal-photos', false)
on conflict (id) do update set public = excluded.public;

-- ── 3) Storage object policies for user-pedal-photos ───────────────────────
alter table storage.objects enable row level security;

drop policy if exists "user_pedal_photos_select_own" on storage.objects;
drop policy if exists "user_pedal_photos_insert_own" on storage.objects;
drop policy if exists "user_pedal_photos_update_own" on storage.objects;
drop policy if exists "user_pedal_photos_delete_own" on storage.objects;

create policy "user_pedal_photos_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user-pedal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "user_pedal_photos_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'user-pedal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "user_pedal_photos_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'user-pedal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'user-pedal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "user_pedal_photos_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'user-pedal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
