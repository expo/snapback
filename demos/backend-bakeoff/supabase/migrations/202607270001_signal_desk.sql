create extension if not exists pgcrypto;

create table if not exists public.bakeoff_incidents (
  id text primary key default gen_random_uuid()::text,
  title text not null check (length(trim(title)) > 0),
  summary text not null default '',
  severity text not null check (severity in ('SEV-1', 'SEV-2', 'SEV-3')),
  status text not null check (status in ('investigating', 'monitoring', 'resolved')),
  commander_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    to_tsvector('english', title || ' ' || summary || ' ' || severity || ' ' || status)
  ) stored
);

create index if not exists bakeoff_incidents_updated_idx
  on public.bakeoff_incidents (updated_at desc);
create index if not exists bakeoff_incidents_search_idx
  on public.bakeoff_incidents using gin (search_document);

create table if not exists public.bakeoff_tasks (
  id text primary key default gen_random_uuid()::text,
  incident_id text not null references public.bakeoff_incidents(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  completed boolean not null default false,
  assignee_id text not null,
  position integer not null,
  created_at timestamptz not null default now()
);
create index if not exists bakeoff_tasks_incident_idx
  on public.bakeoff_tasks (incident_id, position);

create table if not exists public.bakeoff_comments (
  id text primary key default gen_random_uuid()::text,
  incident_id text not null references public.bakeoff_incidents(id) on delete cascade,
  author_id text not null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists bakeoff_comments_incident_idx
  on public.bakeoff_comments (incident_id, created_at);

create table if not exists public.bakeoff_activity (
  id text primary key default gen_random_uuid()::text,
  incident_id text not null references public.bakeoff_incidents(id) on delete cascade,
  actor_id text not null,
  kind text not null,
  detail text not null,
  created_at timestamptz not null default now()
);
create index if not exists bakeoff_activity_incident_idx
  on public.bakeoff_activity (incident_id, created_at desc);

alter table public.bakeoff_incidents enable row level security;
alter table public.bakeoff_tasks enable row level security;
alter table public.bakeoff_comments enable row level security;
alter table public.bakeoff_activity enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'bakeoff_incidents', 'bakeoff_tasks', 'bakeoff_comments', 'bakeoff_activity'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name
        and policyname = 'bakeoff_demo_read'
    ) then
      execute format(
        'create policy bakeoff_demo_read on public.%I for select to anon, authenticated using (true)',
        table_name
      );
    end if;
  end loop;
end $$;

grant select on public.bakeoff_incidents to anon, authenticated;
grant select on public.bakeoff_tasks to anon, authenticated;
grant select on public.bakeoff_comments to anon, authenticated;
grant select on public.bakeoff_activity to anon, authenticated;

create or replace function public.bakeoff_record_activity(
  p_incident_id text,
  p_actor_id text,
  p_kind text,
  p_detail text,
  p_now timestamptz
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.bakeoff_activity
    (incident_id, actor_id, kind, detail, created_at)
  values (p_incident_id, p_actor_id, p_kind, p_detail, p_now);
$$;

create or replace function public.bakeoff_create_incident(
  p_actor_id text,
  p_title text,
  p_severity text,
  p_at_ms bigint
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  incident_id text;
  at_time timestamptz := to_timestamp(p_at_ms / 1000.0);
begin
  insert into public.bakeoff_incidents
    (title, summary, severity, status, commander_id, created_at, updated_at)
  values (
    trim(p_title),
    'Investigation started. Add tasks and field notes as evidence arrives.',
    p_severity,
    'investigating',
    p_actor_id,
    at_time,
    at_time
  )
  returning id into incident_id;
  perform public.bakeoff_record_activity(
    incident_id, p_actor_id, 'incident.created', p_severity || ' incident opened', at_time
  );
  return incident_id;
end;
$$;

create or replace function public.bakeoff_add_task(
  p_actor_id text,
  p_incident_id text,
  p_body text,
  p_at_ms bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_position integer;
  at_time timestamptz := to_timestamp(p_at_ms / 1000.0);
begin
  select coalesce(max(position), 0) + 1 into next_position
  from public.bakeoff_tasks where bakeoff_tasks.incident_id = p_incident_id;
  insert into public.bakeoff_tasks
    (incident_id, body, completed, assignee_id, position, created_at)
  values (p_incident_id, trim(p_body), false, p_actor_id, next_position, at_time);
  update public.bakeoff_incidents set updated_at = at_time where id = p_incident_id;
  perform public.bakeoff_record_activity(
    p_incident_id, p_actor_id, 'task.added', trim(p_body), at_time
  );
end;
$$;

create or replace function public.bakeoff_toggle_task(
  p_actor_id text,
  p_incident_id text,
  p_task_id text,
  p_completed boolean,
  p_at_ms bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  task_body text;
  at_time timestamptz := to_timestamp(p_at_ms / 1000.0);
begin
  update public.bakeoff_tasks
  set completed = p_completed
  where id = p_task_id and bakeoff_tasks.incident_id = p_incident_id
  returning body into task_body;
  if task_body is null then raise exception 'task not found'; end if;
  update public.bakeoff_incidents set updated_at = at_time where id = p_incident_id;
  perform public.bakeoff_record_activity(
    p_incident_id,
    p_actor_id,
    case when p_completed then 'task.completed' else 'task.reopened' end,
    task_body,
    at_time
  );
end;
$$;

create or replace function public.bakeoff_add_comment(
  p_actor_id text,
  p_incident_id text,
  p_body text,
  p_at_ms bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  at_time timestamptz := to_timestamp(p_at_ms / 1000.0);
begin
  insert into public.bakeoff_comments (incident_id, author_id, body, created_at)
  values (p_incident_id, p_actor_id, trim(p_body), at_time);
  update public.bakeoff_incidents set updated_at = at_time where id = p_incident_id;
  perform public.bakeoff_record_activity(
    p_incident_id, p_actor_id, 'comment.added', left(trim(p_body), 80), at_time
  );
end;
$$;

create or replace function public.bakeoff_set_status(
  p_actor_id text,
  p_incident_id text,
  p_status text,
  p_at_ms bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous text;
  at_time timestamptz := to_timestamp(p_at_ms / 1000.0);
begin
  select status into previous from public.bakeoff_incidents where id = p_incident_id;
  if previous is null then raise exception 'incident not found'; end if;
  update public.bakeoff_incidents
  set status = p_status, updated_at = at_time
  where id = p_incident_id;
  perform public.bakeoff_record_activity(
    p_incident_id, p_actor_id, 'incident.status', previous || ' → ' || p_status, at_time
  );
end;
$$;

create or replace function public.bakeoff_generate_brief(p_incident_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select
    i.severity || ' · ' || upper(i.status) || ' — ' || i.title || '. ' ||
    count(t.id) filter (where t.completed)::text || '/' || count(t.id)::text ||
    ' tasks complete. Latest note: ' ||
    coalesce(
      (select c.body from public.bakeoff_comments c
       where c.incident_id = i.id order by c.created_at desc limit 1),
      'No field notes yet.'
    )
  from public.bakeoff_incidents i
  left join public.bakeoff_tasks t on t.incident_id = i.id
  where i.id = p_incident_id
  group by i.id;
$$;

revoke all on function public.bakeoff_record_activity(text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.bakeoff_create_incident(text, text, text, bigint) from public;
revoke all on function public.bakeoff_add_task(text, text, text, bigint) from public;
revoke all on function public.bakeoff_toggle_task(text, text, text, boolean, bigint) from public;
revoke all on function public.bakeoff_add_comment(text, text, text, bigint) from public;
revoke all on function public.bakeoff_set_status(text, text, text, bigint) from public;
revoke all on function public.bakeoff_generate_brief(text) from public;

grant execute on function public.bakeoff_create_incident(text, text, text, bigint) to anon, authenticated;
grant execute on function public.bakeoff_add_task(text, text, text, bigint) to anon, authenticated;
grant execute on function public.bakeoff_toggle_task(text, text, text, boolean, bigint) to anon, authenticated;
grant execute on function public.bakeoff_add_comment(text, text, text, bigint) to anon, authenticated;
grant execute on function public.bakeoff_set_status(text, text, text, bigint) to anon, authenticated;
grant execute on function public.bakeoff_generate_brief(text) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'bakeoff_incidents'
  ) then
    alter publication supabase_realtime add table public.bakeoff_incidents;
    alter publication supabase_realtime add table public.bakeoff_tasks;
    alter publication supabase_realtime add table public.bakeoff_comments;
    alter publication supabase_realtime add table public.bakeoff_activity;
  end if;
end $$;

insert into public.bakeoff_incidents
  (id, title, summary, severity, status, commander_id, created_at, updated_at)
values
  (
    'incident_api',
    'Checkout API latency',
    'p95 latency rose after the catalog deploy; checkout remains available.',
    'SEV-2', 'investigating', 'user_ada',
    to_timestamp(1785157200), to_timestamp(1785159000)
  ),
  (
    'incident_email',
    'Receipt email backlog',
    'Transactional receipts are delayed in the west region.',
    'SEV-3', 'monitoring', 'user_grace',
    to_timestamp(1785146400), to_timestamp(1785155400)
  )
on conflict (id) do nothing;

insert into public.bakeoff_tasks
  (id, incident_id, body, completed, assignee_id, position, created_at)
values
  ('task_trace', 'incident_api', 'Compare traces before and after deploy', true, 'user_ada', 1, to_timestamp(1785157260)),
  ('task_cache', 'incident_api', 'Verify catalog cache hit rate', false, 'user_lin', 2, to_timestamp(1785157320)),
  ('task_queue', 'incident_email', 'Drain delayed receipt queue', true, 'user_grace', 1, to_timestamp(1785146460))
on conflict (id) do nothing;

insert into public.bakeoff_comments
  (id, incident_id, author_id, body, created_at)
values
  ('comment_api_1', 'incident_api', 'user_lin', 'Database time is flat; catalog calls account for most of the regression.', to_timestamp(1785157800)),
  ('comment_email_1', 'incident_email', 'user_grace', 'Backlog is shrinking and no messages have failed permanently.', to_timestamp(1785151800))
on conflict (id) do nothing;

insert into public.bakeoff_activity
  (id, incident_id, actor_id, kind, detail, created_at)
values
  ('activity_api_1', 'incident_api', 'user_ada', 'incident.created', 'SEV-2 incident opened', to_timestamp(1785157200)),
  ('activity_email_1', 'incident_email', 'user_grace', 'incident.status', 'investigating → monitoring', to_timestamp(1785155400))
on conflict (id) do nothing;
