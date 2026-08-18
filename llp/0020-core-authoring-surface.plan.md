# LLP 0020: Core authoring surface buildout

**Type:** Plan
**Status:** Draft
**Systems:** API, Runtime, Sync, Realtime, Client integration, Developer experience, Testing, Security
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-27
**Revised:** 2026-07-31 (Phase 4 push transport: accepted sockets set `TCP_NODELAY` — Linux delayed-ACK/Nagle stalled small pushed frames ~40ms and deterministically failed the linux-x64 staged-proof presence witness; see the dated Phase 4 implementation note). 2026-07-20 (Phase 0's v0 contract set is ratified against a retained aggregate receipt under LLP 0063 Step 0; the overall Plan remains Draft because the open Phase 4 design is unchanged). 2026-07-17 (compatibility permission epochs are explicitly JavaScript-safe, capacity-check every mutation commit seam, and refuse before durable work when exhausted). 2026-07-09 (LLP 0051 D2 / ENG-23893: the "`HostPlan` is an internal bridge" invariant is amended in place — the mutation IR returns to first-class as the data-tier's default for the common mutation, authored via the typed builder; raw plan objects remain non-authoring); previously 2026-07-01 (LLP 0032 R1 batch verification: Phases 0–4 largely shipped, but §Remaining Phase 4 design — dependency vocabulary and auth epochs — is still open, so status honestly stays Draft; parts of that remaining work are now scheduled by LLP 0032 E4/P4; 2026-06-27: Phase 4 equality, `In`, range/boundary matcher, WebSocket push, permission-epoch resync, and retained reconnect/resume epoch gate slices; review revisions; see `llp/reviews/0020-core-authoring-surface.claude.md` and `llp/reviews/0020-core-authoring-surface.gpt-5.md`)
**Related:** LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0015, LLP 0016, LLP 0018, LLP 0019, LLP 0021, LLP 0063, Diary 0001

## Summary

The first todo diary proved that Snapback's agent-facing facts are already
valuable: stable diagnostics, honest capability gaps, deterministic seed state,
and a subscription response that includes the authoritative initial result. It
also showed that the core authoring path is still a bring-up surface, not the
product surface promised by LLP 0004 and LLP 0012.

This Plan turns the core-side negative findings from
[`diaries/0001-todo-demo.diary.md`](../diaries/0001-todo-demo.diary.md) into a
focused implementation sequence:

- replace hand-derived manifest shapes with typed, versioned generated
  packages;
- wire real JavaScript `ctx.db` handlers through Ibex instead of authoring demo
  CRUD as declarative `HostPlan`s;
- capture handler reads during execution so mutation conflicts are not
  caller-supplied — the same read-dependency capture the realtime matcher and
  the static function manifest both consume;
- upgrade realtime from correct v0 replace/poll semantics to an
  authorization-aware, dependency-matched, push-capable path.

LLP 0016 remains the umbrella diary-driven change program. This document narrows
its core phases into the acceptance gates needed before the next demos can claim
that Snapback's public authoring surface is real.

## Motivation

The todo diary's core complaint was not that the v0 local server failed. It was
that the server worked through scaffolding that should not become the product
mental model:

- the documented authoring API is `defineQuery` / `defineMutation` handlers
  using `ctx.db`, but the demo had to use declarative `HostPlan`s because the
  Ibex host-call bridge was still a capability gap;
- manifest JSON was derived from Rust source by hand, with no published
  TypeScript type or package boundary;
- all live subscriptions were rerun after every mutation, which is correct but
  hides the future fan-out cost;
- realtime delivery used deterministic poll/drain, useful for tests but not a
  product transport;
- read-set conflict checking was available only when the client supplied the
  read set, rather than being captured from the handler's own reads.

Those gaps cut across existing LLPs. LLP 0004 owns the application API. LLP 0008
owns local-first sync and realtime semantics. LLP 0009 owns the handler
execution security envelope. LLP 0010 owns acceptance. LLP 0012 owns generated
artifacts, capability reporting, diagnostics, and adapter-facing facts. This
Plan owns the sequence that turns those specs into the next concrete core
milestone.

## Scope

This Plan owns:

- the implementation order for the core authoring surface;
- which v0 scaffolds may remain internal versus public;
- acceptance gates for typed artifacts, handler execution, read-set capture,
  and app-grade realtime;
- the capability-reporting rules while those features are absent or partial.

It does not own:

- the application data API syntax, owned by LLP 0004 (which itself defers a
  fixed spelling to a later Spec);
- the detailed storage and transaction contract, owned by LLP 0003, and the
  storage-portability contract, owned by LLP 0007 (LLP 0003 implements
  portability but does not own the contract);
- the detailed sync/realtime protocol, owned by LLP 0008;
- the sandbox and resource-limit model, owned by LLP 0009;
- the generated artifact schemas and adapter-facing contract, owned by
  LLP 0012;
- Contract/Exact adapter and tooling work, owned by LLP 0021.

When this Plan conflicts with a subsystem spec, the subsystem spec owns the
mechanics. This Plan owns sequencing, cutlines, and proof.

## Constraints

### Keep the agent-first wins

Do not trade away the behavior that made the todo diary good. Stable diagnostic
codes, `/inspect` capability gaps, deterministic reset/seed, one-source
generated facts, and sleep-free test controls are product surfaces. New authoring
ergonomics must preserve them.

### `HostPlan` is an internal bridge

> **Amended 2026-07-09 (LLP 0051 D2, Increment 3 — ENG-23893):** partially
> superseded. LLP 0051 re-litigated this demotion and returned `HostPlan`
> mutations to **first-class visibility as the default tier for the common
> mutation** — with the authoring problem this section reacted to fixed at
> the front-end (the typed `define.mjs` builder, extended to the full v1
> profile, is the first-class authoring surface), not by hiding the tier.
> What this section got right stands: **raw plan objects** are still not an
> application authoring model, and JS `ctx.db` handlers remain fully
> supported for everything beyond the profile ("outgrew the IR" is a normal,
> class-specific diagnostic). See LLP 0051 D2 for the extension and its
> gates.

`HostPlan` is useful for deterministic fixtures, bring-up, and maybe low-level
tests. It must not be presented as the primary application authoring model after
this Plan lands. Public examples should move to JavaScript handlers using
`ctx.db`, generated function references, and generated clients.

### Handler execution must stay inside the LLP 0009 envelope

The first real handler path must not punch holes in the security model to reach
ergonomics faster. The local target can honestly report missing hosted-grade
resource limits, but it must still preserve the capability shape: no ambient
SQLite, filesystem, network, environment, secrets, or native host access from
query and mutation handlers.

### Capability honesty is part of done

A missing typed package, missing Ibex bridge, replace-only subscription, or
poll-only transport is acceptable only when reported as a capability gap.
Hidden fallbacks are regressions. Every phase that fills a gap adds a test
asserting the capability is reported absent while missing and cleared once it
exists — the `ibex_ctx_db_host_bridge` rule in Phase 2 generalized to all gaps.

## Change Program

Phase numbering is local to this Plan. LLP 0016 folds read-set capture into its
own Phase 2, so this Plan's Phase 3 splits that work into its own phase; a
cross-reference to "Phase 3" must name the document. This Plan owns the
authoritative required-changes and acceptance gates for the core phases; LLP 0016
is the umbrella tracker and now indexes these gates rather than restating them.
The hard order is Phase 2 → Phase 3 (read capture
needs a running handler) and Phase 3 → Phase 4 (the matcher reuses Phase 3's
read-dependency substrate); Phase 1 can start in parallel with Phase 2, but its
JavaScript function-manifest read-summary gate cannot fully close until the
Phase 2 bundler has real handler bodies to analyze.

### Phase 0: Freeze the good v0 facts

Before replacing scaffolding, pin the behavior that already worked.

Required changes:

- keep stable diagnostic codes for the eight families LLP 0012 pins — schema,
  function, query, capability, bundle, runtime, mutation-conflict, and
  stale-artifact failures;
- keep deterministic reset and seed that bypass handlers;
- keep subscribe as one seam returning the current authorized result and
  subscription id together;
- keep deterministic outbox/flush controls for tests, even after a push
  transport exists;
- keep capability gaps machine-readable and visible through `/inspect` or its
  LLP 0012 successor;
- keep generated output carrying freshness information, such as an `inputsHash`.

Acceptance gate:

- the existing todo headless acceptance suite still passes without sleeps;
- a deliberately missing capability is asserted as a structured fact, not
  inferred from a failed request;
- stale generated artifacts are visible in diagnostics or runtime state.

**Ratified 2026-07-20.** LLP 0063 Step 0 retains the aggregate receipt at
`demos/partiful-matrix/acceptance/results/step0-v0-core.json`. It executes the
Todo headless acceptance suite, the capability-manifest check, and the cargo
capability/version test as three required commands and binds their passing
results to the six Phase 0 claim IDs: stable diagnostics, deterministic
reset/seed, atomic initial result plus subscription, deterministic delivery
controls, machine-readable capability gaps, and artifact freshness. The
aggregate's vacuous-pass guard requires all three commands and every child
receipt to pass; a short or skipped run is non-passing. This ratifies the v0
contract set for later lifecycle work without changing the overall Plan's
Draft status or resolving its remaining Phase 4 design.

### Phase 1: Ship typed generated artifacts

This phase removes the need for app code or tests to derive wire shapes from
Rust source.

Required changes:

- choose one source of truth for the v0 artifact schemas (resolves Open
  Question 1);
- generate TypeScript types for `schemaManifest`, `functionManifest`,
  `capabilityManifest`, the target profile, diagnostics, runtime state,
  generated function references, and the client call surface;
- define the static read-set / primary-table summary LLP 0012 pins on each
  function manifest as a typed field from the first generated package; when real
  handler bodies exist, validate it against those bodies — the build-time
  projection of the same read-dependency facts Phase 3 captures at runtime;
- assign every artifact `artifactKind`, `schemaVersion`, and version-mismatch
  diagnostics consistent with LLP 0012, plus hash/freshness fields whose scope
  is explicit (codegen-inputs vs. handler-bundle vs. schema version), per
  LLP 0012's caution against two undifferentiated hashes;
- carry LLP 0010's no-silent-drops rule into codegen: validate manifest
  completeness against what the runtime actually persists and fail closed, so no
  field is silently omitted — the fail-closed property the todo diary credited;
- expose a package entry point usable without Contract/Exact installed (Contract's
  own data manifest, LLP 0021, generates from the same source of truth and shares
  the freshness hash);
- add a drift check so Rust runtime structs, generated TypeScript types, and
  documented v0 artifact schemas cannot silently diverge;
- make `tsc` honest in a consuming app: green must mean the generated package
  resolves and types the app's functions.

Acceptance gate:

- no demo imports `crates/snapback/src/manifest.rs` knowledge or redefines manifest JSON by
  hand;
- the todo headless client consumes generated function references and generated
  types;
- a deliberate artifact version mismatch produces a structured diagnostic;
- a deliberate schema drift between runtime and generated bindings fails CI;
- a field present in the runtime schema but dropped from codegen fails closed
  rather than emitting an incomplete manifest.

### Phase 2: Wire JavaScript `ctx.db` handlers

This phase closes the largest docs-to-product gap.

Required changes:

- implement the Ibex host-call bridge for the minimal `ctx.db` read and write
  API in LLP 0004;
- bundle handler modules with hashed dependencies and reject unsupported dynamic
  imports or ambient dependencies with source-span diagnostics;
- drive async handlers to completion releasing the runtime lock between
  microtask ticks and taking the storage write lock only at commit, never across
  the handler's async duration (LLP 0003 §Execution and Write Semantics);
- run handlers against LLP 0003's buffered host API: consistent snapshot reads
  fixed at handler start, the handler's own writes layered over that snapshot
  (read-your-writes), read-only `ctx.db` to queries and read-write `ctx.db` to
  mutations;
- use injected runtime APIs for ids and time;
- keep writes buffered until one commit boundary per mutation;
- normalize handler-thrown errors into a stable diagnostic family so an
  arbitrary handler failure never escapes as an unstructured error; if handler
  failures do not fit Phase 0's eight families, pin a new `HANDLER_*` family in
  LLP 0012 as a schema event rather than emitting an ad-hoc code;
- report the bridge as a precise capability gap when unavailable.

Acceptance gate:

- the todo app defines `listTodos`, `createTodo`, `setCompleted` or
  `toggleTodo`, and `deleteTodo` as JavaScript handlers using `ctx.db`;
- the same generated function references call those handlers from headless and
  adapter surfaces;
- a query or mutation handler that attempts ambient filesystem, network,
  process, or direct SQLite access fails through the runtime boundary or a
  structured diagnostic (the network ban is scoped to queries and mutations;
  LLP 0009 reserves network for the actions class, which this Plan does not
  build);
- per-invocation state does not leak between handler calls — a fresh or
  equivalently reset context per invocation, per LLP 0009 §Invocation Isolation;
- a handler that throws produces a structured diagnostic with a stable code, not
  an unstructured error or raw stack trace;
- `ibex_ctx_db_host_bridge` disappears from capability gaps only when the bridge
  actually exists.

### Phase 3: Capture read sets during handler execution

This phase makes mutation isolation a property of handler execution rather than
a caller obligation. The read-dependency capture it builds is one substrate with
three consumers: the static function-manifest summary (Phase 1), this mutation
conflict check, and the Phase 4 realtime matcher. LLP 0003 §Execution is explicit
— "build it once and both the mutation-isolation check and reactive invalidation
share it"; LLP 0008 names the shape a *dependency summary*. Build one extractor,
not three. That same buffered-handler-plus-captured-reads substrate is also what
a propose → check → commit dry-run would run on (LLP 0019).

Required changes:

- record row ids, query ranges, indexes, predicates, and auth facts that a
  handler read or relied on;
- validate those dependencies at mutation commit;
- reject stale mutations with a distinct conflict diagnostic;
- expose the captured read/write facts in admin and doctor surfaces where safe;
- define the first retry policy explicitly. Reject-only is acceptable for v0 if
  reported honestly.

Acceptance gate:

- a stale toggle or equivalent read-before-write mutation is rejected without
  the client manually supplying a `read_set`;
- conflict diagnostics are stable enough for tests to assert code and details;
- the admin/function-runner surface can display the read/write facts for a
  successful mutation and the conflict facts for a rejected one.

Implementation note, 2026-06-27: a first local slice records row, missing-row,
query, and auth dependencies from Ibex `ctx.db` host calls, validates them at
commit, and reports reject-only conflict diagnostics. Query dependencies are
currently conservative table-version facts plus predicate details; Phase 4 still
owns the precise realtime matcher, and read-your-writes overlay remains open.

### Phase 4: Upgrade realtime from v0 outbox to app-grade live delivery

This phase should land before realtime-heavy demos are used as product evidence.

Required changes:

- add a dependency matcher for analyzable syncable-live queries, using the
  *dependency summary* shape from LLP 0008 — the same read-dependency facts
  Phase 3 captures for mutations, not a second extractor;
- keep a correct replace/resnapshot fallback for queries the matcher cannot
  prove;
- make the matcher authorization-aware from the first version, applying LLP 0011
  visibility before any delta syncs; v0 may use server-directed resubscribe on
  permission change rather than live per-row revocation deltas (LLP 0008);
- keep ephemeral presence/cursor/typing state on the LLP 0013 carrier, not the
  durable live-query path;
- add a push transport (WebSocket locally; the transport is swappable behind
  LLP 0008's ordered-changeset contract);
- scope subscription ids and the observed version stream to one logical app per
  LLP 0018, even though v0 is single-app, so a later multi-app instance need not
  retrofit it;
- retain deterministic drain/flush hooks for tests;
- expose subscription state, queue/backpressure state, and recent delivery
  errors in runtime state;
- the matcher, the push transport, and the observability work are independently
  shippable; sequence them but do not weld them into one all-or-nothing change.

Acceptance gate:

- two clients can observe live updates without product-code polling;
- an unrelated mutation does not refresh a subscription when the matcher can
  prove disjointness;
- a mutation to a row a subscriber cannot see neither notifies that subscriber
  nor leaks existence through runtime state;
- tests can force delivery deterministically without sleeps;
- fan-out cost is measured and recorded before any messaging, kanban, or
  collaboration demo is cited as scale evidence;
- a target that only supports replace/poll reports that capability honestly.

Implementation note, 2026-06-27: the local matcher now stores the captured
`CapturedReadDependency::Query` facts from each live subscription and skips live
query refreshes when table summaries or `Eq`/`In`/range predicates prove a
change is disjoint. Captured query dependencies now include optional order,
limit, result-count, and first/last boundary facts, so limited ordered queries
can skip changes that are known to sort after the retained boundary. The todo
`userId` auth filter is one equality case, not a bespoke matcher path. Change
events carry changed field names so updates that touch predicate fields fall back
to rerun instead of being skipped incorrectly. Deletes carry the deleted row into
the in-memory change event so hidden-row deletes can be proved disjoint without
leaking the row to clients. The delivery shape remains `live_replace`, now
available over a local WebSocket stream as well as the deterministic outbox, and
`/inspect` exposes `liveDelivery` fan-out, delivery, and skip counts. Permission
epochs now use v0 function metadata (`permissionEpochBumps`) to advance
`user:<id>` or declared scopes, live subscriptions capture
`Permission(scope, epoch)` facts, and stale subscriptions receive durable
`resync_required` messages instead of a `live_replace`. Reconnect/resume
stale-epoch comparison remains open.

Implementation note, 2026-07-07 (ENG-23420): the dependency gate now consults
captured `Row`/`MissingRow` point-read facts alongside `Query` predicates — a
change landing on a point-read's `(table, id)` wakes the subscription even when
every query predicate proves disjoint. Previously an Ibex live query that did
`ctx.db.get` and folded the row into its result went permanently stale when
only that row changed, because the gate filtered captured reads to `Query`
dependencies before deciding to skip.

Implementation note, 2026-07-31 (linux-x64 qualified-package-staging repair):
the bound server now sets `TCP_NODELAY` on every accepted connection
(`nodelay_listener` in `BoundSnapbackApp::serve` /
`serve_with_graceful_shutdown`). Axum does not set it, and with Nagle enabled
a small pushed WebSocket frame written while an earlier small frame is still
unACKed waits for the peer's delayed-ACK timer — ~40ms on Linux even over
loopback. The packaged comparator's presence-disconnect witness surfaced
this: the ephemeral delta was on the wire ~2ms after publish but reached the
client ~38ms later, after the post-drain assertion, deterministically failing
the linux-x64 staged proof while identical bytes passed on macOS. Push-lane
latency is a product property (the comparator and every presence UI measure
it), so the option belongs at the accept seam, not in test tolerances; the
`accepted_live_socket_delivers_small_frames_without_nagle_delay` regression
pins it with a median-latency witness that sits at the delayed-ACK floor on
the defective listener.

#### Remaining Phase 4 design: dependency vocabulary and auth epochs

The next implementation slice must extend one shared dependency vocabulary rather
than adding matcher-only facts. The same captured records should serve:

- mutation conflict validation;
- generated/static read-set summaries;
- realtime invalidation and skip decisions;
- later retained-sync resume checks.

The v0 vocabulary adds these dependency facts:

- `Row(table, id, version)` and `MissingRow(table, id, table_version)` for point
  reads and absent rows;
- `Query(table, index, predicate, order, limit, boundary, table_version, rows)`
  for collected query ranges;
- `Auth(field, value)` for direct auth facts such as `userId`;
- `Permission(scope, epoch)` for authorization state the query depends on;
- `MutationOverlay(table, ids, fields)` for reads that observe buffered writes
  inside the same handler.

`Query.predicate` is the analyzable subset. V0 extends beyond equality only where
the manifest can express the operator and the matcher can prove disjointness. The
first extension set is:

- `Eq(field, value)`;
- `In(field, values)`;
- `Lt/Lte/Gt/Gte(field, value)`;
- `Between(field, lower, upper, lower_inclusive, upper_inclusive)`;
- `Prefix(field, value)` only for string fields with an explicitly portable
  collation rule.

Any unsupported operator, runtime value, computed expression, unknown collation,
or missing old/new row data makes the query dependency conservative. The matcher
may skip only when it proves that every changed row is disjoint from every
captured query dependency. Otherwise it reruns and emits `live_replace`.

Order and limit are boundary-sensitive. A limited query may be skipped only when
the changed row is predicate-disjoint and cannot affect the ordering boundary.
To make that check possible, captured query dependencies should include:

- the ordered fields and directions;
- the result count;
- for limited non-empty results, the first and last returned sort key;
- whether the result was known complete (`result_count < limit`) or boundary
  truncated (`result_count == limit`).

Until those facts exist, any insert/delete/update that matches the predicate for
a limited query must rerun. Updates that touch a predicate field, order field, or
system ordering field also rerun. Deletes need the deleted row in the in-memory
change event; if the deleted row is unavailable, rerun.

Permission changes follow LLP 0011's v1 answer: server-directed resubscribe, not
arbitrary live remove deltas. The first local shape is:

- permission-affecting writes are declared by function metadata or table
  permission metadata; unknown permission impact is conservative;
- each permission scope has a monotonically increasing `epoch`;
- live subscriptions record the permission scopes and epochs captured while
  computing their snapshot;
- a mutation that advances one of those epochs enqueues a durable live message:

Compatibility permission epochs are plain-JSON counters in
`0..=Number.MAX_SAFE_INTEGER`. Because publication runs after SQLite commit,
every mutation execution/commit seam resolves its exact declared scopes and
rechecks their remaining capacity while holding Local, before entering durable
work. The postcommit increment is checked but infallible under that serialized
preflight. At the maximum, `SNAPBACK_PERMISSION_EPOCH_EXHAUSTED` refuses the
mutation with rows, storage version, authorization state, and live effects
unchanged; wrapping to zero would be an authorization ABA.

```json
{
  "kind": "resync_required",
  "reason": "permission_epoch_changed",
  "subscription_id": "sub_1",
  "scope": "user:user_ada",
  "epoch": 42,
  "clear_retained": true
}
```

Clients must mark the affected result stale immediately. If `clear_retained` is
true, they clear the retained rows before resubscribing. The fresh subscription
snapshot is filtered through current permissions. Reconnect/resume compares the
client's recorded permission epochs with the server's current epochs and
resnapshots when any recorded epoch is stale.

Implementation sequence for the remaining Phase 4 work:

1. Extend manifest/runtime structs with the dependency vocabulary above, but keep
   the capability gap until behavior is tested.
2. Capture range/order/limit boundaries from `ctx.db.query(...).collect()` and
   from `HostPlan` queries.
3. Extend the matcher with skip-only-when-proven rules for `In`, range, and
   boundary-sensitive limited queries.
4. Add permission dependency capture, epoch state, and `resync_required`
   delivery.
5. Remove `precise_realtime_query_range_matcher` only after acceptance covers
   disjoint range inserts, range-crossing updates, limited-query boundary
   changes, permission-epoch resync, and reconnect with stale epochs.

Implementation note, 2026-06-27: steps 1 through 5 have landed for the local
target. Retained live resume now carries client-recorded permission epochs,
compares them against current server epochs, keeps matching subscriptions on the
retained path, and forces an authorized resnapshot when any recorded epoch is
stale. The `precise_realtime_query_range_matcher` capability gap is removed for
the current local target on that basis.

## Demo Admission Rule

This is the core-specific specialization of LLP 0016's demo admission rule, not
a competing authority. A demo may claim the core authoring surface only when it
uses:

- generated typed artifacts rather than hand-authored manifest JSON;
- JavaScript handlers using `ctx.db` rather than public `HostPlan` authoring;
- handler-captured read sets for conflict detection;
- an honestly reported realtime capability class.

A demo may still run before all phases land, but its diary must name the exact
scaffolding it depends on and the capability class it is exercising.

## Non-Goals

- Do not build Postgres, Cloudflare, external auth providers, assets, cron,
  notifications, or hosted multi-tenant isolation as part of this Plan.
- Do not claim offline/local-first parity until local handler execution,
  offline queueing, deterministic replay, and rebase-on-reconnect exist — the
  mechanics owned by LLP 0008's mutation-replay contract, the parity-capability
  claim gated by LLP 0012.
- Do not replace the typed generated API with direct client table writes.
- Do not make Contract/Exact requirements create private backend semantics;
  the adapter plan is LLP 0021.

## Open Questions

- Which schema definition is the single source of truth for Rust and TypeScript
  artifact generation, and does that source also own the shared
  `ContractDataManifest` schema or only the core manifests LLP 0012 names?
- What is the pluggable transport abstraction for non-local targets, now that
  the first local push transport is WebSocket?
- Which exact permission metadata syntax declares permission-affecting writes
  and scopes for v0: table annotations, function metadata, or a dedicated
  permission manifest?
- Which range operators beyond `Eq`, `In`, numeric/string comparisons, `Between`,
  and portable `Prefix` should enter the first analyzable subset?
- Does the first stale-read behavior reject only, retry automatically for pure
  handlers, or expose both as target capabilities?
- Which runtime resource limits can Ibex enforce in-process on the canonical
  local target, and which must be reported as missing until one of LLP 0009's
  three paths exists — an engine watchdog, a killable process/isolate, or a V8
  target?
- How visible should `HostPlan` remain in public generated artifacts after real
  handlers land?

## Status

Draft. Phases 1 through 3 have landed as local slices. Phase 4's local
replace-mode matcher now covers observability, WebSocket push, `In`, range,
limited-boundary, permission-epoch resync, and retained reconnect/resume
permission-epoch checks. Broader local-first work such as offline mutation
replay and incremental delta transport remains outside this completed
replace-mode matcher slice.
