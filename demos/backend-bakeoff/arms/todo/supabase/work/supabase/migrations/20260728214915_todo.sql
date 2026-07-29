create table public.llp0102_todo_sb01_workspaces (
  id uuid primary key,
  namespace text not null unique,
  name text not null
);

create table public.llp0102_todo_sb01_memberships (
  id uuid primary key,
  workspace_id uuid not null references public.llp0102_todo_sb01_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  persona text not null,
  unique (workspace_id, user_id)
);

create table public.llp0102_todo_sb01_lists (
  id uuid primary key,
  workspace_id uuid not null references public.llp0102_todo_sb01_workspaces(id) on delete cascade,
  name text not null,
  ordinal integer not null,
  task_order uuid[] not null default '{}',
  unique (workspace_id, ordinal)
);

create table public.llp0102_todo_sb01_tasks (
  id uuid primary key,
  workspace_id uuid not null references public.llp0102_todo_sb01_workspaces(id) on delete cascade,
  list_id uuid not null references public.llp0102_todo_sb01_lists(id) on delete cascade,
  title text not null check (length(title) between 1 and 500),
  completed boolean not null default false,
  assignee text not null,
  due_date date not null,
  revision bigint not null default 0,
  seed_key text not null unique
);

create index llp0102_todo_sb01_memberships_user_idx
  on public.llp0102_todo_sb01_memberships(user_id, workspace_id);
create index llp0102_todo_sb01_lists_workspace_idx
  on public.llp0102_todo_sb01_lists(workspace_id, ordinal);
create index llp0102_todo_sb01_tasks_workspace_idx
  on public.llp0102_todo_sb01_tasks(workspace_id, list_id);

create function public.llp0102_todo_sb01_is_member(candidate_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.llp0102_todo_sb01_memberships membership
    where membership.workspace_id = candidate_workspace
      and membership.user_id = (select auth.uid())
  );
$$;

revoke all on function public.llp0102_todo_sb01_is_member(uuid) from public;
grant execute on function public.llp0102_todo_sb01_is_member(uuid) to authenticated, service_role;

alter table public.llp0102_todo_sb01_workspaces enable row level security;
alter table public.llp0102_todo_sb01_memberships enable row level security;
alter table public.llp0102_todo_sb01_lists enable row level security;
alter table public.llp0102_todo_sb01_tasks enable row level security;

create policy llp0102_todo_sb01_workspace_read
  on public.llp0102_todo_sb01_workspaces
  for select to authenticated
  using (public.llp0102_todo_sb01_is_member(id));

create policy llp0102_todo_sb01_membership_read
  on public.llp0102_todo_sb01_memberships
  for select to authenticated
  using (public.llp0102_todo_sb01_is_member(workspace_id));

create policy llp0102_todo_sb01_list_read
  on public.llp0102_todo_sb01_lists
  for select to authenticated
  using (public.llp0102_todo_sb01_is_member(workspace_id));
create policy llp0102_todo_sb01_list_update
  on public.llp0102_todo_sb01_lists
  for update to authenticated
  using (public.llp0102_todo_sb01_is_member(workspace_id))
  with check (public.llp0102_todo_sb01_is_member(workspace_id));

create policy llp0102_todo_sb01_task_read
  on public.llp0102_todo_sb01_tasks
  for select to authenticated
  using (public.llp0102_todo_sb01_is_member(workspace_id));
create policy llp0102_todo_sb01_task_insert
  on public.llp0102_todo_sb01_tasks
  for insert to authenticated
  with check (public.llp0102_todo_sb01_is_member(workspace_id));
create policy llp0102_todo_sb01_task_update
  on public.llp0102_todo_sb01_tasks
  for update to authenticated
  using (public.llp0102_todo_sb01_is_member(workspace_id))
  with check (public.llp0102_todo_sb01_is_member(workspace_id));
create policy llp0102_todo_sb01_task_delete
  on public.llp0102_todo_sb01_tasks
  for delete to authenticated
  using (public.llp0102_todo_sb01_is_member(workspace_id));

grant select on public.llp0102_todo_sb01_workspaces to authenticated;
grant select on public.llp0102_todo_sb01_memberships to authenticated;
grant select, update on public.llp0102_todo_sb01_lists to authenticated;
grant select, insert, update, delete on public.llp0102_todo_sb01_tasks to authenticated;
grant all on public.llp0102_todo_sb01_workspaces to service_role;
grant all on public.llp0102_todo_sb01_memberships to service_role;
grant all on public.llp0102_todo_sb01_lists to service_role;
grant all on public.llp0102_todo_sb01_tasks to service_role;

create function public.llp0102_todo_sb01_create_task(
  selected_list uuid,
  task_title text
)
returns public.llp0102_todo_sb01_tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_workspace uuid;
  created public.llp0102_todo_sb01_tasks;
begin
  select workspace_id into selected_workspace
  from public.llp0102_todo_sb01_lists
  where id = selected_list;
  if selected_workspace is null then
    raise exception 'authorized list not found';
  end if;
  insert into public.llp0102_todo_sb01_tasks (
    id, workspace_id, list_id, title, completed, assignee, due_date, revision, seed_key
  ) values (
    gen_random_uuid(), selected_workspace, selected_list, task_title, false,
    'Alice', date '2026-08-01', 0, 'created:' || gen_random_uuid()::text
  ) returning * into created;
  update public.llp0102_todo_sb01_lists
  set task_order = array_append(task_order, created.id)
  where id = selected_list;
  return created;
end;
$$;

create function public.llp0102_todo_sb01_patch_task(
  selected_task uuid,
  task_title text default null,
  task_completed boolean default null
)
returns public.llp0102_todo_sb01_tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed public.llp0102_todo_sb01_tasks;
begin
  update public.llp0102_todo_sb01_tasks
  set title = coalesce(task_title, title),
      completed = coalesce(task_completed, completed),
      revision = revision + 1
  where id = selected_task
  returning * into changed;
  if changed.id is null then
    raise exception 'authorized task not found';
  end if;
  return changed;
end;
$$;

create function public.llp0102_todo_sb01_delete_task(selected_task uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_list uuid;
begin
  select list_id into selected_list
  from public.llp0102_todo_sb01_tasks
  where id = selected_task;
  if selected_list is null then
    raise exception 'authorized task not found';
  end if;
  update public.llp0102_todo_sb01_lists
  set task_order = array_remove(task_order, selected_task)
  where id = selected_list;
  delete from public.llp0102_todo_sb01_tasks where id = selected_task;
  return selected_task;
end;
$$;

revoke all on function public.llp0102_todo_sb01_create_task(uuid, text) from public;
revoke all on function public.llp0102_todo_sb01_patch_task(uuid, text, boolean) from public;
revoke all on function public.llp0102_todo_sb01_delete_task(uuid) from public;
grant execute on function public.llp0102_todo_sb01_create_task(uuid, text) to authenticated;
grant execute on function public.llp0102_todo_sb01_patch_task(uuid, text, boolean) to authenticated;
grant execute on function public.llp0102_todo_sb01_delete_task(uuid) to authenticated;

alter table public.llp0102_todo_sb01_lists replica identity full;
alter table public.llp0102_todo_sb01_tasks replica identity full;
alter publication supabase_realtime add table
  public.llp0102_todo_sb01_workspaces,
  public.llp0102_todo_sb01_memberships,
  public.llp0102_todo_sb01_lists,
  public.llp0102_todo_sb01_tasks;
