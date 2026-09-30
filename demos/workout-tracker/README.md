# Workout tracker backend comparison

One React web tracker backed by Convex, Supabase, or **snapback4@0.4.9**. The
same screen and task list are used for each backend. This is a local,
single-user development comparison; it does not claim production auth or
deployment readiness.

## Frozen task

1. Start a workout with a title; list active and past workouts newest first.
2. Add a set using an exercise name, positive reps, and a nonnegative weight
   in kilograms to one decimal place.
3. Mark a set complete or incomplete, remove a set, and finish a workout.
4. Show set count and completed volume (`reps × kilograms`) for each workout.
5. Observe changes in another open tab and retain them after reload.

Each backend stores workouts and sets. Weight is an integer in tenths of a
kilogram on all three backends. The React screen supplies a small shared
exercise suggestion list; users can type any exercise name. The comparison
does not include a separate exercise-catalog table, account management,
offline-write acceptance, or a hosted deployment.

## Run

From this directory, run `bun install`. Use two terminals for a backend and
Vite, then open the Vite URL (normally `http://localhost:5173`). Stop one Vite
process before switching backends; each choice uses its own data store.

| Backend | Terminal 1 | Terminal 2 |
| --- | --- | --- |
| Snapback 4 (0.4.9) | `bun run backend:snapback4` | `bun run dev` |
| Convex | `bun run backend:convex` | `bun run dev:convex` |
| Supabase | `bun run backend:supabase` | `bun run dev:supabase` |

The Snapback package is pinned to **`snapback4@0.4.9`** (the backend label in
the table means Snapback 4, version 0.4.9). Its development server uses port
4488. Override with `VITE_SNAPBACK_URL` if needed. The first visit creates a
local guest identity and reuses it on reload. `snapback4 dev` is loopback-only
development mode; do not expose it to a network.

For Convex, first run
`bunx convex dev --configure new --dev-deployment local --once` if this
checkout has no deployment. The CLI writes ignored `.env.local` settings and
may ask you to sign in or link a Convex project. Keep `backend:convex` running
to serve the local deployment and push function changes. This is a local
deployment, even if project linking uses a Convex account.

For Supabase, Docker Desktop (or another Docker-compatible daemon) must be
running. After `backend:supabase` starts and applies the SQL migration, run
`bun run configure:supabase` once to write the local URL and anon key into
ignored `.env.local`; restart Vite if it was already open. To stop the stack,
run `bunx supabase stop` from this directory.

`bun run typecheck` checks the shared UI and all three adapters. Build a
selected frontend with `bun run build` (Snapback),
`VITE_BACKEND=convex bun run build`, or
`VITE_BACKEND=supabase bun run build`. Use `bun run build:snapback4` for the
Snapback offline page shell. The app shows at most 100 recent workouts and
1,000 recent sets; it is a bounded demo rather than a pagination example.

## Comparison

The three implementations share [one UI](src/TrackerScreen.tsx), data shape,
and validation. [Convex](convex/workouts.ts) uses TypeScript functions and a
reactive `useQuery` snapshot. [Supabase](supabase/migrations/20260930180000_workout_tracker.sql)
uses SQL tables, constraints and RLS; the client explicitly subscribes to
Postgres Changes and refetches. [Snapback 4](snapback/schema.q) expresses
ownership, mutations, and a synced guest partition in its schema; its client
also handles pending durable writes. The dated build notes, friction and
qualification results are in
[diary 0123](../../diaries/0123-workout-tracker-three-backends.diary.md).

All three implementations are **local single-user comparisons**. Convex has no
account checks, Supabase's anonymous RLS policies allow all local users, and
Snapback uses development guest identities. Add real authorization and review
data exposure before any hosted deployment.
