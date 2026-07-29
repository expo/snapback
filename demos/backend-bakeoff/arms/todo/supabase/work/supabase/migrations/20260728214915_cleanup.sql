begin;

alter publication supabase_realtime drop table
  public.llp0102_todo_sb01_workspaces,
  public.llp0102_todo_sb01_memberships,
  public.llp0102_todo_sb01_lists,
  public.llp0102_todo_sb01_tasks;

drop function public.llp0102_todo_sb01_delete_task(uuid);
drop function public.llp0102_todo_sb01_patch_task(uuid, text, boolean);
drop function public.llp0102_todo_sb01_create_task(uuid, text);

drop table public.llp0102_todo_sb01_tasks;
drop table public.llp0102_todo_sb01_lists;
drop table public.llp0102_todo_sb01_memberships;
drop table public.llp0102_todo_sb01_workspaces;

drop function public.llp0102_todo_sb01_is_member(uuid);

commit;
