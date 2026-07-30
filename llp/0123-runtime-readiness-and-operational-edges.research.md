# LLP 0123: Runtime readiness and operational edges

**Type:** Research
**Status:** Review
**Systems:** Competitive evaluation, Developer experience, Runtime, Bootstrap, Packaging, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0010, LLP 0030, LLP 0031, LLP 0074, LLP 0115, LLP 0116, LLP 0122, Diary 0022, Diary 0028, Diary 0032–0039

This document is part of the Convex-parity research series:

| LLP | Topic |
| --- | --- |
| 0116 | convex-parity-research-series (overview) |
| 0117 | typescript-type-flow-parity |
| 0118 | handler-composition-and-helper-reuse |
| 0119 | reactive-by-default-and-live-search |
| 0120 | relational-composition-and-aggregation |
| 0121 | transactional-one-off-scheduling |
| 0122 | installed-product-coherence-and-packaging |
| 0123 | runtime-readiness-and-operational-edges (this document) |
| 0124 | product-breadth-storage-and-vector-search |
| 0125 | concurrency-and-conflict-ergonomics |

## Summary

In the 2026-07-30 seven-app rerun (Diary 0039), every final Convex arm
started cleanly; its only recorded local operational edge was port
coordination across parallel projects in beta anonymous mode. Six of the
seven Snapback rerun diaries (0032–0036, 0038) hit the same
Hermes/framework bootstrap-ordering incident: an exact-stamped
`target/debug/snapback` dynamically loaded a `hermesvm.framework` that had
been refreshed *after* the binary linked. `scripts/ibex-doctor` was green,
`scripts/bootstrap-ibex-runtime` exited 0 with
`SNAPBACK_IBEX_RUNTIME_LINK_OK`, servers launched and served `/health` —
and every JavaScript query, mutation, and action refused with
`SNAPBACK_RUNTIME_CREATE_FAILED` because `ex_hermes_create_no_eval()`
rejected VM creation ("Armed startup refused: Hermes promise rejection
checkpoint tracking is unavailable"). Diary 0038's formulation is the
crux: "link + launch smoke passed" is not yet equivalent to "an armed
handler VM can be created."

This Research document maps the incident class against what Convex does
structurally differently, reconstructs why Snapback's native runtime lane
exists and what it buys, and lays out an option space that goes beyond the
qualification fixes LLP 0115 already plans (CV-2/CV-3) into the strategic
layer: hermetic prebuilt distribution, shrinking the dynamic-link surface,
engine-strategy risk reduction, limit discoverability as a product
surface, and treating the first hour as an acceptance-tested artifact. It
deliberately does not make the final call.

## What Convex does

**Diary evidence (labeled).** Across Diaries 0032–0039, the Convex arms
ran in anonymous local agent mode (`CONVEX_AGENT_MODE=anonymous npx convex
dev`). Every final Convex arm started cleanly; Diary 0032 records
functions ready in 268.93 ms on the recorded run. The only operational
friction the rerun recorded was that anonymous-mode default ports collide
across parallel projects, so the matrix had to isolate ports or serialize
final runs (Diary 0039 §Deterministic acceptance and server ownership),
and the mode is explicitly beta. There is "no native framework link step
and no checkout-relative import into the Convex source tree" (Diary 0039
§Installed, coherent TypeScript workflow), and "Fewer framework-specific
operational edges" is one of the report's four "Where Convex is better"
headings.

**General background (not diary-verified).** Convex's local development
story ships the backend as a prebuilt binary per platform, fetched by the
CLI; application JavaScript executes inside the engine embedded in that
binary. The load-bearing structural property is not the engine choice —
it is that the server and its JS engine are compiled, versioned, and
distributed as one sealed artifact. There is no on-user-machine native
build, no separately refreshable engine artifact sitting beside the
server binary, and therefore no state in which "the server you built" and
"the engine you loaded" can disagree. The entire incident class this
document studies — stamped binary, newer framework, green link smoke,
dead handler VM — is unrepresentable in that distribution shape. Whatever
else one thinks of a managed closed backend, this is a real architecture
dividend, and the rerun priced it.

## What Snapback does today

### Why the native runtime lane exists

Snapback links the vendored `ibex-runtime` crate and drives a Hermes VM
through a C ABI (`src/runtime.rs`): `ex_hermes_create_no_eval()` creates
the restricted no-eval VM `RuntimeGuard::create` wraps,
`ex_hermes_watch_time_limit`/`ex_hermes_interrupt_eval` enforce bounded
execution, and `ex_hermes_take_async_failure_event` backs the
unhandled-rejection checkpoint that lets Snapback guarantee "handler
completed with unhandled promise rejection(s) — the invocation failed and
committed no writes." This buys things Snapback treats as product
identity: the no-eval security posture for application handlers, exact
time-limit and async-failure semantics behind the fail-closed invocation
contract, and one deterministic local server binary that owns storage,
live queries, and the ephemeral lane.

An important boundary the incident made visible: the declarative query,
live-query, and ephemeral paths are pure Rust and kept working throughout
(`issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md`;
Diary 0038). The Hermes VM serves exactly the JS-handler lane. That both
shrank the blast radius and delayed detection — nothing before the first
JS invocation exercises the VM.

### The bootstrap/doctor/harness triad

Three tools own local runtime readiness today:

- `scripts/bootstrap-ibex-runtime` — the authoritative fixer. It resolves
  the `vendor/ibex` submodule, prefers prepared Hermes artifacts (copying
  from a sibling checkout with `rsync -a`), falls back to
  `download-hermes.sh`, and only then to building Hermes from source. It
  then validates via `scripts/runtime-link-smoke.mjs`: a real cargo link
  of the kept target plus a launch with `DYLD_*` scrubbed, failing with
  stable codes from LLP 0010's registry
  (`SNAPBACK_IBEX_RUNTIME_LINK_FAILED`,
  `SNAPBACK_IBEX_RUNTIME_LOAD_FAILED`, and friends).
- `scripts/ibex-doctor` — the read-only diagnoser. It classifies checkout
  and artifact states, then runs the same probe module against a fresh
  *disposable* Cargo target. LLP 0010's dated 2026-07-30 note records
  that this design is structurally blind to a stale served binary: the
  from-scratch build is coherent with the current framework precisely
  when `target/debug/snapback` is not.
- The demo harness (`demos/_kit/server-process.mjs`, governed by LLP 0030
  §Server process ownership and LLP 0031 §Server-binary identity) —
  resolves a binary down a ladder (configured → prebuilt → `cargo`),
  verifies reuse against `/health`'s build-identity block (crate version,
  git commit/dirty, startup nonce), and runs the link probe only on its
  `cargo` rung. `scripts/verify-local-proof` disables the bootstrap smoke
  by default (`SNAPBACK_BOOTSTRAP_CHECK=0`).

The three tools already share one probe module, one diagnostic registry
(LLP 0010), and one `snapback.runtime-recovery.v1` record
(`packages/snapback-cli/runtime-recovery.mjs`), whose `producerInputs`
sha256 the framework binary, headers, and cargo inputs on every run. The
current gaps, per LLP 0115 CV-3: nothing persists a receipt, the captured
digests are never compared against anything, harness rungs other than
`cargo` are presence-plus-identity only, and the default local proof path
skips the smoke entirely.

### Why the framework loads dynamically today (investigated)

On macOS the default build resolves Hermes as a dynamic framework: the
binary carries an `@rpath`-relative install name and the top-level
`build.rs` emits the matching `LC_RPATH` itself, because cargo does not
propagate a dependency build script's `rustc-link-arg` to the final
binary (ENG-22664; LLP 0010 §Native Runtime Bootstrap). On Linux the
binary links `libhermesvm.so` with a loader-relative `$ORIGIN/../lib`
RUNPATH. Two findings from reading `vendor/ibex/build.rs`:

1. **Static linking already exists as a supported build mode.**
   `HERMES_LINK_STATIC=1` selects `libhermesvm_a.a` (or
   `hermesvmlean_a`), expecting a static bundle (`lib*.a`, `libjsi.a`,
   `libboost_context.a`) under a `macos-static` lib dir produced by
   `scripts/build-hermes.sh --release`. Snapback simply never uses it
   locally.
2. **The dynamic default is lineage and artifact-reuse convenience, not a
   hard requirement.** Ibex inherits Hermes's mobile packaging
   (framework/xcframework layouts), and Snapback's prepared-artifact
   model — copy a framework directory from a sibling checkout instead of
   rebuilding Hermes — presumes a shared, swappable dynamic artifact.
   That swappability is exactly the degree of freedom the incident
   exploited.

The candidate root cause for "framework newer than binary yet cargo
no-ops," recorded in the issue and CV-2 and still unconfirmed: the
bootstrap's `rsync -a` copy preserves *source* mtimes, plausibly
defeating cargo's mtime-based `rerun-if-changed` on the framework
binary, so the stale kept binary never relinks.

### Prior incidents and runtime-only-discoverable limits

The 2026-07-30 incident is the newest member of a family:

- **Diary 0028 (Chat bakeoff):** a clean checkout with no prepared
  Hermes artifact fell back to building Hermes from source — "by far the
  most expensive prerequisite for a small demo." The heaviest cost in
  Snapback's first hour was never Snapback code.
- **Diary 0022 (§Runtime/toolchain incident):** a dirty checkout forced a
  fresh link that failed on missing `ex_hermes_create_no_eval` /
  `ex_hermes_watch_time_limit` / `ex_hermes_unwatch_time_limit` symbols
  while `ibex-doctor` reported healthy; the harness fell back to an older
  `stamp-mismatch` binary and passed. Same two-artifact coherence
  problem, loud-at-link-time variant.
- **Runtime-only-discoverable limits**, a distinct but adjacent edge
  class: the 1,024 buffered-write ceiling surfaced mid-acceptance and was
  absent from the mutation guide (Diary 0029);
  `SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED` surfaced only at runtime
  (Diary 0031); and `SNAPBACK_OUTBOUND_ACTIONS=1` being required *at
  codegen time* was discovered only after a failed generation, despite
  being documented as a runtime grant (Diaries 0030/0031). None of these
  are bootstrap defects, but they belong to the same product experience:
  the framework teaches its envelope by refusal rather than by
  declaration.

## How they differ, and why agents preferred Convex

The structural difference is not engine quality; Hermes created VMs in
microseconds when coherent (`bench_runtime_create_us`, `src/runtime.rs`).
It is that Convex ships engine and server as one sealed versioned
artifact, while Snapback's local lane composes **two independently
refreshable native artifacts** — a statically compiled glue crate and a
dynamically loaded framework — whose agreement is a behavioral/ABI
contract (the promise-rejection checkpoint prerequisite) that neither
symbol resolution nor process launch tests. Every green signal the agent
saw measured something adjacent to the contract: file presence (doctor's
artifact probes), linkability (the smoke), launchability (`DYLD`-scrubbed
launch), identity (`/health` build stamp, exact `01e94173…` on both
sides). Identity is not readiness: the rerun proved an exact-identity
binary can be JS-dead.

Diary 0032 adds a subtle evidence hazard: the initial nominal 1/5
included a rejection-shaped check that "passed" because VM-creation
failure satisfied the broad rejection predicate before application
validation ran. Readiness failures do not merely block positive checks;
they can counterfeit negative ones.

Recovery, when it came, was paved — re-running the same bootstrap *after*
the final framework refresh relinked the binary (00:52:53 binary vs
00:55:00 framework, relinked 00:55:57; Diary 0033) — but diagnosis
required inherited server output and a parallel lane's cross-observation.
Agents preferred Convex on this axis because its first hour cannot enter
this state, not because its diagnostics are better. Snapback's
diagnostics are in fact richer (stable codes, recovery records, digests);
they were pointed at the wrong boundary.

## Option space

None of these are decisions. Options 1–3 attack the incident class
itself; 4 is risk analysis; 5–6 attack the broader operational-edge
experience.

### Option 1 — VM-qualification receipts and digest coherence (CV-2/CV-3)

The path LLP 0115 already sequences as Tranche A, credited here rather
than redesigned: bootstrap creates and destroys the same VM
`RuntimeGuard::create` uses and executes one trivial function after final
framework selection; binary and framework digests bind into one persisted
readiness receipt that doctor, bootstrap, and every harness rung (plus
`verify-local-proof`'s default path) trust and re-verify; a framework
refresh invalidates or relinks before qualification; failures get a new
stable code. Prior art is unusually complete: the smoke already captures
the exact digests (never compared), and
`packages/snapback-runtime-linux-x64/artifact-attestation.mjs` is a
finished binary+Hermes digest attestation with
validate-against-actual-files checking.

**Residual risk.** Qualification detects the incoherent state; it does
not remove the process that manufactures it. The mutable
checkout-plus-copied-artifact model still exists, receipts need
invalidation semantics that are correct under concurrent refresh (the
hard part CV-3 names), and a receipt is one more artifact whose custody
and tamper story must be defined. This option makes the incident loud
and named; options 2–3 make it unrepresentable.

### Option 2 — Prebuilt hermetic runtime distribution

Never build or assemble Hermes on an adopter's machine. The seed exists
in-tree: `packages/snapback-runtime-darwin-arm64` already pairs
`bin/snapback` with `Frameworks/hermesvm.framework` in one sealed npm
package, and `packages/snapback-runtime-linux-x64` adds the attestation.
The strategic move is to make that sealed pair the *only* adopter-facing
runtime delivery — binary and framework versioned, digested, and
installed atomically together, attestation extended to macOS — and
demote the sibling-checkout/vendored-bootstrap machinery to an explicit
contributor lane. This interacts directly with LLP 0122's single-binary
packaging option (the limiting case: one artifact, nothing to pair) and
with CV-1's published-channel work; LLP 0041 owns the package closure.
Diary 0028's Hermes-from-source cost disappears from the adopter path by
construction. Residual: contributors still live in the mutable world, so
option 1 remains necessary for the source-tree lane either way.

### Option 3 — Shrink the dynamic-linking surface

Statically link (or otherwise embed) the VM so binary and engine cannot
drift apart. The vendored build already supports it
(`HERMES_LINK_STATIC=1`), so this is closer to a build-policy change
plus a static-bundle supply chain than new engineering. It eliminates
the entire coherence class: the rsync-mtime staleness, the ENG-22664
`LC_RPATH` launch wedge, and the framework-refresh-after-link ordering
all stop existing for the final binary; header drift remains possible
but fails loudly at compile/link time (the Diary 0022 shape) rather
than as a runtime refusal after green gates. Costs: larger binaries,
Hermes rebuilds ride every runtime-package build instead of a framework
copy, and the swap-a-framework-without-relinking property is lost — the
correct observation being that this property is the bug surface, not a
feature adopters need. A plausible split: static for packaged/adopter
artifacts (compounding option 2), dynamic retained for contributor
iteration under option 1's receipts.

### Option 4 — Alternative or additional JS engine (risk analysis only)

What actually depends on Hermes specifics? Reading `src/runtime.rs`, the
load-bearing contracts are: (a) the restricted **no-eval constructor**;
(b) the **time-limit watch/interrupt** surface; (c) the **async-failure
checkpoint** — `ex_hermes_eval` reaching a full microtask checkpoint so
detached-rejection and never-settled-promise invocations can be failed
with no writes; and (d) the host-call bridge and safe-throw/stage1 value
metadata. These are a small, explicit C ABI — which cuts both ways: any
replacement engine must supply equivalents of (a)–(c) with the same
semantics, and the fail-closed invocation contract is only as strong as
the checkpoint semantics underneath it. A wasm-hosted engine (Hermes or
QuickJS compiled to wasm inside a statically linked wasm runtime) would
remove native dynamic-link fragility categorically — the engine becomes
data, not a dyld participant — at the cost of performance headroom and
reimplementing the watchdog/checkpoint contracts at the wasm boundary.
A V8/JSC fallback buys little here: the incident is a distribution-shape
problem, and V8 would inherit it unless shipped per option 2/3 anyway.
Conclusion of the analysis: engine *choice* is secondary; engine
*co-shipment* is the property that matters, and the ex_hermes ABI is
narrow enough that Snapback is not deeply Hermes-captive, except at the
checkpoint semantics where it is.

### Option 5 — Runtime-limit discoverability as a product surface

Declare limits instead of teaching them by refusal. The 1,024
buffered-write ceiling, the membership-batch bound, and the
outbound-actions codegen gate should be rows in the capability/
introspection surfaces that already exist (LLP 0010 §Capability Reports;
the guide's capability index per LLP 0061), queryable by agents before
they design against them, assertable by acceptance, and — for the
codegen-time cases like `SNAPBACK_OUTBOUND_ACTIONS` — checked at
generation with a diagnostic that names the missing grant rather than
failing generation obscurely. This extends Snapback's honest-nonclaim
posture (LLP 0115 governing constraint 2) from capabilities to
quantitative envelopes. Cheap, incremental, and independent of the
runtime options above.

### Option 6 — The first hour as an acceptance-tested artifact

Make "fresh machine to first armed JS invocation" a CI job that is
literally the first hour: clean environment, install from the published
channel (or clean clone for the contributor variant), bootstrap, create
an app, run one JS mutation and one live query, tear down — with the
CV-2 mismatched-framework fixture as a required failing case. Today no
gate runs this end-to-end path; each tool proves its own slice and the
seams between slices are where both 2026-07-30 and Diary 0022 lived.
Prior art: LLP 0041's comparator receipt already runs a real product
fixture with semantic checks, and CV-1's published-channel harness mode
is the natural carrier. The adopter variant is only meaningful once
CV-1 lands (a checkout-based job proves contributor experience, not
adopter experience). Cost is real — macOS runners and wall-clock — and
the job's value is exactly proportional to how faithfully it refuses
shortcuts like reusing a warm target directory.

## Findings

1. **The Convex advantage here is distribution shape, not engine or
   diagnostics.** Engine and server ship as one sealed artifact, so the
   binary/framework coherence class is unrepresentable. Diary evidence:
   all seven final Convex arms started cleanly; the sole recorded local
   edge is beta anonymous-mode port coordination (Diary 0039).
2. **Snapback's incident is a two-artifact coherence failure measured by
   the wrong gates.** Presence, linkability, launchability, and identity
   were all green; none executes JavaScript. The failing contract — the
   promise-rejection checkpoint prerequisite behind
   `ex_hermes_create_no_eval()` — is behavioral/ABI, invisible to dyld
   symbol resolution (issue file; LLP 0010 dated note 2026-07-30).
3. **Doctor's false green is by design and now priced.** The fresh
   disposable target proves the checkout can produce a good binary and is
   structurally blind to a stale served one (LLP 0010).
4. **Readiness failures can counterfeit negative acceptance checks.**
   Diary 0032's rejection-shaped check "passed" under VM-creation
   failure. Harness rungs must prove armed readiness before rejection
   predicates count as evidence.
5. **CV-2/CV-3 are necessary but detection-shaped.** Receipts and digest
   coherence make the state loud; only distribution/link-surface changes
   (options 2/3) remove the state-manufacturing process.
6. **Static linking is an already-supported build mode**
   (`HERMES_LINK_STATIC` in `vendor/ibex/build.rs`), unused locally; the
   dynamic default is mobile-packaging lineage plus the sibling-checkout
   artifact-reuse model, whose swappability is the incident's enabling
   degree of freedom.
7. **Sealed per-platform runtime packages already exist**
   (`packages/snapback-runtime-darwin-arm64`, `-linux-x64`); option 2 is
   largely a promotion/adoption problem riding CV-1, with attestation
   currently Linux-only.
8. **The ex_hermes ABI is narrow; the checkpoint semantics are the
   captivity point.** No-eval, time-limits, and microtask-checkpoint
   rejection detection are the three contracts any engine strategy must
   preserve; the declarative/live/ephemeral lanes never touch the VM.
9. **Limit discoverability is a separate, cheap win.** Diaries 0029–0031
   show a recurring learn-by-refusal pattern with an existing
   capability/introspection surface ready to absorb the declarations.
10. **No current gate walks the whole first hour.** Each triad tool
    proves a slice; both major incidents (0022, 0032–0038) lived in the
    seams between slices.

## Confidence

- **High:** the incident mechanism, timeline, and tool behaviors — read
  directly from six diaries, the issue's code trace, and the scripts
  (`bootstrap-ibex-runtime`, `ibex-doctor`, `runtime-link-smoke.mjs`,
  `runtime-recovery.mjs`, `build.rs`, `src/runtime.rs`).
- **Medium:** the `rsync -a` mtime root-cause hypothesis (explicitly
  unconfirmed; CV-2 owns verification). Static-link viability — the
  build mode exists but the macOS static bundle supply
  (`build-hermes.sh --release`) is unexercised in Snapback's loop.
  The wasm-engine analysis (no spike behind it).
- **Low / labeled background:** Convex distribution internals beyond
  what the diaries observed; treated as general background above and
  never as diary evidence.

## Open questions

1. Is the rsync-mtime hypothesis the actual missed-relink mechanism, and
   does fixing it (copy without source mtimes, or digest-based rerun
   detection) belong inside CV-2 or in the bootstrap regardless?
2. Where is the adopter/contributor lane split declared — does LLP 0041
   own "adopters get only sealed runtime packages" while LLP 0010 keeps
   the source-tree bootstrap contract?
3. Should packaged runtime artifacts move to static linking (option 3)
   while the contributor lane stays dynamic under receipts, and who
   ratifies that build-policy change?
4. Could the framework self-describe its behavioral ABI (a versioned
   checkpoint-contract stamp readable before VM creation) as a cheaper
   coherence check than digest binding, or is that just a second thing
   to keep coherent?
5. Where do quantitative limits live canonically — capability report,
   introspection, guide capability index — and what keeps the three from
   drifting?
6. What does the first-hour CI job cost on macOS runners, and does it
   gate merges or run as a scheduled canary?

## Relationship to LLP 0115 and owning documents

LLP 0115 CV-2 (VM qualification during bootstrap) and CV-3 (persisted
readiness receipt across doctor/bootstrap/harness) are the planned P0
work items for this area; this document summarizes and credits them as
option 1 and deliberately explores the layer above them. LLP 0010 owns
the bootstrap contract, the `SNAPBACK_*` diagnostic registry, and the
coming CV-2 amendment; its dated 2026-07-30 note already records the
standing facts. LLP 0030 owns server-process ownership and the resolver
ladder; LLP 0031 owns `/health` binary identity (and CV-15's `unpinned`
wording). LLP 0041 owns packaging and the runtime-package closure that
option 2 would promote; LLP 0122 (series sibling) covers installed-
product coherence, where the single-binary option composes with options
2/3. LLP 0074 frames the strategic bar — "ordinary authors should not
need to know that Cargo, Ibex, Hermes, sibling checkouts, runtime
packages, ready files, or internal artifact aliases exist" — which is
the sentence this document's option space exists to make true. Any
decision arising from options 2–6 should land in those owners (or a new
owned Spec), not here; per LLP 0115's watch items, Convex's anonymous
local mode maturing out of beta would erase its one remaining local edge
and raise the bar for all of them.
