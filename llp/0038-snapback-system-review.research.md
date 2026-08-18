# LLP 0038: Snapback system review

**Type:** Research
**Status:** Draft
**Systems:** Project, Runtime, Storage, Sync, Realtime, Security, Developer experience, Deployment, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-05
**Revised:** 2026-07-21 (fan-out figures marked superseded per the `37f1a2f` benchmark corrections — LLP 0035's 2026-07-21 note). 2026-07-05 (initial)
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0003, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0014, LLP 0016, LLP 0017, LLP 0019, LLP 0020, LLP 0021, LLP 0022, LLP 0024, LLP 0026, LLP 0028, LLP 0029, LLP 0031, LLP 0032, LLP 0033, LLP 0034, LLP 0035, LLP 0036, LLP 0037, https://github.com/ccheever/ibex, https://github.com/expo/valet

## Summary

This is a whole-system review of Snapback as of 2026-07-05: what is actually
built, how it works, how it compares to prior art, which tradeoffs it has
chosen, where it is weak, where it is differentiated, and what should change.
It is a Research document in the corpus's own sense — findings with provenance
tags, not a proposal — and it is deliberately written by a reviewer, not an
advocate.

**The verdict, up front.** Snapback is an unusually disciplined, evidence-driven
implementation of a coherent thesis, at a very early stage. The local core —
Rust server, SQLite storage, embedded Hermes runtime, captured-read-set
concurrency, matched live queries with op-log deltas, ephemeral presence, cron,
secrets, admin console — is real, measured, adversarially reviewed, and honest
about its gaps to a degree that is rare in any codebase and nearly unheard of
in one this young (first commit 2026-06-25; 225 commits in ten days). The
process machinery around it — capability manifests, stable diagnostic codes,
demo diaries with adversarial re-runs, measurement-gated decision dockets — is
itself a differentiated asset, arguably the most novel thing in the repository.

But the product thesis currently rests on legs that do not exist yet. *Scale to
zero* as an economics claim depends on the Cloudflare-shaped target, which is a
strategy document with zero code ([LLP 0014](./0014-cloudflare-strategy.rfc.md);
[LLP 0032](./0032-decision-and-implementation-hardening.plan.md) X3 is scheduled
and not done). *Local-first* depends on offline mutation replay, which is
honestly must-not-claim ([LLP 0010](./0010-agent-dx-and-acceptance.spec.md));
today every adapter is Online-class. *Auth next to your data* — named in
[LLP 0000](./0000-snapback.explainer.md) as the most important data in most
apps — has a ratified direction and an unbuilt surface
([LLP 0011](./0011-auth-and-permissions.rfc.md)). *Agent-first* is genuinely
delivered in diagnostics and feedback loops, but the flagship agent surface —
MCP projections of the host-ops core — is unbuilt
([LLP 0024](./0024-agent-operating-surface.spec.md)), while the corpus's own
peer research names PowerSync's MCP/docs stack as the current bar
([LLP 0022](./0022-electric-powersync-turso.research.md)).

So the honest one-line assessment is: **a high-quality, well-instrumented
foundation whose differentiating claims are still mostly forward contracts**
`[inferred]`. The engineering risk is modest and well-managed; the strategic
risk is concentrated in three places — the Exact/Contract coupling, the
unstarted second target, and the unbuilt auth/sync-authorization layer — and
the next phase of work should be sequenced to buy evidence on exactly those,
rather than continuing to polish the local core past the point of diminishing
returns. Detailed findings and ranked recommendations follow.

## Method and provenance

This review was produced in one session on 2026-07-05 from primary sources in
this repository: the full LLP corpus (0000–0037, reviews, tombstones), the Rust
implementation (`crates/snapback/src/`, `build.rs`, `tests/`), the JS surface (`packages/`,
`demos/`, `schemas/`, `admin-ui/`, `scripts/`, CI workflows), all eleven demo
diaries, and a sampling of the cross-family review corpus. Portions of the
reading were performed by parallel sub-agent passes; every load-bearing claim
below was either read directly or spot-verified against the code by the author
of this document (file references are given where they matter). Provenance tags
follow [LLP 0001](./0001-prior-art.research.md): `[observed]` for facts
verifiable in this repository, `[inferred]` for the reviewer's judgment,
`[confirmed - source]` for first-hand diary/benchmark evidence. Measured
numbers cite [LLP 0035](./0035-local-target-benchmarks.research.md) and carry
its caveats (one developer machine, order-of-magnitude confidence).

Scale of the artifact under review `[observed]`: ~21,000 lines of Rust
(`crates/snapback/src/`), ~26,000 lines of JS across packages and demos, ~21,000 lines of LLP
design documents (38 documents), 11 diaries, 48 review documents, 216 Rust test
functions, 225 commits over ten calendar days, one human author/ratifier plus
agent labor.

## Part 1 — How Snapback works

### The shape of the system

A Snapback app on the canonical local target
([LLP 0002](./0002-canonical-local-target.decision.md)) is one Rust process
owning one SQLite database, hosting generated application artifacts, executing
JavaScript handlers in an embedded Hermes VM (via the vendored Ibex runtime),
and exposing HTTP + WebSocket transport for queries, mutations, actions, live
subscriptions, ephemeral state, admin, and host operations. The server is the
authority for writes, schema application, change tracking, and realtime
delivery ([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md)).

The app author (normally an agent) writes three or four files: `schema.mjs`
(tables, validators, indexes, `.sync()` eligibility, ephemeral collections,
cron jobs, declared config/secrets), `functions.mjs` (query/mutation/action
declarations), and optionally `handlers.mjs` (JS handler bodies for the
Ibex-executed path). A codegen package **executes** these definitions — a
deliberate anti-silent-drop choice after Valet's regex schema parser silently
dropped a field ([LLP 0006](./0006-valet-retrospective.research.md)) — and
emits committed artifacts: schema/function manifests the Rust server loads,
typed client bindings, Contract data manifests, and a capability manifest, all
validated against JSON Schemas generated from the Rust types that parse them
([LLP 0037](./0037-schema-source-of-truth.decision.md)). Artifact staleness is
detected by content hashes threaded from source to manifest to adapter mount.

Two function styles coexist `[observed]`: **host-plan** functions, where the
mutation is a declarative unconditional write plan the server executes with no
JS at runtime, and **Ibex-module** functions, where a JS handler runs in the
embedded VM against a buffering `ctx.db` host API. Actions are a third
execution class ([LLP 0028](./0028-cron-scheduled-execution.rfc.md)): they may
fetch (behind an env gate) and read secrets, run outside the transactional
snapshot, and commit only by calling `ctx.runMutation`.

### Execution and write semantics

The write path is the system's conceptual core, and it is a direct structural
correction of Valet's worst architecture decision (holding the database mutex
for the entire handler, which both rejected `async` handlers and serialized all
writes behind the slowest one). Snapback drives handlers to completion on the
engine's microtask loop with the lock released between ticks; `ctx.db` reads
observe a consistent snapshot with the handler's own buffered writes layered
over it (read-your-writes); on completion the host takes the write lock once,
applies all buffered writes in one transaction, advances a single per-app
commit version, and stamps it on every affected row
([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md) §Execution and
Write Semantics).

Isolation is optimistic: each invocation's read set — row versions and
predicate-shaped query dependencies — is captured during execution and
re-validated at commit under the lock; conflicts return a structured
`SNAPBACK_MUTATION_CONFLICT`. Validation is predicate-granular (LLP 0032 E4),
which measurably drove the spurious-conflict rate on disjoint writes from 1.0
to 0.0 ([LLP 0035](./0035-local-target-benchmarks.research.md)). Host-plan
mutations invert the responsibility by design: they are atomic unconditional
write sequences, so the only read that can be stale is the client's optimistic
one, and the client supplies that baseline as a `read_set` the server validates
inside the commit transaction (DK-1/E3, Option A). The same captured-dependency
machinery is reused by the realtime matcher — one predicate vocabulary serving
conflict validation, live matching, and the read-your-writes overlay — which is
the single best architectural idea in the codebase `[inferred]`.

Concurrency in the process is two-lane `[observed]`: everything writeful
serializes on one global `tokio::Mutex<LocalSnapback>` and executes on blocking
threads (`lock_owned` + `spawn_blocking`, debug-asserted at chokepoints), while
file-backed queries run lock-free on a WAL reader pool with per-invocation
pinned snapshots — measured ~70× better read latency during a busy write
(LLP 0032 L6/L7; [LLP 0035](./0035-local-target-benchmarks.research.md)).

### The runtime and the warm VM

Handlers execute in Hermes via the vendored Ibex runtime. Ambient powers
(`fetch`, timers, `process`, `require`, `WebSocket`, `Date.now`,
`Math.random`) are denied at the JS layer *and* at the host boundary; the
capability boundary is the host not exposing the power, with the static scan
treated as lint, not sandbox — Valet's AST-analyzer arms race is the cited
reason ([LLP 0009](./0009-code-execution-security.rfc.md) §Capability Model).

Because a fresh Hermes VM per invocation measured ~3.6–4.4 ms and dominated
every other cost by three orders of magnitude, the DK-4 decision shipped a warm
VM pool for the trusted-local target only: VMs keyed by exact module source,
reset between invocations by a baseline-restore sweep over `globalThis`, the
dispatch table, and a broad intrinsic root set, with fail-closed burn on any
doubt, an invocation-epoch guard that rejects host calls from stale
continuations (closing a HIGH cross-invocation context-injection bug found by
adversarial review), and a pool generation counter. Warm invocation is
~800–900 µs (4.5–6.1× cheaper); single-writer throughput rose to ~1,050–1,280
mutations/s ([LLP 0009](./0009-code-execution-security.rfc.md) §DK-4 as-built;
[LLP 0035](./0035-local-target-benchmarks.research.md) §After warm VM). Module-
level closure state persisting across warm invocations is an accepted,
characterization-tested limit. Actions always run fresh; hosted/untrusted
stays fresh-per-invocation by policy.

What the runtime cannot do is as load-bearing as what it can `[observed]`: the
local engine has **no enforceable wall-clock or CPU limit** — the capability
manifest reports `wall_clock_timeout` Missing, and `crates/snapback/src/config.rs` documents
"the local runtime has no handler timeout at all yet." Valet shipped fictional
timeout claims; Snapback reports the gap honestly, which is better, but the gap
is still open (see Part 4).

### Realtime and sync

The unit of subscription is the named query
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)). A subscription gets
an authoritative initial snapshot (fixing the cold-start race every Valet demo
hit), then ordered updates as commits land. The matcher decides per commit
which subscriptions a change can affect (skip cost ~1.8 µs/sub); affected
subscriptions historically got a full re-query serialized as `live_replace`,
and — after the DK-3 revisit trigger fired on measurement — the analyzable
subset (unordered single-table filtered host-plan queries) now gets `live_delta`
op-log deltas computed by classifying changed rows against the captured
predicate with no VM and no re-query: ~0.32–0.36 µs per affected subscriber,
~5,200× cheaper, moving the fan-out ceiling from ~5–6 to ~28,000+ subscribers
per commit for that subset (figures superseded by the `37f1a2f` fixture
corrections — LLP 0035's 2026-07-21 note; the mechanism stands, the ratio is
unmeasured), with a debug-build convergence assertion guarding
delta/replace equivalence ([LLP 0035](./0035-local-target-benchmarks.research.md)
§M3). Ordered/limited windows and Ibex-executed queries keep the honest
re-query + `live_replace` fallback.

The wire protocol (LLP 0032 P4; [LLP 0034](./0034-contract-source-seam-provider-side.rfc.md))
is addressed envelopes over one multiplexed WebSocket, durable and ephemeral
lanes independent, reconnect as a fresh subscribe (never resume), loss on a
dying socket recovered by snapshot, subscription-scoped and connection-wide
`resync_required` sentinels, and per-subscription non-decreasing version
guards. Version semantics are pinned portably (DK-2,
[LLP 0007](./0007-storage-portability.spec.md) §Commit-version graduation):
per-app gap-free commit-visibility streams, opaque `(stream, version)` cursors,
allocator mechanics target-owned (SQLite serialized writer today, commit
fencing named for Postgres, one Durable Object version authority per app named
for Cloudflare).

What sync is **not** yet `[observed]`: there is no client-side local store, no
offline mutation queue, no replay, no delta-resume across reconnect. The
Valet-derived replay contract (captured `{generatedIds, now}`, sequence-ordered
replay, doc-id suppression) is fully designed in LLP 0008 and unimplemented.
"Local-first" is currently a wire-protocol-shaped promise, honestly labeled
Online-class in the adapter ([LLP 0012](./0012-headless-integration-contract.spec.md)).

### Ephemeral state

High-frequency transient state (cursors, presence) is a first-class subsystem,
not table writes ([LLP 0013](./0013-ephemeral-realtime-state.rfc.md);
[LLP 0026](./0026-ephemeral-backend-abstraction.plan.md)): typed TTL-bound
latest-state collections in sharded process memory, rooms with scope epochs,
per-connection outboxes with overflow-to-resync, rate budgets declared in the
schema and checked by the Exact analyzer at build time, and hard limits
enforced as structured rejections. Measured publish cost ~2 µs (~485k/s) — four
orders of magnitude of headroom over the 20–60 Hz cursor target. The graffiti
and cursors-web demos exercise both lanes on one connection. The hosted
adapters (Redis, Durable Objects) are design-only.

### The operational surface

Cron ([LLP 0028](./0028-cron-scheduled-execution.rfc.md)) ships with unusually
careful semantics: at-least-once, no-overlap, one catch-up tick, deterministic
jitter on by default, POSIX-OR day matching (DK-6, a deliberate breaking
change), unsatisfiable expressions rejected at validation, `WhileLive` demand
activation, and zero idle cost (the 1 s ticker does no work when nothing is
armed — the measured idle profile is zero disk writes, no measurable CPU,
~13 MiB resident over 120 s, [LLP 0035](./0035-local-target-benchmarks.research.md)
§Idle cost). Secrets/config ([LLP 0036](./0036-app-secrets-and-config.rfc.md))
is a genuinely well-engineered slice: declared entries with acquisition
metadata that render a setup wizard, an 0600 sibling store, per-invocation
grants delivering redacting handles only to fresh (never pooled) VMs, and
names-only projections everywhere. The admin console
([LLP 0017](./0017-admin-console-inspection-surface.rfc.md)) is a Contract-
built UI over a headless gated `/_snapback/api/*` contract, with a function
runner that displays captured read/write sets. Host operations
([LLP 0024](./0024-agent-operating-surface.spec.md)) exist as a six-verb
CLI/HTTP core with one `hostOpsResult` envelope; unimplemented verbs fail
loudly with structured codes rather than 404s.

### The process layer is part of the system

No description of Snapback is complete without the machinery around the code
`[inferred]`: the LLP corpus with `ref-check` enforcement (217 `@ref`
annotations tie code to design sections; Active documents may not carry
`[inferred]` claims — a promotion of LLP 0001 was *reverted* because the
tooling caught exactly that), capability manifests that make every gap a
structured fact, stable `SNAPBACK_*` diagnostic codes across Rust, codegen,
adapter, and harness, demo diaries with a pain-to-change program
([LLP 0016](./0016-diary-driven-change-program.plan.md)), adversarial redteam
re-runs with pre-registered flip conditions, and a hardening program
([LLP 0032](./0032-decision-and-implementation-hardening.plan.md)) that
registered fifteen defects with regression tests and drove ten decision-docket
rows to closure in about 48 hours of agent labor. The loop demonstrably closes
for anything a demo can reach: diary 0011's adapter reconnect gap was fixed the
same day with a mirrored acceptance check; diary 0006's landing entry counts
~465 lines of demo glue that "simply no longer exist" after the platform
absorbed its asks `[confirmed - diaries 0006/0011]`.

### What exists versus what is design

The capability-gap list in `crates/snapback/src/manifest.rs` is the honest inventory
`[observed]`. Built and real on the local target: the server + SQLite core,
both function styles, captured-read concurrency, matched live queries with
`live_delta`, the multiplexed wire protocol, ephemeral realtime, cron, secrets,
admin console + dev loop, host-ops CLI/HTTP, the codegen/artifact pipeline,
the Contract adapter and build preset, five demos with acceptance suites, the
benchmark harness. Design-only or absent: offline replay and any client local
store, Postgres, Cloudflare, hosted/untrusted execution, enforced resource
limits, external auth providers and the whole auth surface, assets,
notifications, MCP, dry-run, service principals, published packages, joins and
relation traversal, schema migrations beyond the additive applier, delta-resume
across reconnect.

## Part 2 — Prior art and positioning

### Lineage

Snapback is a second attempt, and it behaves like one `[observed]`. Valet
(expo/valet) proved the architecture directionally (Rust + SQLite + embedded
JS + trigger/change-table/tailer realtime) and failed on recoverable specifics.
[LLP 0006](./0006-valet-retrospective.research.md) recovered those specifics
into hard constraints — no silent codegen drops, no handler-source-only replay,
one commit version per mutation, authoritative initial snapshots, recoverable
backpressure, honest resource-limit reporting — and the corpus's discipline in
citing them per decision is exceptional. Nearly every load-bearing correctness
choice in Snapback traces to a tagged Valet failure. The corresponding risk is
survivorship `[inferred]`: the system is superbly defended against Valet's
failure modes and comparatively untested against failure modes Valet never
reached (hosted multi-tenancy, real concurrency at scale, adversarial code,
multi-process operation).

### The field, briefly

Peer-by-peer, drawing on [LLP 0001](./0001-prior-art.research.md),
[LLP 0022](./0022-electric-powersync-turso.research.md), the diaries, and this
reviewer's knowledge of the field `[inferred where comparative]`:

- **Convex** is the closest DX analogue: typed queries/mutations/actions,
  reactive-by-default subscriptions, transactional mutations, agent/MCP
  investment. Convex is more polished on every developer-facing loop (watch
  mode, colocated typed functions with inferred return types, React hooks,
  hosted dashboard, npm imports in functions) and has automatic read-set
  reactivity where Snapback has a declared analyzable subset. Snapback's
  counters are real: open source and self-hostable on your own SQLite file
  versus a proprietary hosted datastore; capability honesty ("Convex tends to
  hide its gaps; Snapback names them" `[confirmed - diary 0001]`); one
  coherent model for durable + ephemeral + cron where Convex stitches
  components; and a deliberate local-first plan where Convex is online-first.
- **Supabase** validates "auth and data in one database, open, self-hostable"
  — the closest philosophical peer at scale. Its RLS-on-Postgres authorization
  is both the reference and the cautionary tale for Snapback's unbuilt
  permission language. Snapback's named-function surface is safer to hand an
  agent than direct table access + RLS `[inferred]`, and its realtime
  contract (ordered changesets, membership deltas) is more principled than
  Supabase Realtime's broadcast primitives; but Supabase ships auth, storage,
  and an ecosystem today.
- **Firebase** remains the reference for the onboarding/offline/realtime magic
  and the scale-to-zero free tier that Snapback's prototype thesis chases —
  and the anti-model for data shape (schemaless NoSQL, no joins, lock-in).
- **ElectricSQL / PowerSync / Turso** ([LLP 0022](./0022-electric-powersync-turso.research.md))
  are the closest living peers on the sync thesis, and the corpus's own
  research is candid: each beats Snapback today on one axis (Electric:
  CDN-cacheable read-path fan-out; PowerSync: production auth-aware partial
  sync and the best agent-facing docs/MCP stack; Turso: the SQLite substrate
  at massive per-tenant scale). None attempts the vertical: one system from
  embedded prototype through server-authoritative sync to Postgres
  graduation. Electric's abandonment of generic bidirectional CRDT sync is
  the strongest external validation of Snapback's server-authoritative
  choice.
- **Zero/Replicache** validate query-driven partial sync with optimistic
  mutators and permissions in the sync layer — the model LLP 0008 adopts.
  **InstantDB** shows agents thrive on inspectable schema/permission files
  and sandboxes, which Snapback's artifact model matches. **PocketBase** is
  the minimal-footprint single-binary comparison: what Snapback's local
  target must beat on simplicity while offering far more (typed functions,
  live queries, sync). **Val Town** is the bar for instant code-to-endpoint
  DX. **SpacetimeDB** marks the fast-twitch boundary Snapback correctly
  declares a non-goal. **Rails** remains the philosophical north star for
  comprehensive-and-coherent, and the reminder that convention plus
  generators is a moat when executed completely.

### Does the differentiation hold?

The claimed differentiation is an intersection: comprehensive backend +
SQLite→Postgres portability + local-first partial sync + realtime + agent-first
+ scale-to-zero + MIT + Contract/Exact-native. As an *intersection* it is real —
no shipping system occupies it `[inferred]`. But reviewed honestly:

1. Every individual axis has a stronger incumbent today, so the bet only pays
   if the intersection is what users want and if Snapback actually ships the
   missing legs (sync replay, Postgres, a zero-idle deploy target, auth).
2. Two axes are currently *behind* the corpus's own named bar: agent operating
   surface (no MCP; PowerSync has one) and one-command developer loop (no
   watch mode, no scaffold, nothing published to a registry; Convex and
   PocketBase both beat it).
3. One axis — Contract/Exact-native — is both the sharpest differentiation and
   the least defensible dependency, because the primary client stack is a
   private, fast-moving sibling repository (see Part 4).

## Part 3 — The tradeoffs chosen

Each of these is a deliberate, documented bet. Listed with what it buys and
what it costs; assessments are `[inferred]` unless cited.

1. **SQLite + single writer + one global commit version.** Buys: trivially
   correct gap-free version streams, zero-ops embedded storage, the measured
   ~13 MiB zero-write idle profile, and a portability story upward (commit
   fencing on Postgres). Costs: a designed per-app write ceiling (~1,050–1,280
   mutations/s warm, measured), fan-out work inside the write lock, and an
   unproven Postgres leg. The DK-2 graduation note is genuinely good design —
   the contract is pinned so the wire never hardens around the local
   implementation. Verdict: right bet for the product class; the ceiling is
   the honest price of gap-free semantics, and every peer in this class pays
   a version of it ([LLP 0022](./0022-electric-powersync-turso.research.md)).
2. **Embedded Hermes (Ibex) as the canonical engine, V8 deferred.** Buys:
   small footprint, JIT-less environments, one vendored runtime, the local
   target's independence from any cloud. Costs: no enforceable CPU/wall-clock
   limits (reported Missing), no isolate hygiene for untrusted code, the
   warm-VM pool's complexity to claw back performance a V8 isolate pool would
   give more cheaply, a heavy native bootstrap that is the repo's #1 recurring
   DX pain (`scripts/bootstrap-ibex-runtime`, the wedge codes, DYLD scrubbing)
   `[confirmed - diaries 0001/0004/0010/0011]`, and a conformance twin
   deferred (DK-5), so "one programming model on two engines" remains
   unverified. Verdict: defensible for trusted-local v1, but the V8 leg is not
   optional — it is the prerequisite for hosting, untrusted code, and
   Cloudflare all at once, and deferring it concentrates risk.
3. **Server-authoritative query-result sync, LWW-per-field, no CRDT core.**
   Buys: a comprehensible model, idempotent whole-document deltas, and escape
   from the complexity that Electric abandoned and Valet designed-but-never-
   shipped. Costs: collaborative text needs its own future design; generic
   multi-master is out. Verdict: strongly supported by external evidence
   ([LLP 0022](./0022-electric-powersync-turso.research.md)); the right call.
4. **A restricted, analyzable syncable-live subset** (single table, declared
   index, structured predicates) rather than reactive-everything. Buys:
   provable membership deltas (the `live_delta` win — originally reported as
   ~5,200×, a figure since superseded per LLP 0035 — exists *because*
   the predicate is analyzable), honest capability classes, authorization-
   aware sync that can actually be reasoned about. Costs: an expressiveness
   gap against Convex's automatic reactivity; both close peers raced to add
   joins, so pressure here is predictable. Verdict: correct v1 line, with the
   join/graduation path the most important unstated design debt.
5. **Buffered `ctx.db` + commit-time read-set validation** instead of holding
   the write lock across handlers. Buys: native async handlers, no
   slow-handler write serialization (Valet's P99 ~1 s), predicate-granular
   conflicts measured at zero spurious rate. Costs: optimistic-concurrency
   semantics app authors must understand (conflict/retry), and mutation
   handlers still read the live write connection rather than a pinned
   snapshot (open refinement). Verdict: the best-executed subsystem in the
   codebase.
6. **Contract/Exact first; React/Expo second.** Buys: a genuinely novel
   authoring surface (typed ephemeral channels checked at build time; a
   `.contract` file that is "a complete, transcribable product spec"
   `[confirmed - diary 0010]`), Design-Mode alignment, and first-party
   pressure on the integration seam. Costs: the primary client is a private
   sibling repository consumed at HEAD, whose breakage is the single most
   recurring diary friction ("dev green, ship broken"; "the pin detects
   drift; it cannot hold a shared sibling still" `[confirmed - diaries
   0009/0010/0011]`); two of three adversarial redteams returned split or
   ship-React verdicts on operational grounds; and the public-adoption story
   (React hooks package, published npm packages) does not exist yet.
   Verdict: coherent as a strategy bet given the founder's portfolio, but it
   is the project's largest concentration of non-technical risk.
7. **Agent-first DX as the priority.** Buys: structured diagnostics
   everywhere, capability honesty as architecture, deterministic reset/seed,
   provenance-verified server reuse, machine-checkable acceptance — the parts
   of Snapback that feel years ahead of peers `[inferred]`. Costs: human
   conveniences (scaffold, watch mode, hooks) lag, and some agent affordances
   (MCP, dry-run) are specified but unbuilt, so today the *practices* are
   agent-first while part of the *tooling* is still missing.
8. **MIT, eyes open** ([LLP 0033](./0033-license-posture.decision.md)). Buys:
   the "truly open" value, differentiation against FSL peers, zero adoption
   friction. Costs: no license moat; the named response (trademark policy) is
   unwritten; CLA/contributor posture unexamined. Verdict: right for the
   thesis; the moat must come from velocity and completeness, which raises
   the stakes on actually shipping the missing legs.
9. **Docs-as-constitution (the LLP process).** Buys: traceability that made
   this review possible, drift gates that catch real dishonesty, decision
   dockets that turned benchmarks into architecture within days. Costs: the
   corpus needs its own maintenance subsystem; revision headers run to
   hundreds of words; several documents contradict themselves after fast
   pivots (0017's Accepted header vs Draft footer; 0021's body vs its own
   checklist); review debt is flagged but not always paid; and the single
   human ratifier is the throughput bottleneck. Verdict: net strongly
   positive today `[inferred]`, with a real risk the ratio inverts if paper
   keeps outrunning shipped surface.
10. **Local target first, Cloudflare second-but-designed-for.** Buys: the
    fastest possible iteration loop and a real product shape before
    distribution. Costs: local-shaped mass accretes (polling tailer, process-
    memory ephemeral, instance lock, Hermes bootstrap) while the second
    target stays paper — exactly the hardening risk LLP 0014 exists to
    prevent, now visible in the repo `[observed]`.

## Part 4 — Weak points and biggest risks

Ranked by expected impact on the thesis, not by ease of fix.

### Strategic

1. **The Exact/Contract coupling is the load-bearing external dependency.**
   The primary client stack lives in a sibling repository, consumed partly at
   HEAD with hand-maintained pins and aliases; the corpus's own integration
   spec calls the current packaging "the headless contract has not actually
   shipped," and the repo's newest commits are an interim `@exact/*` bridge
   `[observed]`. Every adversarial re-run's operational failures (production
   build DNF, silent shell takeover, alias deletions breaking demos for days)
   trace here `[confirmed - diaries 0007/0009/0010/0011]`. If Exact
   stabilizes and publishes, this becomes a moat; until then it is the most
   likely source of a lost month `[inferred]`.
2. **The thesis's flagship claims live on unbuilt legs.** Scale-to-zero
   economics → Cloudflare target (zero code; X3 scheduled, not done; and
   [LLP 0022](./0022-electric-powersync-turso.research.md) shows self-hosted
   scale-to-zero is not credible, so the claim *requires* that target).
   Local-first → offline replay (designed, unbuilt, honestly disclaimed).
   Auth-next-to-data → [LLP 0011](./0011-auth-and-permissions.rfc.md) surface
   unbuilt, and it is the critical path for authorized sync, the card-game
   acceptance slice, ephemeral privacy, and the Design-Mode story all at
   once. The system is honest about all three; honesty does not ship them.
3. **Single-consumer validation.** Every abstraction has been pressure-tested
   only by demos written by the same team in the same repo, on one machine
   class, with client-asserted dev auth. No external consumer, no second
   target, no hosted instance has pushed on the seams. The corpus knows this
   (LLP 0016's admission rule) but cannot substitute for it `[inferred]`.
4. **Bus factor and ratification throughput.** One human ratifier; agent labor
   executing ~48-hour phase cycles; a 22-commit near-loss when Phase 5 landed
   on a diverged local main (recovered via ENG-22680) `[observed]`. The
   process assumes a cadence that a single human checkpoint must sustain.

### Technical

5. **No handler timeout + actions hold the global write mutex.** A hung
   outbound `fetch` in an action wedges all mutations, cron, and (for
   in-memory DBs) all queries, indefinitely; only the file-backed read lane
   and ephemeral stay alive `[observed — crates/snapback/src/config.rs:20-25 admits the gap;
   /action/{name} runs under with_snapback]`. This is simultaneously the
   worst availability property and a known, documented, capability-reported
   gap. It converts one slow third-party API into a dead app.
6. **Transport authentication does not exist, and the connection-id namespace
   is the weak link.** `ctx.auth` is client-asserted dev identity;
   `GET /outbox/{connection_id}` is classified Public and
   `GET /live/{connection_id}/stream` upgrades with no check, so knowledge of
   a connection id suffices to drain another client's live results
   `[observed — crates/snapback/src/server.rs:225-234, 1561-1575]`. Public `/inspect` also
   returns complete JS module source. Loopback CORS deliberately echoes any
   localhost origin and allowlists the admin-token header, so any local web
   page can drive a token-less loopback admin API `[observed]`. All of this
   is defensible *only* under "trusted local, loopback bind" — and the
   admin-token comparison is non-constant-time (`c == p`,
   `crates/snapback/src/admin.rs:387`). The moment any bind leaves loopback, this posture is
   fatal; the mitigation today is documentation and defaults, not
   enforcement.
7. **The fan-out cliff outside the delta subset.** Ibex-executed live queries
   and ordered/limited windows re-run per affected subscriber per commit,
   inside the write lock, at warm-VM cost (~1.7–2 ms each): a 100-watcher
   Ibex query costs ~200 ms of write-lane time per commit `[observed —
   LLP 0035]`. The `live_delta` path covers only unordered single-table
   host-plan queries. The read-heavy reference apps (feeds, leaderboards)
   will live or die on extending the delta/boundary path.
8. **Portability is an untested promise.** No Postgres adapter, no
   cross-engine conformance matrix (the exact rig Valet asserted and never
   built — the corpus cites this warning and has not yet escaped it), no
   second execution site for query semantics. The single-sourced type map and
   the DK-2 contract are the right preparation; they are not evidence.
9. **JS-surface ergonomics debt.** Split declaration/implementation with
   stringly `exportName` glue, hand-declared `reads`/`writes`, no imports in
   handlers, `unknown`-returning bindings, whole-file handler source embedded
   per function in manifests (5× duplication in All Aboard), no watch mode,
   no scaffold, nothing published, no React hooks package, and codegen —
   1,900 lines of load-bearing tooling — has essentially no unit tests
   `[observed]`. None of this is architectural; all of it is what a newcomer
   hits in the first hour.
10. **Assorted implementation debt, honestly small.** `local.rs` as a 3.5k-
    line god object; error classification by substring matching on JS error
    text; HTTP status mapping defaulting unknown codes to 400; receipts
    hardcoding `"transport": "http"` for cron-driven mutations; a stats
    double-count when one mutation bumps permission epochs and fans out; the
    raw-pointer aliasing dance in the action host that is correct today and
    fragile under refactor `[observed — agent-verified file:line refs]`.

### Process

11. **CI is currently off.** GitHub Actions has been billing-blocked since
    2026-07-02; the verification scripts run on the honor system locally
    `[observed — workflow comments]`. For a project whose philosophy is
    machine-checkable feedback loops, this is the most ironic gap in the
    repo, and it silently degrades every "CI enforces X" claim in the corpus.
12. **Corpus drift and review debt.** Status headers contradicting footers,
    same-session self-reviews candidly flagged but outstanding (0031, 0034 —
    the latter Accepted same-day against both reviewers' recommendations),
    and revision headers whose length now impedes the traceability they
    exist to provide `[observed]`.

## Part 5 — Differentiated strengths

1. **Capability honesty as architecture.** Gaps are structured facts —
   manifest fields, `notClaiming` lists, fail-closed rejections of
   unimplemented options (cron `backoff`), tests that assert the *gap* is
   reported. This is the system's integrity mechanism and its most
   copied-worthy idea `[inferred]`. No peer does this systematically.
2. **The evidence loop.** Benchmarks that decide architecture within days
   (M1 → DK-4 warm VM → M3 → `live_delta`, each with revisit triggers that
   actually fired and were honored), diaries that become tracked issues that
   become regression tests, adversarial redteams with pre-registered flip
   conditions and preserved dissent. As a *method*, this is years ahead of
   normal practice `[inferred]`.
3. **One predicate vocabulary, three consumers.** Captured read dependencies
   serve conflict validation, live matching, and read-your-writes — so
   correctness, reactivity, and isolation cannot drift apart. The measured
   payoffs (0.0 spurious conflicts; delta fan-out originally reported at
   ~5,200×, since superseded per LLP 0035) both fall out of this
   unification.
4. **Agent-grade diagnostics.** Stable `SNAPBACK_*` codes end to end,
   machine-readable envelopes on every surface, provenance-verified server
   reuse, vacuous-pass guards in the harness. "I could assert on codes
   instead of scraping prose" `[confirmed - diary 0001]` is the compounding
   advantage for agent-built apps.
5. **Ephemeral realtime as a typed schema primitive** with declared rate
   budgets checked at build time — no competitor has this shape, and the
   measured headroom (~485k publishes/s) is enormous for its product target.
6. **A genuinely earned scale-to-zero idle profile** on the local target:
   zero disk writes, unmeasurable CPU, ~13 MiB resident — the "idle means
   idle" half of the claim is banked; only the dollars half awaits a target.
7. **Truly open, deliberately.** MIT with the free-riding exposure reasoned
   through and revisit triggers named, against an FSL trend among peers.
8. **Security engineering where it exists is real:** the warm-VM
   epoch/reset/burn design, the secrets slice (grants, redacting handles,
   never-pooled VMs, names-only projections), the route-taxonomy registry
   with enforcement tests, and the two-lane exec-guard architecture are all
   above the bar for this stage `[observed]`.

## Part 6 — Overall assessment

By dimension `[inferred]`:

- **Architecture and design judgment: excellent.** The core semantics (one
  commit version, buffered handlers, optimistic read-set validation, honest
  capability classes, per-app version streams) are correct, mutually
  consistent, and pinned before the wire could harden wrong. Design errors
  Valet made once are structurally prevented, not just avoided.
- **Implementation quality relative to scope: strong.** Disciplined error
  handling, documented lock orders, adversarially-tested concurrency,
  216 tests including enforcement tests for the system's own architectural
  rules. Known holes are documented rather than hidden. Grade tempered by
  the availability/auth gaps in Part 4 and the god-object accretion.
- **Product completeness relative to the stated thesis: early.** Roughly:
  the v0 local loop is done and hardened; of v1, cron + secrets + ephemeral +
  admin are real while auth, assets, notifications, offline, and any second
  target are paper. The README's status banner says this plainly, to its
  credit.
- **Developer/agent experience: bimodal.** For an agent inside this repo
  with the Exact sibling configured, the loop is exceptional. For anyone
  else, there is no installable package, no scaffold, no watch mode, no
  hosted anything — the paved road currently ends at the monorepo boundary.
- **Process: a differentiated asset trending toward heavy.** The machine
  works — the question is whether it scales past one ratifier and whether
  the corpus's maintenance cost stays sublinear in its value.

**Overall: this is a very good system in the making, reviewed at the moment
where its risk is maximally concentrated in what has not been attempted yet**
`[inferred]`. The quality of what exists is well above the norm for its age;
the honesty machinery means the gaps are known, named, and tested-as-gaps
rather than lurking; the measured local envelope (warm ~1k mutations/s,
28k+ delta subscribers/commit, zero idle) is credible for the Partiful-class
north star *if* the delta path generalizes and the missing legs land. The
things most likely to sink it are not in the code: they are the Exact
delivery vehicle, the unstarted second target that the economics claim
depends on, the unbuilt auth layer that most differentiation routes through,
and the possibility that the intersection thesis takes longer to assemble
than the competitive window stays open. None of those is refuted by the
excellence of the local core — and the local core's excellence is exactly
what makes them now the binding constraints.

## Part 7 — Recommendations

Ranked. The first four are sequencing arguments about the next phase; the
rest are cheaper corrections.

1. **Buy evidence on the unproven legs before polishing the proven one.**
   Concretely: execute LLP 0032 X3 (the Cloudflare narrow proof) now — it is
   the first real V8 conformance exercise (DK-5 trigger 1), the first test of
   the change-notification seam off the polling tailer, and the only way the
   scale-to-zero economics claim stops being paper. Local-core optimization
   past the current envelope has visibly diminishing returns; the thesis
   does not.
2. **Build the auth vertical slice next among subsystems.** LLP 0011's
   direction is ratified; almost everything differentiating (authorized
   partial sync, the card-game slice, ephemeral privacy, Design-Mode
   mappings, "auth next to your data") is blocked behind it. A minimal slice
   — `ctx.auth` from a real session, one provider, declared auth-variable
   dependencies feeding the existing epoch/resync machinery — unblocks more
   of the corpus per unit work than anything else `[inferred]`.
3. **Close the two local security/availability holes even though "it's
   local."** (a) Bound action execution: at minimum move actions off the
   global write mutex (they already commit only via `ctx.runMutation`, which
   can reacquire) and add a coarse watchdog — even a kill-the-VM-thread
   fallback — so one hung fetch cannot wedge the instance; the capability
   report keeps honesty either way. (b) Authenticate the connection-id
   namespace (unguessable server-issued ids at minimum, a bearer handshake
   ideally) and trim module source from public `/inspect`. These are cheap
   now, expensive after any demo binds beyond loopback, and both were
   verified live in this review `[observed]`.
4. **De-risk the Exact coupling by finishing what LLP 0021 already says:**
   publish real versioned `@snapback/*` and Exact packages, kill
   sibling-at-HEAD consumption in every demo (cursors-web's `cd ../../exact`
   dev script is the emblem), and keep the React control arm first-class —
   the redteams show it is the reproducibility hedge while Contract's
   delivery vehicle matures. If publishing Exact is not yet possible, vendor
   a pinned snapshot; the pin must *hold*, not merely detect drift
   `[confirmed - diary 0010]`.
5. **Ship the minimum agent operating surface the thesis already promises:**
   the control-plane MCP server over the existing host-ops core, plus watch
   mode and `snapback new`. This closes the gap between agent-first
   *practices* (excellent) and agent-first *tooling* (missing), and it is
   mostly projection work over surfaces that exist.
6. **Either schedule offline replay or soften the local-first language.** The
   wire protocol, replay environment, and store-agnostic client interface
   (DK-9) are all designed; the honest Online-class labels protect the
   contract but the README's present-tense "syncs the relevant slice down to
   the device" outruns the code. Pick the fix by capacity; do not leave the
   gap ambiguous into any public moment.
7. **Extend the delta path toward the reference apps that need it:** ordered/
   limited windows first (the matcher already has boundary primitives), then
   captured plans for Ibex queries where analyzable, then move remaining
   re-query fan-out off the write lock. This is the measured next lever after
   DK-3/DK-4 and the difference between "chat demo" and "feed at load."
8. **Restore CI immediately** (billing), and while at it add the missing
   high-value integration tests the code review identified: WS reconnect
   supersession under load, journal prune + resume floor with live
   subscriptions, outbox overflow-to-resync with a real client, kill-and-
   reopen crash recovery, and unit tests for the 1,900-line codegen package.
9. **Put the corpus on a diet without losing its teeth.** Cap revision-header
   length (move history to a per-doc changelog section), derive status
   summaries from the LLP 0000 ledger instead of restating them per document,
   fix the known header/footer contradictions (0013, 0017, 0021, 0025), and
   pay the flagged review debt on 0031/0034 with genuinely independent
   passes. The process is a real asset; its current growth rate is not free.
10. **Small code-health items, batched:** split `local.rs` along its four
    natural seams; constant-time admin-token comparison; classify JS errors
    by structured code rather than message substring; honest receipt
    transport for cron/action-driven mutations; fix the fan-out stats
    double-count; document (or eliminate) the action-host raw-pointer
    aliasing with a dedicated safety test.

## Confidence

- How the system works (Part 1): **high** — read directly from code and
  corpus, with the load-bearing security/availability claims spot-verified
  at file level in this session.
- Measured performance characterizations: **medium-high** — they cite
  [LLP 0035](./0035-local-target-benchmarks.research.md), which is honest
  about being single-machine, order-of-magnitude data.
- Prior-art comparisons (Part 2): **medium** — grounded in the corpus's own
  primary-source research (LLP 0022) and this reviewer's knowledge; the
  external landscape moves fast and product specifics should be re-verified
  before any decision leans on them.
- Weak points and risks (Part 4): **high for existence** (each is observed in
  code or corpus), **medium for ranking** — relative impact is judgment.
- Overall assessment and recommendations (Parts 6–7): `[inferred]` throughout
  — the reviewer's judgment, offered for the ratifying source to accept,
  reweight, or reject.

## Open questions

- What is the acceptance bar for calling the intersection thesis *validated*
  — first external consumer? first non-loopback deployment? first reference
  app past the demo scale profile? Naming it would give the strategic risks
  in Part 4 the same falsifiability the technical ones already have.
- Does the Contract-first client priority survive contact with public
  adoption, or does the React/Expo path (LLP 0016 Phase 6) become the de
  facto front door? The redteam evidence cuts both ways and the corpus has
  not yet forced the question.
- Where exactly does the join/relational-traversal line land for syncable
  queries, and can the analyzable-subset approach extend there without
  forfeiting the delta win? Both close peers faced this pressure within a
  year of shipping.
- What is the smallest hosted/multi-tenant offering consistent with LLP 0009's
  honesty rules (V8 + killable isolates + enforced limits), and when does it
  become worth building relative to the Cloudflare leg?

## Status

Draft. A point-in-time external-style review, written 2026-07-05 against the
post-P5/P6 main. It asserts no new contracts; where it disagrees with ratified
direction it says so and defers to the ratifying source. Revisit after X3
(Cloudflare narrow proof), the auth slice, or the first external consumer —
whichever lands first — since any of those will invalidate parts of Part 4's
ranking, which is the point.
