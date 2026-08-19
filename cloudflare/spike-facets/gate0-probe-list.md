# Gate 0 isolation probe list — for LLP 0009 reviewer sign-off

Status: **v2, PRE-LEG SIGNED (2026-07-23)** — round-1 REJECT applied in
full, round-2 APPROVE received; the suite-level isolation leg may now run
against this list. Per
[LLP 0087](../../llp/0087-facets-hosted-adoption.plan.md) Gate 0, the
reviewer signs this list **before** the suite-level isolation leg runs on
the candidate topologies, and signs the results after. Review artifacts are
recorded verbatim under `reviews/`.

Revision history:
- v1 (2026-07-23, commit 28498cb0): P1–P8.
- v2 (2026-07-23): REJECT verdict from cross-family round 1
  (`reviews/gate0-probe-list.codex.r1.md`, Codex family, delegated by
  Charlie Cheever). All 8 required changes applied: P2 and the P4 budget
  adopt the reviewer's wording verbatim; P4 expanded to the full two-app
  adversarial leg; P7/P8 completed; new P9–P13; instrument-coverage
  overclaim corrected here and in `README.md`.

Scope note (LLP 0087 §Ratification posture): facet-hosted code is
**operator-supplied trusted code**. These probes verify the *engineering*
containment properties the coordinator contract depends on — not an
untrusted-tenant security boundary, which remains LLP 0009/0047 + Workers
for Platforms territory. Per the reviewer: trusted scope does not waive
capability minimality, cross-invocation/app leakage, queue isolation,
honest resource-limit reporting, or failure containment — those are exactly
what P2, P4, P9, P11, and P12 verify. Where a limit is not enforced for
trusted code, the receipt reports `Missing` honestly (LLP 0009's
enforcement-honesty rule); `Missing` is tolerable for trusted code,
*claiming* enforcement that was not demonstrated is not.

## Topologies under test

- **A — facet family:** coordinator DO hosts handler + action facets.
- **B — loader-only shared services:** handler and action services are
  shared platform Workers loading per-app code via Worker Loader;
  coordinator calls them over service bindings.
- **C — hybrid:** handler as coordinator facet; action as loader-fed shared
  service.
- **Baseline — compiled-in:** today's shape (static module), as latency
  control and P4 contention control — a control, not a waiver.

## Probes

### P1 — Ambient egress denial

App code (handler **and** action roles) attempts global `fetch` to an
external origin. **Pass:** denied with the platform's capability error
(error text/category recorded, not just an HTTP status), and a
network-level observation (harness-side request log or platform egress
log) confirms no bytes left. Matches the `acceptance.egress.mjs`
ambient-denial behavior. Applies: A, B, C.

### P2 — Binding-envelope minimality (reviewer wording, verbatim)

> For every app-code role in topologies A, B, and C, `Reflect.ownKeys(env)`
> is exactly `["HOST"]`, with no symbol keys and no additional
> capability-bearing inherited properties. Direct reads of `LOADER`,
> coordinator/storage bindings, handler/action service bindings,
> registry/artifact bindings, and an injected secret-canary binding return
> `undefined` or a capability-denied error. `HOST` is app- and role-scoped:
> it exposes only the declared host-operation protocol and cannot address
> another app, raw coordinator storage, control-plane operations, arbitrary
> service bindings, or arbitrary outbound URLs. Run the enumeration and
> active-access attempts from both handler and action code.

The canary binding is injected into the loader/service environment
deliberately so the probe fails if any *future* platform secret leaks into
the loaded code's envelope, not only currently known names. Applies: A, B, C.

### P3 — Slow-action non-blocking

A 1.5 s action is in flight; ≥ 20 **concurrently dispatched** queries plus
≥ 1 mutation and ≥ 1 live-push delivery proceed meanwhile. **Pass:**
concurrent query/mutation p95 unaffected (budget: ≤ 100 ms local; the
on-platform budget is fixed in the receipt before the on-platform run).
Verifies the LLP 0040/0049 slow-action property per topology. Applies:
A, B, C.

### P4 — Two-app adversarial leg

Two halves, both required.

**(a) Contention and termination — on-platform authoritative; budget
pre-registered (reviewer wording, verbatim):**

> For CPU-spin and allocation-balloon variants separately, run at least
> five overlapping attack intervals and collect at least 30 app-2 query
> samples per topology. Compare against same-session, same-location app-2
> idle measurements. App 2 passes when its error rate is zero and
> attack-period p95 is no greater than `max(2 × idle p95, idle p95 +
> 100 ms)`. Issue app-1 termination while the adversarial request is still
> active. The request must terminate with the documented
> abort/resource-limit category; a previously acquired stale stub must
> fail with the supplied abort reason; app 2 must remain within the same
> latency/error budget during and after termination. Record the
> compiled-in baseline as a control, not as a waiver.

Local (Miniflare) runs verify only the deterministic termination
semantics; the 2026-07-23 reconnaissance showed local starvation in every
topology including the baseline, so local contention numbers are an
instrument-limitation control in the receipt, never a pass. For B and C's
shared action service the receipt must name the **concrete per-app
kill/invalidation primitive**; if none exists, that topology fails P4 —
"per-app service isolation" is not evidence.

**(b) State, cache, artifact, and binding confusion:** with two apps
loaded: same loader name/content hash requested by two apps with
different bytes (must not alias); app 1 attempting to select app 2's
artifact identifier (must fail with a coded error); global/module/cache
state separation across apps; stale-cache behavior after app 1 updates its
artifact; app 1's `HOST` attempting operations against app 2 (must fail
closed); per-app log and error attribution is unambiguous.

Applies: A, B, C.

### P5 — Storage invariant

Inspect facet/loaded-worker SQLite after a full probe run. **Pass:**
nothing app-data-shaped in facet SQLite — app rows, version counter,
journal, outbox, cron, and subscription state live only in the coordinator
(LLP 0014 door 1). The suite-level leg's expected facet table set is
**empty** for today's handler/action roles; any role-local state a
topology introduces must be enumerated in the receipt. (The recon
harness's `scratch` table is an artifact of the recon app, not license for
the real roles.) Applies: A, C; B when a service uses DO state.

### P6 — Lifecycle and stub semantics

`facets.abort(reason)` then re-`get`; `facets.delete`; calls on stale
stubs; abort *during* an in-flight request. **Pass:** abort halts and
invalidates stubs (calls throw the supplied reason); storage persists
across abort/restart; delete permanently destroys the facet DB; every
failure mode surfaces as a distinguishable error the host maps to a stable
`SNAPBACK_*` code. Applies: A, C (facet mechanics); B analogues via its
kill primitive from P4(a).

### P7 — Cold start with validated eviction

First-request latency after **demonstrably discarding** the loaded
worker/facet (the eviction method must be shown to discard the runtime,
not merely coordinator in-memory state). **Pass:** p95 over ≥ 30 validated
cold samples per topology, same session/location as the compiled-in
baseline, meeting **both** frozen budgets: `candidate p95 ≤ 2× baseline
p95` **and** `candidate p95 − baseline p95 ≤ 250 ms` (LLP 0087's absolute
budget). Applies: A, B, C vs Baseline.

### P8 — Version skew, rollback, and migration

Load v1; while a v1 request is **genuinely in flight**, begin serving v2.
**Pass:** the in-flight v1 request completes on v1; no request observes
mixed versions; rollback to v1 works; the old version is discardable and
its resources released; host-op/schema protocol skew between coordinator
and loaded code fails closed with a coded error; facet-class migration
findings (rename/replace of the loaded DO class) are recorded per LLP
0087's lifecycle item. Applies: A, B, C.

### P9 — Invocation lifecycle and async quiescence

For each role and topology: write module-scope, instance, and global state
in invocation A; observe from invocation B and from app 2 (app-2 leakage =
fail). Start detached promises, timers, and `waitUntil` work; return; prove
the detached work cannot later execute with invocation B's `HOST`/auth
context. Record whether the runtime is fresh, reset, or long-lived —
characterization, not pass/fail (LLP 0009's runtime-policy honesty).
Hibernate/evict, then repeat the checks. Applies: A, B, C.

### P10 — Alarms, hibernation, and PITR in facets

Whether a facet can schedule an alarm at all; alarm wake-up from
hibernation; which bindings app code sees during `alarm()` (must satisfy
P2); interaction of `facets.abort`/`delete` with a pending alarm;
PITR/bookmark behavior of facet SQLite; and **non-interference with the
coordinator's single-alarm dispatcher** (LLP 0014 platform fact: one alarm
per object; LLP 0028's dispatcher must stay sole owner of coordinator
scheduling). Applies: A, C (facet roles); B for its DO state if any.

### P11 — Error boundaries and diagnostics

For each of: synchronous throw, rejected handler promise, detached
rejection, `HOST`-call rejection, malformed result shape, and
loader/module-initialization failure. **Pass:** a distinguishable stable
`SNAPBACK_*` category per class; **no partial coordinator commit** (no
partial rows/version/journal/outbox effects from the failed invocation);
diagnostics are bounded and redacted (no app-code source or secrets in
platform logs beyond policy); the next invocation either succeeds in a
clean runtime or fails per a documented burn/restart policy. Applies:
A, B, C.

### P12 — Per-invocation-class resource honesty

For each invocation class (query/handler, mutation, action, alarm, and
load/module-initialization): deliberately exceed the candidate CPU,
wall-clock, and memory limits and record what actually happens, as a
matrix of `Enforced | Advisory | Missing` — plus **attribution**: which
worker/facet/coordinator is metered for the CPU and memory. Trusted code
may tolerate `Missing`; the receipt may not claim enforcement that was not
demonstrated (LLP 0009 §resource limits). Applies: A, B, C (+ baseline
column for comparison).

### P13 — Scale and retention

Repeated load/dispose of many content hashes with memory measured to a
plateau or documented limit; concurrent facet/loaded-worker count up to
and just beyond the supported limit; largest accepted and first rejected
module/bundle size; at every limit, failure is recoverable and coded and
does not disturb the other app; abort/delete/version-discard demonstrably
release runtime/cache resources. Applies: A, B, C.

## Instruments — honest coverage statement

- `spike.mjs` — micro-spike. Reconnaissance shapes of P1/P5/P6 for a
  single facet. Discharges nothing.
- `harness.mjs` — per-topology reconnaissance. It implements **partial,
  reconnaissance-grade shapes** of P1 (handler route only, status-code
  check only), P2 (`Object.keys` enumeration only — no canaries, no active
  access attempts), P3 (sequential queries, no mutation/live-push), P4
  (contention timing + post-hoc termination only), P5 (recon app's own
  table), P7 (10 restart samples, warm-only for topology B), and P8
  (sequential version switch only). It does **not** implement P6, P9–P13,
  or any probe's full criterion, and its output is never a probe pass —
  recon results inform instrument design and nothing else.
- The suite-level leg (post-sign-off) reuses the existing acceptance
  behaviors (local-suite manifest checks, `acceptance.egress.mjs`) with
  app code hosted under each candidate topology, extended to the full
  criteria above; on-platform legs cover P4(a), P7, P10, P12, and P13
  where local runs are non-authoritative.

## Reviewer sign-off

- [x] **Pre-leg:** probe list approved (probes sufficient and correctly
      scoped for the trusted-code posture; budgets pre-registered) —
      reviewer: **Codex (codex-cli 0.145.0, OpenAI family), cross-family
      review delegated by Charlie Cheever**; date: **2026-07-23**;
      artifacts: `reviews/gate0-probe-list.codex.r1.md` (REJECT, 8 required
      changes — all applied in v2), `reviews/gate0-probe-list.codex.r2.md`
      (APPROVE, all 8 verified ADDRESSED, no required changes).
- [ ] **Post-leg:** results reviewed against this list — reviewer:
      ____________, date: ____________

Amendments after pre-leg sign-off require reviewer re-approval; record
deltas here with dates.
