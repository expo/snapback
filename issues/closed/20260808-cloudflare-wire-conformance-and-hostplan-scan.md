# Cloudflare: pong frame violates the committed schema (no conformance gate) + HostPlan native path is an unbounded full-table scan

**Opened:** 2026-08-08 · **Severity:** P2 · **Area:** cloudflare

## A) Kit `pong` omits `serverTimeMs`, which the committed schema requires

`cloudflare/src/coordinator.js:5292`; schema
`schemas/live.socket-server.schema.json` ("pong" requires `serverTimeMs`);
consumer `clients/swift/.../WireTypes.swift:601`.

```js
ws.send(JSON.stringify({ kind: 'pong', requestId: parsed.requestId }));
```

A schema-conformant strict decoder (the Swift client once `live/hosted` is
claimed) treats a missing member as an undecodable known kind → forced
connection-wide resync **every 5 s heartbeat** — a resync storm driven by the
liveness mechanism itself. Latent today (Swift claims only `poll/local`/
`live/local`; the JS kit refreshes freshness on any frame).

**Root cause worth fixing generally:** the Cloudflare arm hand-writes ~10 wire
frames inline (`ws.send(JSON.stringify({...}))`) while `schemas/` is the
committed authority and other arms decode strictly against it. No JS consumer
replays the shared `schemas/live.wire-fixtures.v1.json` corpus (`rg
"live.wire-fixtures" packages/` and `cloudflare/` are empty — only Swift/Rust/
docs reference it).
*Fix:* add `serverTimeMs: Date.now()` to the pong; add a wire-shape conformance
gate that validates every coordinator-emitted frame against the JSON schemas
(cloudflare/test already has `wire-schema-gate.mjs` — the pong escapes it).

## B) HostPlan native evaluation + `/app/bundle` load the whole table into JS

`cloudflare/src/coordinator.js:3827` (invokeHandler fast path), :1490
(appBundle):

```js
const stored = [...this.sql.exec(`SELECT row_json FROM ${this.physicalTable(plan.table)}`)]
  .map((r) => JSON.parse(r.row_json));
const rows = evaluateHostPlanQuery(plan, args || {}, stored);
```

Every subscribe snapshot, fan-out group re-query, and bundle request on a
HostPlan-eligible query does a full-table scan + per-row `JSON.parse` in the
single-threaded DO — while the handler-isolate path (`storageQuery` in
host-ops.js) carefully pushes filter/order/limit into SQLite. At 50k+ rows each
commit's fan-out becomes O(table × groups); the bundle's 2 s/5000-row limits are
enforced only *after* the scan.
*Fix:* compile HostPlan `Eq` filters and limit into the SQL (the machinery
exists in `storageQuery`), falling back to JS only for the residue.

## Confidence

A: high divergence from the committed schema, latent. B: high mechanics, medium
ticket-worthiness at current proof scale.

## Resolution (2026-08-08)
Fixed on main (Lane H). Verified (Node 24.18.0): acceptance 53/53, cron 13/13, rqs 42/42, wire-schema-gate 20/20, index-scaling pass; deployment-identity regenerated + check pass; ref-check clean.
