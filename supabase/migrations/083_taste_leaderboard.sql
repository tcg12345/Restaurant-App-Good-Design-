-- 083: The taste profile — tiers, benchmarks, leaderboards, taste twins.
-- ════════════════════════════════════════════════════════════════════
-- Applied to the live project in four steps (taste_leaderboard,
-- taste_leaderboard_sorts, taste_points_uncapped, taste_twins) on
-- 2026-09-01/02; this file is the consolidated FINAL state so re-running
-- it can never revert anything. Every statement is create-or-replace.
--
-- The taste profile page (/profile/taste) ranks a user against everyone
-- else on GoodEats and says how their grading, breadth and spend compare
-- to the platform. None of that is computable from the client:
-- community_ratings' RLS (046) only shows the caller rows from public
-- accounts and accepted follows, and even those rows would have to be
-- pulled wholesale to aggregate. So the aggregation happens here, as
-- SECURITY DEFINER, over every row — and only AGGREGATES leave.
--
-- ── What leaves the database ─────────────────────────────────────────
--   get_taste_leaderboard(limit, sort)  user ids + per-user counts, only for
--                          users the caller could already see (can_view_author):
--                          public accounts, accepted follows, self. Private
--                          accounts are counted in the ranking, never listed.
--                          sort ∈ points | places | cuisines | cities.
--   get_taste_my_ranks     ONE row: the caller's rank on each board.
--   get_taste_benchmarks   ONE row: the caller's own stats and rank, platform
--                          means/medians, and the caller's percentiles.
--   get_taste_twins(limit) other visible users ranked by cuisine-profile
--                          similarity, with the cuisines shared and co-rated
--                          counts. Only aggregates.
--   taste_user_stats_impl  the shared per-user table. NOT granted to any
--                          role — reachable only through the functions above.
--
-- ── The points formula is DUPLICATED in src/lib/taste-tier.ts ────────
-- The client computes the same total from local ratings (live as you
-- rate, and works without this migration). The two must agree — no caps:
--   10·ln(1+ratings) + 3·cuisines + 4·cities + 20·score spread + notes
--   + 4·√photos + tags + 3·active months
-- Reference case, pinned in taste-tier.test.ts: 10 ratings, 4 cuisines,
-- 1 city, 2 notes, 3 photos, 5 tags, spread 1.2, 2 months → 84.
-- Tier floors (client): Newcomer 0 · Regular 60 · Explorer 150 ·
-- Connoisseur 280 · Critic 400 · Legend 650.
--
-- Cuisine tokens split on , / and " & " (recommendations.splitCuisines),
-- lower-cased, with the Places-type leftovers older resolvers saved as
-- cuisines dropped (cuisine.ts NON_ANSWERS); cities use lib/city.ts's
-- cityFromAddress, mirrored regex-for-regex below. The PGlite harness in
-- the session scratchpad checks both mirrors against the TypeScript.
--
-- ── Scale note ───────────────────────────────────────────────────────
-- taste_user_stats_impl scans community_ratings on every call (a few
-- hundred rows today). Past ~50k rows, turn it into a materialized view
-- refreshed on a schedule and read that instead; the function boundary
-- makes that a one-place change.
--
-- Run this in your Supabase SQL Editor. Safe to run multiple times.

-- ── City parser (mirrors src/lib/city.ts cityFromAddress, regex for regex) ──
create or replace function public.taste_city_of(addr text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
  n integer;
  last_part text;
  city text;
begin
  parts := array_remove(array(
    select btrim(x) from unnest(string_to_array(coalesce(addr, ''), ',')) as x
  ), '');
  n := coalesce(array_length(parts, 1), 0);
  if n = 0 then return null; end if;

  -- Drop a trailing country (by name only — a shape rule ate real cities).
  if parts[n] ~* '^(?:afghanistan|albania|algeria|andorra|angola|antigua and barbuda|argentina|armenia|aruba|australia|austria|azerbaijan|bahamas|bahrain|bangladesh|barbados|belarus|belgium|belize|benin|bermuda|bhutan|bolivia|bosnia and herzegovina|botswana|brazil|brunei|bulgaria|burkina faso|burundi|cambodia|cameroon|canada|cape verde|cabo verde|cayman islands|central african republic|chad|chile|china|colombia|comoros|congo|costa rica|croatia|cuba|curaçao|curacao|cyprus|czechia|czech republic|denmark|djibouti|dominica|dominican republic|ecuador|egypt|el salvador|england|equatorial guinea|eritrea|estonia|eswatini|ethiopia|fiji|finland|france|french polynesia|gabon|gambia|georgia|germany|ghana|gibraltar|greece|greenland|grenada|guam|guatemala|guernsey|guinea|guinea-bissau|guyana|haiti|honduras|hong kong|hungary|iceland|india|indonesia|iran|iraq|ireland|republic of ireland|isle of man|israel|italy|ivory coast|côte d''ivoire|cote d''ivoire|jamaica|japan|jersey|jordan|kazakhstan|kenya|kiribati|kosovo|kuwait|kyrgyzstan|laos|latvia|lebanon|lesotho|liberia|libya|liechtenstein|lithuania|luxembourg|macau|macao|madagascar|malawi|malaysia|maldives|mali|malta|marshall islands|mauritania|mauritius|mexico|micronesia|moldova|monaco|mongolia|montenegro|morocco|mozambique|myanmar|burma|namibia|nauru|nepal|netherlands|the netherlands|new caledonia|new zealand|nicaragua|niger|nigeria|north korea|north macedonia|northern ireland|norway|oman|pakistan|palau|palestine|panama|papua new guinea|paraguay|peru|philippines|poland|portugal|puerto rico|qatar|romania|russia|russian federation|rwanda|saint kitts and nevis|saint lucia|saint vincent and the grenadines|st\.? lucia|samoa|san marino|sao tome and principe|saudi arabia|scotland|senegal|serbia|seychelles|sierra leone|singapore|slovakia|slovenia|solomon islands|somalia|south africa|south korea|korea|south sudan|spain|sri lanka|sudan|suriname|sweden|switzerland|syria|taiwan|tajikistan|tanzania|thailand|timor-leste|east timor|togo|tonga|trinidad and tobago|tunisia|turkey|türkiye|turkmenistan|turks and caicos islands|tuvalu|uganda|ukraine|united arab emirates|uae|united kingdom|uk|u\.?k\.?|great britain|britain|united states|united states of america|usa|u\.?s\.?a?\.?|us virgin islands|u\.s\. virgin islands|british virgin islands|uruguay|uzbekistan|vanuatu|vatican city|venezuela|vietnam|viet nam|wales|yemen|zambia|zimbabwe)$' then
    n := n - 1;
  end if;
  if n = 0 then return null; end if;

  -- Drop a trailing "STATE ZIP" / spelled-out state + zip / zip / state.
  last_part := parts[n];
  if n > 1 and (
       last_part ~ '^[A-Za-z]{2,3}\.?\s+[A-Za-z]?\d[\dA-Za-z\- ]*$'
    or last_part ~* '^(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|puerto rico|alberta|british columbia|manitoba|new brunswick|newfoundland and labrador|nova scotia|ontario|prince edward island|quebec|québec|saskatchewan|yukon|northwest territories|nunavut|new south wales|victoria|queensland|south australia|western australia|tasmania|northern territory|australian capital territory)\s+[A-Za-z]?\d[\dA-Za-z\- ]*$'
    or last_part ~ '^\d[\d\- ]*$'
    or last_part ~ '^[A-Za-z]{1,2}\d[\dA-Za-z]?\s*\d[A-Za-z]{2}$'
    or last_part ~ '^[A-Za-z]{2}$'
  ) then
    n := n - 1;
  end if;

  city := btrim(parts[n]);
  -- Leading postcode: "75004 Paris", "1016 GV Amsterdam", "110 00 Praha".
  city := btrim(regexp_replace(city, '^\d[\dA-Za-z\-]*(?:\s+(?:[A-Z]{1,2}|\d{2,3}))?\s+', ''));
  -- Trailing postcode: "London NW1 6XE", "Boston 02115", "Tokyo 104-0061".
  city := btrim(regexp_replace(city, '\s+(?:[A-Za-z]{1,2}\d[\dA-Za-z]?\s*\d[A-Za-z]{2}|\d[\d-]{3,})$', ''));
  if city = '' then return null; end if;
  return lower(city);
end;
$$;

revoke all on function public.taste_city_of(text) from public;

-- ── Per-user stats (internal) ─────────────────────────────────────────
create or replace function public.taste_user_stats_impl()
returns table (
  user_id uuid,
  rating_count integer,
  cuisine_count integer,
  city_count integer,
  note_count integer,
  photo_count integer,
  tag_count integer,
  score_spread numeric,
  month_count integer,
  -- Mean score, self-picked slider scores excluded (countsForCommunity).
  avg_score numeric,
  -- Share of PRICED ratings in $$$ / $$$$.
  premium_share numeric,
  -- Share of priced ratings in the user's single biggest tier.
  dominant_share numeric,
  points integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select r.user_id, r.score, r.cuisine, r.address, r.notes, r.tags, r.price,
           r.created_at, r.rating_method
    from public.community_ratings r
  ),
  cuisines as (
    select b.user_id, count(distinct lower(btrim(t.tok)))::int as c
    from base b
    cross join lateral regexp_split_to_table(coalesce(b.cuisine, ''), '[,/]|\s&\s') as t(tok)
    where btrim(t.tok) <> ''
      and lower(btrim(t.tok)) not in ('restaurant', 'restaurants', 'food', 'establishment',
                                      'point of interest', 'point_of_interest', 'store',
                                      'meal takeaway', 'meal delivery')
    group by b.user_id
  ),
  tags as (
    select b.user_id, count(distinct lower(btrim(t.tag)))::int as c
    from base b
    cross join lateral unnest(coalesce(b.tags, '{}'::text[])) as t(tag)
    where btrim(t.tag) <> ''
    group by b.user_id
  ),
  photos as (
    select p.user_id, count(*)::int as c
    from public.community_photos p
    group by p.user_id
  ),
  tiers as (
    select b.user_id, length(b.price) as tier, count(*)::numeric as cnt
    from base b
    where length(coalesce(b.price, '')) between 1 and 4
    group by b.user_id, length(b.price)
  ),
  dom as (
    select t.user_id,
           max(t.cnt) / sum(t.cnt) as dominant_share,
           coalesce(sum(t.cnt) filter (where t.tier in (3, 4)), 0) / sum(t.cnt) as premium_share
    from tiers t
    group by t.user_id
  ),
  agg as (
    select b.user_id,
           count(*)::int as rating_count,
           count(distinct public.taste_city_of(b.address))::int as city_count,
           count(*) filter (where btrim(coalesce(b.notes, '')) <> '')::int as note_count,
           coalesce(stddev_pop(b.score) filter (where b.score > 0), 0)::numeric as score_spread,
           count(distinct to_char(b.created_at at time zone 'UTC', 'YYYY-MM'))::int as month_count,
           avg(b.score) filter (where b.score > 0 and b.rating_method is distinct from 'slider') as avg_score
    from base b
    group by b.user_id
  )
  select a.user_id,
         a.rating_count,
         coalesce(c.c, 0) as cuisine_count,
         a.city_count,
         a.note_count,
         coalesce(p.c, 0) as photo_count,
         coalesce(t.c, 0) as tag_count,
         a.score_spread,
         a.month_count,
         a.avg_score,
         coalesce(d.premium_share, 0),
         coalesce(d.dominant_share, 0),
         round((
             10 * ln(1 + a.rating_count)
           + 3 * coalesce(c.c, 0)
           + 4 * a.city_count
           + 20 * a.score_spread
           + a.note_count
           + 4 * sqrt(coalesce(p.c, 0))
           + coalesce(t.c, 0)
           + 3 * a.month_count
         )::numeric)::int as points
  from agg a
  left join cuisines c on c.user_id = a.user_id
  left join tags t on t.user_id = a.user_id
  left join photos p on p.user_id = a.user_id
  left join dom d on d.user_id = a.user_id;
$$;

-- Internal: no role may call it directly. The definer functions below run
-- as the owner and reach it that way.
revoke all on function public.taste_user_stats_impl() from public;

-- ── Leaderboards ──────────────────────────────────────────────────────
-- Ranked over EVERY user with unlocked scores (10+ published ratings —
-- scoreUnlock.ts; nothing is published below that anyway), then filtered
-- to the users the caller may see. A strict ladder (row_number), ties
-- broken by rating count, then points, then id.
-- The one-argument form from the first deploy is dropped: with defaults
-- on both, a one-argument call would be ambiguous between the overloads.
drop function if exists public.get_taste_leaderboard(integer);

create or replace function public.get_taste_leaderboard(
  p_limit integer default 25,
  p_sort text default 'points'
)
returns table (
  user_id uuid,
  points integer,
  rank integer,
  rating_count integer,
  cuisine_count integer,
  city_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select s.user_id, s.points, s.rating_count, s.cuisine_count, s.city_count,
           row_number() over (
             order by
               case p_sort
                 when 'places'   then s.rating_count
                 when 'cuisines' then s.cuisine_count
                 when 'cities'   then s.city_count
                 else s.points
               end desc,
               s.rating_count desc,
               s.points desc,
               s.user_id
           ) as rn
    from public.taste_user_stats_impl() s
    where s.rating_count >= 10
  )
  select r.user_id, r.points, r.rn::int, r.rating_count, r.cuisine_count, r.city_count
  from ranked r
  where public.can_view_author(r.user_id)
  order by r.rn
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.get_taste_leaderboard(integer, text) from public;
grant execute on function public.get_taste_leaderboard(integer, text) to authenticated;

create or replace function public.get_taste_my_ranks()
returns table (
  ranked_users integer,
  points_rank integer,
  places_rank integer,
  cuisines_rank integer,
  cities_rank integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select s.user_id,
           row_number() over (order by s.points desc, s.rating_count desc, s.user_id) as points_rn,
           row_number() over (order by s.rating_count desc, s.points desc, s.user_id) as places_rn,
           row_number() over (order by s.cuisine_count desc, s.rating_count desc, s.points desc, s.user_id) as cuisines_rn,
           row_number() over (order by s.city_count desc, s.rating_count desc, s.points desc, s.user_id) as cities_rn
    from public.taste_user_stats_impl() s
    where s.rating_count >= 10
  )
  select
    (select count(*) from ranked)::int,
    (select points_rn from ranked where ranked.user_id = auth.uid())::int,
    (select places_rn from ranked where ranked.user_id = auth.uid())::int,
    (select cuisines_rn from ranked where ranked.user_id = auth.uid())::int,
    (select cities_rn from ranked where ranked.user_id = auth.uid())::int;
$$;

revoke all on function public.get_taste_my_ranks() from public;
grant execute on function public.get_taste_my_ranks() to authenticated;

-- ── Benchmarks ────────────────────────────────────────────────────────
-- One row about the caller. Percentiles are the share of OTHER ranked
-- users the caller beats (0..1); null when the caller isn't ranked, or —
-- for grading — has no non-slider scores to compare with.
create or replace function public.get_taste_benchmarks()
returns table (
  ranked_users integer,
  my_rank integer,
  my_points integer,
  my_rating_count integer,
  my_cuisine_count integer,
  my_city_count integer,
  my_note_count integer,
  my_photo_count integer,
  my_tag_count integer,
  my_score_spread numeric,
  my_month_count integer,
  -- Mean of every ranked user's mean score: the platform grading baseline,
  -- one vote per person so a heavy rater can't set it alone.
  platform_avg_score numeric,
  avg_cuisine_count numeric,
  avg_city_count numeric,
  median_rating_count numeric,
  -- Share of other ranked users whose mean score is HIGHER than the
  -- caller's — i.e. the share the caller grades tougher than.
  grading_percentile numeric,
  -- Share of other ranked users with FEWER distinct cuisines.
  breadth_percentile numeric,
  -- Share of other ranked users LESS distinctive (0.75·premium share +
  -- 0.25·breadth, the recommendation engine's own blend).
  distinctive_percentile numeric,
  -- Share of ALL platform ratings in each tier, $ → $$$$.
  platform_price_share numeric[],
  -- Share of ranked users with ≥ half their priced ratings in one tier.
  concentrated_user_share numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select * from public.taste_user_stats_impl()
  ),
  ranked as (
    select s.*,
           row_number() over (order by s.points desc, s.rating_count desc, s.user_id) as rn,
           (0.75 * s.premium_share
            + 0.25 * greatest(0, least(1, (s.cuisine_count - 3) / 9.0))) as distinctive
    from s
    where s.rating_count >= 10
  ),
  mine as (
    select * from s where s.user_id = auth.uid()
  ),
  me as (
    select * from ranked where ranked.user_id = auth.uid()
  ),
  others as (
    select * from ranked where ranked.user_id <> auth.uid()
  ),
  price as (
    select length(r.price) as tier, count(*)::numeric as cnt
    from public.community_ratings r
    where length(coalesce(r.price, '')) between 1 and 4
    group by length(r.price)
  ),
  price_total as (
    select coalesce(sum(cnt), 0) as total from price
  )
  select
    (select count(*) from ranked)::int,
    (select rn from me)::int,
    (select points from me),
    (select rating_count from mine),
    (select cuisine_count from mine),
    (select city_count from mine),
    (select note_count from mine),
    (select photo_count from mine),
    (select tag_count from mine),
    (select score_spread from mine),
    (select month_count from mine),
    (select avg(avg_score) from ranked where avg_score is not null),
    (select avg(cuisine_count) from ranked),
    (select avg(city_count) from ranked),
    (select percentile_cont(0.5) within group (order by rating_count) from ranked),
    (select case when (select avg_score from me) is null or count(*) = 0 then null
              else count(*) filter (where o.avg_score > (select avg_score from me))::numeric / count(*)
            end
     from others o where o.avg_score is not null),
    (select case when exists (select 1 from me) and count(*) > 0
              then count(*) filter (where o.cuisine_count < (select cuisine_count from me))::numeric / count(*)
            end
     from others o),
    (select case when exists (select 1 from me) and count(*) > 0
              then count(*) filter (where o.distinctive < (select distinctive from me))::numeric / count(*)
            end
     from others o),
    (select case when pt.total > 0 then array[
        coalesce((select cnt from price where tier = 1), 0) / pt.total,
        coalesce((select cnt from price where tier = 2), 0) / pt.total,
        coalesce((select cnt from price where tier = 3), 0) / pt.total,
        coalesce((select cnt from price where tier = 4), 0) / pt.total
      ] end
     from price_total pt),
    (select case when count(*) > 0
              then count(*) filter (where ranked.dominant_share >= 0.5)::numeric / count(*)
            end
     from ranked);
$$;

revoke all on function public.get_taste_benchmarks() from public;
grant execute on function public.get_taste_benchmarks() to authenticated;

-- ── Taste twins ───────────────────────────────────────────────────────
-- Per user, a cuisine vector: weight 0.5 for eating a cuisine plus 1 when
-- they scored it at or above their OWN mean (liking is relative to the
-- grader). Similarity is the cosine between two users' vectors (0..1), so
-- a heavy rater and a light one compare by shape, not volume. Alongside:
-- the top three cuisines the pair share, and how many restaurants both
-- rated and agreed on (within 1.5 points — migration 080's signal).
-- Both sides need 10+ published ratings; a caller with nothing published
-- gets no rows.
create or replace function public.get_taste_twins(p_limit integer default 25)
returns table (
  user_id uuid,
  similarity numeric,
  shared_cuisines text[],
  co_rated integer,
  co_agree integer,
  rating_count integer,
  cuisine_count integer,
  points integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as id
  ),
  stats as (
    select s.user_id, s.rating_count, s.cuisine_count, s.points
    from public.taste_user_stats_impl() s
    where s.rating_count >= 10
  ),
  means as (
    select r.user_id, avg(r.score) as m
    from public.community_ratings r
    where r.score > 0
    group by r.user_id
  ),
  toks as (
    select r.user_id, lower(btrim(t.tok)) as tok,
           0.5 + case when r.score >= mn.m then 1 else 0 end as w
    from public.community_ratings r
    join means mn on mn.user_id = r.user_id
    cross join lateral regexp_split_to_table(coalesce(r.cuisine, ''), '[,/]|\s&\s') as t(tok)
    where btrim(t.tok) <> ''
      and lower(btrim(t.tok)) not in ('restaurant', 'restaurants', 'food', 'establishment',
                                      'point of interest', 'point_of_interest', 'store',
                                      'meal takeaway', 'meal delivery')
      and r.user_id in (select st.user_id from stats st)
  ),
  vec as (
    select tk.user_id, tk.tok, sum(tk.w) as w
    from toks tk
    group by tk.user_id, tk.tok
  ),
  norm as (
    select v.user_id, sqrt(sum(v.w * v.w)) as n
    from vec v
    group by v.user_id
  ),
  mine as (
    select v.tok, v.w
    from vec v, me
    where v.user_id = me.id
  ),
  my_norm as (
    select n.n
    from norm n, me
    where n.user_id = me.id
  ),
  dots as (
    select v.user_id,
           sum(v.w * mi.w) as dot,
           (array_agg(v.tok order by v.w * mi.w desc))[1:3] as shared
    from vec v
    join mine mi on mi.tok = v.tok, me
    where v.user_id <> me.id
    group by v.user_id
  ),
  sim as (
    select d.user_id,
           d.dot / nullif(nu.n * mn.n, 0) as similarity,
           d.shared
    from dots d
    join norm nu on nu.user_id = d.user_id
    cross join my_norm mn
  ),
  co as (
    select o.user_id,
           count(*)::int as co_rated,
           count(*) filter (where abs(o.score - r.score) <= 1.5)::int as co_agree
    from public.community_ratings r
    join me on r.user_id = me.id
    join public.community_ratings o
      on o.restaurant_id = r.restaurant_id and o.user_id <> r.user_id
    where o.user_id in (select st.user_id from stats st)
    group by o.user_id
  )
  select s.user_id,
         round(s.similarity::numeric, 4),
         s.shared,
         coalesce(co.co_rated, 0),
         coalesce(co.co_agree, 0),
         st.rating_count,
         st.cuisine_count,
         st.points
  from sim s
  join stats st on st.user_id = s.user_id
  left join co on co.user_id = s.user_id
  where s.similarity is not null
    and public.can_view_author(s.user_id)
  order by s.similarity desc, st.rating_count desc, s.user_id
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.get_taste_twins(integer) from public;
grant execute on function public.get_taste_twins(integer) to authenticated;
