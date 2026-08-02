# A1 — Triage Graph

Provider-native implementations of the LLP 0138 relational issue inbox over a
deterministic 10,000-issue fixture. The arms intentionally share fixture facts
but no backend abstraction.

## Run

From `demos/zero-bakeoff`:

```sh
node ../../packages/snapback-codegen/index.mjs apps/triage-graph/snapback
node apps/triage-graph/snapback/acceptance.mjs
ZERO_BAKEOFF_POSTGRES_URL="$(node scripts/postgres-local.mjs status | jq -r .url)" \
  bun apps/triage-graph/zero/acceptance.ts
```

Each arm writes its retained receipt to `evidence/<provider>.v1.json`. Both
suites own their clients and child services; the Zero suite creates and drops
one exact per-run database without stopping the shared PostgreSQL process.

The minimal React projections are `snapback/App.tsx` and `zero/App.tsx`. They
render each provider's native completeness/current state using stable test IDs.

