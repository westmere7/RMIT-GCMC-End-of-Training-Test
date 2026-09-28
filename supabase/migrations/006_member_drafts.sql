-- 006 · group play: what each teammate has picked but not yet submitted. When the taker submits, a teammate who
-- hasn't pressed Submit gets their current pick counted as their answer.
begin;

alter table public.assessment_room_members
  add column if not exists draft   jsonb,
  add column if not exists draft_q integer;

insert into public.assessment_migrations (name) values ('006_member_drafts') on conflict do nothing;
commit;
