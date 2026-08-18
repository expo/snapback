# LLP 0123: Runtime readiness and operational edges

**Type:** Research
**Status:** Active
**Systems:** Competitive evaluation, Developer experience, Runtime, Bootstrap, Packaging, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-08-06 (Darwin npm-shape correction: the package seal and
production layout now bind the real versioned Hermes framework file named by
the Mach-O load command, not a convenience symlink npm omits; publication
reopens the seal from the actual packed bytes.) 2026-08-06 (Option 3 package sealing landed: both runtime
packages carry one package-owned `snapback.runtime-readiness.v1` seal binding
the binary, shipped Hermes header/runtime digests, full build identity, source
revision, and the separate-process CV-2 verdict; production qualifies after
assembly and the CLI re-hashes the seal before returning a packaged binary.)
2026-08-05 (desktop-sidecar boundary note: LLP 0129 Phase 2b now
consumes the runtime-package resolver and exposes a pre-commit
`verifyCandidate` hook, but its descriptor/health nonce attestation is only a
live-child identity proof. It does not seal the binary/Hermes pair, qualify
package-production behavior, or solve attestation custody.) 2026-07-31 (dated note in Option 2: the landed CV-2
qualification shape — a separate-process `snapback runtime-qualify`
subcommand — is posture-neutral toward serving processes by process
isolation, pinned by `crates/snapback/tests/runtime_qualify_posture_v0.rs`; the standing
first-VM-only-Enforce fact is ticketed with LLP 0009's owners as
`issues/20260731-first-vm-only-strict-host-context.md`, and an
in-serving-process boot witness still requires a ratified mitigation
shape); 2026-07-30 (v0.3, round-2 delta review corrections — Fable
READY (three NITs); Codex NOT READY on the strict-Host handoff hazard in
the v0.2-added Option 2 and on Option 4's content-addressing precision,
with all round-1 concerns resolved. Round-2 deltas in
`reviews/0123-runtime-readiness-and-operational-edges.fable.md` and
`reviews/0123-runtime-readiness-and-operational-edges.codex.md`; 5 items
applied, all re-verified against the tree. Codex blocking: the Option 2
boot probe as drafted consumes the one-shot strict Host handoff —
`ensure_host_installed()` installs `Host::strict()` once behind a
`std::sync::Once`, `ex_hermes_create_no_eval()` claims and zeroes the
thread-bound pending token, and later diagnostic constructions fall
back to a fresh `SecurityMode::Audit` context — so the option now
states the hazard, analyzes four mitigation shapes as design
requirements, and its no-evidence-regression entry is corrected to
regression-prone as drafted. Codex material + Fable NIT: Option 4's
"digest-anchored rerun detection" relabeled — digests govern selection
and build-time validation, the watch set stays Cargo's mtime-based
change detection, and a digest-named directory does not alone prevent
in-place mutation. Codex detail + Fable NIT: the error-fidelity
sub-option's "cheap" replaced with the honest cost — no constructor
error-result ABI exists, so propagation means a new channel in the
vendored Ibex C ABI. Codex detail: the Workerd semantic-inventory
pointer rerouted from OQ8 to LLP 0048. Fable NIT:
`scripts/build-hermes.sh` respelled repo-relative as
`vendor/ibex/scripts/build-hermes.sh`. Related gains LLP 0009.)
2026-07-30 (v0.2, round-1 dual-family review corrections —
verbatim reviews in
`reviews/0123-runtime-readiness-and-operational-edges.fable.md` and
`reviews/0123-runtime-readiness-and-operational-edges.codex.md`, both
NOT READY; all eleven findings were independently re-verified against
code and applied — none refuted. Blocking: the false "live paths never
touch the VM" boundary corrected — JS live queries (`defineJsLiveQuery`
→ `FunctionKind::LiveQuery`) reach `RuntimeGuard::create()` like every
JS handler, so the blast-radius statements and Finding 8 now split
declarative from JS live queries (Codex A); two options added — the
server-side readiness lane (boot-time VM qualification surfaced on
`/health`, plus reason-carrying invocation diagnostics; Fable 1) and
content-addressed immutable dynamic engine selection (vendored Ibex's
portable-engine machinery; Codex B) — renumbering the option space to
1–8; the prebuilt/static options reworked around precise guarantees —
packages are assembly closures, not behavioral-coherence proofs; static
linking proves link-time binding, not behavioral compatibility; the
Hermes-rebuild cost claim corrected — plus a per-option
no-evidence-regression check (Codex C). Material/detail: the
engine-captivity account expanded with Ibex's native host surface and
the in-tree Workerd/V8 twin (Codex D); the Convex sealed-artifact
account narrowed to labeled inference with its verification path
(Codex E); limit discoverability split into three problem classes with
"cheap" demoted to hypothesis (Codex F); "created VMs in microseconds"
corrected to LLP 0035 §M2's ~2 ms (Fable); the CV-15 owner statement
aligned with 0115's status board (Fable); Finding 5 now credits CV-2's
owned invalidate-or-relink half (Fable); the "bug surface, not a
feature" pre-judgment removed in favor of attributed analysis (Fable).
Related gains LLP 0035, LLP 0048, and Diaries 0029–0031.)
**Related:** LLP 0009, LLP 0010, LLP 0030, LLP 0031, LLP 0035, LLP 0041, LLP 0048, LLP 0074, LLP 0115, LLP 0116, LLP 0122, LLP 0129, Diary 0022, Diary 0028, Diary 0029–0031, Diary 0032–0039

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
layer: a server-side readiness lane, hermetic prebuilt distribution,
content-addressed immutable engine selection, shrinking the dynamic-link
surface, engine-strategy risk reduction, limit discoverability as a
product surface, and treating the first hour as an acceptance-tested
artifact. It deliberately does not make the final call.

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

**General background and labeled inference (not diary-verified).**
Convex's local development story ships the backend as a prebuilt binary
per platform, fetched by the CLI; application JavaScript executes inside
an engine that ships with that binary. The diaries establish only this
much: a downloaded precompiled backend, no user-visible native framework
link step, and clean final starts. The stronger account — server and JS
engine compiled, versioned, and distributed as one sealed artifact, with
no separately refreshable engine artifact and therefore no representable
state in which "the server you built" and "the engine you loaded"
disagree — is *inference* from that behavior, not observation; verifying
it would take an authoritative Convex source or an inspection of the
downloaded artifact's closure (one file or several, and what is
refreshable in place). What the diaries do support: the tested workflow
exposed no user-managed engine/server coherence boundary, so the
incident class this document studies — stamped binary, newer framework,
green link smoke, dead handler VM — had no surface to occur on across
seven arms. Whatever else one thinks of a managed closed backend, that
is a real architecture dividend, and the rerun priced it.

## What Snapback does today

### Why the native runtime lane exists

Snapback links the vendored `ibex-runtime` crate and drives a Hermes VM
through a C ABI (`crates/snapback/src/runtime.rs`): `ex_hermes_create_no_eval()` creates
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

An important boundary the incident made visible, stated precisely: the
*declarative* (Rust-evaluated) query and live-query paths and the
ephemeral lane are pure Rust and kept working throughout
(`issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md`;
Diary 0038). Diary 0037 is the in-corpus control: the one rerun arm that
avoided the incident is the one whose exercised lane was native
declarative search, and it marks its own failure "independent of the
Hermes JS-runtime incident" (line 82). The Hermes VM serves the
JS-handler lane — and that lane is wider than queries, mutations, and
actions: JS live queries exist (`defineJsLiveQuery`,
`packages/snapback-codegen/define.mjs`), execute as
`FunctionKind::LiveQuery` through the same query-execution path, and
reach `RuntimeGuard::create()` like every other JS handler
(`crates/snapback/src/runtime.rs`), so a JS live query is exactly as dead in this state
as a JS mutation. That boundary both shrank the blast radius and delayed
detection — nothing before the first JS invocation exercises the VM.

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
   `vendor/ibex/scripts/build-hermes.sh --release`. Snapback simply
   never uses it locally.
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

The structural difference is not engine quality; VM-creation cost was
never the incident's cause — roughly 2 ms when coherent, ~55 % of the
~2,700–3,900 µs fresh-invocation cost (LLP 0035 §M2, measured by
`bench_runtime_create_us` in `crates/snapback/src/runtime.rs`). It is that the tested
Convex workflow exposes no user-managed engine/server coherence boundary
(the sealed-artifact account behind that is labeled inference above),
while Snapback's local lane composes **two independently
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
Agents preferred Convex on this axis because its first hour presented no
surface for this state, not because its diagnostics are better. Snapback's
diagnostics are in fact richer (stable codes, recovery records, digests);
they were pointed at the wrong boundary.

## Option space

None of these are decisions. Options 1–5 attack the incident class
itself — 1–2 by making readiness witnessed (tool-side, then
server-side), 3–5 by changing the distribution/link shape that
manufactures the state; 6 is risk analysis; 7–8 attack the broader
operational-edge experience. A per-option check against LLP 0115's
no-evidence-regression constraint closes the section.

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
and tamper story must be defined. A trivial-function probe proves the
VM-creation and checkpoint prerequisites, not all handler semantics.
This option makes the incident loud and named; options 3–5 remove the
processes that manufacture it, with residuals of their own below.

### Option 2 — Server-side readiness: the process witnesses itself

The serving process qualifies its own handler VM at boot: create and
destroy the same VM `RuntimeGuard::create` uses (optionally executing
one trivial function), surface the verdict on `/health` beside the
ENG-22798 build-identity block, and either refuse to serve or serve
loudly degraded when it fails. Today `/health` carries identity and
capability *presence* only — `ibex_available` reports CLI/bridge
availability and `binary` reports the build stamp (`crates/snapback/src/server.rs`;
LLP 0031 §Server-binary identity) — and nothing in the payload has ever
created a VM, which is why the incident's defining sentence — servers
"launched and served `/health`" while every JS handler was dead — was
possible. This option is genuinely distinct from option 1: it has no
receipt custody or invalidation problem (the running process is its own
witness), it works identically for every distribution shape and every
harness rung including `configured`/`prebuilt`/reused (which are
presence-plus-identity only today), and it catches drift that happens
after bootstrap ran. It would have converted the incident into a loud,
self-diagnosing launch or health failure regardless of refresh ordering.
A packaged `snapback runtime-qualify` subcommand exposing the same probe
would let every delivery form — bootstrap, doctor, package tests, CI —
share one behavioral check.

**The strict-Host handoff hazard (round-2 finding, code-verified).**
"Create and destroy the same VM" is not posture-neutral as drafted,
because the strict Host handoff is one-shot. `ensure_host_installed()`
installs `Host::strict()` (`SecurityMode::Enforce`, default-deny)
exactly once per process behind a `std::sync::Once` (`crates/snapback/src/runtime.rs`);
`install_host` publishes the policy and retains a thread-bound,
single-use pending creation token (`PENDING_HOST_CONTEXT`,
`vendor/ibex/src/host/abi.rs`); `ex_hermes_create_no_eval()` claims and
zeroes that token; and every later diagnostic construction, finding no
pending token, falls back to a fresh `SecurityMode::Audit` context —
the rollout mode that computes and logs the real capability decision
but lets denied operations proceed (`vendor/ibex/src/host/mod.rs`).
Armed construction never has that fallback; the diagnostic constructor
Snapback uses does. Two consequences. First, in today's process exactly
one VM — the first `RuntimeGuard::create()` on the installing thread —
ever holds the Enforce-mode context; that standing fact belongs with
LLP 0009's host-install policy independent of this option. Second, a
boot probe that creates and destroys a VM would spend that one strict
claim on a diagnostic VM and guarantee no serving invocation ever
holds it: readiness evidence weakening the security posture it
verifies. Any adopted design must satisfy one of these requirement
shapes:

- **Per-creation strict reinstallation** — install the strict Host (or
  re-arm the pending token) before every VM construction, so probe and
  serving VMs claim equivalent strict contexts. Revisits the
  install-once caching `crates/snapback/src/runtime.rs` documents as a deliberate
  M2-era optimization (LLP 0009), and changes the posture of today's
  second-and-later invocation VMs — which is why the fix belongs with
  the owners, not here.
- **Probe-as-first-real-VM** — the qualification VM is not destroyed
  but serves the first invocation, so the strict claim is spent on
  real work. Sits against per-invocation VM isolation (LLP 0009) and
  only defers the fallback question to the second invocation.
- **Qualify through the same handoff path** — the probe performs the
  full install-then-claim sequence a real invocation performs, then
  re-arms a fresh strict token afterward, making the probe
  posture-neutral by construction; this is per-creation reinstallation
  scoped to the probe boundary and shares its ownership question.
- **An ABI change** — a non-consuming qualification constructor or a
  claim-preserving probe surface in the vendored Ibex C ABI, so
  readiness probing never competes with real handoffs; a cross-repo
  ABI-design cost like the error-fidelity sub-option below.

Whichever shape is chosen, the design needs a post-probe test proving
that invocations after qualification retain the same fail-closed
enforcement posture as before it.

**Dated note (2026-07-31): the landed CV-2 shape is posture-neutral by
process isolation — code-verified while executing LLP 0115 CV-3.** The
hazard above was written against a probe running *inside a serving
process*. The qualification that actually landed (`814acd77`) is a CLI
subcommand: `snapback runtime-qualify` runs `qualify_handler_vm()` in
its own short-lived process (`crates/snapback/src/cli.rs` `HostCommand::RuntimeQualify`;
the only caller of `qualify_handler_vm`), and every consumer —
`qualifyRuntimeBinary` (`packages/snapback-cli/runtime-recovery.mjs`,
`spawnSync`), `scripts/runtime-link-smoke.mjs`, bootstrap, doctor,
`scripts/verify-local-proof`, and the demo harness's rung
re-qualification — invokes it as a separate child with loader overrides
scrubbed. The one-shot strict-Host handoff it consumes belongs to that
disposable process, which then exits; no server startup path runs the
probe in-process, so a serving process's first `RuntimeGuard::create()`
still claims its own freshly armed strict token exactly as before the
landing. This is effectively the "qualify through the same handoff
path" shape realized at process granularity, with no re-arm step needed
because the probe never shares a process with serving. The required
post-probe test exists: `crates/snapback/tests/runtime_qualify_posture_v0.rs` runs the
qualification exactly as consumers do, then proves the current
process's first (strict-claimed) and second (diagnostic-fallback)
handler VMs present identical fail-closed ambient enforcement. Two
boundaries stay explicitly open: (1) the standing fact that only the
first VM per process holds the Enforce-mode context predates CV-2, is
unchanged by it, and is now ticketed with LLP 0009's owners
(`issues/20260731-first-vm-only-strict-host-context.md`); (2) any
future *in-serving-process* boot witness (the LLP 0030/0031 `/health`
option this section analyzes) still requires one of the four mitigation
shapes ratified with LLP 0009's owners — the landed subcommand's
neutrality does not transfer to an in-process probe.

The companion sub-option is invocation-error fidelity.
`SNAPBACK_RUNTIME_CREATE_FAILED` today carries only the fixed strings
"Ibex runtime could not be created" / "Ibex runtime identity could not
be captured" (`crates/snapback/src/runtime.rs`); the native refusal reason ("Armed
startup refused: Hermes promise rejection checkpoint tracking is
unavailable") reached the operator only through inherited stderr, which
is why diagnosis needed a parallel lane's cross-observation. Carrying
the native reason inside the coded error would help every other option,
but it is not cheap: there is no constructor error-result ABI to tap —
`ex_hermes_create_no_eval()` returns a bare null pointer on refusal,
and the detailed reason is emitted through `ex_host_console_log`
(`vendor/ibex/src/engine/hermes_runtime.cc`) — so propagation means
designing a new channel in the vendored Ibex C ABI (a last-error getter
or an error-out constructor variant), with the ownership, concurrency,
sanitization, and compatibility questions any new native error
transport carries.

**Costs.** Boot-time VM creation is ~2 ms (LLP 0035 §M2), negligible
against server startup. Refuse-vs-degraded semantics interact with
LLP 0030's process lifecycle and need a ratified failure behavior. The
readiness verdict is one more thing that must stay truthful: a boot-time
bit goes stale if the framework is swapped under a running server (OQ4's
caution applies), so this complements option 1's receipts rather than
replacing them; and a trivial-probe verdict proves the creation and
checkpoint prerequisites, not all handler semantics. Owners: LLP 0031
(`/health` payload), LLP 0030 (lifecycle), LLP 0010 (diagnostics),
LLP 0009 (the host-install policy every handoff mitigation above
touches).

### Option 3 — Prebuilt hermetic runtime distribution

Never build or assemble Hermes on an adopter's machine. The seed exists
in-tree: `packages/snapback-runtime-darwin-arm64` already pairs
`bin/snapback` with `Frameworks/hermesvm.framework` in one npm package,
and `packages/snapback-runtime-linux-x64` adds a binary+Hermes digest
attestation. The strategic move is to make that co-packaged pair the
*only* adopter-facing runtime delivery — binary and framework versioned,
digested, and installed atomically together, attestation extended to
macOS — and demote the sibling-checkout/vendored-bootstrap machinery to
an explicit contributor lane. This interacts directly with LLP 0122's
single-binary packaging option (the limiting case: one artifact, nothing
to pair) and with CV-1's published-channel work; LLP 0041 owns the
package closure. Diary 0028's Hermes-from-source cost disappears from
the adopter path by construction.

**What it does and does not guarantee.** Today's packages are assembly
closures, not behavioral-coherence proofs: the macOS prepare script runs
`build-identity` and then copies binary and framework independently
(`prepare-runtime.mjs`), its package test checks build identity only
(`package.test.mjs`), and the Linux package test proves attestation
digests, launch, and identity — never VM creation. A package can
therefore seal and faithfully distribute an already-incompatible pair,
and extracted files can be altered after installation. Packaging removes
the sibling-refresh workflow — the manufacturing process behind this
incident — but claiming coherence requires CV-2-style VM qualification
at the package-production boundary (and/or at consumption, per option
2's `runtime-qualify` probe), plus a custody story for the attestation
itself. Residual: contributors still live in the mutable world, so
option 1 remains necessary for the source-tree lane either way.

#### Desktop-sidecar package-swap attachment boundary (2026-08-05)

The first LLP 0129 Phase-2b sidecar rung consumes, but does not strengthen,
this option. `@expo/snapback-sidecar` resolves its initial and updater-supplied
runtime selections through the packaged CLI resolver, starts the selected
binary on an OS-assigned port, validates the Rust-owned ready descriptor and
owner-only siblings, and matches `startupNonce` against `/health`. Its
optional `verifyCandidate` callback runs after that health proof but before
the updater commits the candidate attachment; a failed callback triggers the
journaled old-or-new recovery path.

Those checks prove which live child wrote the descriptor. They do not prove
that the binary and Hermes artifact were installed atomically, that their
digests are bound into a tamper-resistant package receipt, or that the pair
can create the required handler VM. The callback is an attachment point for a
future package-production/consumption verifier, not permission to label the
current package sealed. Option 1's behavioral qualification and this option's
attestation-custody work therefore remain necessary before LLP 0129's
"sealed, attested artifact" phrase can be promoted beyond a named dependency.

#### Package seal landing (2026-08-06)

The Option 3 package boundary is now sealed. Both platform packages stage the
compile-side Hermes header with the load-time framework/library and emit one
package-owned `snapback.runtime-readiness.v1` receipt binding their SHA-256
digests, the binary digest, the full `snapback.binary-identity.v1` build
identity, exact source revision, and the complete successful
`snapback.runtime-qualify.v1` verdict. Darwin and native Linux production run
the CV-2 probe only after the final `bin/../Frameworks` or `bin/../lib` layout
exists, with loader overrides scrubbed so the binary's LC_RPATH/RUNPATH is the
authority. Cross-host Linux assembly accepts only the byte-identical native
builder attestation, now extended with the header digest and successful
qualification verdict, because a Darwin assembler cannot execute an x86-64
ELF binary.

Package-manager tarball integrity owns custody of the receipt as a member of
the same immutable package. At consumption, the packaged CLI resolver refuses
before returning the binary unless `verifyRuntimePackageSeal` re-hashes the
installed binary, header, and Hermes runtime and reopens the source/build/
verdict binding. A replaced binary classifies `binary-drift`; a swapped or
missing Hermes artifact classifies `framework-drift`. The app-owned
`.snapback/runtime-readiness.json` flow remains a separate, later live
qualification record; it no longer substitutes for the package-production
seal.

**Darwin npm-shape correction (2026-08-06).** The release binary's Mach-O
load command names
`@rpath/hermesvm.framework/Versions/1/hermesvm`; dyld does not open the
top-level `hermesvm.framework/hermesvm` convenience symlink. npm omits that
symlink when packing/installing the framework. Darwin production therefore
stages the versioned real-file tree, qualifies that symlink-less final layout,
and records `Frameworks/hermesvm.framework/Versions/1/hermesvm` in the seal.
The publisher extracts every runtime tarball and reopens its seal from those
npm-serialized bytes, so a pre-pack-only artifact spelling cannot pass again.

This landing deliberately does **not** add the in-serving-process boot witness
analyzed in Option 2. That witness still needs LLP 0009/Ibex host-handoff work
before it can consume a strict Host token safely. It also does not add richer
native refusal-reason propagation: that remains a new vendored-Ibex C-ABI
channel (§Option 2, invocation-error fidelity). Package sealing uses the
already posture-neutral, short-lived `runtime-qualify` subprocess and requires
neither deferred change.

### Option 4 — Content-addressed immutable dynamic engine selection

Keep dynamic linking, but select the engine artifact by digest from an
immutable store and bind the build to exactly that selection — removing
the mutable well-known framework path whose in-place refresh the
incident raced. This is not hypothetical: vendored Ibex already ships a
portable-engine mode with exact artifact-id and archive-digest selectors
(`IBEX_PORTABLE_HERMES_ARTIFACT_ID` /
`IBEX_PORTABLE_HERMES_ARCHIVE_DIGEST`, `vendor/ibex/build.rs`), a
checkout-local content-addressed store under `target/hermes-artifacts`
whose root must canonicalize to itself (no symlink redirection),
manifest/header-set/runtime validation with exact framework-resolution
checking, and every selected payload entry added to Cargo's
rerun-if-changed watch set
(`vendor/ibex/build_support/portable_engine_build_consumption.rs`).
Stated precisely: what is digest-anchored is *selection* and
*build-time validation* — digest checks run only when the build script
actually reruns, and the watch set itself is still Cargo's ordinary
mtime-based change detection, so this machinery does not replace the
mtime heuristic the rsync hypothesis suspects. The protection comes
from store immutability plus the fact that changing engines changes
the content address (and so the watched paths), with digest validation
catching a defeated assumption whenever a rerun does happen. It
occupies a genuine middle point between options 3 and 5: contributor
iteration and shared engine artifacts stay dynamic, while "swap the
framework in place" stops being a supported workflow state because
consumption is pinned to a content address — though a digest-named
directory does not by itself make in-place mutation unreachable, which
is why the enforcement residual below is load-bearing.

**Costs and residuals.** As shipped, Ibex's selector is coupled to its
promotion/preflight authorization apparatus — portable mode requires a
preflight receipt, nonce, `RUSTC_WRAPPER`, a cargo target map, and a
promotion admission alongside the digest selectors
(`vendor/ibex/build.rs`) — so whether Snapback can adopt the selector
without that apparatus is an open question (OQ7). Immutability must be
enforced, not assumed: qualification binds to bytes read at a pathname
unless it is bound to the mapped object, so post-link mutation/TOCTOU
survives (OQ8); the loader must resolve exactly the selected artifact at
run time, not only at link time; and digest identity proves artifact
identity, not glue/engine behavioral compatibility — a correctly pinned
but semantically incompatible pair still needs option 1/2
qualification.

### Option 5 — Shrink the dynamic-linking surface

Statically link (or otherwise embed) the VM so binary and engine cannot
drift apart after the link. The vendored build already supports it
(`HERMES_LINK_STATIC=1`), so this is closer to a build-policy change
plus a static-bundle supply chain than new engineering. What it removes
is precise: post-link engine replacement and loader-path resolution
failure stop existing for the final binary — the rsync-mtime staleness,
the ENG-22664 `LC_RPATH` launch wedge, and the
framework-refresh-after-link ordering all disappear from the served
artifact. What survives is equally precise: a defeated relink then
serves an old but self-coherent engine — staleness, not incoherence —
and link success proves link-time binding, not behavioral
compatibility. A semantically incompatible static archive can still
compile and link cleanly, so header or contract drift is *likelier* to
fail loudly at build time (the Diary 0022 shape) but is not guaranteed
to, and build-boundary qualification (option 1) keeps its job. Costs,
corrected: larger binaries; every final binary relinks against the
static bundle, but Hermes itself need not rebuild per package assembly
— the build consumes pre-existing archives (`lib*.a`, `libjsi.a`,
`libboost_context.a`) that can be produced and cached separately
(`vendor/ibex/scripts/build-hermes.sh --release`); and the
swap-a-framework-without-relinking property is lost — this analysis
found no adopter-facing need for swap-without-relink, but whether the
contributor lane needs it is part of what OQ3 routes to a ratifier. A
plausible split: static for packaged/adopter artifacts (compounding
option 3), dynamic retained for contributor iteration under option 1's
receipts or option 4's content addressing.

### Option 6 — Alternative or additional JS engine (risk analysis only)

What actually depends on Hermes specifics? Two boundaries, not one. At
the `crates/snapback/src/runtime.rs` C ABI the load-bearing contracts are: (a) the
restricted **no-eval constructor**; (b) the **time-limit
watch/interrupt** surface; (c) the **async-failure checkpoint** —
`ex_hermes_eval` reaching a full microtask checkpoint so
detached-rejection and never-settled-promise invocations can be failed
with no writes; and (d) the host-call bridge and safe-throw/stage1 value
metadata. That ABI is small and explicit. But the replacement boundary
is not just that ABI: vendored Ibex compiles and watches a large
Hermes-specific native body — module execution and bootstrap, timers,
DNS, crypto, filesystem, process, TLS/HTTP/fetch/WebSocket networking,
sqlite, debugger, console, IPC, worklets, runtime extensions, ABI
checks, and per-platform code (`vendor/ibex/build.rs`) — and any engine
strategy inherits a decision about how much of that host surface moves
with it. In-tree prior art bounds the question empirically: Snapback
already carries a **Workerd/V8 execution twin** (`crates/snapback/src/workerd_exec.rs`,
LLP 0048) that runs non-action handlers through the same host-op
protocol in a local workerd process, opt-in per run — proof that part of
the semantics is portable, and a marker for what is not (actions stay on
Ibex; egress and secrets powers are outside the twin's scope). Which
semantics the twin already proves, and which are absent, is an empirical
inventory this document has not run; running it belongs with LLP 0048,
which owns the twin — no open question here claims it, and OQ8
(readiness-evidence boundaries and TOCTOU binding) does not cover it.

A wasm-hosted engine (Hermes or QuickJS compiled to wasm inside a
statically linked wasm runtime) would remove native dynamic-link
fragility categorically — the engine becomes data, not a dyld
participant — at the cost of performance headroom and reimplementing the
watchdog/checkpoint contracts at the wasm boundary. A V8/JSC fallback
buys little here: the incident is a distribution-shape problem, and V8
would inherit it unless shipped per option 3/4/5 anyway. Conclusion of
the analysis, restated with the wider boundary in view: engine *choice*
is secondary; engine *co-shipment* is the property that matters. The
checkpoint semantics remain the deepest captivity point because the
fail-closed invocation contract rests on them — but no-eval enforcement,
host-call behavior, interruption, value/error representation, async
settlement, module/bundle semantics, platform capabilities, and action
support are all contract points too. The source-level narrowness of the
ex_hermes ABI is not the same thing as a small semantic migration, and
the migration cost is an empirical question the Workerd twin only
partially answers.

### Option 7 — Runtime-limit discoverability as a product surface

Declare limits instead of teaching them by refusal — noting that the
diary evidence actually contains three different problem classes with
different declaration surfaces and remediation paths:

1. **Quantitative ceilings** — the 1,024 buffered-write ceiling surfaced
   mid-acceptance (Diary 0029). Belongs in the capability/introspection
   surfaces that already exist (LLP 0010 §Capability Reports; the
   guide's capability index per LLP 0061) as queryable numbers,
   assertable by acceptance.
2. **Unsupported operation shapes** — one membership command per
   mutation, discovered as `SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED` at
   runtime (Diary 0031). A shape restriction, not a number: it belongs
   in the capability index and the authoring guide as a stated contract
   of the mutation surface.
3. **Phase/configuration prerequisites** — `SNAPBACK_OUTBOUND_ACTIONS=1`
   required *at codegen time*, discovered only after a failed generation
   despite being documented as a runtime grant (Diaries 0030/0031).
   Neither a ceiling nor a shape: the fix is a codegen-time check that
   names the missing grant rather than failing generation obscurely.

All three extend Snapback's honest-nonclaim posture (LLP 0115 governing
constraint 2) from capabilities to envelopes. Each rides an existing
surface, so the cost is *plausibly* small — but that is a hypothesis,
not analysis: canonical ownership, generated-introspection
compatibility, and drift enforcement between report, index, and guide
are exactly what OQ5 leaves open. Independent of the runtime options
above.

### Option 8 — The first hour as an acceptance-tested artifact

Make "fresh machine to first armed JS invocation" a CI job that is
literally the first hour: clean environment, install from the published
channel (or clean clone for the contributor variant), bootstrap, create
an app, run one JS mutation and one live query, tear down — with the
CV-2 mismatched-framework fixture as a required failing case. Today no
gate runs this end-to-end path; each tool proves its own slice and the
seams between slices are where both 2026-07-30 and Diary 0022 lived.
Prior art: LLP 0041's comparator receipt already runs a real product
fixture with semantic checks, and CV-1's published-channel harness mode
is the natural carrier; the nearest existing runner shape is
`.github/workflows/public-package-proof.yml` (LLP 0041's GitHub-hosted
cold-proof matrix), which sharpens the cost estimate beyond "macOS
runners and wall-clock." The adopter variant is only meaningful once
CV-1 lands (a checkout-based job proves contributor experience, not
adopter experience). Cost is real, and the job's value is exactly
proportional to how faithfully it refuses shortcuts like reusing a warm
target directory.

### The no-evidence-regression check (LLP 0115 constraint 1)

LLP 0115's first governing constraint — no work item may improve
ergonomics by weakening an evidence boundary — applied per option:

- **Option 1 (receipts):** evidence-adding. The regression risk is a
  trusted-but-stale receipt becoming a new false green; CV-3's
  invalidation semantics are the guard, and receipt custody, tampering,
  and the qualification-to-use race (OQ8) must be part of the design.
- **Option 2 (server-side):** regression-prone as drafted. The naive
  create-and-destroy probe consumes the one-shot strict Host handoff
  and leaves serving constructions on the `SecurityMode::Audit`
  fallback (see the hazard analysis in the option), buying readiness
  evidence by weakening enforcement posture; the option cannot be
  classified evidence-adding until one of its mitigation shapes is
  chosen and proven posture-neutral. With that in place it is
  evidence-adding at the serving boundary — and it still must not
  *replace* invocation-time fail-closed semantics, and a boot-time
  verdict must not be trusted across post-boot drift.
- **Option 3 (prebuilt):** regression-prone if the packaged pair is
  trusted *because it is packaged* — without production-boundary VM
  qualification and attestation custody it converts a loud local
  incident into a quietly shipped one. With them, evidence-neutral or
  better for adopters.
- **Option 4 (content-addressed):** evidence-adding for artifact
  identity; regression-prone only if digest identity is read as
  behavioral proof, which it is not.
- **Option 5 (static):** removes the loader-drift evidence problem for
  the served binary but must not retire build-boundary qualification —
  link success is not behavioral proof.
- **Option 6 (engine strategy):** any replacement must preserve the
  fail-closed checkpoint evidence exactly; a faster or better-packaged
  engine with weaker settlement semantics is a regression by
  definition.
- **Options 7–8:** purely evidence-adding (declared envelopes; an
  end-to-end first-hour proof with a required failing fixture).

## Findings

1. **The Convex advantage here is distribution shape, not engine or
   diagnostics.** Diary-supported core: the tested workflow exposed no
   user-managed engine/server coherence boundary — all seven final
   Convex arms started cleanly, and the sole recorded local edge is beta
   anonymous-mode port coordination (Diary 0039). The stronger "one
   sealed engine+server artifact" account is labeled inference (§What
   Convex does); verifying it needs an authoritative Convex source or
   inspection of the downloaded artifact's closure.
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
5. **CV-2/CV-3 carry detection *and* the known ordering fix — but not
   the whole class.** CV-2's work text owns the prevention half: a
   framework refresh must invalidate or relink the final binary before
   qualification runs (LLP 0115), which removes the incident's known
   manufacturing mechanism. Distribution/link-surface changes (options
   3–5) remove whole manufacturing processes including out-of-band
   refresh paths; none of them proves behavioral compatibility by
   construction, so qualification keeps a job in every option.
6. **Static linking is an already-supported build mode**
   (`HERMES_LINK_STATIC` in `vendor/ibex/build.rs`), unused locally; the
   dynamic default is mobile-packaging lineage plus the sibling-checkout
   artifact-reuse model, whose swappability is the incident's enabling
   degree of freedom.
7. **Co-packaged per-platform runtime packages already exist**
   (`packages/snapback-runtime-darwin-arm64`, `-linux-x64`) — but as
   assembly closures whose tests prove launch and identity, never VM
   creation; option 3 is a promotion/adoption problem riding CV-1 *plus*
   a qualification-at-assembly obligation, with attestation currently
   Linux-only.
8. **The ex_hermes ABI is narrow; captivity is wider than the ABI.**
   No-eval, time-limits, and microtask-checkpoint rejection detection
   are the contracts any engine strategy must preserve, and the
   checkpoint is the deepest captivity point — but the replacement
   boundary also includes Ibex's Hermes-specific native host surface,
   partially bounded in practice by the in-tree Workerd/V8 twin
   (option 6). The declarative (Rust-evaluated) query/live-query paths
   and the ephemeral lane never touch the VM; JS live queries
   (`defineJsLiveQuery`) do, exactly like every other JS handler.
9. **Limit discoverability is a separate win in three classes.**
   Diaries 0029–0031 show a recurring learn-by-refusal pattern across
   quantitative ceilings, unsupported operation shapes, and
   phase/configuration prerequisites, with existing capability/
   introspection surfaces ready to absorb the declarations; the cost is
   plausibly small but unquantified (option 7).
10. **No current gate walks the whole first hour.** Each triad tool
    proves a slice; both major incidents (0022, 0032–0038) lived in the
    seams between slices.
11. **Nothing witnesses readiness at the serving boundary.** `/health`
    carries build identity and capability presence only (ENG-22798;
    `ibex_available` is a presence flag), no layer of the stack creates
    a VM before the first invocation, and the coded invocation error
    omits the native refusal reason — which is why the incident served
    green health while JS-dead, and why diagnosis needed inherited
    stderr (option 2).

## Confidence

- **High:** the incident mechanism, timeline, and tool behaviors — read
  directly from six diaries, the issue's code trace, and the scripts
  (`bootstrap-ibex-runtime`, `ibex-doctor`, `runtime-link-smoke.mjs`,
  `runtime-recovery.mjs`, `build.rs`, `crates/snapback/src/runtime.rs`). Also
  code-verified in v0.2: the JS-live-query execution path
  (`define.mjs` → `FunctionKind::LiveQuery` → `RuntimeGuard::create`),
  the Workerd/V8 twin's existence and non-action scope
  (`crates/snapback/src/workerd_exec.rs`), the runtime packages' assembly and test
  behavior (prepare/test scripts), the `/health` payload contents
  (`crates/snapback/src/server.rs`), and Ibex's portable-engine selector machinery
  (`vendor/ibex/build.rs`, `build_support/`). Code-verified in v0.3:
  the one-shot strict-Host handoff behind Option 2's hazard —
  `ensure_host_installed()`'s `Once` (`crates/snapback/src/runtime.rs`),
  `install_host`/`claim_pending_host_context` and the
  `SecurityMode::Audit` fallback (`vendor/ibex/src/host/abi.rs`),
  `ex_hermes_create_no_eval()`'s claim of the diagnostic context
  (`vendor/ibex/src/engine/hermes_runtime.cc`), and `Host::strict()` =
  `Enforce` plus Audit's log-but-proceed semantics
  (`vendor/ibex/src/host/mod.rs`) — and the console-log-only transport
  of native refusal reasons (`ex_host_console_log`, no constructor
  error-result ABI).
- **Medium:** the `rsync -a` mtime root-cause hypothesis (explicitly
  unconfirmed; CV-2 owns verification). Static-link viability — the
  build mode exists but the macOS static bundle supply
  (`vendor/ibex/scripts/build-hermes.sh --release`) is unexercised in
  Snapback's loop.
  The wasm-engine analysis (no spike behind it). Whether Ibex's
  portable-engine selector is adoptable without its promotion/preflight
  apparatus (OQ7, unassessed).
- **Low / labeled background:** Convex distribution internals beyond
  what the diaries observed — the sealed single-artifact account is
  inference; treated as labeled background above and never as diary
  evidence.

## Open questions

1. Is the rsync-mtime hypothesis the actual missed-relink mechanism, and
   does fixing it (copy without source mtimes, or digest-based rerun
   detection) belong inside CV-2 or in the bootstrap regardless?
2. Where is the adopter/contributor lane split declared — does LLP 0041
   own "adopters get only co-packaged, qualified runtime packages" while
   LLP 0010 keeps the source-tree bootstrap contract?
3. Should packaged runtime artifacts move to static linking (option 5)
   while the contributor lane stays dynamic under receipts (option 1) or
   content addressing (option 4), and who ratifies that build-policy
   change?
4. Could the framework self-describe its behavioral ABI (a versioned
   checkpoint-contract stamp readable before VM creation) as a cheaper
   coherence check than digest binding, or is that just a second thing
   to keep coherent? If pursued, who reads it — bootstrap, doctor, or
   the server at boot (option 2)?
5. Where do quantitative ceilings, unsupported operation shapes, and
   phase/configuration prerequisites live canonically — capability
   report, introspection, guide capability index — and what keeps the
   three surfaces from drifting?
6. What does the first-hour CI job cost on macOS runners, and does it
   gate merges or run as a scheduled canary?
7. Can Snapback adopt Ibex's content-addressed portable-engine selector
   directly, or is it bound to upstream promotion/preflight
   infrastructure (preflight receipt, nonce, `RUSTC_WRAPPER`, cargo
   target map, promotion admission) unsuitable for the ordinary
   contributor lane?
8. Which boundary issues the authoritative readiness evidence — engine
   production, binary link, package assembly, installation, first
   launch, serve time, or a composition — and how is qualification bound
   to the mapped engine object rather than to bytes read from a pathname
   just before use (TOCTOU)?
9. Is the strategic standard "incoherence impossible," "incoherence
   fails before serving," or a layered combination — and which options
   are graded against which standard?

## Relationship to LLP 0115 and owning documents

LLP 0115 CV-2 (VM qualification during bootstrap) and CV-3 (persisted
readiness receipt across doctor/bootstrap/harness) are the planned P0
work items for this area; this document summarizes and credits them as
option 1 and deliberately explores the layer above them. LLP 0010 owns
the bootstrap contract, the `SNAPBACK_*` diagnostic registry, and the
coming CV-2 amendment; its dated 2026-07-30 note already records the
standing facts. LLP 0030 owns server-process ownership and the resolver
ladder — and would own option 2's refuse-vs-degraded lifecycle
semantics. LLP 0031 owns `/health` binary identity and defines the
reuse-verdict vocabulary (`verified`/`unpinned`/…) — and would own
option 2's readiness block; the CV-15 `unpinned` wording fix itself sits
with the 0010 harness per LLP 0115's status board. LLP 0041 owns
packaging and the runtime-package closure that option 3 would promote;
LLP 0048 owns the Workerd/V8 twin that option 6 uses as prior art;
LLP 0122 (series sibling) covers installed-product coherence, where the
single-binary option composes with options 3/5. LLP 0074 frames the
strategic bar — "ordinary authors should not need to know that Cargo,
Ibex, Hermes, sibling checkouts, runtime packages, ready files, or
internal artifact aliases exist" — which is the sentence this document's
option space exists to make true. Any decision arising from options 2–8
should land in those owners (or a new owned Spec), not here; per
LLP 0115's watch items, Convex's anonymous local mode maturing out of
beta would erase its one remaining local edge and raise the bar for all
of them.
