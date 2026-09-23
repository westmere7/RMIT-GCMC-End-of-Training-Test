-- 001 · initial schema (as first deployed)
-- Run once in the Supabase SQL editor. Only the Vercel functions (service role key) touch these tables:
-- RLS is on with no policies, so the public anon key can't read or write them.

create table if not exists public.assessment_config (
  id          text primary key,
  data        jsonb not null,
  revision    integer not null default 1,
  updated_at  timestamptz not null default now()
);

create table if not exists public.assessment_config_history (
  id          bigint generated always as identity primary key,
  config_id   text not null,
  revision    integer not null,
  data        jsonb not null,
  saved_at    timestamptz not null default now()
);

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
  payload     jsonb,
  created_at  timestamptz not null default now()
);

alter table public.assessment_config         enable row level security;
alter table public.assessment_config_history enable row level security;
alter table public.assessment_results        enable row level security;

-- Handy view for Danh: latest attempts first.
create or replace view public.assessment_leaderboard with (security_invoker = true) as
  select name, email, correct, total, round(100.0 * correct / nullif(total, 0)) as pct,
         finished_at - started_at as time_used, timed_out, created_at
  from public.assessment_results
  order by created_at desc;
