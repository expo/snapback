-- ub-b-supabase-1 cleanup: drop everything the arm created, nothing else.
alter publication supabase_realtime drop table if exists public.ub_b_photos;
alter publication supabase_realtime drop table if exists public.ub_b_members;
drop policy if exists "ub-b storage member read" on storage.objects;
drop policy if exists "ub-b storage member write" on storage.objects;
drop table if exists public.ub_b_photos;
drop table if exists public.ub_b_members;
drop table if exists public.ub_b_events;
drop function if exists public.ub_b_is_member(uuid, uuid);
