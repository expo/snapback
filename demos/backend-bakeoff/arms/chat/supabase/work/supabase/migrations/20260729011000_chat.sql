create extension if not exists pgcrypto;

create table public.channels (
  id uuid primary key,
  arm_namespace text not null,
  slug text not null unique,
  name text not null,
  visibility text not null check (visibility in ('public', 'private')),
  sort_key integer not null unique,
  created_at timestamptz not null default clock_timestamp()
);

create table public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default clock_timestamp(),
  primary key (channel_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id),
  body text not null check (length(body) between 1 and 4000),
  seq bigint generated always as identity unique,
  created_at timestamptz not null default clock_timestamp()
);

create index messages_channel_seq_idx on public.messages(channel_id, seq desc);
create index channel_members_user_channel_idx on public.channel_members(user_id, channel_id);

create table public.read_markers (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  last_read_seq bigint not null check (last_read_seq >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (channel_id, user_id)
);

create or replace function public.can_access_channel(requested_channel uuid, requested_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels c
    where c.id = requested_channel
      and (
        c.visibility = 'public'
        or exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id and cm.user_id = requested_user
        )
      )
  );
$$;

create or replace function public.is_channel_member(requested_channel uuid, requested_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channel_members cm
    where cm.channel_id = requested_channel and cm.user_id = requested_user
  );
$$;

create or replace function public.can_access_realtime_topic(requested_topic text, requested_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  requested_channel uuid;
begin
  if split_part(requested_topic, ':', 1) <> 'chat' then
    return false;
  end if;
  requested_channel := split_part(requested_topic, ':', 2)::uuid;
  return public.can_access_channel(requested_channel, requested_user);
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.can_access_channel(uuid, uuid) from public;
revoke all on function public.is_channel_member(uuid, uuid) from public;
revoke all on function public.can_access_realtime_topic(text, uuid) from public;
grant execute on function public.can_access_channel(uuid, uuid) to authenticated;
grant execute on function public.is_channel_member(uuid, uuid) to authenticated;
grant execute on function public.can_access_realtime_topic(text, uuid) to authenticated;

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;
alter table public.read_markers enable row level security;

create policy channels_read_authorized
on public.channels for select to authenticated
using (public.can_access_channel(id, (select auth.uid())));

create policy members_read_authorized
on public.channel_members for select to authenticated
using (public.can_access_channel(channel_id, (select auth.uid())));

create policy messages_read_authorized
on public.messages for select to authenticated
using (public.can_access_channel(channel_id, (select auth.uid())));

create policy messages_insert_member
on public.messages for insert to authenticated
with check (
  author_id = (select auth.uid())
  and public.is_channel_member(channel_id, (select auth.uid()))
);

create policy markers_read_own
on public.read_markers for select to authenticated
using (user_id = (select auth.uid()));

create policy markers_insert_own_member
on public.read_markers for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_channel_member(channel_id, (select auth.uid()))
);

create policy markers_update_own_member
on public.read_markers for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and public.is_channel_member(channel_id, (select auth.uid()))
);

grant usage on schema public to authenticated;
grant select on public.channels, public.channel_members, public.messages, public.read_markers to authenticated;
grant insert on public.messages to authenticated;
grant insert, update on public.read_markers to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all privileges on public.channels, public.channel_members, public.messages, public.read_markers to service_role;
grant usage, select on all sequences in schema public to service_role;

alter publication supabase_realtime add table public.messages;

create policy chat_realtime_receive
on realtime.messages for select to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.can_access_realtime_topic((select realtime.topic()), (select auth.uid()))
);

create policy chat_realtime_send
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.can_access_realtime_topic((select realtime.topic()), (select auth.uid()))
);
