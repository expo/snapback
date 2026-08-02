# Diary 0047: Fleet Observatory — Snapback/Zero bakeoff

**Application:** A6 Fleet Observatory, paired Snapback and Zero arms  
**Date:** 2026-08-01  
**Code:** `demos/zero-bakeoff/apps/fleet-observatory`  
**Plan:** LLP 0138  
**Systems:** Large partial sync, query churn, live invalidation, auth, React, acceptance testing

## What was built

Both arms use deterministic facts for five fleets, 500 owners, 25,000 devices,
and 250,000 events. The active route is a bounded latest-100 query with fleet,
severity, region, and device-status filters plus device and owner composition.
The stress mutation changes 1,000 events, exactly 100 of which belong in the
active query. Twenty simultaneous views and an unauthorized Mallory client
exercise resource and custody boundaries.

Snapback uses a JS live query and mutation over Ibex/SQLite. Zero uses ZQL over
PostgreSQL 17 and `zero-cache-dev`; the browser-shaped client is real Zero with
a memory store for headless acceptance. Neither arm shortcuts its product query
or mutation through a shared backend adapter.

## Chronology and immutable first attempt

1. I froze eight A6 checks: bounded initial slice, first-useful versus complete,
   filter churn, matching-update convergence, no full transfer, twenty active
   views, warm/cold restart, and outsider nonreplication.
2. Zero's first run proved the 250,000-event seed and route worked, but two
   harness mistakes failed: Alice attempted the 900 intentionally nonmatching
   fleet-2 writes, and the synchronous listener-removal closure had a temporal
   dead zone. A separate authorized Bob writer and initialized removal closure
   fixed those test defects. The rerun was 7 PASS, 1 honest GAP, 0 FAIL.
3. Snapback's first run passed the read, churn, resource, and authorization
   checks, but its 1,000-patch mutation took roughly 23 seconds and the live
   route still contained zero changed messages at the immediate assertion.
4. I replaced the immediate assertion with a 30-second bounded convergence
   wait and reran. It still timed out. I then repeated over Snapback's native
   durable-poll carrier to separate WebSocket timing from query invalidation;
   that also timed out. The retained final run adds a direct-query diagnostic.
   It found `directMatches=0` and `liveMatches=0`: the mutation reported 1,000
   changes, but even a new authoritative query saw none of the expected 100
   visible changes. This is classified as mutation durability/visibility plus
   consequent live-convergence failure, not an environment GAP. Later
   remediation must append here rather than erase it.

No hosted API key or human intervention was required.

## Evidence

### Zero 1.8.0

The final receipt is **7 PASS, 1 GAP, 0 FAIL**, cleanup green:

- initial query: 100 rows / 43,769 serialized bytes;
- first useful: 34.7 ms; complete: 34.9 ms;
- twenty switches: mostly 28–38 ms cold combinations and about 0.9–1.5 ms for
  the repeated locally materialized combinations;
- 1,000-update mutation: exactly 100 active matches converged;
- client inspector: 100 retained event rows for the 250,000-event main route,
  and zero event rows for Mallory;
- twenty views: 500 retained event rows, five inspector query entries, about
  306 MB process RSS (Bun process context, not isolated client heap).

### Snapback

The retained final receipt is **6 PASS, 1 GAP, 1 FAIL**, cleanup green:

- initial query: 100 rows / 29,700 serialized bytes;
- first useful and authoritative complete snapshot: 69.0 ms;
- twenty filter switches: about 56–63 ms each, with no predecessor leakage;
- 1,000-patch mutation settled after roughly 20–23 seconds, then neither a
  fresh authoritative query nor the subscribed result showed any of the
  expected 100 changed rows inside another 30 seconds;
- twenty views retained 1,366 projected rows and the Node process reported
  about 122 MB RSS;
- Mallory received zero rows.

Both providers retain the same honest **warm/cold browser restart GAP**. The
headless carriers use memory stores, so neither receipt proves IndexedDB or a
Snapback browser retained-store restart. This is a carrier coverage gap, not a
claim that either product lacks persistence.

The retained Snapback receipt records the exact source commit and
`identityVerdict: unpinned-binary`: the configured debug binary matched the
checkout commit but was dirty. Results are useful local evidence but not a
pinned-release performance benchmark.

## Authoring and source cost

Excluding fixture, acceptance, generated files, and README, Snapback is 95
lines across schema, functions, and React. Zero is 91 lines across schema,
queries, mutators, and React, plus 110 lines for owned PostgreSQL/endpoints/
`zero-cache` runtime. Acceptance is 163 Snapback lines and 111 Zero lines.
Zero's runtime cost is real for this isolated arm but normally shared;
Snapback reuses the repository's existing server kit.

## What felt good

### Snapback

- The bounded server projection made “not the whole dataset” structurally
  simple: the client receives one authoritative 100-row result, not a table
  replica. Server-side membership checks made outsider delivery zero.
- A single schema/functions bundle and one server process were far easier to
  provision and clean up than a replication stack. Stable server diagnostics
  and owned process cleanup remained useful even when the product check failed.
- Twenty live handles were straightforward to create and dispose.

### Zero

- This is Zero's home ground. The same ZQL definition specifies the bounded
  server query, client materialization, filters, and device/owner relations.
- Partial sync was observable rather than inferred: the inspector showed 100
  event rows out of 250,000, then 500 across twenty views, and zero for Mallory.
- Repeated filter combinations became local reads around one millisecond. That
  is a qualitatively different interaction model from Snapback's roughly
  56–63 ms server round trip for every switch.
- The 1,000-update burst converged while keeping only active query custody.

## What felt bad or surprising

### Snapback

- The live query collects all fleet/severity matches, filters and sorts them in
  JS, then performs device and owner point reads for each of 100 results. It is
  bounded on output but not a pushed-down relational plan.
- The 1,000-patch mutation is serial application work and took tens of seconds.
  More seriously, it reported 1,000 patches but a fresh authoritative query
  still saw zero matching changes after the additional 30-second bound. The
  subscription also remained stale over stream observation and durable polling.
  That points below the carrier at mutation durability/visibility; live
  convergence necessarily fails with it.
- Snapback has no Zero-like supported inspector that can enumerate exactly
  which durable application rows a client holds. The receipt can prove bytes
  delivered by the query projection, but its `clientRetainedRows: 0` is a
  statement about this memory carrier, not a general browser-store audit.
- Codegen completed but warned that the generic fixture rows and 1,000-update
  batch use JSON validators, degrading those generated argument types to
  `unknown`. A typed bulk-write primitive would improve both performance and
  the generated contract.
- The guide documented the composition limits; this was not a guide gap. The
  product surface itself needs a more capable query planner and custody tools.

### Zero

- The elegant application code sits on a wider operational stack: PostgreSQL
  logical replication, publications and slots, two app endpoints,
  `zero-cache`, client identities, and exact teardown.
- Direct PostgreSQL fixture loading is dramatically easier and faster for this
  test than loading 250,000 rows through public mutations, but it also means
  seed/setup time is not a fair provider throughput comparison.
- Headless memory hides the browser restart path; a browser carrier remains
  required before making offline/warm-start claims.

## Initial verdict

For large query-driven partial sync and filter churn, **Zero is decisively
better**. It combines pushed-down bounded relations, local materialization,
explicit completeness, and inspectable custody. Snapback's operational
simplicity and authoritative projection are real advantages, but they do not
offset repeated network-bound filter reads or a live result that failed the
burst convergence contract.

Snapback improvement ideas, in priority order:

1. Add a first-class query-plan surface for indexed ordering, limit, filters,
   and typed relations so JS handlers do not collect/sort/join broad sets.
2. Make live invalidation scale with the affected result, not serial patch
   count; add a bulk patch/upsert primitive and a regression at 1,000 writes.
3. Expose first-useful, completeness/currentness, and convergence settlement as
   separate observable states.
4. Add a supported client custody inspector: active queries, retained rows and
   bytes, provenance, and authorization scope.
5. Add a browser acceptance carrier that measures warm/cold retained-store
   restart and proves revocation clears protected bytes.

## Receipts

- `demos/zero-bakeoff/apps/fleet-observatory/evidence/snapback.v1.json`
- `demos/zero-bakeoff/apps/fleet-observatory/evidence/snapback.v2.json`
- `demos/zero-bakeoff/apps/fleet-observatory/evidence/zero.v1.json`

## 2026-08-01 remediation — diagnosis corrected

The first-attempt chronology and receipt above remain unchanged, but their
initial diagnosis is superseded. A minimized 10,000-row reproduction passed,
and inspection with the exact 250,000-row fixture proved that the burst
mutation committed all 1,000 patches at authoritative version 310. The fresh
and live queries returned zero changed rows because `collect()` silently
returned only the first 1,024 matches in index order; the handler then sorted
and sliced that incomplete prefix in JavaScript. The 100 changed rows were at
the global tail and never entered the prefix.

This was not a transaction-durability or invalidation failure. It was a query
completeness failure with a dangerous success shape: incomplete input looked
complete to application code. The platform remediation makes an implicit
collection that reaches the 1,024-row safety ceiling fail closed with
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`. Calling `.take(n)` explicitly records
that the application wants bounded-prefix semantics. The Fleet handler must
also push indexed descending `pageKey` ordering and `.take(100)` into the query
before collection; sorting after collection cannot establish a global top-100
result. The platform fix landed on `origin/main` as `b52e3b9c`.

The historical **6 PASS, 1 GAP, 1 FAIL** remains the honest pre-remediation
score. Follow-up product evidence belongs to
`issues/closed/20260801-fleet-query-implicit-limit.md`; a post-fix Fleet receipt
is retained as `snapback.v2.json` rather than rewriting `snapback.v1.json`.
That exact 250,000-row rerun retained **7 PASS, 1 browser-carrier GAP, 0 FAIL**:
the mutation settled all 1,000 updates, the independent live observer converged
exactly 100 matching rows, all twenty active views stayed bounded, and cleanup
was green. The roughly 27.5-second mutation time is local debug evidence, not a
throughput claim. Its configured clean fix binary intentionally reports a
checkout `stamp-mismatch` because the uncommitted bakeoff demo lives in this
separate working tree; the receipt pins the binary itself to `b52e3b9c`.
