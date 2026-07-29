create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  arm_namespace text not null,
  display_name text not null
);

create table public.events (
  id uuid primary key,
  arm_namespace text not null,
  host_id uuid not null references public.profiles(user_id),
  slug text not null unique,
  title text not null,
  summary text not null,
  venue_public text not null,
  private_notes text not null,
  is_public boolean not null default false,
  capacity integer not null check (capacity > 0),
  guest_list_visible boolean not null default true,
  starts_at timestamptz not null,
  art_path text,
  deleted_at timestamptz,
  revision integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.event_members (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null check (role in ('host', 'cohost', 'guest')),
  revoked_at timestamptz,
  primary key (event_id, user_id)
);

create table public.invitations (
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  email text not null,
  invitee_id uuid references public.profiles(user_id),
  created_by uuid not null references public.profiles(user_id),
  status text not null check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now()
);

create table public.rsvps (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  response text not null check (response in ('yes', 'no', 'maybe')),
  plus_one integer not null default 0 check (plus_one between 0 and 4),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.wall_posts (
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  author_id uuid not null references public.profiles(user_id),
  body text not null,
  sequence bigint generated always as identity,
  created_at timestamptz not null default now()
);

create table public.reminder_schedules (
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  run_at timestamptz not null,
  dedupe_key text not null unique,
  status text not null default 'scheduled' check (status in ('scheduled', 'ran', 'cancelled')),
  cron_job_name text not null unique,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  schedule_id uuid references public.reminder_schedules(id) on delete cascade,
  kind text not null,
  dedupe_key text not null,
  attempt_no integer not null,
  state text not null check (state in ('attempting', 'succeeded', 'failed', 'ambiguous')),
  provider_receipt text,
  response_code integer,
  fault text,
  created_at timestamptz not null default now(),
  unique (dedupe_key, attempt_no)
);

create table public.provider_deliveries (
  dedupe_key text primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  receipt text not null,
  delivery_count integer not null default 1,
  created_at timestamptz not null default now()
);

create index profiles_namespace_idx on public.profiles(arm_namespace);
create index events_namespace_idx on public.events(arm_namespace);
create index event_members_event_active_idx on public.event_members(event_id, revoked_at, role);
create index invitations_event_idx on public.invitations(event_id, status);
create index rsvps_event_response_idx on public.rsvps(event_id, response);
create index wall_posts_event_sequence_idx on public.wall_posts(event_id, sequence);
create index reminder_schedules_event_run_idx on public.reminder_schedules(event_id, run_at);
create index notification_attempts_dedupe_idx on public.notification_attempts(dedupe_key, attempt_no);

create or replace function public.is_active_event_member(target_event uuid, target_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_members
    where event_id = target_event and user_id = target_user and revoked_at is null
  )
$$;

create or replace function public.can_manage_event(target_event uuid, target_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_members
    where event_id = target_event and user_id = target_user
      and role in ('host', 'cohost') and revoked_at is null
  )
$$;

create view public.public_event_previews
with (security_invoker = false)
as
select id, slug, title, summary, venue_public, starts_at, art_path
from public.events
where deleted_at is null and is_public;

revoke all on public.events from anon;
grant select on public.public_event_previews to anon, authenticated;
grant select, update on public.events to authenticated;
grant select on public.profiles to authenticated;
grant select, update on public.event_members to authenticated;
grant select, update on public.invitations to authenticated;
grant select, insert, update on public.rsvps to authenticated;
grant select, insert on public.wall_posts to authenticated;
grant select, insert, update on public.reminder_schedules to authenticated;
grant select, insert, update on public.notification_attempts to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.invitations enable row level security;
alter table public.rsvps enable row level security;
alter table public.wall_posts enable row level security;
alter table public.reminder_schedules enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.provider_deliveries enable row level security;

create policy profiles_for_shared_event on public.profiles for select to authenticated
using (
  user_id = auth.uid() or exists (
    select 1
    from public.event_members mine
    join public.event_members theirs on theirs.event_id = mine.event_id
    join public.events e on e.id = mine.event_id
    where mine.user_id = auth.uid() and mine.revoked_at is null
      and theirs.user_id = profiles.user_id and theirs.revoked_at is null
      and (e.guest_list_visible or mine.role in ('host', 'cohost'))
  )
);

create policy events_for_active_members on public.events for select to authenticated
using (public.is_active_event_member(id));
create policy events_managed on public.events for update to authenticated
using (public.can_manage_event(id)) with check (public.can_manage_event(id));

create policy members_visible on public.event_members for select to authenticated
using (
  user_id = auth.uid() or public.can_manage_event(event_id) or (
    public.is_active_event_member(event_id)
    and exists (select 1 from public.events e where e.id = event_id and e.guest_list_visible)
  )
);
create policy members_managed on public.event_members for update to authenticated
using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));

create policy invitations_visible on public.invitations for select to authenticated
using (invitee_id = auth.uid() or public.can_manage_event(event_id));
create policy invitations_managed on public.invitations for update to authenticated
using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));

create policy rsvps_visible on public.rsvps for select to authenticated
using (
  user_id = auth.uid() or public.can_manage_event(event_id) or (
    public.is_active_event_member(event_id)
    and exists (select 1 from public.events e where e.id = event_id and e.guest_list_visible)
  )
);

create policy wall_visible on public.wall_posts for select to authenticated
using (public.is_active_event_member(event_id));
create policy wall_insert on public.wall_posts for insert to authenticated
with check (author_id = auth.uid() and public.is_active_event_member(event_id));

create policy schedules_visible on public.reminder_schedules for select to authenticated
using (public.can_manage_event(event_id));
create policy schedules_managed on public.reminder_schedules for all to authenticated
using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));

create policy attempts_visible on public.notification_attempts for select to authenticated
using (public.can_manage_event(event_id));
create policy attempts_managed on public.notification_attempts for all to authenticated
using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));

create or replace function public.set_rsvp(target_event uuid, new_response text, new_plus_one integer)
returns public.rsvps
language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  target public.events;
  occupied integer;
  result public.rsvps;
begin
  if actor is null or not public.is_active_event_member(target_event, actor) then
    raise exception 'EVENT_FORBIDDEN' using errcode = '42501';
  end if;
  if new_response not in ('yes', 'no', 'maybe') or new_plus_one < 0 or new_plus_one > 4 then
    raise exception 'INVALID_RSVP' using errcode = '22023';
  end if;
  select * into target from public.events where id = target_event and deleted_at is null for update;
  if target.id is null then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if new_response = 'yes' then
    select coalesce(sum(1 + plus_one), 0)::integer into occupied
    from public.rsvps where event_id = target_event and response = 'yes' and user_id <> actor;
    if occupied + 1 + new_plus_one > target.capacity then
      raise exception 'CAPACITY_EXCEEDED' using errcode = 'P0001';
    end if;
  end if;
  insert into public.rsvps(event_id, user_id, response, plus_one)
  values (target_event, actor, new_response, new_plus_one)
  on conflict (event_id, user_id) do update
    set response = excluded.response, plus_one = excluded.plus_one,
        revision = public.rsvps.revision + 1, updated_at = now()
  returning * into result;
  return result;
end
$$;
grant execute on function public.set_rsvp(uuid, text, integer) to authenticated;

create or replace function public.set_guest_list_visibility(target_event uuid, visible boolean)
returns public.events
language plpgsql security definer set search_path = public
as $$
declare result public.events;
begin
  if not public.can_manage_event(target_event) then
    raise exception 'EVENT_FORBIDDEN' using errcode = '42501';
  end if;
  update public.events
  set guest_list_visible = visible, revision = revision + 1
  where id = target_event and deleted_at is null returning * into result;
  return result;
end
$$;
grant execute on function public.set_guest_list_visibility(uuid, boolean) to authenticated;

create or replace function public.create_reminder(target_event uuid, target_id uuid, target_run_at timestamptz, target_dedupe text)
returns public.reminder_schedules
language plpgsql security definer set search_path = public
as $$
declare result public.reminder_schedules;
begin
  if not public.can_manage_event(target_event) then
    raise exception 'EVENT_FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.reminder_schedules(id, event_id, run_at, dedupe_key, cron_job_name, created_by)
  values (target_id, target_event, target_run_at, target_dedupe, 'party-' || target_id::text, auth.uid())
  returning * into result;
  return result;
end
$$;
grant execute on function public.create_reminder(uuid, uuid, timestamptz, text) to authenticated;

create or replace function public.run_due_reminders()
returns integer
language plpgsql security definer set search_path = public
as $$
declare inserted_count integer;
begin
  with due as (
    update public.reminder_schedules
    set status = 'ran'
    where status = 'scheduled' and run_at <= now()
    returning *
  ), attempts as (
    insert into public.notification_attempts(event_id, schedule_id, kind, dedupe_key, attempt_no, state, provider_receipt)
    select event_id, id, 'scheduled-reminder', dedupe_key, 1, 'succeeded', 'local-scheduler'
    from due
    on conflict (dedupe_key, attempt_no) do nothing
    returning 1
  )
  select count(*)::integer into inserted_count from attempts;
  return inserted_count;
end
$$;

create extension if not exists pg_cron;
select cron.schedule(
  'llp0102-partiful-supabase-reminders',
  '5 seconds',
  'select public.run_due_reminders()'
);

create or replace function public.record_effect_attempt(
  target_event uuid,
  target_dedupe text,
  target_attempt integer,
  target_state text,
  target_receipt text,
  target_code integer,
  target_fault text
)
returns public.notification_attempts
language plpgsql security definer set search_path = public
as $$
declare result public.notification_attempts;
begin
  insert into public.notification_attempts(
    event_id, kind, dedupe_key, attempt_no, state, provider_receipt, response_code, fault
  ) values (
    target_event, 'external-notification', target_dedupe, target_attempt,
    target_state, target_receipt, target_code, target_fault
  )
  on conflict (dedupe_key, attempt_no) do update set
    state = excluded.state,
    provider_receipt = excluded.provider_receipt,
    response_code = excluded.response_code,
    fault = excluded.fault
  returning * into result;
  return result;
end
$$;

revoke all on function public.record_effect_attempt(uuid, text, integer, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_effect_attempt(uuid, text, integer, text, text, integer, text) to service_role;

alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.event_members;
alter publication supabase_realtime add table public.rsvps;
alter publication supabase_realtime add table public.wall_posts;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('event-art', 'event-art', false, 10485760, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = false;

create policy event_art_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'event-art'
  and public.can_manage_event((storage.foldername(name))[1]::uuid)
);
create policy event_art_read on storage.objects for select to authenticated
using (
  bucket_id = 'event-art'
  and public.is_active_event_member((storage.foldername(name))[1]::uuid)
);
create policy event_art_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'event-art'
  and public.can_manage_event((storage.foldername(name))[1]::uuid)
);
