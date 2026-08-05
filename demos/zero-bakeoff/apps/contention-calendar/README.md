# Contention Calendar (A3)

Paired provider-native implementations of LLP 0138's final-capacity booking
race. The business invariant is structural in each authority: a Snapback
compound unique index and a PostgreSQL unique constraint. Client predictions
are intentionally allowed to disagree until authority answers.

The Snapback arm's shipping write-lane path is one generated `Insert` plan.
Its private row is keyed for presentation by protocol intent identity, then
replaced by the generated query's branded canonical row after settlement.
There is no parallel component-owned pending collection and no client-minted
canonical reservation id.

```sh
cd demos/zero-bakeoff/apps/contention-calendar
npm run generate:snapback
npm run accept:snapback
npm run accept:zero
npm run typecheck
```

The program orchestrator mints and verifies the separate dated rung-2 exit
from the repository root:

```sh
volta run --node 24.18.0 node tests/acceptance/contention-calendar-rung2-v1.mjs
volta run --node 24.18.0 node tests/acceptance/contention-calendar-rung2-v1.mjs --check
```

The first command runs a real served runtime and writes the dated receipt. It
is intentionally not part of ordinary arm acceptance or local documentation
checks.

The Zero runner uses the already-qualified shared PostgreSQL 17 server when
`ZERO_BAKEOFF_PG_URL` is set, creating and dropping a distinct database. It
owns its API server, Zero port, replica file, clients, and cleanup. A runtime
failure becomes a machine-readable GAP and non-zero exit.

Stable UI identifiers are `cc-calendar`, `cc-slot-<key>`, `cc-book-<key>`,
`cc-status`, `cc-error`, and `cc-alternative`.
