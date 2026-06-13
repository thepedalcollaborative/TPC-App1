-- Admin helper RPCs for the in-app Admin Console.
-- All functions check is_admin and run SECURITY DEFINER to bypass RLS.

-- ─── Stats ──────────────────────────────────────────────────────────────────

create or replace function public.admin_get_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  wk text;
  ws timestamptz;
begin
  if not coalesce((select is_admin from user_profiles where id = auth.uid()), false) then
    raise exception 'unauthorized';
  end if;

  wk := to_char(now() at time zone 'UTC', 'IYYY') || '-W' || to_char(now() at time zone 'UTC', 'IW');
  ws := date_trunc('week', current_timestamp);

  return json_build_object(
    'users',           (select count(*) from user_profiles),
    'new_this_week',   (select count(*) from user_profiles where created_at >= ws),
    'catalog_pedals',  (select count(*) from pedals),
    'owned_pedals',    (select count(*) from user_pedals where status = 'owned'),
    'wishlist_pedals', (select count(*) from user_pedals where status = 'wishlist'),
    'boards',          (select count(*) from boards),
    'picks_this_week', (select count(*) from weekly_picks where week_key = wk)
  );
end;
$$;

grant execute on function public.admin_get_stats() to authenticated;

-- ─── User search ─────────────────────────────────────────────────────────────

create or replace function public.admin_search_users(p_query text)
returns table(
  id          uuid,
  username    text,
  display_name text,
  is_admin    boolean,
  is_premium  boolean,
  created_at  timestamptz,
  pedal_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select up2.is_admin from user_profiles up2 where up2.id = auth.uid()), false) then
    return;
  end if;

  return query
  select
    up.id,
    up.username,
    up.display_name,
    up.is_admin,
    up.is_premium,
    up.created_at,
    coalesce((select count(*) from user_pedals where user_id = up.id and status = 'owned'), 0) as pedal_count
  from user_profiles up
  where
    up.username ilike '%' || p_query || '%'
    or up.display_name ilike '%' || p_query || '%'
  order by up.created_at desc
  limit 20;
end;
$$;

grant execute on function public.admin_search_users(text) to authenticated;

-- ─── Set user flag ────────────────────────────────────────────────────────────

create or replace function public.admin_set_user_flag(p_user_id uuid, p_field text, p_value boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select is_admin from user_profiles where id = auth.uid()), false) then
    return json_build_object('ok', false, 'error', 'unauthorized');
  end if;

  if p_field not in ('is_admin', 'is_premium') then
    return json_build_object('ok', false, 'error', 'invalid_field');
  end if;

  if p_field = 'is_admin' and not p_value and p_user_id = auth.uid() then
    return json_build_object('ok', false, 'error', 'cannot_demote_self');
  end if;

  if p_field = 'is_admin' then
    update user_profiles set is_admin = p_value where id = p_user_id;
  else
    update user_profiles set is_premium = p_value where id = p_user_id;
  end if;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.admin_set_user_flag(uuid, text, boolean) to authenticated;

-- ─── Weekly pick admin ────────────────────────────────────────────────────────

create or replace function public.admin_get_weekly_pick(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
  wk     text;
begin
  if not coalesce((select is_admin from user_profiles where id = auth.uid()), false) then
    return json_build_object('error', 'unauthorized');
  end if;

  wk := to_char(now() at time zone 'UTC', 'IYYY') || '-W' || to_char(now() at time zone 'UTC', 'IW');

  select row_to_json(wp) into result
  from weekly_picks wp
  where wp.user_id = p_user_id and wp.week_key = wk;

  return result;
end;
$$;

grant execute on function public.admin_get_weekly_pick(uuid) to authenticated;

create or replace function public.admin_clear_weekly_pick(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  wk text;
begin
  if not coalesce((select is_admin from user_profiles where id = auth.uid()), false) then
    return json_build_object('ok', false, 'error', 'unauthorized');
  end if;

  wk := to_char(now() at time zone 'UTC', 'IYYY') || '-W' || to_char(now() at time zone 'UTC', 'IW');

  delete from weekly_picks where user_id = p_user_id and week_key = wk;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.admin_clear_weekly_pick(uuid) to authenticated;

create or replace function public.admin_set_weekly_pick(
  p_user_id  uuid,
  p_brand    text,
  p_model    text,
  p_why      text,
  p_category text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  wk text;
begin
  if not coalesce((select is_admin from user_profiles where id = auth.uid()), false) then
    return json_build_object('ok', false, 'error', 'unauthorized');
  end if;

  wk := to_char(now() at time zone 'UTC', 'IYYY') || '-W' || to_char(now() at time zone 'UTC', 'IW');

  delete from weekly_picks where user_id = p_user_id and week_key = wk;

  insert into weekly_picks (user_id, brand, model, why, category, week_key)
  values (p_user_id, p_brand, p_model, p_why, p_category, wk);

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.admin_set_weekly_pick(uuid, text, text, text, text) to authenticated;

-- ─── Add pedal ────────────────────────────────────────────────────────────────

create or replace function public.admin_add_pedal(
  p_brand         text,
  p_model         text,
  p_category      text,
  p_subcategory   text,
  p_description   text    default null,
  p_analog        boolean default false,
  p_in_production boolean default true,
  p_image_url     text    default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not coalesce((select is_admin from user_profiles where id = auth.uid()), false) then
    return json_build_object('ok', false, 'error', 'unauthorized');
  end if;

  insert into pedals (brand, model, category, subcategory, description, analog, in_production, image_url, image_source)
  values (
    p_brand, p_model, p_category, p_subcategory, p_description,
    p_analog, p_in_production, p_image_url,
    case when p_image_url is not null then 'manufacturer' else null end
  )
  returning id into new_id;

  return json_build_object('ok', true, 'id', new_id);
end;
$$;

grant execute on function public.admin_add_pedal(text, text, text, text, text, boolean, boolean, text) to authenticated;
