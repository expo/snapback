create extension if not exists vector with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create type public.question_state as enum ('active','complete','failed','cancelled','timed_out','ambiguous');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null
);
create table public.rooms (
  id uuid primary key,
  slug text unique not null,
  name text not null,
  owner_id uuid not null references public.profiles(id)
);
create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','member')),
  primary key (room_id,user_id)
);
create table public.sources (
  id uuid primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  title text not null,
  body text not null,
  byte_size integer not null,
  content_hash text not null,
  storage_path text,
  embedding extensions.vector(32) not null,
  search_document tsvector generated always as (to_tsvector('english', title || ' ' || body)) stored,
  created_at timestamptz not null default now()
);
create index sources_search_idx on public.sources using gin(search_document);
create index sources_embedding_idx on public.sources using hnsw (embedding extensions.vector_cosine_ops);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  prompt text not null,
  dedupe_key text not null,
  state public.question_state not null default 'active',
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique(author_id,room_id,dedupe_key)
);
create table public.progress_updates (
  id bigint generated always as identity primary key,
  question_id uuid not null references public.questions(id) on delete cascade,
  seq integer not null check (seq between 1 and 4),
  stage text not null,
  created_at timestamptz not null default now(),
  unique(question_id,seq)
);
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.questions(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create table public.citations (
  answer_id uuid not null references public.answers(id) on delete cascade,
  source_id uuid not null references public.sources(id),
  primary key(answer_id,source_id)
);
create table public.effect_attempts (
  id bigint generated always as identity primary key,
  question_id uuid not null references public.questions(id) on delete cascade,
  attempt integer not null,
  requested_outcome public.question_state not null,
  settlement text not null,
  unique(question_id,attempt)
);
create table public.scheduled_refreshes (
  id bigint generated always as identity primary key,
  dedupe_key text unique not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  external_url text not null,
  content_hash text not null,
  progress text not null,
  ran_at timestamptz not null default now()
);
create table public.server_secrets (
  name text primary key,
  secret_hash text not null
);
revoke all on public.server_secrets from anon, authenticated;

create or replace function public.is_room_member(target_room uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from room_members where room_id=target_room and user_id=auth.uid()) $$;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.sources enable row level security;
alter table public.questions enable row level security;
alter table public.progress_updates enable row level security;
alter table public.answers enable row level security;
alter table public.citations enable row level security;
alter table public.effect_attempts enable row level security;
alter table public.scheduled_refreshes enable row level security;
alter table public.server_secrets enable row level security;

create policy profiles_self_or_shared on public.profiles for select to authenticated
using (id=auth.uid() or exists(select 1 from room_members mine join room_members theirs using(room_id) where mine.user_id=auth.uid() and theirs.user_id=profiles.id));
create policy rooms_members on public.rooms for select to authenticated using (is_room_member(id));
create policy members_members on public.room_members for select to authenticated using (is_room_member(room_id));
create policy sources_members_select on public.sources for select to authenticated using (is_room_member(room_id));
create policy sources_owner_insert on public.sources for insert to authenticated with check (owner_id=auth.uid() and is_room_member(room_id));
create policy sources_owner_delete on public.sources for delete to authenticated using (owner_id=auth.uid() and is_room_member(room_id));
create policy questions_members_select on public.questions for select to authenticated using (is_room_member(room_id));
create policy progress_members_select on public.progress_updates for select to authenticated
using (exists(select 1 from questions q where q.id=question_id and is_room_member(q.room_id)));
create policy answers_members_select on public.answers for select to authenticated
using (exists(select 1 from questions q where q.id=question_id and is_room_member(q.room_id)));
create policy citations_members_select on public.citations for select to authenticated
using (exists(select 1 from answers a join questions q on q.id=a.question_id where a.id=answer_id and is_room_member(q.room_id)));
create policy attempts_members_select on public.effect_attempts for select to authenticated
using (exists(select 1 from questions q where q.id=question_id and is_room_member(q.room_id)));
create policy refresh_members_select on public.scheduled_refreshes for select to authenticated using (is_room_member(room_id));

insert into storage.buckets(id,name,public,file_size_limit) values ('research-sources','research-sources',false,1048576);
create policy source_objects_read on storage.objects for select to authenticated
using (bucket_id='research-sources' and public.is_room_member(((storage.foldername(name))[1])::uuid));
create policy source_objects_insert on storage.objects for insert to authenticated
with check (bucket_id='research-sources' and owner_id=auth.uid()::text and public.is_room_member(((storage.foldername(name))[1])::uuid));
create policy source_objects_delete on storage.objects for delete to authenticated
using (bucket_id='research-sources' and owner_id=auth.uid()::text and public.is_room_member(((storage.foldername(name))[1])::uuid));

create policy research_progress_broadcast_read on realtime.messages
for select to authenticated
using (
  extension='broadcast'
  and exists (
    select 1 from public.questions q
    where ('question:' || q.id::text)=realtime.topic()
      and public.is_room_member(q.room_id)
  )
);

create or replace function public.keyword_search(target_room uuid, terms text)
returns table(id uuid,title text,rank real) language sql stable security invoker set search_path=public
as $$ select s.id,s.title,ts_rank(s.search_document,websearch_to_tsquery('english',terms)) from sources s
where s.room_id=target_room and s.search_document @@ websearch_to_tsquery('english',terms)
order by 3 desc,s.id $$;

create or replace function public.semantic_search(target_room uuid, query_embedding extensions.vector(32), match_count integer default 5)
returns table(id uuid,title text,distance double precision) language sql stable security invoker set search_path=public,extensions
as $$ select s.id,s.title,(s.embedding <=> query_embedding) from sources s where s.room_id=target_room order by s.embedding <=> query_embedding,s.id limit match_count $$;

create or replace function public.start_question(target_room uuid, question_prompt text, client_dedupe_key text)
returns public.questions language plpgsql security definer set search_path=public
as $$
declare result public.questions;
begin
  if not is_room_member(target_room) then raise exception 'not authorized'; end if;
  insert into questions(room_id,author_id,prompt,dedupe_key) values(target_room,auth.uid(),question_prompt,client_dedupe_key)
  on conflict(author_id,room_id,dedupe_key) do update set prompt=questions.prompt returning * into result;
  insert into effect_attempts(question_id,attempt,requested_outcome,settlement)
  values(result.id,coalesce((select max(attempt)+1 from effect_attempts where question_id=result.id),1),'active','accepted')
  on conflict do nothing;
  return result;
end $$;

create or replace function public.append_progress(target_question uuid, progress_seq integer, progress_stage text)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  if not exists(select 1 from questions q where q.id=target_question and q.author_id=auth.uid() and q.state='active') then return false; end if;
  insert into progress_updates(question_id,seq,stage) values(target_question,progress_seq,progress_stage) on conflict do nothing;
  return found;
end $$;

create or replace function public.complete_question(target_question uuid, answer_body text, cited_sources uuid[])
returns uuid language plpgsql security definer set search_path=public
as $$
declare result uuid;
begin
  if not exists(select 1 from questions q where q.id=target_question and q.author_id=auth.uid() and q.state='active'
    and (select count(*) from progress_updates p where p.question_id=q.id)=4) then raise exception 'question not active or progress incomplete'; end if;
  if exists(select 1 from unnest(cited_sources) sid where not exists(
    select 1 from sources s join questions q on q.room_id=s.room_id where q.id=target_question and s.id=sid
  )) then raise exception 'invalid citation'; end if;
  insert into answers(question_id,body) values(target_question,answer_body) returning id into result;
  insert into citations(answer_id,source_id) select result,unnest(cited_sources);
  update questions set state='complete',settled_at=now() where id=target_question and state='active';
  return result;
end $$;

create or replace function public.cancel_question(target_question uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  update questions set state='cancelled',cancelled_at=clock_timestamp(),settled_at=clock_timestamp()
  where id=target_question and author_id=auth.uid() and state='active';
  return found;
end $$;

create or replace function public.settle_fault(target_room uuid, client_dedupe_key text, target_state public.question_state)
returns public.questions language plpgsql security definer set search_path=public
as $$
declare result public.questions;
begin
  if target_state not in ('failed','timed_out','ambiguous') or not is_room_member(target_room) then raise exception 'invalid settlement'; end if;
  insert into questions(room_id,author_id,prompt,dedupe_key,state,settled_at)
  values(target_room,auth.uid(),'fault injection',client_dedupe_key,target_state,clock_timestamp())
  returning * into result;
  insert into effect_attempts(question_id,attempt,requested_outcome,settlement) values(result.id,1,target_state,target_state::text);
  return result;
end $$;

create or replace function public.perform_scheduled_refresh(target_room uuid, refresh_key text)
returns bigint language plpgsql security definer set search_path=public
as $$
declare result bigint;
begin
  insert into scheduled_refreshes(dedupe_key,room_id,external_url,content_hash,progress)
  values(refresh_key,target_room,'https://example.invalid/frozen-research-source','sha256:frozen-external-source','fetched')
  on conflict(dedupe_key) do update set dedupe_key=excluded.dedupe_key returning id into result;
  return result;
end $$;
revoke execute on function public.perform_scheduled_refresh(uuid,text) from anon,authenticated;

create or replace function public.broadcast_progress()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform realtime.broadcast_changes(
    'question:' || new.question_id::text,
    'progress',
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end $$;
create trigger progress_broadcast
after insert on public.progress_updates
for each row execute function public.broadcast_progress();

select cron.schedule(
  'llp0102-research-supabase-w2-r2-refresh',
  '5 seconds',
  $$select public.perform_scheduled_refresh('10000000-0000-4000-8000-000000000001'::uuid,'scheduled-primary')$$
);

alter publication supabase_realtime add table public.progress_updates,public.questions,public.answers;

grant usage on schema public to anon,authenticated,service_role;
grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
grant usage,select on all sequences in schema public to authenticated,service_role;
revoke all on public.server_secrets from anon,authenticated;
revoke execute on function public.perform_scheduled_refresh(uuid,text) from anon,authenticated;
