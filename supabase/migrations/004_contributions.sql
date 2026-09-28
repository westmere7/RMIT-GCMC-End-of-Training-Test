-- 004 · questions from the team, through private links (no sign-in), reviewed in the editor before they join the bank;
-- and the editor's own private key.
begin;

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

insert into public.assessment_migrations (name) values ('004_contributions') on conflict do nothing;
commit;
