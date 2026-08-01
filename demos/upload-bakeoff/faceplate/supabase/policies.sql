-- ub-a-supabase-1: RLS policies for the Faceplate arm, scoped strictly to
-- the arm's bucket. Names carry the arm namespace for provable cleanup.
create policy "ub-a-supabase-1 owner writes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ub-a-supabase-1-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "ub-a-supabase-1 owner updates"
  on storage.objects for update to authenticated
  using (bucket_id = 'ub-a-supabase-1-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "ub-a-supabase-1 authenticated reads"
  on storage.objects for select to authenticated
  using (bucket_id = 'ub-a-supabase-1-avatars');
