# LLP 0009: Code execution security and tenant isolation

**Type:** RFC
**Status:** Draft
**Systems:** Runtime, Security, Storage, Auth, Deployment, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-07-01 (LLP 0032 M2: §Invocation Isolation records the DK-4 decision — warm VM per bundle hash for trusted-local, gated on a proven reset, on the M1 VM-cost evidence in LLP 0035)
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0006, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0014, https://github.com/ccheever/ibex

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
is the threat model, and the canonical local engine cannot enforce a CPU or
wall-clock timeout in-process.** Valet shipped no-op watchdog stubs and was, in its
own words, "unsafe against CPU-exhaustion attackers" on the Hermes/Ibex path; its
isolate-clean V8 path — the one suited to untrusted multi-tenant code — was designed
but never built. This RFC therefore states honestly what each engine can enforce
rather than assuming the runtime boundary is uniform, and treats a real watchdog or
a killable process/isolate as a *prerequisite* for hosting untrusted code, not a
later optimization.

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

Ibex passes this floor (the poll loop exists and releases the lock per tick);
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

## Status

Draft. This RFC should be reviewed before app-authored code is run outside a
trusted local development context. The async-handler/runtime-conformance floor
is ratified for the first trusted local implementation as of 2026-06-26: the
async gap is an execution-boundary property, not an engine limitation; Snapback
targets Ibex and V8, not Boa; and acceptable runtimes must drive async handlers
to completion without holding the storage lock across async work.

Hosted or multi-tenant untrusted execution remains unratified until the chosen
target has an enforceable resource-limit and isolation story.
