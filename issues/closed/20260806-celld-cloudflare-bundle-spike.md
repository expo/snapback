# Spike: run Snapback's Cloudflare bundle under celld (self-hosted DO runtime)

**Opened:** 2026-08-06
**Systems:** Deployment, Cloudflare, Runtime, Testing
**Related:** LLP 0083 (celld section), LLP 0014, LLP 0040, LLP 0048, LLP 0049, LLP 0086 §CC-2a

celld (github.com/denoland/celld, Apache-2.0) implements the actual
Cloudflare Workers/Durable Objects JavaScript API and wrangler config on
self-hosted infrastructure — V8 + per-cell SQLite + LTX replication to an
S3-compatible bucket. LLP 0083's celld section identifies a cheap spike:
our Cloudflare port (`cloudflare/src` — gateway Worker + `Coordinator` DO
with SQLite storage + handler Worker over service bindings, standard
`wrangler.jsonc`) appears to need exactly the surface celld supports.

**Task.** Attempt to deploy and run the notes app bundle
(`cloudflare/app/notes.app.js` + gateway + coordinator + handler workers)
under celld locally against MinIO. Record a dated result artifact under
`cloudflare/` or in LLP 0083.

**Known compatibility gaps to check (from celld's cloudflare-compat.md,
fetched 2026-08-06):**

- no `scheduled` (cron) handler — LLP 0049's cron hardening will not run;
- KV/R2/Queues bindings load but throw; Cache API, HTMLRewriter, TCP
  sockets absent;
- `routes`/`triggers`/`kv_namespaces` wrangler keys are deploy **errors**
  — check our wrangler configs for offending keys;
- celld accepts `wrangler.jsonc`/`.json`, not `.toml` (we use `.jsonc` —
  fine);
- WebSockets do not survive cell migration; single-node spike avoids
  this.

**Exit questions.** (1) Does the coordinator DO run with SQLite storage,
WebSocket hibernation, and alarms intact — do the Miniflare local-suite
gates (`cloudflare/test/local-suite.mjs`) pass against celld? (2) Could
the LLP 0048 conformance twin test celld as a third leg? (3) What would a
`celld-do-sqlite-v8` capability manifest honestly claim vs. the
`cloudflare-do-sqlite-v8` manifest? Findings feed LLP 0086 §CC-2a's
lock-in accounting for the LLP 0014 door-2 re-ratification.

**Non-goals.** No hosted rearchitecture, no production use — celld is
weeks old and "still evolving" (same discipline LLP 0087 applied to
Facets). Prior-art/optionality evidence only.

## Findings — 2026-08-09

The spike is complete; the detailed evidence is in
[`cloudflare/spike-celld/RESULTS-20260809.md`](../cloudflare/spike-celld/RESULTS-20260809.md).

The clean result is negative for faithful execution on celld 0.1.0. celld's
Web API object shapes conflict with the LLP 0048 handler harness, and celld
continues to resolve configurable ambient globals after module evaluation
while Snapback intentionally strips them. A second celld incompatibility
throws when a Durable Object `stub.fetch()` carries a POST body. The checked-in
bundle therefore cannot start and serve requests unchanged.

An explicitly unsafe diagnostic adaptation preserved celld's ambient globals
and tunneled the DO body through a header. Under that adaptation, the full
gateway -> coordinator -> handler -> SQLite path performed reads and writes,
maintained monotonic coordinator versions, delivered a WebSocket snapshot and
live replacement across connected-idle eviction/rehydration, and persisted the
observed data. celld's unchanged alarm example also fired a SQLite DO alarm
after hibernation. Those are positive substrate results, not Snapback target
conformance.

The current 29-gate Cloudflare local suite cannot be redirected to celld; its
runtime cases create Miniflare internally. No local-suite gate therefore
passed *against celld*. Manual acceptance-core fragments translated, but the
ambient-denial invariant failed and cron remains unavailable because celld has
no `scheduled` handler. The LLP 0048 twin must not add this diagnostic program
as a third leg. It becomes plausible only after celld removes the runtime
global dependency, accepts the harness's Web getter contract, and fixes DO
POST-body construction.

No `celld-do-sqlite-v8` capability manifest should be published yet. A
provisional fail-closed ledger would clear `supportedCapabilities`,
`liveSubscriptions`, `syncableLiveQueries`, and `supportedQueryForms`; set
`localServerLifecycle` true; mark wall-clock, CPU, and object-storage limits
`Missing`; replace Cloudflare-specific lifecycle/platform/storage facts; and
add gaps for handler-harness conformance, ambient denial, DO POST transport,
version metadata, WebSocket migration survival, and scheduled handlers. The
existing V8/SQLite identity and coordinator transaction/version design remain
applicable, but only the unsafe diagnostic run exercised them.

## Resolution — 2026-08-09

Spike executed and complete; all three exit questions answered with
evidence in `cloudflare/spike-celld/RESULTS-20260809.md`. Outcome: clean
negative for faithful execution (celld 0.1.0's post-evaluation ambient
globals conflict with the LLP 0048 harness strip; DO `stub.fetch()` POST
bodies fail in `__makeIncomingRequest`), with positive substrate evidence
(per-cell SQLite, hibernation, alarms) under explicitly unsafe diagnostic
adaptations. No `celld-do-sqlite-v8` manifest may be published; the LLP
0048 twin must not add the diagnostic program as a leg. Re-evaluate if
upstream fixes the two faithfulness blockers. Closed.
