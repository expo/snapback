-- ub-b-supabase-1: Party Wall arm schema + policies, namespaced for
-- provable cleanup (0102 amendment). Applied via SUPABASE_DB_URL.
create table if not exists public.ub_b_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  host uuid not null
);
create table if not exists public.ub_b_members (
  event_id uuid not null references public.ub_b_events(id) on delete cascade,
  user_id uuid not null,
  primary key (event_id, user_id)
);
create table if not exists public.ub_b_photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ub_b_events(id) on delete cascade,
  caption text not null,
  author uuid not null,
  object_path text not null,
  created_at timestamptz not null default now()
);
alter table public.ub_b_events enable row level security;
alter table public.ub_b_members enable row level security;
alter table public.ub_b_photos enable row level security;

create policy "ub-b events member read" on public.ub_b_events for select to authenticated
  using (exists (select 1 from public.ub_b_members m where m.event_id = id and m.user_id = (select auth.uid())));
create policy "ub-b members self read" on public.ub_b_members for select to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from public.ub_b_members m2 where m2.event_id = event_id and m2.user_id = (select auth.uid())));
create policy "ub-b photos member read" on public.ub_b_photos for select to authenticated
  using (exists (select 1 from public.ub_b_members m where m.event_id = event_id and m.user_id = (select auth.uid())));
create policy "ub-b photos member insert" on public.ub_b_photos for insert to authenticated
  with check (author = (select auth.uid())
              and exists (select 1 from public.ub_b_members m where m.event_id = event_id and m.user_id = (select auth.uid())));
create policy "ub-b photos author delete" on public.ub_b_photos for delete to authenticated
  using (author = (select auth.uid()));

-- storage: bucket ub-b-party-1; path convention {event_id}/{file}
create policy "ub-b storage member read" on storage.objects for select to authenticated
  using (bucket_id = 'ub-b-party-1'
         and exists (select 1 from public.ub_b_members m
                     where m.event_id::text = (storage.foldername(name))[1]
                       and m.user_id = (select auth.uid())));
create policy "ub-b storage member write" on storage.objects for insert to authenticated
  with check (bucket_id = 'ub-b-party-1'
              and exists (select 1 from public.ub_b_members m
                          where m.event_id::text = (storage.foldername(name))[1]
                            and m.user_id = (select auth.uid())));

alter publication supabase_realtime add table public.ub_b_photos;
alter publication supabase_realtime add table public.ub_b_members;
