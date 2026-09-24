-- End-of-Training Assessment · Supabase schema (current state = migrations 001 + 002)
-- For a fresh project: run this once in the Supabase SQL editor.
-- For an existing project: apply the files in supabase/migrations/ that aren't in assessment_migrations yet.
-- Only the Vercel functions (service role key) touch these tables: RLS is on with no policies,
-- so the public anon key can't read or write them.

create table if not exists public.assessment_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);

-- Row "main" holds the question bank and settings as one JSON document.
create table if not exists public.assessment_config (
  id          text primary key,
  data        jsonb not null,
  revision    integer not null default 1,
  updated_at  timestamptz not null default now()
);

-- Every previous version of the bank, written on each save.
create table if not exists public.assessment_config_history (
  id          bigint generated always as identity primary key,
  config_id   text not null,
  revision    integer not null,
  data        jsonb not null,
  saved_at    timestamptz not null default now()
);

-- First names, keyed by the SHA-256 of the lower-cased email.
create table if not exists public.assessment_people (
  email_sha256 text primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
  name         text not null check (char_length(name) between 1 and 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One row per finished attempt.
create table if not exists public.assessment_results (
  id          bigint generated always as identity primary key,
  email       text,
  name        text,
  assessment  text,
  correct     integer,
  total       integer,
  timed_out   boolean default false,
  started_at  timestamptz,
  finished_at timestamptz,
  by_category jsonb,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

alter table public.assessment_migrations     enable row level security;
alter table public.assessment_config         enable row level security;
alter table public.assessment_config_history enable row level security;
alter table public.assessment_people         enable row level security;
alter table public.assessment_results        enable row level security;

-- One row per attempt per category.
create or replace view public.assessment_category_scores with (security_invoker = true) as
  select r.id as result_id, r.name, r.email, r.created_at,
         c->>'name' as category, (c->>'correct')::int as correct, (c->>'total')::int as total,
         round(100.0 * (c->>'correct')::int / nullif((c->>'total')::int, 0)) as pct
  from public.assessment_results r,
       jsonb_array_elements(coalesce(r.by_category, r.payload->'byCategory', '[]'::jsonb)) c;

-- Latest attempts first, with each person's strongest and weakest category.
create or replace view public.assessment_leaderboard with (security_invoker = true) as
  select r.name, r.email, r.correct, r.total, round(100.0 * r.correct / nullif(r.total, 0)) as pct,
         r.finished_at - r.started_at as time_used, r.timed_out,
         (select s.category from public.assessment_category_scores s where s.result_id = r.id order by s.pct desc, s.total desc limit 1) as strongest,
         (select s.category from public.assessment_category_scores s where s.result_id = r.id order by s.pct asc, s.total desc limit 1) as weakest,
         r.created_at
  from public.assessment_results r
  order by r.created_at desc;

-- Question images: a public bucket, WebP only, up to 3 MB each (api/images.js uploads to it).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assessment-images', 'assessment-images', true, 3145728, array['image/webp'])
on conflict (id) do nothing;

insert into public.assessment_migrations (name) values ('001_initial'), ('002_people_and_category_scores'), ('003_images_bucket') on conflict do nothing;
