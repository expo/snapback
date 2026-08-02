# A6 — Fleet Observatory

Provider-native implementations of the LLP 0138 telemetry observatory over a
deterministic 25,000-device and 250,000-event fixture. The arms share fixture
facts and acceptance IDs, but no backend abstraction.

## Run

From `demos/zero-bakeoff`:

```sh
node ../../packages/snapback-codegen/index.mjs apps/fleet-observatory/snapback
node apps/fleet-observatory/snapback/acceptance.mjs
ZERO_BAKEOFF_POSTGRES_URL="$(node scripts/postgres-local.mjs status | jq -r .url)" \
  bun apps/fleet-observatory/zero/acceptance.ts
```

The historical provider receipts are `evidence/<provider>.v1.json`. The
remediated Snapback runner writes `evidence/snapback.v2.json`, preserving the
pre-fix v1 failure as immutable evidence. The Zero suite owns and drops an
exact per-run PostgreSQL database and its `zero-cache` process without stopping
the shared PostgreSQL service.

Both headless receipts retain an honest GAP for browser-backed warm/cold
restart: the Node/Bun carriers use memory stores. The minimal React projections
are `snapback/App.tsx` and `zero/App.tsx` and expose provider-native completeness
state under stable test IDs.
