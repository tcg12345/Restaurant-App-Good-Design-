-- One vote per account; visibility follows the source photo's existing RLS.
create table public.community_photo_likes (
  photo_id uuid not null references public.community_photos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);
create index community_photo_likes_user_idx on public.community_photo_likes(user_id);
alter table public.community_photo_likes enable row level security;
revoke all on public.community_photo_likes from public, anon, authenticated;
grant select on public.community_photo_likes to anon, authenticated;
grant insert, delete on public.community_photo_likes to authenticated;
create policy "Read likes on visible photos" on public.community_photo_likes for select to anon, authenticated
  using (exists (select 1 from public.community_photos p where p.id = photo_id));
create policy "Like visible photos as yourself" on public.community_photo_likes for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.community_photos p where p.id = photo_id));
create policy "Remove your own photo likes" on public.community_photo_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create function public.community_photo_like_stats(p_photo_ids uuid[])
returns table(photo_id uuid, like_count bigint, liked boolean)
language sql stable security invoker set search_path = '' as $$
  select p.id, count(l.user_id), coalesce(bool_or(l.user_id = (select auth.uid())), false)
  from public.community_photos p left join public.community_photo_likes l on l.photo_id = p.id
  where p.id = any(p_photo_ids[1:250]) group by p.id;
$$;
create function public.popular_restaurant_photo(p_restaurant_id text)
returns setof public.community_photos
language sql stable security invoker set search_path = '' as $$
  select p.* from public.community_photos p where p.restaurant_id = p_restaurant_id
  order by (select count(*) from public.community_photo_likes l where l.photo_id = p.id) desc,
    p.is_favorite desc, p.created_at desc, p.id limit 1;
$$;
revoke all on function public.community_photo_like_stats(uuid[]), public.popular_restaurant_photo(text) from public;
grant execute on function public.community_photo_like_stats(uuid[]), public.popular_restaurant_photo(text) to anon, authenticated;

-- Preserve photo IDs (and their likes) when captions or reviews are edited.
-- Only metadata can be updated in place; changing the image creates a new ID.
revoke update on public.community_photos from authenticated;
grant update(caption, is_favorite) on public.community_photos to authenticated;
create policy "Update own photo metadata" on public.community_photos for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create function public.sync_community_photos(p_user_id uuid, p_restaurant_id text, p_photos jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare owner_id uuid := (select auth.uid()); item jsonb;
begin
  if owner_id is null or p_user_id is distinct from owner_id then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_restaurant_id is null or p_restaurant_id = '' or p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    raise exception 'Invalid photos';
  end if;
  if jsonb_array_length(p_photos) > 500 then raise exception 'Too many photos'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text || ':' || p_restaurant_id, 0));
  delete from public.community_photos p where p.user_id = owner_id and p.restaurant_id = p_restaurant_id
    and not exists (select 1 from jsonb_array_elements(p_photos) j where j->>'url' = p.url);
  for item in select value from jsonb_array_elements(p_photos) loop
    if coalesce(item->>'url', '') = '' then raise exception 'Photo URL required'; end if;
    update public.community_photos set caption = coalesce(item->>'caption',''), is_favorite = coalesce((item->>'is_favorite')::boolean,false)
      where user_id = owner_id and restaurant_id = p_restaurant_id and url = item->>'url';
    if not found then
      insert into public.community_photos(user_id, restaurant_id, url, caption, is_favorite)
        values(owner_id, p_restaurant_id, item->>'url', coalesce(item->>'caption',''), coalesce((item->>'is_favorite')::boolean,false));
    end if;
  end loop;
end;
$$;
revoke all on function public.sync_community_photos(uuid,text,jsonb) from public, anon;
grant execute on function public.sync_community_photos(uuid,text,jsonb) to authenticated;
