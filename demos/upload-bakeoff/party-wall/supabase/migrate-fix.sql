-- Fix the RLS self-recursion (42P17, masked by storage-api as a 503):
-- membership checks move into a SECURITY DEFINER helper — the canonical
-- Supabase idiom — and every policy consults the function, never the
-- table under its own RLS.
create or replace function public.ub_b_is_member(e uuid, u uuid)
returns boolean language sql security definer stable
set search_path = public
as $$ select exists(select 1 from public.ub_b_members where event_id = e and user_id = u) $$;
revoke all on function public.ub_b_is_member(uuid, uuid) from public;
grant execute on function public.ub_b_is_member(uuid, uuid) to authenticated, anon, service_role;

drop policy if exists "ub-b events member read" on public.ub_b_events;
drop policy if exists "ub-b members self read" on public.ub_b_members;
drop policy if exists "ub-b photos member read" on public.ub_b_photos;
drop policy if exists "ub-b photos member insert" on public.ub_b_photos;
drop policy if exists "ub-b photos author delete" on public.ub_b_photos;
drop policy if exists "ub-b storage member read" on storage.objects;
drop policy if exists "ub-b storage member write" on storage.objects;

create policy "ub-b events member read" on public.ub_b_events for select to authenticated
  using (public.ub_b_is_member(id, (select auth.uid())));
create policy "ub-b members self read" on public.ub_b_members for select to authenticated
  using (public.ub_b_is_member(event_id, (select auth.uid())));
create policy "ub-b photos member read" on public.ub_b_photos for select to authenticated
  using (public.ub_b_is_member(event_id, (select auth.uid())));
create policy "ub-b photos member insert" on public.ub_b_photos for insert to authenticated
  with check (author = (select auth.uid()) and public.ub_b_is_member(event_id, (select auth.uid())));
create policy "ub-b photos author delete" on public.ub_b_photos for delete to authenticated
  using (author = (select auth.uid()));
create policy "ub-b storage member read" on storage.objects for select to authenticated
  using (bucket_id = 'ub-b-party-1'
         and public.ub_b_is_member(((storage.foldername(name))[1])::uuid, (select auth.uid())));
create policy "ub-b storage member write" on storage.objects for insert to authenticated
  with check (bucket_id = 'ub-b-party-1'
              and public.ub_b_is_member(((storage.foldername(name))[1])::uuid, (select auth.uid())));
