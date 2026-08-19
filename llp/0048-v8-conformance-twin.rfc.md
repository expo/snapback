# LLP 0048: V8 conformance twin

**Type:** RFC
**Status:** Draft
**Systems:** Runtime, Security, Testing, Developer experience, Deployment
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-07
**Revised:** 2026-08-18 (LLP 0276 crate-path relocation); 2026-08-01 (the declared/undeclared/bare application-refusal
triad now runs through all three serving surfaces; local admission occurs at
the shared post-executor join and Cloudflare admission uses the resolved
deploy-time function declaration, closing LLP 0144's widened parity gap).
2026-07-18 (dynamic source compilation is now a convergent runtime denial: Workerd proves its platform policy before handler evaluation, Snapback opts Ibex into no-eval Hermes plus patch 0010, the twin covers constructor and reflective aliases, and AST codegen diagnostics remain defense in depth)
**Revised:** 2026-07-13 (audit blocker: the Workerd settlement and detached-host-call drain consume one shared invocation deadline; expiry aborts HOST fetches and reports the quiescence phase before the outer kill deadline); 2026-07-13 (whole-codebase security follow-up: trusted strip state is one-shot and consumed before handler evaluation; the rejection ledger/drain is closure-private rather than importable; Promise-channel records, Response thenability, and Promise species resist inherited-then forgery; independent invoke/host/response capabilities close the worker-port bind race; readiness/invoke response bodies and sanitized stderr tails are bounded); 2026-07-12 (ENG-24559/ENG-24564: rejection collection is lexical rather than handler-drainable; response serialization is captured/prototype-free; local invoke and callback transports authenticate before bounded reads; per-invocation files use an atomically created 0700 UUID directory and exclusive 0600 files); 2026-07-12 (ENG-24375: encoding boundary coverage now pins
forgiving-base64 padding validation, the complete UTF-8 label table with exact
ASCII-whitespace/Web-IDL conversion, and streaming UTF-8 decoder state;
ENG-24339: adversarial twin coverage pins sealed invoke/settle globals,
accessor and wrapper interception, and raw host-call denial; whole-review
integration: canonical evidence no longer embeds an absolute developer
worktree path); 2026-07-07
(post-review author pass: internal manifest profile id
pinned as `local-conformance-sqlite-workerd-v8`, `nodejs_compat` refusal test
added to acceptance, and the two author decisions given proposed defaults
pending Charlie's nod — first allowlist slice (encoding/URL/base64/console)
and the minimum LLP 0040 deploy gate; earlier same day, review pass: logical
host-call protocol clarified
versus physical transport, workerd fidelity/security claims narrowed, V8 kill
domains and generated runtime-surface tests pinned; later same day:
handler-visible API surface pinned to the Workers dialect — generated allowlist,
subtractive on the V8 leg, additive on the Ibex leg, decided by Charlie
in-session; initial same day — executes the DK-5 re-decision recorded in
LLP 0009 §Decision DK-5)
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0007, LLP 0009, LLP 0010, LLP 0012, LLP 0014, LLP 0035, LLP 0040, LLP 0041, LLP 0043, LLP 0047, https://github.com/cloudflare/workerd, https://developers.cloudflare.com/workers/runtime-apis/web-standards/

## Summary

This RFC builds Snapback's local V8 handler runtime: the same handler harness
[LLP 0040](./0040-cloudflare-narrow-proof.rfc.md) will deploy to Cloudflare,
hosted in local **workerd** behind the async, RPC-shaped handler↔host seam
([LLP 0014](./0014-cloudflare-strategy.rfc.md) §One-way doors 3), driven by
the unchanged canonical local server. It has three jobs:

1. **The DK-5 conformance twin.** Run the existing conformance corpus with
   only the handler executor swapped — storage, host operation
   implementation, generated artifacts, and the logical host-call protocol
   identical — so any behavioral difference is either a protocol-adapter bug
   or an engine fact, attributable on sight, and the engine-neutral
   handler-semantics contract becomes a standing CI gate rather than an
   intention.
2. **The Cloudflare proof's harness, proven first.** LLP 0040's V8 handler
   harness (global-strip at module init, `ctx`-only powers, the tagged
   completion envelope of LLP 0009's conformance floor) is built and passes
   here before the first deploy — the engine half of Phase 0, de-risked
   without wrangler, billing, or credentials.
3. **LLP 0047's deterministic limits testbed.** Kill semantics and wall-clock
   enforcement land first at this service boundary, where they are locally
   testable: the busy-loop kill, structured kill diagnostics, and the first
   V8 capability manifest whose limit fields are computed, not asserted
   (LLP 0009 DK-5's capability-truthfulness note).

This document is prerequisite-shaped for LLP 0040: the first real deploy
consumes the harness only after the twin's conformance gate passes locally.

## Motivation

DK-5 ([LLP 0009](./0009-code-execution-security.rfc.md) §Decision DK-5)
deferred a synthetic V8 twin on 2026-07-02, with four revisit triggers. The
first two fired on 2026-07-07 — LLP 0040 starts X3, and
[LLP 0047](./0047-hosted-execution-limits.rfc.md) begins hosted-limits work —
and the re-decision (recorded in 0009, ratified by Charlie in-session) is to
build the twin now. Two things changed since the deferral:

- **The cost structure changed.** DK-5 correctly refused "a second native
  bring-up — the repo's #1 recurring DX pain." The handler↔host seam is now
  pinned async and RPC-shaped (LLP 0014 §One-way doors 3, LLP 0040 §App
  subset), which turns a second engine from an embedding problem into a
  protocol consumer: the twin is the 0040 harness hosted in local workerd,
  not V8 linked into the `snapback` binary.
- **Bi-engine became permanent, not transitional.** Cloudflare is V8 by
  construction; Exact on devices is Hermes; and
  [LLP 0012](./0012-headless-integration-contract.spec.md)'s parity rule
  makes eventual on-device handler execution
  ([LLP 0043](./0043-offline-replay-retention.rfc.md)'s direction) a Hermes
  execution site. There is no single-engine future in either direction — the
  enduring engine posture and the four reasons Hermes stays canonical
  locally are recorded in 0009's DK-5 re-decision, and
  [LLP 0002](./0002-canonical-local-target.decision.md) does not reopen.

The twin is therefore not a migration tool toward either engine. It enforces
an **engine-neutral handler-semantics contract** — the runtime analogue of
[LLP 0007](./0007-storage-portability.spec.md)'s storage portability
contract: portable by default, engine-specific behavior a declared fact,
never a silent divergence.

Expectations are calibrated: LLP 0009's runtime gates and codegen diagnostics
remove the divergence-prone surface ("`import`/`process`/`fetch`/timers/
`Date.now`/`Math.random`/dynamic source compilation"; the `ctx` surface is the only power), so the twin should
mostly *confirm* convergence. Its value is the standing gate, the limits
testbed, and de-risking 0040's hardest new seam — more than immediate bug
yield.

## Design

### Architecture

The canonical local server (Ibex + SQLite, unchanged) gains an alternate
handler-execution backend selected per run: a local workerd process hosting
the shared handler harness, speaking the async host-call protocol over a
private local transport. The Ibex path stays in-process and default, so the
physical transport is intentionally not the invariant. The invariant is the
logical protocol: request/response shapes, host-call ordering, idempotence and
commit boundaries, diagnostic codes, and a machine-readable host-call trace.
The V8 and Ibex legs must produce equivalent traces before their user-visible
outputs are compared. Nothing about storage, the version stream, the matcher,
generated artifacts, or the public wire changes — the twin swaps the handler
executor and its adapter, not the rest of the system.

The harness is the same artifact LLP 0040 deploys: ambient globals removed or
shadowed at module init (`fetch` and friends are globals in an isolate —
LLP 0040 §App subset), host powers reachable only through the generated async
`ctx` surface, results delivered as the tagged completion envelope so an
untagged output is a failed invocation (`SNAPBACK_HANDLER_DID_NOT_SETTLE`,
LLP 0009). Harness source is single-sourced between the twin and the deploy
template; divergence between them is a structured failure, not a drift.

### Single-sourced runtime flags

workerd is chosen over a Node.js host because fidelity is the point: workerd
is based on the same runtime code as Workers and shares the
`compatibility_date`/flag model, while Node carries different globals and its
own V8 cadence. The twin does not assert "same production build" by trust: it
records the workerd package/release id, the selected `compatibility_date`,
compatibility flags, and any available runtime version facts in the capability
manifest. The twin's workerd config and LLP 0040's deploy config are generated
from one source, following the `schemas/` drift-gate pattern; an unsupported
compatibility date, a compat-flag mismatch, or accidental Node compatibility
surface (`nodejs_compat*`) fails closed.

### Handler-visible API surface

The reference dialect is **the Workers platform, not Ibex** (decided by
Charlie, 2026-07-07): where handler code can see an API at all, its name and
observable semantics match what Cloudflare provides, and gap-closing lands on
the Ibex side — or as a codegen ban on both engines — never as a
Snapback-invented global. Three layers:

1. **ECMAScript intrinsics** (`JSON`, `Math`, `Array`, …) — both engines
   provide them; the conformance diff covers their agreement.
2. **Ambient authority** (`fetch`, bindings, env, timers, dynamic code) —
   stripped or disabled by the harness/platform on V8, disabled by the
   embedder runtime on Ibex, and diagnosed by codegen either way (LLP 0009).
3. **Compute-only platform APIs** — the deliberate middle: candidates like
   `TextEncoder`/`TextDecoder`, `URL`/`URLSearchParams`, `atob`/`btoa`,
   `structuredClone`, `crypto.subtle.digest`, and `console` routed to
   diagnostics. workerd provides these natively — a major reason the runner
   is workerd rather than raw V8, which ships no web platform and would
   force Snapback to hand-build one, creating a third dialect. Handlers see
   an explicit **allowlist generated as data** and asserted by the twin on
   both engines. An API enters the allowlist only if (a) Workers provides
   it, (b) it is deterministic under LLP 0007's replay rules — so
   `crypto.getRandomValues`/`crypto.randomUUID` stay banned; entropy and ids
   come from the runtime, like `now` — and (c) Ibex provides matching
   observable semantics or gains them.

The allowlist is member-granular, not object-granular. Admitting
`crypto.subtle.digest`, for example, does not admit raw `crypto`,
`crypto.getRandomValues`, or `crypto.randomUUID`; the harness either exposes a
Snapback-owned wrapper or proves those members are unreachable. The generated
allowlist also emits the negative probes: after the V8 global-strip and after
Ibex additive installation, tests inspect `globalThis`/`self` descriptors and
try off-list names through obvious aliases, prototype paths, constructor
escape hatches, and host-object serialization. Each leg proves direct/indirect
eval and every reachable Function-family constructor unavailable before the
handler module evaluates. The V8 strip seals the global Function constructor
and each Function-family prototype constructor to one Snapback denier while
retaining the ordinary shared Function prototype shape, and its startup probe
requires that exact denial rather than relying on Workerd's current V8 default;
codegen also diagnoses dynamic-code paths (`eval`,
Function constructors, `with`, and dynamic import). The runtime-surface test is
therefore not bypassable through aliases or reflective constructor calls.

The work is therefore asymmetric by design: on the V8 leg the surface is
**subtractive** (workerd has everything; remove authority and
nondeterminism), on the Ibex leg **additive** (a lean engine gains exactly
the allowlisted APIs, or the API is banned for both). "Close enough" is
measured, not hoped: the twin asserts the same list with the same behavior
on both legs.

**Proposed first slice (pending Charlie's nod):** encoding
(`TextEncoder`/`TextDecoder`), `URL`/`URLSearchParams`, base64
(`atob`/`btoa`), and diagnostics-routed `console`. `structuredClone` and
`crypto.subtle.digest` enter a second slice only after the member-granular
wrappers and negative probes are proven — the hard case is member-granular
crypto exposure, not encoding.

### The conformance contract

Handler semantics are defined by Snapback, not by whichever engine runs them
(the same rule LLP 0007 pins for query semantics). The conformance corpus
runs on both engines and diffs. Divergences fall into exactly three classes:

1. **contract violations** — same inputs, different observable handler
   behavior: fails CI, fixed by pinning the semantics or narrowing the paved
   path;
2. **declared engine facts** — real, wanted differences (e.g. enforced CPU
   limits on V8): reported in the capability manifest, per target profile;
3. **diagnostic-flavored noise** — error strings, stack shapes, message
   formatting: normalized before comparison, because diagnostic *text* is
   engine-flavored and is not part of the contract (stable `SNAPBACK_*`
   codes are).

A divergence that fits none of these classes blocks the gate until it is
classified. The report is machine-readable, like the LLP 0010 conformance
corpus it extends.

### Limits testbed (LLP 0047)

The service boundary is where enforcement is real: the host owns the workerd
process and can kill a stuck handler regardless of what the handler does. The
first V8 runner's kill domain is **one invocation**: if enforcement is process
termination, the runner starts one workerd process per invocation, serializes
work so no unrelated invocation shares the kill domain, or uses an equivalent
isolate/request cancellation primitive that proves the same collateral-free
property. Pooling or multiplexing V8 invocations is blocked until it can prove
LLP 0047's fresh-per-invocation isolation and burn-on-uncertainty semantics.
On the V8 leg, LLP 0047's first acceptance items execute locally and
deterministically — a busy-loop query killed with a stable diagnostic and no
committed writes, an oversized result rejected, a stale continuation refused.
The V8 leg's capability manifest — internal profile id
`local-conformance-sqlite-workerd-v8`, named to be unmistakably non-public so
generated clients cannot mistake it for a supported `local-dev-sqlite-v8` —
reports its limit fields and kill-domain facts computed on the real runtime;
the Ibex leg's manifest is untouched and stays honest
(`wall_clock_timeout`/`cpu_budget` Missing, `action_wall_clock_timeout`
Enforced — LLP 0009).

### Security posture, stated asymmetrically

The two engines are strong on different axes, and the manifests must say so
rather than imply equivalence (LLP 0009 §Engine and threat model, extended by
the DK-5 re-decision): Ibex denies ambient authority **by construction** —
the host hands in capabilities and nothing else exists; the V8 leg achieves
the same posture **by discipline** — the harness strips globals, and the
denial suite (probing both directions: ambient globals and host-object
reach-through, per LLP 0040) is what keeps that discipline from eroding until
Workers for Platforms enforces it at the platform layer. Local workerd is not
treated as a hardened sandbox; it is deterministic conformance and
limit-preflight evidence for trusted local tooling, not proof that
`hosted_untrusted_code` can graduate without the real platform defense-in-depth
and LLP 0047 evidence. Conversely the V8 leg gets killability and computed
limits Hermes cannot offer. Neither leg's report may claim the other's
strength.

### Distribution posture

workerd is a dev/CI dependency (npm-distributed), never part of the product
binary — [LLP 0041](./0041-packaged-dev-loop.rfc.md)'s runtime-distribution
story remains Hermes-only. The twin backend is not the default, is not
required for ordinary local development, and its absence is a capability
fact, not an error.

### Sequencing

Prerequisite-shaped, without over-serializing: LLP 0040's first real deploy
requires the twin's conformance gate green on the corpus subset that covers
the proof's app surface. Full-corpus breadth and CI cadence can trail (see
Open Questions). The twin can begin immediately — it needs no Cloudflare
account, which is the point.

**Proposed minimum gate for LLP 0040's first deploy (pending Charlie's
nod):** the harness envelope suites (settlement, unhandled rejection), the
async `ctx` host-call corpus covering the proof's app surface (its query,
mutation, and subscription shapes), the two-direction ambient-power denial
suite, one end-to-end V8 mutation, and the busy-loop kill path LLP 0047
expects. Demo acceptance suites are not part of the gate; full corpus
breadth trails in CI.

### Implementation slices

1. Extract the single-sourced handler harness and generated workerd/deploy
   runtime config, including the Workers-dialect API allowlist and negative
   probes.
2. Add the workerd executor behind the existing handler-execution seam with a
   one-invocation kill domain, the private host-call transport, and the
   machine-readable trace schema.
3. Extend the conformance runner to execute the same corpus on Ibex and V8,
   diff host-call traces, normalize diagnostic text, and emit the classified
   divergence report.
4. Add the internal V8 capability manifest profile with workerd version facts,
   compat config, kill-domain facts, and computed limits, without making it a
   public supported target profile.
5. Make LLP 0040's deploy template consume the same harness/config only after
   the local gate for the proof's app-surface corpus is green.

## Non-goals

- Reopening [LLP 0002](./0002-canonical-local-target.decision.md): Ibex +
  SQLite stays the canonical local target and the default engine.
- Embedding V8 (`rusty_v8`/`deno_core`) in the `snapback` binary — the
  second-native-bring-up cost DK-5 refused still holds.
- A Node.js-hosted runner (wrong V8, wrong globals; fidelity is the point).
- Claiming hosted or untrusted execution — LLP 0047 still gates that claim;
  the twin runs trusted code as local tooling.
- A public, supported `local-dev-sqlite-v8` target profile in v1. The runner
  may graduate into one later if users want V8-local semantics; that is a
  separate decision with its own manifest, docs, and support surface.
- Replacing LLP 0040's real-Cloudflare evidence: the twin produces engine
  evidence; hibernation, billing, placement, and platform limits remain
  deploy-only evidence (LLP 0040 §Measurements, evidence split).

## Acceptance

- The conformance corpus runs against both engines with only the handler
  executor swapped — same storage, host operation implementation, generated
  artifacts, logical host-call protocol, and public wire. Physical transport
  differences are hidden behind equivalent host-call traces. The runner emits
  a machine-readable divergence report in which every divergence is a fixed
  contract violation, a protocol-adapter bug, a declared engine fact, or
  normalized diagnostic noise; an unclassified divergence blocks the gate.
- The harness (global-strip, `ctx` marshaling, completion envelope) is
  single-sourced with LLP 0040's deployed Worker, and the workerd compat
  flags are generated from the same source as the deploy config; unsupported
  compatibility dates, accidental Node compatibility flags, or config mismatch
  are structured failures — including a generated-config test that requests
  `nodejs_compat` and is refused.
- The ambient-power denial suite passes on both engines, probing both
  ambient globals and direct host-object reach-through.
- The handler-visible global surface is an explicit generated allowlist in
  the Workers dialect; the twin asserts the same member-granular list with the
  same observable behavior on both engines, and anything off-list is
  unreachable (covered by descriptor checks and the denial suite).
- A busy-loop query on the V8 leg is killed with a stable `SNAPBACK_*`
  diagnostic, no committed writes, and no collateral kill of an unrelated live
  invocation; a killed mutation commits nothing.
- A non-settling handler and an unhandled detached rejection produce the
  same structured failures on both engines
  (`SNAPBACK_HANDLER_DID_NOT_SETTLE`, `SNAPBACK_HANDLER_UNHANDLED_REJECTION`)
  — LLP 0009's conformance floor is engine-neutral in practice, not just in
  prose.
- The V8 leg serves the internal `local-conformance-sqlite-workerd-v8`
  capability manifest, distinct from `local-dev-sqlite-ibex`, with workerd
  version facts, compatibility config, kill-domain facts, and limit fields
  computed on the real runtime; the Ibex leg's manifest is unchanged.
- The twin leg runs in CI with no Cloudflare credentials.

## Open Questions

- Does the proposed first allowlist slice stand (encoding, URL, base64,
  `console`; `structuredClone`/`crypto.subtle.digest` deferred), and for each
  admitted API does Ibex gain it natively or via a harness-installed
  implementation?
- CI cadence: is the twin leg per-change on the conformance corpus with the
  full demo suite nightly, or full-suite per-change?
- Physical transport for the private host-call protocol: stdio pipe, unix
  socket, or local HTTP — and what trace schema proves equivalence without
  exposing a public route?
- Does the proposed minimum gate for LLP 0040's first deploy stand (harness
  envelope, `ctx` host-call corpus for the proof's app surface, two-direction
  denial, one end-to-end V8 mutation, busy-loop kill), or must any demo
  acceptance suite join it?
- Does the twin join LLP 0035's benchmark harness in v1 (the expected shape:
  Hermes faster at spinup, V8 faster on JITed hot paths, the gap narrowing
  under fresh-per-invocation execution), or is that a later research pass?

## As-built (2026-07-07)

The twin is built and its minimum gate is green. What landed:

- **Single-sourced harness.** The ctx bootstrap, the invocation settlement
  wrapper, and the Workers-dialect allowlist installer are extracted to
  `packages/snapback-harness/` and `include_str!`-embedded into the Ibex
  runtime (`crates/snapback/src/runtime.rs`), so the Ibex leg, the workerd leg, and the
  LLP 0040 deploy Worker run the *same* JS bytes. The Ibex ambient-denial list
  is now generated from `allowlist.json`'s `bannedEverywhere.globals`, so the
  two engines' banned surface is one data source, not two hand-maintained
  lists.
- **workerd executor behind a per-run seam.** `crates/snapback/src/workerd_exec.rs` adds the
  V8 backend: a fresh workerd process per invocation (kill domain = one
  invocation), the harness modules materialized from the single source, a
  private loopback host-call transport, and the async `ctx` protocol served
  by the *same* `dispatch_host_call` op table the Ibex FFI trampoline uses.
  Backend selection is per-run (`SNAPBACK_HANDLER_BACKEND=workerd-v8` or a
  thread-local test seam); Ibex stays default. Actions stay on Ibex (egress
  and secrets are out of the twin's scope; the manifest says so).
  Materialization uses an atomically-created unpredictable UUID directory,
  owner-only on Unix (0700), with each harness/config/log file opened
  create-new at 0600. The local `/invoke` socket requires a generated bearer
  before its bounded body is read; the callback listener bounds request lines,
  aggregate headers, and body size and authenticates before body allocation.
  Caller→worker invoke, worker→host callback, and worker→caller response use
  three independent per-invocation capabilities. Readiness and invoke clients
  authenticate the response header before inspecting `Content-Length` or
  reading a bounded body, so a process winning the reserved-port bind handoff
  can neither learn callback authority nor forge a successful response. Public
  diagnostics read a fixed tail window from stderr and redact capability values
  and the private materialization path.
- **Conformance runner + gate.** `crates/snapback-conformance/src/bin/snapback-conformance-twin.rs` runs
  one corpus (`tests/conformance/twin-corpus.handlers.js`) on both engines,
  normalizes ids/timestamps and strips diagnostic-only `runtime.log`, then
  diffs normalized outcomes, host-call traces, and committed storage. Current
  gate: **14 convergent, 2 declared engine facts, 0 contract violations**. The
  two declared facts are the V8 busy-loop wall-clock kill (enforceable only at
  the service boundary) and Ibex's non-configurable `HermesInternal` global.
  `Date.now`/`Math.random`, zero-argument Date construction, and dynamic source
  compilation are now convergent runtime denials. `crates/snapback/tests/workerd_twin_v0.rs`
  pins the LLP 0009 floor (settlement, unhandled rejection) engine-neutral,
  the two-direction ambient denial on both engines, the allowlist-slice
  agreement, and the busy-loop kill with no commit and no collateral.
- **Internal V8 manifest.** `CapabilityManifest::conformance_workerd_v8`
  serves `local-conformance-sqlite-workerd-v8` with computed `runtime_facts`
  (workerd release id, compat pins, kill domain, measured wall-clock budget);
  `wall_clock_timeout` reports **Enforced** here, `cpu_budget` stays honestly
  **Missing**. `crates/snapback/tests/workerd_config_v0.rs` proves the single-sourced compat
  config and the `nodejs_compat*` refusal.

**Author decisions taken (proposed defaults in the header, applied):** the
first allowlist slice is encoding + base64 + diagnostics-routed console, plus
`queueMicrotask` (moved into the slice — it is ordering-only, carries no clock
or entropy, and existing rejection-floor tests depend on it). `URL`/
`URLSearchParams`/`structuredClone`/`crypto.subtle.digest` remain deferred and
are proven unreachable on both engines. **`HermesInternal` is a newly recorded
declared engine fact**: it is non-configurable and non-writable on the vendored
runtime, so the JS layer cannot shadow it; a follow-up to disable it at
construction is noted for the Ibex side. The minimum deploy gate stands as
proposed (harness envelope, `ctx` host-call corpus for the proof's app
surface, two-direction denial, one end-to-end V8 mutation, busy-loop kill);
the twin leg runs with no Cloudflare credentials.

## Review hardening (2026-07-07, ENG-23574–ENG-23593)

The review of the as-built twin surfaced enforcement holes in the harness;
all are fixed and gated by the twin suites and the conformance corpus:

- **Invocation scoping** (ENG-23574/ENG-23585): the handler server serializes
  invocations per isolate and hands each invocation an invocation-local
  host-call transport through `__snapbackSettle` (the Ibex leg keeps its
  process-stable FFI global and epoch guard). The isolate-global rejection
  ledger is attributable because exactly one invocation runs — and drains to
  quiescence — at a time.
- **Harness control-plane integrity** (ENG-24339): both engines install the
  shared invoke/settle helpers non-writable and non-configurable before the
  application module evaluates, and settlement calls the invocation helper
  through a lexical reference. Ibex captures its original FFI transport at
  bootstrap time. Twin probes cover hostile frozen globals, accessors,
  wrapper interception, and raw host-call attempts; Rust independently
  rejects action DB reads at the shared host-op boundary. The Workerd default
  service export is frozen before application evaluation as well: importing
  `handler-server.mjs` cannot replace `fetch` and thereby receive the live
  `env` bindings outside the invoke/host/response capability channels.
- **Unforgeable settlement and rejection collection** (ENG-24559): the V8
  rejection ledger and its destructive drain live inside the handler-server
  closure; there is no importable sibling ledger module. The strip exposes a
  one-shot captured-intrinsics function consumed by the server before handler
  evaluation, so a handler importing it later receives no capability bag. The
  shared settlement wrapper captures trusted serialization primitives; the
  server uses null-prototype records for every Promise-channel value, pins an
  own non-then property on `Response.prototype`, and pins native Promise
  constructor/species dispatch before the application runs. Adversarial twin
  cases replace `JSON.stringify`, poison `Object.prototype.toJSON` and
  `Object.prototype.then`, attempt early rejection inspection, and import both
  former control-plane seams; both engines still fail closed with nothing
  committed.
- **Drain contract** (ENG-23584): the fixed 32-tick microtask drain is
  replaced by a quiescence contract — wait for this invocation's in-flight
  host calls, then yield real tasks (workerd defers `unhandledrejection`
  dispatch to task boundaries) until a full round adds no ledger entries.
  Settlement and this entire drain share one timer started before handler
  execution, so the drain receives only the invocation's remaining budget;
  expiry wins every pending await, aborts all HOST fetches through a private
  `AbortSignal`, and returns a no-commit did-not-settle response tagged with
  phase `quiescence`; a missing timer or abort capability rejects the invoke
  before application code runs. Corpus case
  `unhandled-detached-rejection-after-host-call` gates ordinary quiescence on
  both engines, and a deterministic never-responding HOST transport regression
  gates the deadline/abort path on Workerd.
- **Strip self-check** (ENG-23590): the V8 init probe covers the full
  `bannedEverywhere` set (plus the twin-pinned `stripProbes` subset), and
  the Ibex denier gained a symmetric post-install probe that fails the
  invocation (`SNAPBACK_IBEX_GLOBAL_DENY_INCOMPLETE`) on any survivor
  except the declared `HermesInternal` fact.
  `crates/snapback/tests/workerd_twin_v0.rs` parses its probe list from `allowlist.json`
  instead of a retyped literal.
- **Date constructor** (ENG-23588): zero-arg `new Date()` and `Date()` as a
  function are denied by the V8 strip (explicit-timestamp construction and
  `parse`/`UTC` stay); the Ibex leg keeps it reachable as part of the same
  declared deterministic-member asymmetry, pinned by the twin and the
  `deterministic-date-constructor` corpus case.
- **Allowlist fidelity** (ENG-23593): the Ibex `TextDecoder` polyfill is
  WHATWG-faithful (view windows, U+FFFD maximal-subpart replacement,
  `fatal`/`ignoreBOM`), converging with native — gated by the
  `allowlist-decoder-fidelity` corpus case and a spec-pinned twin test. The
  `queueMicrotask` entry is re-worded as a declared engine fact (fine-grained
  interleave with promise reactions differs on the vendored polyfill), with
  a `queue-microtask-interleave` corpus case recording the divergence.
- **Encoding boundaries** (ENG-24375): the Ibex `atob` fallback implements
  forgiving-base64's exact whitespace and padding validation, and its
  `TextDecoder` accepts all six WHATWG UTF-8 labels, trims exactly Infra ASCII
  whitespace (so vertical tab/NBSP remain invalid), applies Web IDL's Symbol
  rejection, canonicalizes every accepted alias to `utf-8` before invoking a
  native decoder, carries incomplete 2/3/4-byte UTF-8 sequences across streaming
  calls, flushes or fatally rejects incomplete input, resets after a fatal
  decode, and applies BOM handling per stream. The
  `allowlist-encoding-boundary-fidelity` case pins those results on Ibex,
  local workerd, and the deployed Cloudflare-JS host-op leg.
- **Egress posture** (ENG-23581): the data-driven denial applies to queries
  and mutations only; egress-enabled actions restore the pre-0048 surface
  (deny exactly `process`/`require`/`WebSocket`), so the lazily-installed
  configurable `fetch` and the wide compute surface stay reachable.
  `crates/snapback/tests/egress_ambient_v0.rs` pins this in `cargo test`.

## Third leg: the Cloudflare-JS host-op table (2026-07-08, ENG-23605)

The deployed Cloudflare target's JS host-op table
(`cloudflare/src/host-ops.js`) was a third op-table implementation outside
this gate — parity held by review discipline plus point regression tests,
which is how the ENG-23582 divergences drifted in silently. The twin runner
now executes the same corpus on that leg too: one Miniflare process
(`cloudflare/test/twin-engine.mjs`, app bundle `cloudflare/app/twin.app.js`)
runs every participating case through the deployed invocation path —
gateway → coordinator → handler Worker → DO SQLite — and the runner diffs
normalized **outcomes and committed storage** against the workerd leg (same
V8+strip engine class, so engine facts cancel and the diff isolates
host-op/coordinator semantics). The leg exposes no host-call trace; that
dimension stays Ibex↔workerd only. `busy-loop-wall-clock-kill` is the leg's
one declared fact (the platform CPU limit cannot be expressed in-process in
Miniflare). Three corpus cases pin the ENG-23582 divergence class directly
(`patch-on-missing-row`, `buffered-point-overlay-timestamps`,
`buffered-patch-into-filter-set`, the last via a seeded stored row), and the
coordinator now passes a `settlementTimeoutMs` to the handler server —
previously a never-settling handler wedged the isolate's invocation chain on
the deployed path. `npm run cf:twin` regenerates the committed report.

The corpus also owns LLP 0144's refusal-admission parity gate. Three mutation
cases raise a declared refusal with details, raise an undeclared refusal with
a payload that must not cross admission, and forge a bare
`SNAPBACK_APP_REFUSAL` claim. Ibex and workerd join at one local admission
seam; the Cloudflare coordinator admits against the resolved compiled
function definition. The report compares the declared diagnostic payload and
the payload-free generic folds, while the ordinary committed-state dimension
proves every refusing mutation remains effect-free.

## Reproducible conformance evidence (2026-07-12)

The committed conformance report records the workerd release id as executable
provenance. When the binary is the repository's dev dependency, its locator is
the stable repo-relative `node_modules/.bin/workerd`, not the absolute path of
the checkout that generated the report. An explicitly selected external
binary may retain its external locator for diagnostic evidence, but the
canonical in-repo artifact must regenerate byte-for-byte across worktrees.

## Status

Draft (as-built sections landed 2026-07-07; review-hardening batch
ENG-23574–ENG-23593 landed the same day; the Cloudflare-JS third leg landed
2026-07-08, ENG-23605). This RFC executes the DK-5 re-decision (LLP 0009
§Decision DK-5); its conformance gate is green and the harness is the
single-sourced artifact LLP 0040 deploys.
