# LLP 0009: Code execution security and tenant isolation

**Type:** RFC
**Status:** Draft
**Systems:** Runtime, Security, Storage, Auth, Deployment, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-08-19 (the Ibex single-payload invocation tail now delegates
payload decoding and export selection to a sealed pre-application helper using
captured `JSON.parse`; hostile application replacement of the reachable
intrinsic cannot erase the host-selected export); 2026-08-12 (the Ibex invocation tail now crosses one fixed-template
slot as one serialized payload instead of sequentially replacing user-adjacent
tokens; native eval output is refused above an 8 MiB pre-parse carrier bound,
and unsettled diagnostics retain only byte length plus SHA-256; the existing
4 MiB application-result contract remains the advertised result limit, while
the owner VM heap ceiling remains honestly absent because the linked
`ex_hermes_create_no_eval` ABI exposes no heap-size parameter or setter);
2026-08-12 (host-mediated action fetch now inherits LLP 0251's
shared public-destination floor: metadata/non-public answers refused, resolver
pinned, redirects and inherited proxies disabled, with loopback HTTP denied by
default); 2026-08-01 (strict host context is armed per VM: the M2
install-once caching also cached the single-use, thread-bound arming, so only
the first VM per process — and no VM on any other thread — claimed an
Enforce-mode Ibex context; the Host is still built once, arming now happens
per construction, with the claim itself pinned by a negative-proven
regression); 2026-07-27 (LLP 0108 amendment: inline v1 admits only a parsed,
self-contained handler expression and preserves the existing evaluator,
capability scan, fresh-per-invocation isolation, and artifact-size ceilings);
2026-07-27 (adopts Ibex main `63ad33bc` from `expo/ibex`: the upstream no-eval constructor uses Hermes patch 0014, leaves the consumer intrinsic graph mutable for Snapback's verified ambient policy, publishes detached rejections through the native owner-thread async-failure queue, owner-thread deadline watches remain unchanged, and foreign-thread cancellation carries the live runtime nonce through `ex_hermes_interrupt_eval` rather than calling `watchTimeLimit` off owner; retires DK-4 warm reuse because current Ibex binds evaluation, queue inspection, value release, and destruction to the creating OS thread while Snapback blocking workers may change threads, so the local capability honestly returns to `fresh-per-invocation`);
2026-07-18 (handler bundle identity is closed at runtime: Snapback opts into a no-eval Ibex constructor, verifies the linked Hermes latch export before enabling it, Hermes patch 0010 closes the cached `Function("return this")` exception, both engines prove Function-family compilation unavailable before application evaluation, egress denies eval/WebAssembly while retaining fetch, and codegen's structural diagnostics are AST-backed defense in depth); 2026-07-18 (Promise completion authentication rejects Proxy-spoofed receivers and direct constructor reentry through a closure-private engine brand, enrolls rejection state before mutable public bookkeeping, derives canonical reaction snapshots from lexical arguments, binds them to the effective source only from the trusted initial handle path after alias traversal, gives adopters independent generations, multiplexes isolated generic and strict downstream observers, and defers generic reporting to a captured host task so authenticated reactions finish before classification); 2026-07-18 (Hermes action authority is bound at Promise reaction registration by a private one-shot scheduler token; ordinary enqueues never inherit ambient parent authority, while Promise's private factory may preserve only an authenticated real active scheduler across a no-frame internal adoption hop, never a sentinel, and any live user frame wins)
**Revised:** 2026-07-17 (Hermes patch 0009 replaces handler-reachable rejection assertions with a required one-shot engine observer: closure-private rejection generations are reported at reject time and completed only after the matching reaction executes or propagates and settles its child; native await, adoption, and combinators are covered, `_B`/`_C` are inert, and stale artifacts fail bootstrap); 2026-07-17 (Linux Hermes portability and adversarial closure: every harness observation child is explicitly guarded; `_C` records provisionally; both engines reject non-canonical Promise constructor paths before `then`, preventing decoy and no-op child capabilities; canonical Hermes handling requires a running sealed reaction; typed host branding and settlement diagnostic access use captured and guarded primitives); 2026-07-17 (Hermes harness-owned handler and settlement promises now receive an explicit sealed mediated reaction before native `await`, preserving handled typed host failures across engine hook-order differences without trusting reachable `_B` calls; the bootstrap also pins the captured `Function.prototype.call` used inside Ibex's `then` wrapper so selective intrinsic poisoning cannot blind the detached-rejection ledger and commit buffered writes); 2026-07-13 (audit blockers: Hermes preserves native Promise constructor identity but turns every handler-reachable then/promise `_B`/`_C` path into sealed state-validating mediators; Workerd settlement and detached-call quiescence share one invocation deadline, which aborts pending HOST fetches and fails closed); 2026-07-13 (whole-codebase security follow-up: the V8 harness now consumes trusted intrinsics exactly once before application evaluation, keeps its destructive rejection drain in the server closure, uses prototype-free Promise-channel records, and pins Response thenability and Promise species; local workerd uses independent invoke/host/response capabilities, authenticates response headers before bounded body reads, and emits only bounded, path/secret-sanitized stderr tails); 2026-07-12 (ENG-24559: settlement serialization and rejection inspection now use captured, non-destructive control-plane primitives and burn rejected warm VMs; ENG-24564: the workerd transport uses private materialization, authenticated local seams, and bounded reads; ENG-24340 final review follow-up: detached action lock acquisition is deadline/abandon-aware and the independent gate spans only final SQLite commit, never handler/plan/fan-out work; ENG-24351: codegen definition modules now cross an AST-resolved, permission-denied evaluation boundary rather than relying on ambient-token rejection; canonical evaluated values join artifact identity; ENG-24339: trusted invoke/settle helpers install before application source, are sealed and lexically linked, Ibex captures its original host transport, and action DB reads are rejected at the Rust host boundary); 2026-07-07 (DK-5 re-decided — triggers 1–2 fired with LLP 0040/LLP 0047 starting the same day; build the twin now as LLP 0048's workerd-hosted runner behind the RPC-shaped handler seam, no native embed; the enduring Hermes-local engine posture recorded — device parity with Exact, capability security by construction, footprint, spinup; ratified by Charlie in-session, applied by Claude); 2026-07-07 (ENG-23361: an unhandled rejection in a detached promise chain now fails the invocation instead of committing its partial work as success — the ctx bootstrap installs a rejection ledger on the vendored then/promise hook slots and the host sweeps it after every successful eval, `SNAPBACK_HANDLER_UNHANDLED_REJECTION`, nothing committed; §Invocation Isolation Obligation 3 updated); 2026-07-07 (ENG-23324: the DK-5 busy-loop rationale records the detached-action posture — actions run off the global write mutex on a watchdogged thread with per-host-call lock reacquisition, `action_wall_clock_timeout` now reports Enforced while query/mutation `wall_clock_timeout`/`cpu_budget` stay honestly Missing); 2026-07-06 (settlement is enforced, not assumed — ENG-23430: the invoke IIFE resolves to a tagged `{"r": …}` completion envelope and an untagged eval output is a failed invocation, `SNAPBACK_HANDLER_DID_NOT_SETTLE`, with no committed writes; §runtime conformance contract and §Invocation Isolation Obligation 3 updated); 2026-07-02 (§Decision DK-5 added — V8 conformance twin deferred with four named revisit triggers, LLP 0032 X2; earlier same day: §Secrets: the product layer above this floor — declared config, store seam, wizard, acquisition — is drafted as LLP 0036, which inherits this section's rules. Same day, LLP 0032 M2/DK-4 follow-through: §Invocation Isolation gains the as-built warm-VM design — pool keyed by module source, per-invocation baseline-restore reset, fail-closed burn, honest module-state limits; then hardened after adversarial review — an invocation-epoch stale-continuation guard closes cross-invocation context injection, the reset root-set broadened to iterator/generator prototypes and all constructors, a pool generation counter closes the read-lane check-in race; the 2026-07-01 revision recorded the decision itself)
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0006, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0014, LLP 0036, LLP 0040, LLP 0041, LLP 0043, LLP 0047, LLP 0048, LLP 0060, LLP 0108, LLP 0250, LLP 0251, https://github.com/ccheever/ibex

## Summary

Snapback runs application-authored JavaScript next to application data. That is
the point of the product, and it is also the security boundary. This RFC defines
the initial security posture for executing app code locally and leaves room for
hosted multi-tenant isolation without pretending that local development has the
same threat model as a public hosting provider.

The proposal: app code runs in a capability-limited JavaScript runtime. It does
not get ambient access to SQLite, filesystem, network, environment variables, or
secrets. All useful powers come through explicit host APIs such as `ctx.db`,
auth context, and later action capabilities. Fresh or equivalently reset
execution contexts are the default until pooling is proven safe.

The single most important correction this revision makes, drawn from Valet
([LLP 0006](./0006-valet-retrospective.research.md)): **the choice of code engine
is the threat model, and the canonical local engine does not provide one uniform
CPU/wall-clock budget for every invocation class.** Valet shipped no-op watchdog
stubs and was, in its own words, "unsafe against CPU-exhaustion attackers" on its
Hermes/Ibex path. Snapback now arms Hermes interruptible-eval deadlines for outer
Action and nested Mutation VMs, asynchronously breaks CPU-bound JavaScript, and
waits for those VM workers to exit before publishing the timeout. Ordinary Query
and top-level Mutation preemption remains honestly Missing, and native host work
can only be abandoned after a bounded grace rather than forcibly killed. This RFC
therefore states what each engine and invocation class can enforce instead of
assuming a uniform boundary; comprehensive preemption remains a prerequisite for
hosting untrusted code.

## Threat Model

Snapback has at least three deployment modes:

- local development, where the app author and machine owner are usually the same
  person;
- self-hosted single-app deployment, where the app code is trusted by the host
  but still must not leak user data accidentally;
- hosted or multi-tenant deployment, where Snapback may run code for multiple
  apps or customers and must treat app code as untrusted.

The first implementation targets local development, but it should adopt the
capability shape required by hosted deployment where doing so is cheap. Do not
build a local-only ambient-power model that later has to be replaced before
Snapback can safely host other people's apps.

## Security Goals

- App code cannot bypass `ctx.db` to read or write the database.
- Query and mutation handlers cannot perform arbitrary network I/O.
- App code cannot read filesystem paths or environment variables unless a
  capability explicitly allows it.
- Secrets are not ordinary strings visible to arbitrary query code.
- Runtime state does not leak between invocations.
- One app cannot observe another app's code, data, secrets, logs, or resources.
- Diagnostics are useful without leaking secret values or unauthorized data.

## Hosted authentication edge

This RFC owns the app-code runtime and tenant-isolation floor. It does not make
a plaintext local listener into a hosted authentication edge. TLS termination,
trusted-proxy effective-source derivation, distributed authentication
throttling, multi-replica session invalidation, and browser credential/XSS
posture are owned by
[LLP 0060](./0060-hosted-auth-security.rfc.md).

The current local target refuses session mode on a plaintext non-loopback bind,
but a loopback listener behind a public reverse proxy passes that mechanical
check. That is an explicit operator-owned residual, not evidence of hosted
readiness. A hosted target must satisfy LLP 0060's conjunctive capability gate
in addition to this RFC's untrusted-execution requirements.

## Runtime Boundary

Handlers run inside Ibex on the canonical local target. V8 is allowed on other
targets. **Boa is not an engine option** — it lacks features and performance;
Snapback targets Ibex and V8 only unless a future, explicit reason names a third.
The programming model must not depend on engine-specific powers — but "must not"
is an obligation this RFC has to *enforce*, and the Valet record shows why: its
default Ibex/Hermes engine **rejected `async` handlers** at validation time,
forcing authors onto the legacy Boa engine to use `async`/`await`
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`).

**The async failure was an execution-boundary choice, not an engine limit.**
Hermes has always had `async`/`await` and a microtask queue; what JSI embeddings
must provide is a loop that pumps it. Valet ran mutation replay inside a
**synchronous `eval` that held the database mutex for the entire handler** (see
the `[observed - Valet LLP 0005]` invariants below). When an `async` handler
returns a Promise, a synchronous eval returns immediately with an *unresolved*
Promise — there is no microtask drain, so the handler never completes, and Valet
rejected it at validation rather than ship something that silently did nothing.
That is a property of the *boundary*, not the engine.

**Ibex already drives async to completion** — verified against the Ibex source
(`[observed - Ibex source, 2026-06-25]`): `ex_hermes_poll(runtime, now_ms)`
(`src/engine/hermes_runtime.cc`) runs one tick — it drains cross-thread callback
queues, runs the `nextTick` queue, calls `drainMicrotasks(...)`, and fires due
timers, returning the count executed — and the host's `drive_event_loop`
(`src/bin/ibex/engine/hermes.rs`) loops on it **until no work remains**,
**releasing the runtime lock between ticks** rather than holding it for the whole
eval. The `ibex` binary supports top-level `await` today (its test suite asserts
`await Promise.resolve()`). The fix for Snapback is therefore structural, not an
engine swap: adopt the poll-driven boundary Ibex already uses.

Snapback needs a **runtime conformance contract**: the language/feature floor
(async/await, the host-call surface, error semantics) that every accepted
engine must pass, with a conformance suite (LLP 0010) that fails an engine which
does not meet it. The conformance floor, made precise by the Ibex evidence, is:

- the host can **drive an `async` handler to completion** — i.e. pump the
  microtask queue until the handler's Promise settles; and
- the host **does not hold the database/storage lock across async work or
  microtask drains** — the lock is acquired per tick or per commit, not for the
  whole handler, so slow or concurrent handlers do not serialize all writes.

Ibex passes this floor with one caveat: the poll loop exists and releases the
lock per tick, but when no timer or pending host work can advance a
still-pending promise, `ex_hermes_eval` returns the raw promise with *success*
status rather than spin. Snapback therefore enforces the completion half of
the floor at the result channel instead of assuming it: the invoke IIFE
resolves to a tagged `{"r": …}` envelope constructed only after the awaited
handler value exists, and an untagged output is a failed invocation —
`SNAPBACK_HANDLER_DID_NOT_SETTLE`, nothing committed (ENG-23430; pinned by
`crates/snapback/tests/handler_settlement_v0.rs`).
V8 passes natively. Absent a host meeting that floor, "pluggable runtime, one
programming model" is not true — which is exactly what bit Valet, and which the
`0003` execution-boundary revision now addresses at the integration level.

**Engine and threat model.** Valet concluded the engine choice is mostly a
deployment property with a security consequence (`[observed - Valet LLP
0041/0048]`): V8 (`deno_core`) for self-hosted/cloud because of real CPU enforcement
and isolate hygiene, Hermes/Ibex where a platform forbids JIT (on-device). "Running
untrusted code on Hermes is currently not safe against CPU-exhaustion attacks." The
practical rule: the canonical local Ibex target is for *trusted* local development;
any untrusted or multi-tenant target needs the V8/killable-isolate path, which is a
**named, load-bearing security dependency**, not an aside. Do not read "adopt the
capability shape required by hosting where cheap" as "Ibex is hosting-ready."

### Decision DK-5 — V8 conformance twin timing (2026-07-02)

**Decided: defer the synthetic V8 twin; the first V8 conformance exercise is
the Cloudflare prototype (X3), with named revisit triggers.** Ratified by
Charlie (applied by Claude under Charlie's same-day delegation); LLP 0032
X2, ledgered in LLP 0000.

Why defer rather than build now:

- **The anti-hardening job is already done by gates that exist.** The twin's
  purpose is keeping handler semantics from hardening around Hermes quirks —
  but the handler surface is deliberately tiny and fail-closed-gated:
  codegen structurally diagnoses ambient dependencies (`import`/`process`/
  `fetch`/timers/`Date.now`/`Math.random`) and dynamic-source syntax
  (`eval`/Function-family constructors/`with`), the `ctx` surface is the only power, definitions
  are executed-DSL-not-parsed, and DK-4's invocation-epoch guard fences
  cross-invocation execution. That narrowness, enforced in CI, is the
  portability defense a twin would re-verify.
- **The second target is V8 by construction.** Cloudflare
  ([LLP 0014](./0014-cloudflare-strategy.rfc.md)) runs workerd/V8; X3's
  narrow proofs exercise this section's conformance floor against the real
  platform — engine, limits, and isolation together — with more fidelity
  than a synthetic local embed, and without maintaining a second native
  bring-up (the repo's #1 recurring DX pain; see LLP 0032 P7).
- **The busy-loop risk that argued for "now" was re-scoped by L6/L7, then
  again by ENG-23324.** A `while(true){}` handler once wedged the whole
  process while holding the global lock; after L6/L7 it cost one
  blocking-pool thread plus the write lane — reads, ephemeral, and health
  stay live. ENG-23324 closed the remaining wedge for **actions** (the only
  egress-capable class, so the only one that can block on a hung outbound
  fetch): an action now executes detached from the write mutex — staged
  under the lock, run on its own thread, each host call reacquiring the
  mutex for just that call — under a coarse wall-clock watchdog
  (`SNAPBACK_ACTION_TIMEOUT_MS`, default 30s). On timeout the caller gets
  `SNAPBACK_ACTION_TIMEOUT` and the run is abandoned through an independent
  commit gate, so the watchdog never needs the instance mutex and no host call
  can commit after the caller was told the action failed. Instance/gate
  acquisition polls abandonment and the execution deadline without holding
  either lock. Plan and buffered-write iteration also polls outside the gate;
  only final SQLite commit owns it, and a precommit timeout rolls back rows,
  version, and idempotency state together. Mutations committed before the
  timeout stand (actions are not transactions, LLP 0028). CPU-bound outer-action
  and nested-mutation JavaScript is asynchronously interrupted; the fresh VM is
  destroyed and its OS worker exits before timeout publication. Native host work
  retains a bounded termination grace and any later result is discarded.
  Preemption for ordinary queries and top-level mutations remains owned by
  §Resource Limits, with the capability report
  honestly declaring `wall_clock_timeout`/`cpu_budget` **Missing** on this
  target while `action_wall_clock_timeout` reports **Enforced**.

**Capability truthfulness note.** `async_handler_completion: Available` is a
constant in the capability report, *verified by the conformance-floor tests*
(the async-handler suites in `crates/snapback/tests/local_v0.rs`) rather than computed at
report time. Computed-not-asserted limit fields land with whichever V8
runtime ships first; until then the suite-verified constant plus the
Missing-declared limits are the honest posture.

**Revisit triggers — any one reopens this decision:**

1. X3's Cloudflare prototype starts (the twin becomes that target's runtime
   bring-up, not a separate artifact);
2. hosted or untrusted execution work begins anywhere (this section's own
   rule: untrusted requires the V8/killable-isolate path);
3. a handler-visible semantics divergence between Hermes and V8 is observed
   in practice (the bug class a twin would catch earlier);
4. the missing wall-clock/CPU enforcement becomes user-facing on the local
   target (a demo or diary hits a wedged busy loop despite the L6/L7
   bounding).

**Re-decision (2026-07-07): triggers 1 and 2 fired; build the twin now, as a
protocol consumer rather than a native embed.** Ratified by Charlie
in-session (applied by Claude the same day).
[LLP 0040](./0040-cloudflare-narrow-proof.rfc.md) (X3's execution slice) and
[LLP 0047](./0047-hosted-execution-limits.rfc.md) were both drafted the same
day, firing triggers 1 and 2. What changed since the deferral: the
handler↔host seam is now pinned async and RPC-shaped
([LLP 0014](./0014-cloudflare-strategy.rfc.md) §One-way doors 3, LLP 0040
§App subset), and LLP 0040 must build a V8 handler harness regardless —
global-strip at module init, `ctx`-only powers, the tagged completion
envelope above — so the twin is no longer "a second native bring-up" (the
cost this decision correctly refused): it is the same harness hosted in
local workerd, speaking the same host-call protocol.
[LLP 0048](./0048-v8-conformance-twin.rfc.md) owns the build; it is
prerequisite-shaped for LLP 0040's first deploy, and it is where computed
limit fields land first (per the capability-truthfulness note above).

The enduring engine posture, recorded from the author (2026-07-07) so the
rationale outlives the conversation that produced it — Ibex/Hermes stays the
canonical local engine ([LLP 0002](./0002-canonical-local-target.decision.md)
does not reopen) because:

1. **consistency with Exact on devices** — mobile clients run Hermes, and
   [LLP 0012](./0012-headless-integration-contract.spec.md)'s parity rule
   makes eventual on-device handler execution
   ([LLP 0043](./0043-offline-replay-retention.rfc.md)'s direction) a Hermes
   execution site, so the local server engine matches where app code will
   actually run local-first;
2. **the capability-security model** — ambient-authority denial is
   constitutional in Ibex (the host hands in capabilities; nothing else
   exists), versus deny-by-discipline on V8/workerd until Workers for
   Platforms enforces it at the platform layer;
3. **smaller download and footprint** — the packaged dev loop
   ([LLP 0041](./0041-packaged-dev-loop.rfc.md)) ships one small embedded
   engine, not a V8 build matrix;
4. **spinup speed** — restart-heavy local development favors Hermes's
   cold-start profile; V8's JIT throughput advantage accrues to long-running
   hot paths, and shrinks under LLP 0047's fresh-per-invocation default.

Snapback is therefore **permanently bi-engine** — V8 on Cloudflare by
construction, Hermes on devices and the canonical local target by the facts
above — and the twin's job is not migration toward either engine: it
enforces the engine-neutral handler-semantics contract, the runtime analogue
of [LLP 0007](./0007-storage-portability.spec.md)'s storage portability
contract, as a standing CI gate. Revisit triggers 3 and 4 remain live as
stated; either firing now escalates within LLP 0048's contract (a class-1
divergence, or pulling the V8 leg's limits forward) rather than reopening
this note.

Concrete runtime invariants worth carrying over verbatim (`[observed - Valet LLP
0005]`), with one now *superseded* by the execution-boundary revision in
[LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md) §Execution and Write
Semantics: ~~the database is passed to the handler as a raw pointer valid only
because the DB mutex is held for the **entire** handler execution~~ — **superseded**.
The new model drives the handler to completion via the microtask loop with the lock
released per tick, and acquires the write lock only for the brief commit; the
raw-pointer-under-lock invariant was a Valet choice that caused both the async gap
and the P99 ~1s write contention, and is not carried forward. The remaining Valet invariants below still hold. `db.transaction()`
rejects nested calls (deadlock prevention); outbound `fetch` cannot be called inside
a transaction (it would hold the DB lock across network I/O); queries/mutations have
`fetch`/`setTimeout`/`require`/`process`/`crypto`/`WebSocket` blocked, and actions
re-enable a selective subset.

The runtime should expose only:

- the handler function and bundled dependencies accepted by codegen;
- validated args;
- auth/session context;
- host calls for the allowed `ctx` surface;
- injected clock and id source;
- structured logging with redaction;
- capability handles explicitly granted to that handler type.

The runtime should not expose:

- direct SQLite handles;
- unrestricted filesystem APIs;
- unrestricted network APIs;
- process environment;
- host process internals;
- dynamic imports outside the generated bundle;
- dynamic source compilation or WebAssembly execution outside the generated bundle;
- native extensions.

## Invocation Isolation

The default is one fresh runtime or an equivalently reset context per handler
invocation. Pooling is allowed only after Snapback can prove that:

- global JavaScript state is cleared or isolated between invocations;
- module caches cannot leak per-user data;
- timers and pending async work cannot outlive the invocation;
- memory limits and CPU limits are enforced;
- logs identify the invocation that produced them.

If pooling ships before those properties are proven, it must be marked as a
local-only capability gap and must not be used as the default hosted posture.
Valet's experience sharpens this from "unproven" to "unsolved": it shipped a fresh
runtime per invocation (complete isolation, allocation cost accepted), and when it
*tried* to design safe shared-VM pooling it found no workable technique — Hermes
exposes no public snapshot/restore primitives, and "strict module discipline plus
rebound globals" was judged the cheapest but most fragile option — so pooling became
"an open question rather than a shipped technique" (`[observed - Valet LLP
0037/0048]`). Treat fresh-context-per-invocation as the durable default and pooling
as research, not a near-term optimization. The five proof obligations above map
almost exactly onto Valet's failed candidates; keep them.

### Decision DK-4 — VM lifecycle for the trusted-local target (2026-07-01)

The M1 benchmarks ([LLP 0035](./0035-local-target-benchmarks.research.md))
measured fresh-VM-per-invocation at **~3.9 ms** — roughly three orders of
magnitude above the matcher (~1.8 µs/sub), read-set validation (~1.3 µs/dep),
or an ephemeral publish (~2 µs). It is paid on every mutation *and again per
affected subscription per commit* (each live re-run is a full VM invocation),
so it single-handedly caps single-writer throughput (~230 mut/s) and the live
fan-out ceiling (~2 affected subscribers per commit at a 10 ms budget). Reducing
per-invocation VM cost is therefore **the single biggest compute lever in the
system**, and the priority is ratified as such.

The *direction* is decided; the *technique* stays gated, because Valet's finding
above (no safe shared-VM technique on Hermes; no snapshot/restore primitives)
still stands. Concretely:

- **Cheapest safe step first — done, and it decided the question.** The
  per-invocation host re-install (`install_host` ran on *every* invocation) was
  cached to a once-per-process install (LLP 0032 M2) — a correct cleanup that
  also removes the nested-re-entry host-reinstall side effect. But the M1
  decomposition ([LLP 0035](./0035-local-target-benchmarks.research.md)) shows
  the install was **not** the cost: caching it left per-invocation VM cost
  within run-to-run noise, and the cost decomposes to **~55 % `ex_hermes_create`
  (pure VM creation) and ~45 % eval**. So the cheap safe win is small, and the
  real lever is **VM reuse** — creation is the majority of the cost and only a
  warm VM avoids it (a warm VM also avoids re-parsing the module inside the
  eval half).
- **Warm VM per bundle hash for the trusted-local target only.** Reusing a VM
  across invocations of the same handler bundle is the larger lever, but it is
  ratified **only for trusted-local** (single app, trusted developer code, no
  cross-tenant boundary) and **only with a proven per-invocation reset**:
  proof obligations 1 (global state cleared/isolated) and 3 (no timers/async
  outlive the invocation) apply here as **correctness**, not merely isolation —
  a warm VM that leaks a global between two invocations of the same app is a
  wrong-result bug, not just a tenancy leak. If Ibex offers no workable reset
  (the Valet blocker), this leg does not ship and the cheap-step win above is
  what stands.
- **Hosted/untrusted is unchanged.** Fresh-context-per-invocation remains the
  durable hosted default; the five proof obligations for hosted pooling are
  untouched. The warm-VM path is a **capability-flagged, local-only**
  optimization and must never become the hosted posture (§Validation
  Requirements: per-invocation global state must not leak under the chosen
  policy — a warm VM must satisfy that test in the trusted-local mode too).

Ledgered in [LLP 0000](./0000-snapback.explainer.md); numbers in LLP 0035.
Revisit: after the cost decomposition, and again once a warm VM (if it ships)
is re-measured to confirm the projected win.

### DK-4 retired — upstream Ibex owner-thread contract (2026-07-27)

DK-4 no longer ships. Current upstream Ibex records the creating OS thread as
the runtime owner and refuses evaluation, asynchronous-failure inspection,
value release, and destruction from any other thread. Snapback's local query
and mutation lanes use blocking workers whose OS-thread assignment may change
between invocations. Exclusive access through a mutex is therefore
insufficient: a checked-in runtime could be evaluated or destroyed by a
different worker even though no two workers use it concurrently.

Snapback now retains no Ibex runtime between invocations. Queries, mutations,
and actions all create, drive, inspect, release, and destroy their runtime on
the invocation's current thread, and the capability manifest reports
`vmLifecycle: "fresh-per-invocation"`. The former `SNAPBACK_FRESH_VM` opt-out
has no behavioral effect because fresh execution is mandatory. Reintroducing
reuse requires an execution architecture with stable runtime-owner threads (or
a new upstream transfer contract with equivalent owner-safe cleanup); merely
re-adding `Send` to an opaque runtime wrapper is forbidden.

The July 2 section below is retained as a historical record of the retired
optimization and its security analysis. Its present-tense implementation
claims do not describe the current runtime.

### DK-4 as-built — the warm VM pool and its per-invocation reset (2026-07-02)

> **Historical / retired 2026-07-27.** The gated leg once shipped. This
> subsection records that former design: what the warm path reused, what
> proved the VM clean between invocations, and — most importantly — the
> limits stated honestly. The implementation lived in `crates/snapback/src/warm_vm.rs`
> (pool, setup/reset sources) and `crates/snapback/src/runtime.rs` (the warm orchestration
> inside `run_ibex_handler_with_context`).

**Scope fences.** Warm VMs serve **query and mutation** invocations of
Ibex-module handlers on the trusted-local target. **Actions always run
fresh** — they receive secrets, cron metadata, and (when outbound egress is
enabled) timers and `fetch`; pooling them buys little and risks much, and
keeping them fresh also makes pool checkout re-entrancy-proof: the only
nested invocation shape is action→mutation (S5.D1), and since the outer
action never holds a pooled VM, the inner mutation's checkout can never
self-deadlock. The hosted/untrusted posture is untouched — fresh per
invocation remains the durable default and the five hosted-pooling proof
obligations stand unchanged. The warm path is capability-flagged
(`vmLifecycle: "warm-pooled-reset"` vs `"fresh-per-invocation"` in the
capability manifest / `inspect`, per LLP 0012's honesty rule) and opt-out:
`SNAPBACK_FRESH_VM=1` (sampled at instance construction) forces the fresh
path for debugging or A/B measurement.

**Keying.** A VM is keyed by the **exact module source text** — not a digest
(the map's key equality is the correctness check; nothing can collide), and
not the manifest `bundleHash` (that hashes manifest metadata, not the
executable text). The full VM-determining setup input is (ambient
restriction, ctx bootstrap, module source, reset install); the bootstrap and
reset are process-static, `SNAPBACK_OUTBOUND_ACTIONS` is env-static, and the
ambient restriction text is **identical for queries and mutations** (only
actions get the egress variant, and actions never pool) — an equality pinned
by test (`dk4_query_and_mutation_share_one_ambient_restriction`), so a future
divergence of the deny sets forces a re-key rather than a silent unsoundness.
Mode still matters per invocation, but it travels as an argument into
`__snapbackInvoke`, and the *real* write boundary is host-side
(`ensure_writable` in the invocation context) per §Capability Model — the JS
mode switch is UX, so one VM can serve both modes of one bundle.

**Threading.** Hermes runtimes are not thread-safe, but the vendored JSI
contract is **non-concurrency, not thread-affinity**
(`vendor/ibex/ios/Frameworks/hermes-headers/jsi/jsi.h`): a Runtime "cannot be
used safely from multiple threads at once. The application is responsible for
ensuring that it is used safely. This could mean using the Runtime from a
single thread, **using a mutex**, doing all work on a serial queue, etc." —
mutex-serialized sequential use from different threads is an explicitly
sanctioned strategy (Meta's own `jsi/threadsafe.h` decorator is exactly
that). Audit of the Ibex layer on top: the only thread-identity capture is
`ExactHermesRuntime::runtime_thread`, consulted solely by
`native_ws_release_context` to marshal a JSI-object delete — unreachable for
warm classes (WebSocket is denied at both the JS ambient layer and the strict
host, so a warm VM never constructs a WS callback context); the engine's
`thread_local g_active_module_id` is set only via `__exactSetActiveModuleId`
(**convention, not enforcement** — the ambient layer denies `process`,
`require`, `fetch`, timers, and `WebSocket`, but does *not* deny the engine's
own `__exact*`/`__hostCall` internals, so trusted handler code *could*
deliberately call it; verified against the engine source, `g_active_module_id`
is read only inside its own setter to return the prior value, so even
deliberate misuse shuffles a value handed straight back to the caller and
never feeds context routing, capability decisions, or the `Send` soundness —
this is the same convention-not-enforced posture the fresh path has always
had); the cross-thread callback queue is drained by whichever thread
evals/polls. The pool therefore uses
**exclusive ownership as the serialization**: checkout moves the VM out of
the `Mutex`-guarded pool, exactly one blocking thread uses it, check-in moves
it back; the pool mutex provides the happens-before edge between successive
owning threads. The lease type is `Send` (with the justification at the
`unsafe impl`) and never `Sync`. This one structure serves both lanes: the
serialized write lane (mutations + fan-out re-runs — the largest win) reuses
one VM per bundle, and concurrent L6 read-lane queries simply check out
distinct VMs, warming extras on miss up to the bound.

**Warm structure.** Setup eval, once per VM: ambient restriction + ctx
bootstrap + module source + reset install (which captures the baseline described
below). Per invocation: one eval of the small async-invoke IIFE — the same
text the fresh path appends — then the reset eval. The S5.D1 host-context
stack is pushed around **both** the setup and invoke evals, so module
top-level host calls on a warm VM's first invocation behave exactly as they
do on the fresh path (on later invocations module top-level simply does not
re-run — part of the module-state semantics below). The reset eval runs after
the context pops; its source is a fixed string that makes no host calls.

**Reset technique — what "proven reset" means here.** At setup, the reset
installer captures a **baseline of own-property descriptors** (string and
symbol keys) for: `globalThis`; the dispatch table `__snapbackHandlers` (one
level deep — it is the dispatch surface, so replacing or adding a handler
property must not survive); and a **deduplicated intrinsic root set**. That
set is deliberately broad — every constructor **and** its prototype (not just
prototypes): the fundamentals, the wrapper types, `Symbol`, `BigInt`, `Date`,
`RegExp`, `Promise`, all the `Error` subclasses, the collections
(`Map`/`Set`/`WeakMap`/`WeakSet`/`WeakRef`/`FinalizationRegistry`), the binary
types (`ArrayBuffer`/`SharedArrayBuffer`/`DataView`, every `TypedArray` view
plus the shared `%TypedArray%` base and prototype), the namespaces
(`JSON`/`Math`/`Reflect`/`Proxy`/`Intl`/`Atomics`/`WebAssembly`), the
host-provided globals (`console`/`crypto`/`TextEncoder`/`TextDecoder`), and —
critically — the **iterator and generator prototypes** reached reflectively
(`%IteratorPrototype%`, `%ArrayIteratorPrototype%`, the String/Map/Set
iterator prototypes, and `%Generator%`/`%GeneratorPrototype%`). The iterator
prototypes are not named globals, but a poisoned `%ArrayIteratorPrototype%.next`
would silently break the *next* invocation's `for-of`/spread — so they must be
in the set. (Async-generator prototypes are absent because Hermes has no
async-generator syntax, so app code cannot reach or pollute them.) The
baseline is taken **after** module top-level ran, so a module-level polyfill
is part of the app's own baseline, not a leak. After every invocation,
`__snapbackReset()` deletes own properties not in the baseline and redefines
any whose descriptor drifted (value identity via `Object.is`; accessor
identity; flag equality) — **restore-or-burn**: if any watched root drifted
un-restorably (a poisoned non-configurable intrinsic), the sweep throws, the
verdict is not-ok, and the VM is burned. Hygiene: every primitive the sweep
uses (`getOwnPropertyNames`/`getOwnPropertySymbols`/`getOwnPropertyDescriptor`/
`defineProperty`/`getPrototypeOf`/`Reflect.apply`/`JSON.stringify`/`Map` and
its methods) is captured at install time, so a handler overwriting the global
copies cannot blind the sweep — and the overwritten globals themselves get
restored. `__snapbackReset` is installed non-writable/non-configurable/
non-enumerable.

**Stale-continuation guard — the cross-invocation execution fence.** The
sweep restores *named* state, but a handler can capture its own `ctx` (or a
resolver closing over it) in **module scope**, where no `globalThis` sweep can
reach it. If invocation A stashes such a callable and a later invocation B
fires it on the same warm VM, A's continuation runs during B's microtask pump;
its `ctx.db.*` calls route through the process thread-local
`CURRENT_IBEX_HOST_CONTEXT`, which now points at **B's** context — so A's code
would execute with B's auth and commit into B's buffer (cross-invocation,
cross-user write injection; reproduced by an adversarial probe, 2026-07-02).
The reset cannot fix this (the resolver is inert-until-fired, so there is no
pending microtask to drain), and detecting a stashed closure from Rust is
undecidable. The fix is an **invocation-identity guard**: every invocation
(fresh and warm) is stamped with a process-monotonic `epoch`; the per-invocation
JS `host()` closure — rebuilt inside `__snapbackInvoke` each call so it closes
over *this* invocation's epoch — prefixes every host op with it
(`"<epoch>|<op>"`), and `snapback_host_call` rejects any call whose epoch does
not equal the live thread-local context's epoch with a structured
`SNAPBACK_HANDLER_STALE_CONTINUATION` (which throws in JS — fail closed). A
continuation therefore carries its *originating* invocation's epoch and is
refused against any later one, sync or async fire. The guard is stack-correct
for the S5.D1 action→mutation re-entry: the nested mutation gets its own epoch
and its own live context, and returning to the outer action restores the
outer epoch alongside the outer context (same save/restore stack). Pinned by
`dk4_stale_continuation_cannot_inject_into_another_invocation`, which fails
against the pre-guard code.

These identities are exhaustion-safe, not merely practically large. Epoch
zero is a permanent terminal sentinel: the allocator returns `u64::MAX` once
while moving atomically to zero, after which construction fails with
`SNAPBACK_HANDLER_INVOCATION_EPOCH_EXHAUSTED` before setup or application
evaluation. It never wraps to an identity that a predecessor continuation
could still carry. The warm-pool reload generation follows the same rule in
the only safe way available to a per-instance optimization: exhausting its
generation permanently disables warming for that pool lineage and burns all
subsequent check-ins, while normal fresh-per-invocation execution stays
available. The bounded pool rebases its LRU ticks in their existing order
before tick exhaustion, so eviction recency cannot invert through wrapping.
`final_invocation_identity_is_unique_then_allocator_is_terminal`,
`dk4_generation_exhaustion_permanently_falls_back_to_fresh_vms`, and
`dk4_lru_rebases_before_tick_exhaustion_without_reversing_recency` pin these
terminal behaviors.

#### Harness control-plane boundary

The ctx bootstrap evaluates before any application module and installs
`__snapbackDispatch`, `__snapbackInvoke`, and `__snapbackSettle` as
non-writable, non-configurable functions whose implementation calls through
lexical references. On Ibex it also captures the original `__hostCall` FFI
transport before application code can wrap the global and observe an epoch.
The fixed invocation tail passes its one serialized payload to
`__snapbackDispatch`; that helper decodes it with the captured `JSON.parse`
before selecting the export. Application replacement of reachable `JSON.parse`
therefore cannot redirect or erase host-owned export selection.
Settlement also captures its serializer, string conversion, error constructor,
and descriptor primitives before the module runs. The outer failure envelope
is assembled from separately encoded primitives instead of passing a plain
object through `JSON.stringify`, so replacing `JSON.stringify` or installing an
inherited `toJSON` hook cannot turn a thrown handler failure into success
(ENG-24559). Typed host-error branding likewise uses captured descriptor and
regular-expression primitives, and reads application-controlled diagnostic
getters only inside independent guards. A hostile `__snapbackCode` or `message`
getter can therefore neither escape the settlement catch nor replace a typed
host failure; an uninspectable message becomes a fixed primitive fallback.
The Hermes rejection tracker follows the same capability rule without exposing
an observer to handler JavaScript. Current Ibex configures Hermes's native
checkpoint tracker when `ex_hermes_create_no_eval` constructs the runtime.
Hermes records each rejected Promise and its rooted reason, removes the exact
record when the Promise becomes handled before the checkpoint, and publishes
the survivors through `ex_hermes_take_async_failure_event`. The first take after
`ex_hermes_eval` is the restricted consumer's determination checkpoint: it
flushes the post-microtask pending set but does not advance timers or unrelated
callback queues. Snapback renders the transferred root through Ibex's trap-free
safe-throw metadata and primitive Stage-1 text APIs, then releases it on the
runtime owner thread. A malformed record, rendering/release failure, native
publication failure, or explicit dropped-count marker fails the invocation
closed. The handler realm has no queue handle, drain function,
`__ibexRegisterPromiseObserver`, or `__OriginalPromise` authority. Legacy
Promise compatibility properties that the engine may retain are not inputs to
the native queue; direct calls cannot delete an enrolled native record.

Before either engine invokes handler-visible native `then`, a sealed,
getter-free gate requires the receiver's direct prototype to be the captured
native Promise prototype and any own `constructor` descriptor to be absent or
the exact native constructor as a data value. Custom, inherited, and accessor
constructor paths fail closed before they can supply child Promise
capabilities. A Proxy cannot use that gate to invoke native Promise `then` on a
non-Promise receiver because the engine's own receiver check independently
rejects it. This is necessary even when a reaction appears to attach: a hostile
constructor can invoke the executor with no-op resolve/reject functions and
swallow the rejection that a missing or throwing callback must propagate to
the child.

Native `async`/`await`, Promise adoption, combinators, explicit reactions, and
harness-owned settlement paths therefore share the engine's checkpoint
lifecycle instead of depending on handler-reachable bookkeeping. The shared
harness seals the same captured-intrinsic constructor gate on Ibex and V8 before
application evaluation. Harness-owned reactions use that sealed mediator;
ordinary `catch`/`finally`, native await, adoption, and combinators retain their
engine semantics, while an own or inherited hostile constructor cannot convert
a propagated rejection into a no-op child capability.
On the V8 leg, ESM exports are not treated as an access-control boundary. The
server is the first application-graph dependency and consumes the strip's
captured intrinsic bag through a one-shot function; a later application import
of the same module receives `null`. Its exported Workerd service object is
frozen before application evaluation, so importing the server cannot replace
`fetch` and recover the live `env` bindings. The rejection ledger and its
destructive drain live in the server module's closure, and the former importable ledger
module does not exist in the workerd config or deployed bundle. Records that
cross an async Promise-resolution boundary are copied to null-prototype
containers, `Response.prototype` has an own non-then property, and the native
Promise constructor/species dispatch points are pinned before application
evaluation. Thus inherited `then` hooks and species substitution cannot turn a
failure record or authenticated Response into forged success.
This ordering is security-significant: application source cannot reserve an
accessor or frozen property at a harness name and receive the live invocation
arguments. The Rust dispatcher is the final capability boundary and rejects
`db.query`/`db.get` in action mode even if a raw call somehow carries a valid
epoch; the action host exposes only named mutation invocation. Adversarial
Ibex/workerd twin probes pin frozen-global, accessor, wrapper-interception,
and raw-call denial (ENG-24339).

**Fail-closed pooling.** The reset returns a JSON verdict; the Rust side
pools the VM only on a parsed `ok: true`. Any handler eval error, reset eval
error, thrown sweep error (e.g. a frozen `globalThis` making a delete or
redefine impossible), or unparseable verdict **burns the VM** — it is
destroyed and the next invocation of that bundle pays a fresh create + setup.
Fresh-per-invocation is always the fallback, never an error. The reset runs
at check-in (not next-checkout) so pooled VMs are clean at rest and a
poisoned VM never sits in the pool.

**Honest limits — the proof-obligation mapping.**

- *Obligation 1 (global state cleared/isolated): met for the swept set —
  `globalThis` own properties, the dispatch table one level deep, and the
  enumerated intrinsic root set (constructors + prototypes + iterator/generator
  prototypes + host namespaces above)* — *and deliberately **not** met for
  module-level closure state.* The intrinsic set is broad enough that **all
  standard-language machinery** (the iterator protocol, collection iterators,
  generators, the fundamental constructors and prototypes) is covered, so
  language-level corruption cannot persist; an intrinsic *not* in the set
  (obscure or host-specific) is the same documented residue class as module
  state, not a language hazard. A module-top-level `let counter` mutated by a
  handler persists across invocations on the warm path: no `globalThis` sweep
  can reach a closure, and re-evaluating the module per invocation is precisely
  the cost being removed (it would also throw on top-level `let`
  redeclaration). This is state *value* residue, not a cross-invocation
  *execution* vector — the latter (a stashed callable) is closed by the
  stale-continuation guard above, not by this carve-out. Position:
  **accepted and documented for trusted-local.**
  (a) It is the standard execution model of mainstream serverless runtimes —
  module state *may* persist across invocations and code must rely on neither
  persistence nor freshness; (b) code that relied on cross-invocation
  freshness of module state was already unportable to any pooled target;
  (c) the semantics are capability-flagged and opt-out-able
  (`SNAPBACK_FRESH_VM=1`); (d) this is single-app, own-code territory — pools
  are per app instance, so state can never cross an app or tenant boundary
  (LLP 0018; pinned by `dk4_pools_are_per_instance`). A characterization test
  (`dk4_module_level_state_persists_documented_semantics`) pins the semantics
  so they are documented-by-test, not accidental.
- *Obligation 3 (timers/pending async cannot outlive the invocation): met,
  by two mechanisms.* Timers cannot exist in a warm VM — `setTimeout`/
  `setInterval` are denied as non-configurable ambient globals for
  queries/mutations before module code ever runs, and actions (which may get
  timers) never pool. Microtasks: `ex_hermes_eval` drains the microtask queue
  and pumps the event loop until the invocation's promise settles — or, when
  no timer or host work can advance it further, returns the still-pending
  promise with success status. That fallback is not a completion: the invoke
  IIFE's tagged completion envelope (ENG-23430) turns it into
  `SNAPBACK_HANDLER_DID_NOT_SETTLE`, a failed invocation whose buffered writes
  never commit, so "settled" is proven by the envelope rather than inferred
  from eval status. Settlement of the invocation promise still does not prove
  the handler's *detached* chains succeeded: a rejection in a chain nothing
  awaits (`forEach(async …)` is the classic shape) was observed by nobody —
  the vendored unwrap shim watches only the invocation promise — so the
  chain's earlier `ctx.db.*` writes stayed in the commit buffer while its
  later ones were silently skipped, and the invocation reported success
  (ENG-23361). Current Ibex records rejected Promises in its native checkpoint
  tracker and cancels the exact record when the Promise becomes handled before
  the checkpoint. After every successful eval — i.e. after the *full*
  microtask drain, so chains that reject after the invocation promise settles
  are still seen — the host takes Ibex's owner-thread async-failure queue and
  fails the invocation (`SNAPBACK_HANDLER_UNHANDLED_REJECTION`, nothing
  committed) if records remain. Rejections handled anywhere before completion
  never trip it. The queue and rooted reasons are not handler-reachable; safe
  rendering and release are native, and malformed/overflowed publication fails
  closed. On workerd, the event ledger's
  destructive take is closure-private and no sibling module exports it. Its
  handler settlement and detached-host-call drain consume one shared deadline;
  expiry wins any pending drain await, aborts the invocation-private HOST
  fetches, and returns a no-commit `SNAPBACK_HANDLER_DID_NOT_SETTLE` verdict
  tagged as the quiescence phase. A malformed report or a vendored-runtime
  upgrade that makes detection unsupported fails the invocation closed. A VM
  with any unhandled rejection is burned instead of returned to the warm pool.
  `crates/snapback/tests/unhandled_rejection_v0.rs` and the adversarial twin tests pin warm,
  fresh, action, hostile-reason, safe-rendering, native-await, adoption,
  combinator, constructor-capability, and Proxy-receiver behavior (ENG-24559).
  Every continuation that does run therefore runs inside
  the invocation that scheduled it. The
  residual hazard — a promise resolver or callback **captured in module scope**
  by invocation A and fired during invocation B — is *not* benign inert data
  (the earlier draft mistakenly folded a captured *callable* into the
  module-state carve-out): when fired, it makes host calls, and without a
  guard those route to B's live context. That is closed by the
  **stale-continuation guard** (above): A's continuation carries A's epoch and
  is rejected against B, fail-closed, whether it fires synchronously inside B
  or via a later microtask. So a stashed continuation can neither execute
  against another invocation's context nor silently succeed — it throws.
  Covered by `dk4_unsettled_promise_does_not_carry_over` (the resolver is
  swept from `globalThis`) and
  `dk4_stale_continuation_cannot_inject_into_another_invocation` (a
  module-scope-captured `ctx` firing in a later invocation is refused).
- *Obligation 2 (module caches cannot leak per-user data): per-invocation
  data never lives in VM state.* Args, auth, reads, writes, and secrets cross
  through the thread-local host context and eval arguments — host calls route
  through Rust, not VM globals — and the sweep removes any global residue.
  Per-user data can enter module state only if handler code puts it there:
  the same trusted-local carve-out, stated plainly. Hosted stays fresh.
- *Obligations 4 (memory/CPU limits) and 5 (log identity): posture
  unchanged.* Limits remain reported-Missing for this engine (§Resource
  Limits); invocation identity lives host-side. A warm VM's heap outlives one
  invocation by design; the pool bound (below) is the memory control.
- *Unobservable residue, named:* the `Symbol.for` registry grows
  monotonically (no data channel — a symbol is observable only through a
  property somewhere, and those are swept); engine-internal caches and GC
  state persist (no JS-observable data channel); per-eval source retention in
  the engine's source map is bounded because eval URLs repeat per
  (bundle, export). Deliberate self-sabotage — e.g. proxying an intrinsic so
  the sweep reads lies — is out of scope: the trusted-local threat model is
  accidental bleed, not the app attacking itself; untrusted code gets fresh
  VMs, full stop.

**Pool bound and invalidation.** One pool per `LocalSnapback` instance (two
local app instances must not share loaded code — §Validation Requirements),
bounded at **4 VMs total per instance** (a Hermes heap is MB-scale; the
common case is one bundle shared by all functions, so 1–2 live VMs);
beyond-bound check-ins destroy the VM. `load_functions` and app `reset` clear
the pool; content keying makes stale reuse impossible even without the clear
(changed source ⇒ different key ⇒ miss). One race remains because the L6 read
lane runs **without the global mutex**: an in-flight lock-free query holding a
VM checked out *before* a `clear()` could, on an identical-source reload,
check that pre-reload VM (with stale module state) back into the freshly
cleared pool. A **generation counter** on the pool closes it: `clear()` bumps
the generation, checkout stamps the VM with the current generation, and a
check-in whose generation is stale is dropped rather than pooled (harmless
otherwise, since content keying already blocks reuse across a changed source).

**Proof.** The gate is the `dk4_*` leak suite — tests that fail if the reset
or the guard regresses: global add, global overwrite (restored to baseline),
dispatch table mutation, prototype pollution (added *and* overwritten
intrinsic props), **iterator-prototype pollution** (a poisoned
`%ArrayIteratorPrototype%.next` must not break the next invocation's for-of),
unsettled-promise carryover, **cross-invocation stale-continuation injection**
(the adversarial-review HIGH — a module-scope-stashed `ctx` fired by a later
invocation must be refused, not committed into that invocation's buffer),
reset-failure burn (a frozen `globalThis` must yield a fresh VM next
invocation), actions-always-fresh, per-instance pool isolation, and the
module-state characterization — plus the full existing suite (E2
read-your-writes, S5.D1 re-entrancy, S5.D9, the
l6_/l7_ concurrency arc) green, plus the bench re-run in LLP 0035 (the
`vm_cost_us` metric keeps its fresh-create definition by disabling the pool
inside that measurement; the warm path gets its own `warm_invoke_us` metric).

## Capability Model

Handlers receive capabilities by handler type:

- query handlers get read-only `ctx.db`, auth context, clock if allowed, and
  diagnostics;
- mutation handlers get read-write `ctx.db` inside one atomic write boundary;
- actions, cron, notifications, assets, and outbound fetch need later contracts
  before they receive network or durable side-effect capabilities.

Capabilities should be visible in generated manifests and runtime diagnostics.
An agent should be able to ask why a handler cannot call a capability in the
current target.

The **real** capability boundary is the runtime not exposing the power, not a
build-time check. Valet built an AST analyzer to reject query/mutation use of
action-only `ctx` fields and ambient `fetch`/`globalThis`, and its commit history
is an *arms race* of escape hatches — direct, bracketed, destructured, aliased,
`Reflect.get`, bound `Reflect.get`, `Reflect.apply(Reflect.get, …)`, and so on —
which is exactly why its own RFC calls static surface analysis "defense-in-depth
rather than a sandbox" (`[observed - Valet LLP 0038/0041]`). Two carry-overs: use an
**AST analyzer, not regex**, for any surface check (Valet's schema codegen was regex
and silently dropped fields — see [LLP 0010](./0010-agent-dx-and-acceptance.spec.md));
and never treat the static check as the boundary — a query handler is read-only
because the runtime hands it a read-only `ctx.db`, not because a linter found no
write calls.

The same rule closes handler **code identity**. Snapback creates its Ibex VM
through `ex_hermes_create_no_eval`, while Ibex's ordinary constructor remains
eval-capable for CLI and module-loader compatibility. That variant completes
trusted Ibex bootstrap, then applies patch 0014's irreversible native latch
before the runtime is returned; a linked engine without the latch fails closed.
The same patch makes the cached `Function("return this")` path honor the mutable
`Runtime::enableEval` policy, so
direct/indirect eval, normal/async/generator Function constructors, constructor
walks, and reflective aliases all fail. The consumer constructor deliberately
leaves the intrinsic graph mutable so Snapback can install and verify its own
deterministic Date/Math policy and sealed Promise constructor gate. The
pre-handler dynamic-code corpus still executes valid source through both direct
and indirect eval and accepts only failure, rather than treating a function
object's presence or branding as proof that compilation is closed. The pinned
Hermes parser has no
reachable async-generator constructor because it rejects raw `async function*`
source and Ibex lowers authored async generators before runtime evaluation.
Trusted setup probes the reachable routes
before application source evaluates, turning a stale or incompatible native
artifact into a failed invocation. Workerd preserves the ordinary shared
`Function.prototype` shape but replaces the global Function constructor and
every reachable Function-family prototype constructor with one sealed denier,
then performs the equivalent pre-handler probe and requires Snapback's exact
denial diagnostic rather than trusting a platform TypeError. Egress changes which services an
action may call: it retains fetch and declared secrets, but still denies eval,
Function-family compilation, and WebAssembly, so fetched text remains data and
cannot execute with `ctx.runMutation` authority. Codegen's AST diagnostics are
deliberately only the early, precise explanation of that runtime policy.

Host-mediated action fetch is also subject to LLP 0251's destination floor:
every DNS answer must be public, the vetted address set is pinned through
connect, redirects and inherited environment proxies are disabled, and
loopback HTTP is denied unless the local operator explicitly enables the
development-only exception. This floor is separate from the still-missing
per-app destination allowlist.

Action egress also depends on causal capability attribution across Promise
machinery. For Promise reactions, Hermes mints a private one-shot scheduler
token while `.then()`'s registrant frame is live and binds it to closure-private
exact-source metadata before constructor reentrancy. Ordinary job enqueue sees
only its live scheduling frame and has no active-parent inheritance rule. The
one narrow exception is inside Promise's private factory: if runtime-internal
adoption registers a descendant after the user callback has returned, a no-user
capture may preserve only the real authenticated scheduler of the actively
draining job. It never turns a no-user or no-job sentinel into root, and any
live user frame wins. Thus a root action retains its explicit fetch grant
through native async preparation, while an unattributed native completion still
fails closed and a deputy reaction remains bound to its registrant rather than a
later resolver or mutable public bookkeeping.

## Secrets

Secrets are deployment-owned values. They should not be copied into generated
bundles or exposed as plain environment variables to query and mutation code.

Draft model:

- secrets are stored by Snapback or the hosting target;
- handlers receive secret handles only when their capability policy allows it;
- logs and diagnostics redact secret values;
- local development can use `.env`-style input as a source, but the runtime still
  exposes secrets through the same explicit API.

Queries should not access secrets. Mutations should avoid secrets unless a later
contract requires it. Actions and integrations are the likely place for secret
use.

This section is the security floor. The product layer above it — declared
configuration in the manifest, the per-app store and its per-target seam, the
status model, the setup wizard, and agent-driven key acquisition — is drafted
in [LLP 0036](./0036-app-secrets-and-config.rfc.md), which inherits every rule
here (secret handles, redaction, no read-back, no value hashing, actions-only
access) rather than restating weaker versions of them.

Valet's hard-won secret discipline answers the open question "how should Snapback
represent secret handles?" and is worth adopting as concrete rules
(`[observed - Valet LLP 0022/0040/0048]`):

- A secret crosses the handler edge as a **`SecretString`/secret-handle type, never
  a plain `String`** — it zeroizes and requires an explicit `.expose_secret()` to
  read. (Valet shipped a regression where `EnvProvider::get` returned a plain
  `String`, then fixed it.)
- **Never hash secret values in audit logs.** Valet considered and *rejected*
  hashing, because low-entropy secrets leak through hash equality if the log is
  later compromised; its `set_env` log records only `{who, when, key,
  value_changed: bool}`.
- **No read-back API.** Storage returns key names on list, never values; writes use
  a fresh nonce per write so an observer cannot even tell whether a value changed.
- `process.env` is actions-only and blocked in queries/mutations.

State the limit honestly: the runtime **cannot prevent deliberate exfiltration** by
handler code that legitimately holds a secret — this is defense-in-depth, not a
guarantee. Valet downgraded its earlier "prevents exfiltration" claim to
defense-in-depth and said so in the RFC. A blanket "deny by default" also breaks
real cases (staging mirrors, per-branch overrides, read-through opt-in), so the
policy is "explicit capability + redaction + honesty," not "the runtime makes
leakage impossible."

## Database Isolation

All database access goes through host-mediated APIs. App code must not build raw
connections to the underlying database on the paved path.

The local target may use one database file per app. Hosted targets may choose
database-per-app, schema-per-app, or row-level tenant boundaries, but the chosen
deployment profile must state:

- what isolates app data;
- what isolates tenant data within an app;
- how backups and restores preserve isolation;
- whether raw SQL escape hatches are allowed;
- how auth and permissions are enforced for sync.

## Resource Limits

Snapback should enforce or at least report:

- invocation wall-clock timeout;
- CPU budget where the runtime supports it;
- memory budget;
- maximum result size;
- maximum mutation changeset size;
- maximum subscription count per client;
- maximum outbound messages per tick.

Local development can default to generous limits, but limits should still appear
in capability reports so agents do not write code that only works by accident.

Private runtime transports are limits too. The local workerd runner bounds
readiness and invocation response bodies independently, checks the worker's
response capability in headers before it reads or trusts `Content-Length`, and
uses separate one-invocation capabilities for caller→worker, worker→host, and
worker→caller authentication. Startup/invocation diagnostics read only a tail
window from stderr and redact the private materialization path and every
capability value before constructing a public error.

**Enforceability is engine-specific and must be reported, not assumed.** "Enforce
or at least report" is load-bearing here: Valet *claimed* a 5s/300s wall-clock
timeout but the watchdog was a no-op stub, and because the engine's `eval` is a
synchronous FFI call, an async wall-clock timeout could not preempt a handler
already running inside the engine — so a runaway handler was never terminated
([LLP 0006](./0006-valet-retrospective.research.md), `[observed - Valet LLP
0038/0048]`). A reported-but-unenforced CPU/wall-clock limit is a security hole, not
a soft default. The capability report must distinguish *enforced* from *advisory*
per engine; real wall-clock/CPU enforcement requires an engine watchdog, a
killable process/isolate boundary, or the V8 path. (Valet's deprecated Boa engine
had crude real limits — 1M loop iterations, 256 recursion depth — that the default
engine lost; Boa is no longer a Snapback engine option per §Runtime Boundary, so
its limits are historical context, not a fallback to reach for.) Likewise, the
outbound-message limit must apply **backpressure or a
recoverable error, never a silent drop**: Valet's 50 msg/s default silently dropped
burst writes and stranded the client's mutations permanently
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Realtime Delivery).

For the Hermes leg, deadline setup and teardown call Ibex's owner-thread
`ex_hermes_watch_time_limit` / `ex_hermes_unwatch_time_limit`. Admission
cancellation can arrive while that owner is inside evaluation, so it instead
uses `ex_hermes_interrupt_eval` with the pointer-plus-nonce identity captured
immediately after construction. The nonce prevents a delayed cancellation from
interrupting a later runtime that reused the same address; teardown removes the
identity from Snapback's cancellation hook before destroying the runtime.

The owner-handler Hermes carrier is separately bounded before Rust allocates
the returned string. Snapback scans at most 8 MiB plus one witness byte and
returns `SNAPBACK_HANDLER_EVAL_OUTPUT_TOO_LARGE` before parsing or copying a
larger result. This outer bound matches the local workerd pre-parse refusal;
the application-visible `maximum_result_size` remains the stricter 4 MiB
post-JSON contract. `maximum_heap_size` remains absent: unlike Ibex's
restricted-worker constructor, the owner-VM `ex_hermes_create_no_eval` ABI
does not accept `withMaxHeapSize` configuration and exposes no post-create
setter. The capability vocabulary must keep that distinction honest.

## Supply Chain and Generated Bundles

Generated handler bundles are part of the security surface. Codegen must decide
which dependencies are included and which dynamic imports are rejected.

Go straight to **hashed, bundled artifacts**; do not ship raw handler source
strings. Valet shipped each handler as `handler.toString()` in a `functions.json`,
which meant the server saw only the function body — so module-level helpers a
handler referenced threw `ReferenceError` on server replay, forcing authors to
inline everything into self-contained handlers
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`). Valet's own RFC called the raw-source
approach a dead end (it precludes multi-file handlers, npm imports, tree-shaking,
per-engine compilation, and source maps) and proposed a bundler it never built
(`[observed - Valet LLP 0004/0041/0048]`). A real bundle step makes both the
security surface and "does the loaded code match the source tree?" answerable, and
removes the self-containment footgun.

Snapback consumes Ibex by an exact gitlink to an `expo/ibex` main-lineage
commit. The 2026-07-27 adoption pin is `63ad33bc`, which includes the reviewed
no-eval constructor, owner-thread native async-failure queue, owner-thread
time-limit ABI, and nonce-authenticated cross-thread interrupt ABI.
Consumer-required engine capabilities are upstreamed through Ibex's review
discipline before this pin advances; Snapback does not carry or pin a
long-lived compatibility branch.

The runtime must preserve that answer after loading. A handler can execute only
the bytes selected by the manifest; network responses, config values, database
rows, and arguments are data, never additional source. The two engine legs
therefore prove string compilation unavailable before application evaluation,
and the codegen AST walk rejects obvious dynamic-code forms for author-facing
diagnostics without treating that syntactic pass as the sandbox.

The source-authored **definition modules** that create those artifacts are an
input-security boundary too. Snapback resolves their exact static local graph
with an AST bundler, hashes every path/source pair and governing module-format
manifest, and evaluates only the resulting bytes. Evaluation runs in a separate
Node process whose permission model denies filesystem, child/worker, addon, and
inspector authority, inside a capability-empty VM that exposes no process or
network globals and denies dynamic code generation and ambient nondeterminism.
Node 24 does not permission-gate network syscalls, so that split is deliberate:
network denial is the VM capability boundary; filesystem denial has both layers.
This is the §Capability Model rule
applied to tooling: computed `Function`/`globalThis`/`process` tricks find no host
power, rather than becoming an endless static-token arms race. Canonical
serialized evaluated values join the source graph in the content hashes, so a
toolchain semantic change cannot give identical source a different meaning under
the same identity. `[confirmed — Charlie Cheever / Codex, 2026-07-12]`

The server should record:

- bundle hash;
- schema hash;
- function manifest hash;
- package or dependency metadata where available;
- target capabilities used by the bundle.

This lets an agent or deployment tool answer what code is currently loaded and
whether it matches the local source tree.

## Validation Requirements

Before this RFC moves beyond `Draft`, tests should prove:

- a handler cannot access filesystem, environment, network, or SQLite directly;
- query handlers cannot call write APIs;
- mutation writes are host-mediated and atomic;
- per-invocation global state does not leak under the chosen runtime policy;
- logs redact secret values, and the audit log never stores a secret value or its
  hash;
- capability diagnostics explain denied operations;
- two local app instances do not share loaded code or database state;
- the chosen engine passes the runtime conformance floor — **an `async` handler
  is driven to completion** via the host's microtask loop (the Ibex `ex_hermes_poll`
  mechanism), and the **DB lock is not held across async work** (released per tick,
  held only for the commit). This is the gap that bit Valet, now reframed as a
  boundary requirement rather than an engine property.
- a runaway handler is either terminated by an enforced wall-clock/CPU limit, or the
  capability report marks that limit **advisory/unenforced** for the engine (no
  silent "5s timeout" that does nothing).

## Open Questions

- What isolation primitives does Ibex provide today, and — given Valet shipped no-op
  watchdog stubs — what is the concrete plan for an enforceable wall-clock/CPU limit
  (engine watchdog vs. killable process/isolate vs. the V8 path)? (The async-handlers
  question that used to live here is now answered above: it was an execution-boundary
  problem, not an engine limit, and the Ibex poll-loop is the mechanism Snapback adopts.)
- What is the minimum practical resource-limit set for local development?
- Pooling is sharpened from "can it be made safe for v1?" to "is fresh-per-invocation
  acceptable as the durable default while pooling stays research?" — Valet found no
  safe shared-VM technique on Hermes.
- (Largely answered) Secret handles in TypeScript: a `SecretString`/secret-handle
  type with explicit `expose`, no read-back, no audit-log hashing — confirm the
  exact TS shape.
- Which hosted isolation model, on which engine, is the first non-local target?
  (This is gated on the unbuilt V8 path.)
- How should Cloudflare's runtime model change this security contract?

## Dated alignment: inline-handler evaluator profile (2026-07-27)

LLP 0108's inline v1 does not introduce closure serialization or a module
bundler. Codegen extracts the direct function/arrow AST from the declaration,
admits only parameters, handler-local bindings, and this RFC's existing
isolated-evaluator globals, and rejects sibling/import captures, class syntax,
dynamic import, `eval`, and `Function`. The generated per-operation runtime
module remains subject to the same capability scan, evaluator settlement
rules, size/count limits, and private executable-source custody as legacy
handlers.

Warm reuse retains this RFC's exact posture: host-owned invocation state is
reset and generation-fenced; trusted-local application lexical residue is not
claimed erased. `inline_handler_v1` therefore adds an authoring and admission
profile, not a stronger isolation claim. The existing DK-4 runtime benchmark
inventory covers inline-operation counts 1, 4, 16, and 64 before the capability
graduates from experimental maturity.

## Bounded Ibex evaluation carrier and single-payload invocation (2026-08-12)

The trusted invocation IIFE is fixed source except for one deliberately invalid
raw-newline slot. Rust serializes export, args JSON, auth JSON, mode, action-run
JSON, granted-config JSON, and the exact decimal epoch as one struct, serializes
that JSON once more as one JavaScript string literal, splits the template at the
unique slot, and inserts the literal exactly once. Raw newlines cannot occur in
the serialized string literal, so handler arguments or granted values containing
former `__SNAPBACK_*__` placeholder text cannot become a second substitution
site. Workerd's field-based invocation transport is unchanged. The IIFE still
returns only the authenticated `{"r": ...}` settlement envelope; an untagged
value remains `SNAPBACK_HANDLER_DID_NOT_SETTLE` with no committed writes.

The Ibex C ABI returns eval output as a NUL-terminated allocation without a
length. Snapback now applies `strnlen` with the 8 MiB carrier ceiling plus one
witness byte before it constructs a Rust `String`. Oversize output receives the
typed carrier refusal and is freed without an unbounded Rust copy. An untagged
settlement diagnostic records only `outputLengthBytes` and `outputSha256`; raw
handler output, including an arbitrarily large prefix, never enters diagnostic
details. The native Ibex allocation necessarily exists before this consumer
check, and the owner VM still has no heap ceiling through the current ABI; those
facts remain distinct from both the bounded Rust copy and the enforced 4 MiB
application-result contract.

## Dated amendment: strict host context is armed per VM (2026-08-01)

The M2-era decision to install the Ibex host exactly once per process
(§Invocation Isolation, DK-4 "cache what carries no per-invocation user
state") cached one thing it should not have: the *arming*. `install_host`
publishes the Host globally but also arms a single-use, thread-bound creation
token that the next Hermes constructor claims and zeroes; a constructor that
finds no token silently falls back to a fresh `SecurityMode::Audit` context,
where a denied capability is computed and logged but proceeds. Installing once
per process therefore gave the Enforce-mode context to exactly one VM — the
first on the installing thread — while every later VM, and every VM on every
other thread, ran the Ibex capability gate in Audit mode.

Amended: the Host is still built once per process (clones share its `Arc`
capability manager, so the policy is identical), but `RuntimeGuard::create`
re-arms per construction, so every VM claims its own Enforce-mode context.
Claimed contexts are released when their runtime is destroyed, exactly as the
first VM's always was. The cost is one Host clone and one context insertion
per VM creation, far below the Hermes construction it accompanies — the DK-4
caching rationale is preserved for the expensive half and withdrawn for the
half that was silently weakening the gate.

The effective enforcement surface is unchanged, and was never solely the Ibex
gate: JS ambient denial shadowing, the no-eval constructor, and
`snapback_host_call` as the only host dispatcher all held on every VM (pinned
by `crates/snapback/tests/runtime_qualify_posture_v0.rs`). This amendment restores the
defense-in-depth layer beneath them, and
`runtime::strict_host_context_tests::every_vm_claims_its_own_strict_context`
pins the claim itself — the observable that distinguishes a claimed strict
context from an Audit fallback — including on a thread that never ran the
process's first construction.

## Status

Draft. This RFC should be reviewed before app-authored code is run outside a
trusted local development context. The async-handler/runtime-conformance floor
is ratified for the first trusted local implementation as of 2026-06-26: the
async gap is an execution-boundary property, not an engine limitation; Snapback
targets Ibex and V8, not Boa; and acceptable runtimes must drive async handlers
to completion without holding the storage lock across async work.

Hosted or multi-tenant untrusted execution remains unratified until the chosen
target has an enforceable resource-limit and isolation story.
