# Signal Desk backend bake-off

Signal Desk is one React incident-response workspace implemented against three
native backends: Snapback, Convex, and Supabase. The UI and product contract are
shared. Select the backend with the tabs or with
`?backend=snapback|convex|supabase`.

The app exercises:

- four related tables (incidents, tasks, comments, activity);
- atomic multi-table writes and server-side validation;
- native durable realtime observed by a second client;
- optimistic task completion with rollback;
- search and a server-derived handoff brief;
- presence (Snapback ephemeral collections, Convex durable rows, Supabase
  Realtime Presence);
- deterministic seed data and backend-native acceptance tests.

This is a developer-experience comparison, not a scale benchmark. The persona
picker is deliberately demo identity; production authentication and
authorization are outside this app's parity contract.

## Set up

From the repository root:

```sh
cd demos/signal-desk
bun install
bunx snapback generate snapback
CONVEX_AGENT_MODE=anonymous bunx convex dev --once
bun run supabase:migrate
```

The Supabase commands read the ignored repository-local
`.agent-local-secrets.md`. The Vite process reads only the public Supabase key;
the migration and test cleanup use server credentials. Convex writes its local
deployment URL to ignored `.env.local`.

Start three terminals from this directory:

```sh
bun run snapback:dev
CONVEX_AGENT_MODE=anonymous bunx convex dev --tail-logs disable
bun run dev:configured
```

Then open <http://127.0.0.1:5217/?backend=snapback>.

`snapback:dev` is the current one-process managed Snapback flow: the installed
CLI generates the backend, starts the package-selected runtime, loads the
generated app and deterministic seed on a fresh database, watches the authoring
files, and owns shutdown. The demo does not import a repository server binary.

## Verify

With the local Snapback and Convex processes running and the Supabase migration
applied, start from a clean checkout and run the package-owned aggregate:

```sh
bun run bakeoff:run
```

The aggregate runs eight required lanes at one exact source revision: contract
inventory, the Snapback comparator, Snapback extras, the separate React suite,
Convex, Supabase, TypeScript, and the production build. There are no optional
backend lanes: a missing service or credential is a red receipt and a nonzero
exit. The runner reopens the comparator, React presence, and generated
query-group receipts, binds their runtime and executing package identities,
and refuses a green result unless every lane and every child receipt passes.

Sanitized stdout/stderr logs are bounded and content-addressed under
`acceptance/logs/`. Sanitized, content-addressed child-receipt projections live
under `acceptance/evidence/`, so a later run cannot overwrite an earlier
aggregate's evidence. The closed, schema-validated aggregate is written as
`acceptance/results/backend-bakeoff-run.<sha256>.v2.json`. Reopen an aggregate
and all of its log/child-receipt digests with:

```sh
bun run bakeoff:verify acceptance/results/backend-bakeoff-run.<sha256>.v2.json
```

The integration tests use each vendor's native client and push transport. The
aggregate does not infer backend correctness from rendered UI and does not
claim hosted or public-package qualification.

The full findings and ranking are in [COMPARISON.md](./COMPARISON.md). The build
diary is [Diary 0022](../../diaries/0022-backend-bakeoff.diary.md).
