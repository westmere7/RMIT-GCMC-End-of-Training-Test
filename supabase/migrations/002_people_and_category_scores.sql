-- 002 · first names table, per-category scores, richer leaderboard
begin;

create table if not exists public.assessment_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table public.assessment_migrations enable row level security;
insert into public.assessment_migrations (name) values ('001_initial') on conflict do nothing;

-- First names, keyed by the SHA-256 of the lower-cased email.
create table if not exists public.assessment_people (
  email_sha256 text primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
  name         text not null check (char_length(name) between 1 and 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.assessment_people enable row level security;

-- Carry over names saved in the interim JSON row, then retire it.
insert into public.assessment_people (email_sha256, name, updated_at)
select e.key, e.value->>'name', coalesce((e.value->>'updated_at')::timestamptz, now())
from public.assessment_config c, jsonb_each(coalesce(c.data->'entries', '{}'::jsonb)) e
where c.id = 'people' and e.key ~ '^[0-9a-f]{64}$' and coalesce(e.value->>'name', '') <> ''
on conflict (email_sha256) do update set name = excluded.name, updated_at = excluded.updated_at;
delete from public.assessment_config where id = 'people';

-- Per-category breakdown as its own column (also kept inside payload).
alter table public.assessment_results add column if not exists by_category jsonb;
update public.assessment_results set by_category = payload->'byCategory'
where by_category is null and payload ? 'byCategory';

-- One row per attempt per category.
create or replace view public.assessment_category_scores with (security_invoker = true) as
  select r.id as result_id, r.name, r.email, r.created_at,
         c->>'name' as category, (c->>'correct')::int as correct, (c->>'total')::int as total,
         round(100.0 * (c->>'correct')::int / nullif((c->>'total')::int, 0)) as pct
  from public.assessment_results r,
       jsonb_array_elements(coalesce(r.by_category, r.payload->'byCategory', '[]'::jsonb)) c;

-- Leaderboard: score, time, and each person's strongest / weakest category.
drop view if exists public.assessment_leaderboard;
create view public.assessment_leaderboard with (security_invoker = true) as
  select r.name, r.email, r.correct, r.total, round(100.0 * r.correct / nullif(r.total, 0)) as pct,
         r.finished_at - r.started_at as time_used, r.timed_out,
         (select s.category from public.assessment_category_scores s where s.result_id = r.id order by s.pct desc, s.total desc limit 1) as strongest,
         (select s.category from public.assessment_category_scores s where s.result_id = r.id order by s.pct asc, s.total desc limit 1) as weakest,
         r.created_at
  from public.assessment_results r
  order by r.created_at desc;

-- Test attempts made while building the site.
delete from public.assessment_results where email = 'claude.test@rmit.edu.vn';

insert into public.assessment_migrations (name) values ('002_people_and_category_scores') on conflict do nothing;
commit;
