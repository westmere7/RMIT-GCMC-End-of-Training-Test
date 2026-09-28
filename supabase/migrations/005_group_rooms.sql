-- 005 · group play: the test taker opens a room on the briefing screen, the team joins it from a QR code and answers
-- the same questions alongside. Rooms are short-lived; the taker's finished attempt (with everyone's points) still goes
-- to assessment_results.
begin;

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

insert into public.assessment_migrations (name) values ('005_group_rooms') on conflict do nothing;
commit;
