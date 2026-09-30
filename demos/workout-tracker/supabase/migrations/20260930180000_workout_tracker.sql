-- Local single-user comparison. The anon grants are intentionally broad and
-- must be replaced with auth.uid()-scoped policies before hosted deployment.
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise text not null check (char_length(btrim(exercise)) between 1 and 80),
  reps integer not null check (reps between 1 and 1000),
  weight_kg_x10 integer not null check (weight_kg_x10 >= 0),
  completed boolean not null default false,
  at timestamptz not null default now()
);

create index workouts_started_at_idx on public.workouts (started_at desc, id desc);
create index workout_sets_at_idx on public.workout_sets (at desc, id desc);
create index workout_sets_workout_id_idx on public.workout_sets (workout_id);

alter table public.workouts enable row level security;
alter table public.workout_sets enable row level security;
create policy "local demo workouts" on public.workouts for all to anon using (true) with check (true);
create policy "local demo sets" on public.workout_sets for all to anon using (true) with check (true);
grant select, insert, update, delete on public.workouts, public.workout_sets to anon;

alter publication supabase_realtime add table public.workouts, public.workout_sets;
