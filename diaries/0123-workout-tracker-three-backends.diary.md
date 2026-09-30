# Diary 0123: One workout tracker on Convex, Supabase, and Snapback 4

**Date:** 2026-09-30

**Subject:** local React workout tracker using Convex 1.46.0, Supabase client 2.117.2 / CLI 2.118.0, and snapback4 0.4.9

**Agent:** Codex

**App:** [demos/workout-tracker](../demos/workout-tracker/README.md)

## The fixed exercise

I kept one React screen and normalized model for all three backends. A user
can start a named workout, add exercise sets with reps and tenths of a
kilogram, toggle completion, remove a set, finish a workout, and see history
and completed volume. I used name suggestions rather than a separate exercise
catalog. The comparison is local and single-user, with no hosted deployment,
account model, or offline-write qualification. All three lists cap their
display at 100 workouts and 1,000 sets.

## Convex

The schema, indexes, validation and six operations were quick to express in
TypeScript. The generated API types made the React adapter direct:
`useQuery(snapshot)` kept the screen updated without a separate subscription
or client-side refetch routine. The local CLI accepted create/add/read calls;
the browser created a second workout, recorded a 3 × 120 kg deadlift set and
immediately showed 360 kg when I completed it. A separate CLI mutation then
appeared in an already-open browser without reload.

The first local deployment setup linked a Convex project in the authenticated
account before starting the local backend. That is more setup than a purely
local schema command, even though the test data stayed local. The backend
process must remain running. I wrote explicit function validation because
Convex's schema types alone did not express the title, reps and weight rules.
There is no authorization boundary in this comparison's functions, so this
version is only safe as a local exercise.

## Supabase

Postgres constraints were the most explicit representation of the data rules:
foreign keys, checks, indexes, timestamp defaults, grants and RLS live in one
migration. Anonymous local API insert/update/select passed for a complete
workout. Adding both tables to `supabase_realtime` and subscribing to Postgres
Changes made a separate browser update when an API client inserted a workout.
The shared screen displayed the previously stored completed 400 kg session
after reload.

The extra work was operational and client-side. The local CLI required a
Docker daemon and downloaded a full stack of images; the first image pull was
rate-limited once and retried. Docker Desktop subsequently stopped, making
both reads and Realtime unavailable until I restarted it. This was a local
runtime interruption, not a database or migration failure. The React adapter
needed an explicit read, a subscription for two tables, and a refetch after
each change; its status and error handling are also application code. The
anonymous RLS policies are deliberately permissive for this local comparison
and would need account-scoped replacements before hosting.

## Snapback 4 (0.4.9)

The schema put owner checks, mutations, indexed queries and the guest's synced
partition in one file. `snapback4 init --web` gave a working React/Vite client
with the guest sign-in and local device wiring already present, which saved
client setup. `snapback4 check` compiled seven operations over two tables. The
CLI created a workout and set, toggled completion and read the resulting rows.
In Chrome the screen created a workout, added and completed a 5 × 80 kg set,
showed 400 kg, finished the workout, and restored that result after reload.
A later set added in one Chrome tab appeared in a second tab without reload.

The write contract demanded more care in the adapter. A mutation may return
`pending` after local custody rather than a final server result, so the UI
tracks the write ID and observes its eventual receipt before clearing the
queued status; I checked that status transition in the browser. A pending
create also lacks the new row ID; the screen can
show the arriving row but cannot automatically select it when another workout
is already selected. Reads can briefly revalidate while a local prediction
settles. I also had to stop the dev server before running a CLI command on
its SQLite store, because the store permits one owning process. These are
meaningful differences from a simple request/response CRUD adapter.

The repository's root `guide/index.md` describes the earlier Snapback
authoring surface, while this task targets Snapback 4. The installed package
and `snapback4/README.md` supplied the relevant commands and schema syntax.
That routing gap is recorded in
[a guide-gap issue](../issues/20260930-guide-gap-route-snapback4-authors.md).

## Comparison and qualification

| Dimension | Convex | Supabase | Snapback 4 |
| --- | --- | --- | --- |
| Data and rules | TypeScript functions and validators | SQL DDL, checks, RLS | One declarative schema with owner rules and mutations |
| Live client | `useQuery` directly | Postgres Changes plus explicit refetch | Synced partition and live query hooks |
| Local setup | Project link and local dev process | Docker stack and URL/key configuration | CLI/web starter and dev server |
| Main client work | Normalize query data | Read/refetch/subscription/error state | Guest sign-in and pending-write receipts |
| Offline behavior tested here | No | No | Reload online only; no offline-write claim |

The shared app typechecked and built. I ran direct mutation/read checks for
each backend; browser journeys covered Snapback and Convex writes, and all
three live updates were observed from a different tab or CLI/API client.
Snapback, Convex and Supabase reload persistence were observed. This is an authoring comparison,
not a performance benchmark: startup cost, network conditions, and the
hosted security posture were not controlled across the three systems.

For this particular small tracker, Convex was the shortest reactive React
path, Supabase gave the clearest familiar SQL constraints at the cost of more
client and local stack wiring, and Snapback made ownership and local data
residency concise but required respecting its durable-write lifecycle.
