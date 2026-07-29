create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key,
  arm_namespace text not null,
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  arm_namespace text not null,
  display_name text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, user_id)
);

create table public.teams (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, key)
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null check (role in ('lead', 'member')),
  primary key (team_id, user_id)
);

create table public.projects (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, slug)
);

create table public.labels (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null,
  unique (organization_id, name)
);

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  assignee_id uuid references public.profiles(user_id) on delete set null,
  issue_number integer not null,
  title text not null check (length(title) between 1 and 300),
  description text not null default '',
  status text not null check (status in ('backlog', 'todo', 'in_progress', 'review', 'done', 'canceled')),
  priority integer not null check (priority between 0 and 4),
  board_position numeric(18, 6) not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored,
  unique (organization_id, issue_number)
);

create table public.issue_labels (
  issue_id uuid not null references public.issues(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  primary key (issue_id, label_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(user_id),
  body text not null check (length(body) between 1 and 4000),
  sequence bigint generated always as identity unique,
  created_at timestamptz not null default clock_timestamp()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  actor_id uuid not null default auth.uid() references public.profiles(user_id),
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  sequence bigint generated always as identity unique,
  created_at timestamptz not null default clock_timestamp()
);

create index organization_members_user_org_idx
  on public.organization_members (user_id, organization_id);
create index team_members_user_team_idx
  on public.team_members (user_id, team_id);
create index teams_organization_idx
  on public.teams (organization_id, id);
create index projects_organization_idx
  on public.projects (organization_id, id);
create index labels_organization_idx
  on public.labels (organization_id, id);
create index issues_organization_status_order_idx
  on public.issues (organization_id, status, created_at desc, id desc);
create index issues_organization_assignee_order_idx
  on public.issues (organization_id, assignee_id, created_at desc, id desc);
create index issues_organization_project_order_idx
  on public.issues (organization_id, project_id, created_at desc, id desc);
create index issues_organization_cursor_idx
  on public.issues (organization_id, created_at desc, id desc);
create index issues_search_document_idx
  on public.issues using gin (search_document);
create index issue_labels_label_issue_idx
  on public.issue_labels (label_id, issue_id);
create index comments_issue_sequence_idx
  on public.comments (issue_id, sequence);
create index activities_issue_sequence_idx
  on public.activities (issue_id, sequence);

create or replace function public.is_organization_member(requested_organization uuid, requested_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = requested_organization
      and user_id = requested_user
  );
$$;

create or replace function public.can_access_issue(requested_issue uuid, requested_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.issues
    where id = requested_issue
      and public.is_organization_member(organization_id, requested_user)
  );
$$;

create or replace function public.shares_organization(requested_user uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members target
    join public.organization_members current
      on current.organization_id = target.organization_id
    where target.user_id = requested_user
      and current.user_id = viewer
  );
$$;

revoke all on function public.is_organization_member(uuid, uuid) from public;
revoke all on function public.can_access_issue(uuid, uuid) from public;
revoke all on function public.shares_organization(uuid, uuid) from public;
grant execute on function public.is_organization_member(uuid, uuid) to authenticated;
grant execute on function public.can_access_issue(uuid, uuid) to authenticated;
grant execute on function public.shares_organization(uuid, uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.projects enable row level security;
alter table public.labels enable row level security;
alter table public.issues enable row level security;
alter table public.issue_labels enable row level security;
alter table public.comments enable row level security;
alter table public.activities enable row level security;

create policy organizations_member_read
on public.organizations for select to authenticated
using (public.is_organization_member(id, (select auth.uid())));

create policy profiles_shared_org_read
on public.profiles for select to authenticated
using (
  user_id = (select auth.uid())
  or public.shares_organization(user_id, (select auth.uid()))
);

create policy organization_members_member_read
on public.organization_members for select to authenticated
using (public.is_organization_member(organization_id, (select auth.uid())));

create policy teams_member_read
on public.teams for select to authenticated
using (public.is_organization_member(organization_id, (select auth.uid())));

create policy team_members_member_read
on public.team_members for select to authenticated
using (
  exists (
    select 1
    from public.teams
    where teams.id = team_members.team_id
      and public.is_organization_member(teams.organization_id, (select auth.uid()))
  )
);

create policy projects_member_read
on public.projects for select to authenticated
using (public.is_organization_member(organization_id, (select auth.uid())));

create policy labels_member_read
on public.labels for select to authenticated
using (public.is_organization_member(organization_id, (select auth.uid())));

create policy issues_member_read
on public.issues for select to authenticated
using (public.is_organization_member(organization_id, (select auth.uid())));

create policy issues_member_update
on public.issues for update to authenticated
using (public.is_organization_member(organization_id, (select auth.uid())))
with check (public.is_organization_member(organization_id, (select auth.uid())));

create policy issue_labels_member_read
on public.issue_labels for select to authenticated
using (public.can_access_issue(issue_id, (select auth.uid())));

create policy comments_member_read
on public.comments for select to authenticated
using (public.can_access_issue(issue_id, (select auth.uid())));

create policy comments_member_insert
on public.comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and public.can_access_issue(issue_id, (select auth.uid()))
);

create policy activities_member_read
on public.activities for select to authenticated
using (public.can_access_issue(issue_id, (select auth.uid())));

create policy activities_member_insert
on public.activities for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and public.can_access_issue(issue_id, (select auth.uid()))
);

create or replace function public.linear_touch_issue()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger issues_touch_updated_at
before update on public.issues
for each row execute function public.linear_touch_issue();

create or replace function public.linear_comment_activity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.activities (issue_id, actor_id, kind, detail)
  values (new.issue_id, new.author_id, 'comment.created', jsonb_build_object('commentId', new.id));
  return new;
end;
$$;

create trigger comments_create_activity
after insert on public.comments
for each row execute function public.linear_comment_activity();

create or replace function public.linear_update_issue(
  requested_issue uuid,
  requested_status text,
  requested_priority integer,
  requested_assignee uuid,
  requested_board_position numeric,
  requested_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  before_row public.issues;
  after_row public.issues;
  activity_sequence bigint;
begin
  select * into before_row
  from public.issues
  where id = requested_issue
  for update;

  if before_row.id is null then
    raise exception 'issue unavailable';
  end if;

  if requested_assignee is not null and not exists (
    select 1
    from public.organization_members
    where organization_id = before_row.organization_id
      and user_id = requested_assignee
  ) then
    raise exception 'assignee is not an organization member';
  end if;

  update public.issues
  set status = requested_status,
      priority = requested_priority,
      assignee_id = requested_assignee,
      board_position = requested_board_position,
      revision = revision + 1
  where id = requested_issue
  returning * into after_row;

  insert into public.activities (issue_id, actor_id, kind, detail)
  values (
    requested_issue,
    (select auth.uid()),
    requested_action,
    jsonb_build_object(
      'before', jsonb_build_object(
        'status', before_row.status,
        'priority', before_row.priority,
        'assigneeId', before_row.assignee_id,
        'boardPosition', before_row.board_position,
        'revision', before_row.revision
      ),
      'after', jsonb_build_object(
        'status', after_row.status,
        'priority', after_row.priority,
        'assigneeId', after_row.assignee_id,
        'boardPosition', after_row.board_position,
        'revision', after_row.revision
      )
    )
  )
  returning sequence into activity_sequence;

  return jsonb_build_object(
    'id', after_row.id,
    'status', after_row.status,
    'priority', after_row.priority,
    'assigneeId', after_row.assignee_id,
    'boardPosition', after_row.board_position,
    'revision', after_row.revision,
    'activitySequence', activity_sequence
  );
end;
$$;

create or replace function public.linear_issue_page(
  requested_organization uuid,
  before_created_at timestamptz default null,
  before_id uuid default null,
  requested_limit integer default 50
)
returns setof public.issues
language sql
stable
security invoker
set search_path = public
as $$
  select issues.*
  from public.issues
  where organization_id = requested_organization
    and (
      before_created_at is null
      or (created_at, id) < (before_created_at, before_id)
    )
  order by created_at desc, id desc
  limit least(greatest(requested_limit, 1), 50);
$$;

create or replace function public.linear_search_issues(
  requested_organization uuid,
  search_query text,
  requested_limit integer default 50
)
returns setof public.issues
language sql
stable
security invoker
set search_path = public
as $$
  select issues.*
  from public.issues
  where organization_id = requested_organization
    and search_document @@ websearch_to_tsquery('english', search_query)
  order by
    ts_rank(search_document, websearch_to_tsquery('english', search_query)) desc,
    issue_number asc,
    id asc
  limit least(greatest(requested_limit, 1), 50);
$$;

revoke all on function public.linear_update_issue(uuid, text, integer, uuid, numeric, text) from public;
revoke all on function public.linear_issue_page(uuid, timestamptz, uuid, integer) from public;
revoke all on function public.linear_search_issues(uuid, text, integer) from public;

grant usage on schema public to authenticated;
grant select on public.organizations, public.profiles, public.organization_members,
  public.teams, public.team_members, public.projects, public.labels, public.issues,
  public.issue_labels, public.comments, public.activities to authenticated;
grant update (status, priority, assignee_id, board_position, revision, updated_at)
  on public.issues to authenticated;
grant insert on public.comments, public.activities to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.linear_update_issue(uuid, text, integer, uuid, numeric, text) to authenticated;
grant execute on function public.linear_issue_page(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.linear_search_issues(uuid, text, integer) to authenticated;

grant all privileges on public.organizations, public.profiles, public.organization_members,
  public.teams, public.team_members, public.projects, public.labels, public.issues,
  public.issue_labels, public.comments, public.activities to service_role;
grant usage, select on all sequences in schema public to service_role;

alter publication supabase_realtime add table public.issues;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.activities;
