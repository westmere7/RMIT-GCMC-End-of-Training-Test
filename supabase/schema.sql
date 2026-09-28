-- End-of-Training Assessment · Supabase schema (current state = migrations 001 to 005)
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

-- Team contributions through private links, and the editor key (see 004_contributions).
-- One private link per person: the token in the link opens the "Submit a question" page as them.
create table if not exists public.assessment_contributors (
  token      text primary key check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  name       text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.assessment_contributors enable row level security;

-- Questions sent through those links. They wait here until someone approves them into the bank (or rejects them).
create table if not exists public.assessment_submissions (
  id                bigint generated always as identity primary key,
  contributor_token text references public.assessment_contributors (token) on delete set null,
  contributor_name  text not null,
  question          jsonb not null,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at        timestamptz not null default now(),
  reviewed_at       timestamptz
);
create index if not exists assessment_submissions_status_idx on public.assessment_submissions (status, created_at desc);
alter table public.assessment_submissions enable row level security;

-- Small server-only secrets. `editor_key` holds the SHA-256 of the editor's private key (never the key itself).
create table if not exists public.assessment_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.assessment_secrets enable row level security;

-- Group play: rooms, the people in them, and their answers (see 005_group_rooms).
-- One row per room. `state` is written only by the taker (phase, question index, clock, who was in at the start);
-- `paper` is the drawn questions and their option order, the same for everyone.
create table if not exists public.assessment_rooms (
  code         text primary key check (code ~ '^[A-Z0-9]{4,8}$'),
  host_hash    text not null,
  host_name    text not null default '',
  host_busy_q  integer,
  host_seen_at timestamptz not null default now(),
  state        jsonb not null default '{}'::jsonb,
  paper        jsonb,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.assessment_rooms enable row level security;

-- Everyone who joined a room. A device (a random id kept in the browser, stored here only as its SHA-256) has one seat
-- per room, so a refresh finds the same seat. No two people in a room share a colour.
create table if not exists public.assessment_room_members (
  id          bigint generated always as identity primary key,
  room        text not null references public.assessment_rooms (code) on delete cascade,
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  name        text not null check (char_length(name) between 1 and 24),
  color       text not null check (color ~ '^#[0-9a-f]{6}$'),
  busy_q      integer,
  seen_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (room, device_hash),
  unique (room, color)
);
alter table public.assessment_room_members enable row level security;

-- One answer per person per question. member_id 0 is the test taker.
create table if not exists public.assessment_room_answers (
  room      text not null references public.assessment_rooms (code) on delete cascade,
  member_id bigint not null,
  qidx      integer not null check (qidx >= 0),
  response  jsonb,
  at        timestamptz not null default now(),
  primary key (room, member_id, qidx)
);
alter table public.assessment_room_answers enable row level security;

insert into public.assessment_migrations (name) values ('001_initial'), ('002_people_and_category_scores'), ('003_images_bucket'), ('004_contributions'), ('005_group_rooms') on conflict do nothing;
