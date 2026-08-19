# Gate 0 probe list — cross-family review, round 2

**Reviewer:** Codex (codex-cli 0.145.0, OpenAI model family), sandbox read-only, repo checkout
**Delegated by:** Charlie Cheever, 2026-07-23
**Date:** 2026-07-23
**Subject:** cloudflare/spike-facets/gate0-probe-list.md v2 (post round-1 revision)
**Verdict:** APPROVE — all 8 round-1 required changes verified ADDRESSED; no required changes; no advisory
**Capture note:** full raw exec transcript below (includes CLI chrome).

---

Reading additional input from stdin...
OpenAI Codex v0.145.0
--------
workdir: /Users/ccheever/projects/snapback
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: read-only
reasoning effort: medium
reasoning summaries: none
session id: 019f8e9e-7f5a-7f80-a424-d5b731d5f63b
--------
user
You are the same LLP 0009 cross-family reviewer role that produced the round-1 REJECT recorded at cloudflare/spike-facets/reviews/gate0-probe-list.codex.r1.md. The probe list has been revised to v2. Round-2 task: verify the revision against round 1's 8 REQUIRED-CHANGES, one by one.

Read: (1) cloudflare/spike-facets/reviews/gate0-probe-list.codex.r1.md — your round-1 findings; (2) cloudflare/spike-facets/gate0-probe-list.md — the v2 under review; (3) cloudflare/spike-facets/README.md — the corrected instrument-coverage claims; (4) llp/0087-facets-hosted-adoption.plan.md Gate 0 section and llp/0009-code-execution-security.rfc.md as needed to check the new probes' fidelity.

For EACH of the 8 required changes: state ADDRESSED / PARTIALLY ADDRESSED / NOT ADDRESSED with a one-line justification citing the v2 text. Then judge overall pre-leg signability: is v2 sufficient for the suite-level isolation leg to run against, with budgets pre-registered? Do not re-open new scope beyond round 1 unless you find a genuine defect introduced by the revision itself.

VERDICT FORMAT (mandatory, last lines):
VERDICT: APPROVE | APPROVE-WITH-CHANGES | REJECT
REQUIRED-CHANGES: <numbered list or 'none'>
ADVISORY: <numbered list or 'none'>
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
I’ll run this as the LLP 0009 round-2 review, using the project’s LLP review instructions and limiting findings to the eight prior requirements plus genuine v2 regressions.
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,240p' /Users/ccheever/projects/snapback/vendor/llp/skills/llp-review/SKILL.md" in /Users/ccheever/projects/snapback
 succeeded in 0ms:
---
name: llp-review
description: Run the LLP 0005 review loop for an LLP document — orchestrate reviews from other model families, write one provenance-tracked artifact per review actually received under llp/reviews/, and never fabricate a review or accept on the author's behalf. Review intensity scales with stakes; the author decides when it's enough.
source: ccheever/llp@v0.2.0
---

# llp-review

<!-- @ref https://github.com/ccheever/llp/blob/v0.2.0/llp/0005-rfc-process.guide.md#honesty-rules-always-in-force — the rules this enforces -->
<!-- @ref https://github.com/ccheever/llp/blob/v0.2.0/llp/0005-rfc-process.guide.md#review-artifacts — artifact + provenance header format -->

Review an LLP the way LLP 0005 prescribes: as much critical review as the stakes warrant, captured honestly. Different model families catch different blind spots, so a single session cannot stand in for a multi-family loop — this skill makes the honest path the only path.

Invoke as `/llp-review <number | slug | filename>`. Bare: list `Draft`/`Review` LLPs and ask.

## Trigger

A document enters `Review` (the author's opt-in to a formal loop), or review is explicitly requested. Otherwise *offer* review scaled to stakes (LLP 0005 §How much review to buy) — don't impose it.

## Invariants

- MUST NOT fabricate a review, record one that wasn't actually provided, or mark a loop complete by intent.
- MUST NOT count the session that authored the draft as an independent reviewer — if this session wrote the document, say so and gather reviews elsewhere.
- MUST NOT change `**Status:**` or accept/reject — propose transitions; the author decides.
- MUST write one artifact per review actually received: `llp/reviews/NNNN-slug.<family>.md`, opening with the LLP 0005 provenance header (family · provider/runtime · date · redacted? · method). Re-reviews by the same family get a dated section, never an overwrite.
- MUST NOT send content to an external provider without an explicit human action; redact secrets by default.

## Workflow

> **Recipe (advisory)** — locate and read the document fully. If this session can act as one independent family reviewer (and didn't author the draft), write that review using the LLP 0005 standard prompt. For each further input the author wants — pasted manual review, sub-agent on a different family, CLI runner — prepare the prompt and **stop until it is actually provided**. Structure each review body: overall assessment · strengths (cite sections) · concerns (with severity and what would resolve each) · suggestions · open questions · recommended next step.

## Artifact

Review files under `llp/reviews/` with provenance headers, plus a summary of the feedback and a *proposed* next step (revise and stay `Draft` / gather another family / ready for the author to accept).

## Hand-offs

- Feedback that amounts to a new design direction → a fresh LLP via `llp-create`.
- The author applies status changes; this skill never does.

hook: PostToolUse
hook: PostToolUse Completed
codex
The LLP review skill’s honesty constraints apply: I’m treating this as the requested Codex-family re-review, not changing document status or fabricating additional reviewers. I’m now mapping each round-1 requirement directly to v2 evidence.
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "wc -l cloudflare/spike-facets/reviews/gate0-probe-list.codex.r1.md cloudflare/spike-facets/gate0-probe-list.md cloudflare/spike-facets/README.md llp/0087-facets-hosted-adoption.plan.md llp/0009-code-execution-security.rfc.md && sed -n '1,260p' cloudflare/spike-facets/reviews/gate0-probe-list.codex.r1.md && sed -n '1,360p' cloudflare/spike-facets/gate0-probe-list.md" in /Users/ccheever/projects/snapback
 succeeded in 0ms:
      92 cloudflare/spike-facets/reviews/gate0-probe-list.codex.r1.md
     238 cloudflare/spike-facets/gate0-probe-list.md
      83 cloudflare/spike-facets/README.md
     537 llp/0087-facets-hosted-adoption.plan.md
    1079 llp/0009-code-execution-security.rfc.md
    2029 total
# Gate 0 probe list — cross-family review, round 1

**Reviewer:** Codex (codex-cli 0.145.0, OpenAI model family), sandbox read-only, repo checkout
**Delegated by:** Charlie Cheever, 2026-07-23 ("delegate to a cross family reviewer")
**Date:** 2026-07-23
**Subject:** cloudflare/spike-facets/gate0-probe-list.md as of commit 28498cb0
**Verdict:** REJECT (8 required changes)
**Capture note:** transcript captured from the exec run's tail; any leading
preamble before "The trusted-code scope note is correct" was elided by the
capture, not by editing. Verdict and required-changes block are complete.

---

The trusted-code scope note is correct: these probes need not establish an untrusted-tenant sandbox. But "trusted" does not waive capability minimality, accidental cross-invocation/app leakage, queue isolation, honest resource-limit reporting, or failure containment.

Blocking gaps:

1. Invocation lifecycle and async quiescence are missing. LLP 0009 requires the hosted runtime policy to characterize global/module state, timers, pending async work, and resource limits (LLP 0009:302). Add a probe that, for every handler/action topology:

   - writes module, instance, and global state in invocation A and checks invocation B and app 2;
   - starts detached promises/timers/`waitUntil` work, returns, and proves it cannot execute later with invocation B's `HOST`/auth context;
   - records whether the runtime is fresh, reset, or long-lived rather than treating persistence as pass/fail;
   - hibernates/evicts and repeats the checks.

2. Facet alarm and hibernation behavior is missing even though LLP 0087 expressly requires alarms, hibernation, and PITR characterization (LLP 0087:210). Add an alarm probe covering scheduling, hibernation wake-up, app-visible bindings during `alarm()`, abort/delete interaction with pending alarms, PITR/bookmark behavior, and noninterference with the coordinator's single-alarm dispatcher.

3. Error-boundary behavior is missing. P6 covers only lifecycle errors. Add synchronous throw, rejected handler promise, detached rejection, `HOST` rejection, malformed result, and loader/module-initialization failure. Require:

   - a distinguishable stable `SNAPBACK_*` category;
   - no partial coordinator rows/version/journal/outbox commit;
   - bounded and redacted diagnostics;
   - a subsequent invocation either succeeds in a clean runtime or fails according to a documented burn/restart policy.

4. Per-invocation-class resource honesty is missing. P4 measures noisy-neighbor behavior but does not state what CPU, wall-clock, or memory limit is actually enforced for handler/query, mutation, action, alarm, and load/module-initialization work. Add a matrix that deliberately exceeds each limit and records `Enforced`, `Advisory`, or `Missing`, plus which worker/facet/coordinator receives the metered CPU and memory. Trusted code may tolerate `Missing`; it may not report enforcement that was not demonstrated. That is the load-bearing rule in LLP 0009 (resource limits, LLP 0009:937).

5. P4 covers only contention, not the rest of LLP 0087's required two-app adversarial leg. Add tests for:

   - same loader name/content hash requested by two apps with different bytes;
   - attempts to select another app's artifact identifier;
   - global/module/cache state separation;
   - stale-cache behavior after one app updates;
   - app 1's `HOST` attempting operations against app 2;
   - per-app logs and error attribution.

   LLP 0087 explicitly names loader-name collisions, artifact/cache confusion, cross-app binding attempts, and global-state separation (LLP 0087:198); none appears in P4.

6. Scale and retention limits are missing. Add:

   - repeated loading and disposal of many content hashes, with memory measured until it plateaus or a documented limit is reached;
   - concurrent facet/loaded-worker creation up to and just beyond the supported limit;
   - largest accepted and first rejected module/bundle sizes;
   - recoverable, coded failure at limits without disturbing another app;
   - evidence that abort/delete/version discard actually releases the intended runtime/cache resources.

7. The lifecycle/version probes are incomplete. P8 must include a genuinely in-flight v1 request while v2 begins serving, plus rollback and old-version discard. LLP 0087 also requires host-op/schema protocol skew and facet-class migration findings, not merely sequential `/version` responses.

8. P7 omits the plan's absolute cold-start limit. Its criterion must be both `candidate p95 <= 2x baseline p95` and `candidate p95 - baseline p95 <= 250 ms`, as specified by LLP 0087 (line 280).

The harness materially overclaims that it implements P1-P8 (probe list line 43):

- P1 tests only the handler route, reduces all failures to status 502, and neither checks the capability code nor proves that no bytes left.
- P2 tests only `Object.keys` on the handler and currently expects an empty envelope.
- P3 dispatches its 20 queries sequentially and dispatches no mutation or live push (harness.mjs:314).
- P4 awaits the CPU spin before termination, tests termination with the balloon instead, has no topology-B termination result, does not test stale stubs or the abort reason, and its `OR app2 succeeded` expression can report termination success even when the balloon completed normally (harness.mjs:323).
- P5 creates and permits `scratch`, while the signed criterion says the expected handler-role table set is empty.
- P6 is not implemented.
- P7 takes ten restart/warm samples, not thirty validated cold starts; topology B is explicitly warm.
- P8 is sequential and has no in-flight v1 request (harness.mjs:307).

Reconnaissance need not meet the official receipt standard, but then the document must stop saying this harness implements P1-P8 and stop describing its partial results as probe passes.

Q2. The local/on-platform split is acceptable in principle. A local runtime that starves app 2 even in the compiled-in baseline is not a valid instrument for production scheduler isolation. It is reasonable to use local runs only for deterministic lifecycle/termination semantics.

P4 is nevertheless not signable yet because "within budget" has no pre-registered budget. LLP 0087 requires the threshold or reviewer judgment to be fixed before the leg (lines 202-204).

I would require this wording:

> For CPU-spin and allocation-balloon variants separately, run at least five overlapping attack intervals and collect at least 30 app-2 query samples per topology. Compare against same-session, same-location app-2 idle measurements. App 2 passes when its error rate is zero and attack-period p95 is no greater than `max(2 x idle p95, idle p95 + 100 ms)`. Issue app-1 termination while the adversarial request is still active. The request must terminate with the documented abort/resource-limit category; a previously acquired stale stub must fail with the supplied abort reason; app 2 must remain within the same latency/error budget during and after termination. Record the compiled-in baseline as a control, not as a waiver.

For B and C's shared action service, the receipt must identify the concrete per-app kill/invalidation primitive. If none exists, that topology fails P4; "per-app service isolation" is not evidence.

Q3. Yes. "Intended host seam binding(s)" is too elastic and directly contradicts LLP 0087's exact-one-binding requirement (lines 189-191).

Use this criterion:

> For every app-code role in topologies A, B, and C, `Reflect.ownKeys(env)` is exactly `["HOST"]`, with no symbol keys and no additional capability-bearing inherited properties. Direct reads of `LOADER`, coordinator/storage bindings, handler/action service bindings, registry/artifact bindings, and an injected secret-canary binding return `undefined` or a capability-denied error. `HOST` is app- and role-scoped: it exposes only the declared host-operation protocol and cannot address another app, raw coordinator storage, control-plane operations, arbitrary service bindings, or arbitrary outbound URLs. Run the enumeration and active-access attempts from both handler and action code.

The injected canary matters: checking only currently known binding names will miss a future platform secret accidentally added to the loader/service environment.

VERDICT: REJECT
REQUIRED-CHANGES: 1. Add invocation-state, detached-async, timer, hibernation, and alarm probes. 2. Add exception propagation, no-partial-commit, and diagnostic-redaction probes. 3. Add per-invocation-class CPU/wall/memory enforcement-and-attribution reporting. 4. Expand the two-app leg to cover state/cache/artifact/binding confusion and pre-register P4's on-platform budget and termination procedure. 5. Add repeated-load memory retention, concurrent facet/worker count, and module-size boundary probes. 6. Tighten P2 to exactly one scoped `HOST` binding with active forbidden-binding canaries. 7. Complete P7/P8 and add P7's 250 ms absolute budget. 8. Correct the harness or remove its claim to implement and pass P1-P8.
ADVISORY: 1. Keep the local P4 contention result as an instrument-limitation control in the receipt. 2. Report trusted-code `Missing` limits honestly rather than converting every missing limit into a topology failure.
# Gate 0 isolation probe list — for LLP 0009 reviewer sign-off

Status: **DRAFT v2 — revised per cross-family review round 1; awaiting
round-2 verdict.** Per
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

- [ ] **Pre-leg:** probe list approved (probes sufficient and correctly
      scoped for the trusted-code posture; budgets pre-registered) —
      reviewer: ____________, date: ____________
- [ ] **Post-leg:** results reviewed against this list — reviewer:
      ____________, date: ____________

Amendments after pre-leg sign-off require reviewer re-approval; record
deltas here with dates. Review artifacts: `reviews/gate0-probe-list.codex.r1.md`
(round 1, REJECT — all required changes applied in v2).

hook: PostToolUse
hook: PostToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,180p' cloudflare/spike-facets/README.md
rg -n '"'^## |''^### |Gate 0|suite-level|two-app|cold|alarm|hibern|PITR|resource|lifecycle|version|migration|probe|250'"' llp/0087-facets-hosted-adoption.plan.md
rg -n '"'^## |''^### |runtime policy|global|timer|pending async|resource limit|resource-limit|Resource|module state|wall-clock|memory|CPU|diagnostic|redact|error boundary|alarm|hibernate'"' llp/0009-code-execution-security.rfc.md" in /Users/ccheever/projects/snapback
 succeeded in 0ms:
# LLP 0087 Phase 0 micro-spike — Worker Loader + DO Facets under Miniflare

First hands-on evidence for [LLP 0087](../../llp/0087-facets-hosted-adoption.plan.md)
Phase 0, run 2026-07-23 on the repo's pinned toolchain (Node 24.18.0,
miniflare 4.20260701.0, workerd 1.20260707.1).

Run it:

```
node cloudflare/spike-facets/spike.mjs   # pinned Node per .node-version
```

## What it demonstrates

A supervisor Durable Object loads app code supplied **at runtime as a
string** (via a `workerLoaders` binding), starts it as a named **facet**
(`ctx.facets.get`), and exercises it end to end.

Result: all probes pass locally.

| Probe | Result |
| --- | --- |
| Worker Loader binding in Miniflare (`workerLoaders: { LOADER: {} }`) | works |
| Facet started from `worker.getDurableObjectClass(...)` | works |
| Facet has its own SQLite (`ctx.storage.sql`) | works — facet sees only `notes`, supervisor only `supervisor_meta` |
| `facets.abort` → restart via `get` | storage persists across abort/restart |
| `facets.delete` | database permanently destroyed (fresh empty DB on restart) |
| `globalOutbound: null` egress denial inside facet | denied with a capability-style error ("must use capabilities (such as bindings in 'env')") |

## Why this matters

- **The plan's biggest kill-risk is cleared at micro-spike level:** LLP 0087
  names Miniflare parity a hard requirement ("no Miniflare support, no
  adoption") because the whole local proof runs on Miniflare. Both
  primitives work under the exact pinned versions the proof uses.
- **The egress model composes with Snapback's.** `globalOutbound: null`
  yields deny-by-default with capability-shaped errors — the same posture
  as the LLP 0047 action-egress gating.

## The per-topology reconnaissance harness (`harness.mjs`)

```
node cloudflare/spike-facets/harness.mjs   # pinned Node; ~1 min
```

Runs **reconnaissance-grade partial shapes** of probes P1/P2/P3/P4/P5/P7/P8
from `gate0-probe-list.md` (see that file's "Instruments — honest coverage
statement" for exactly what each shape omits; P6 and P9–P13 are not
implemented) against topologies A (facet family), B (loader-fed shared
services), C (hybrid), and the compiled-in baseline. It emits
reconnaissance JSON — explicitly **not** the Gate 0 receipt, and its green
results are instrument validation, never probe passes.

Reconnaissance results (2026-07-23, Node 24.18.0 / miniflare 4.20260706 /
workerd 1.20260707):

- **Recon shapes of P1 egress denial, P2 envelope enumeration, P3
  slow-action non-blocking (query p95 ≈ 4–7 ms during a 1.5 s action), P5
  storage inspection, and P8 sequential version switch: green in all three
  topologies.** These are instrument-validation results, not probe passes
  — the full criteria run post-sign-off.
- **P4 adversarial: not locally answerable.** App 2 starves during app 1's
  CPU spin in every topology *including the baseline* — local workerd does
  not exhibit production isolate scheduling, so P4's contention half is
  strictly an on-platform question. Termination semantics (abort while
  misbehaving) do verify locally.
- **P7:** facet abort/restart costs tens of ms locally (A ≈ 41 ms p95,
  C ≈ 5 ms) vs warm p50 ≈ 2–5 ms; true cold-start comparison needs the
  on-platform run with validated eviction.

## What this does NOT establish (open for Gate 0)

- LLP 0009 isolation review (what the isolate boundary actually guarantees;
  CPU/memory attribution between supervisor and facet; whether the
  coordinator/action-handler service split survives colocation).
- Behavior on the **real** platform: cold-start delta, hibernation
  interaction, alarms-per-facet, PITR-per-facet, and measured billing
  (pricing page: billed since 2026-05-26 — $0.002/dynamic-worker/day beyond
  1,000/month, standard request/CPU rates; paid plan only).
- Facet class versioning/migration semantics under real deploys.
- Scale behavior (many facets per supervisor; large modules).

Findings roll up to LLP 0087 Gate 0 and, on decision, into LLP 0014.
8:**Revised:** 2026-07-23 (round-1 multi-family review: Gate 0 restated as a checklist; Miniflare sequencing pinned; LLP 0014 storage invariant pinned across topologies; authority boundaries corrected; Gate 2 split into entry/exit; artifact-security workstream added; concurrent spike progress note integrated. Round-2: trusted-code posture pinned; Gate 0 receipt named and adversarial two-app leg added; Gate 1 remote runners corrected; Phase 1 fixture-only artifact store; Phase 2 prerequisites extended to LLP 0060/0019 and fallback repointed off the handler op table; Gate 2 entry made conjunctive)
11:## Summary
25:isolation adequacy, per-facet storage semantics, economics, lifecycle
38:- **Door 1 — rows live with the version authority — is not touched.** All
39:  topology candidates in this plan keep app rows, the version counter, the
52:  Gate 0 evidence supports re-ratifying or reaffirming it. Adoption
63:  and is not claimed here; if Gate 0 evidence suggests facets could
67:## Motivation
92:## Target architecture (end state, shape to be chosen at Gate 0)
102:  role-local state; the coordinator remains the version authority and
113:  topology B is not a legitimate end state either — Gate 0's adversarial
119:App code becomes a stored, versioned artifact (content-hash identity,
125:lifecycle).
127:## Phases and gates
138:### Phase 0 — truth and spike (now)
144:> workerd 1.20260707.1 on Node 24.18.0 — recorded as resolved versions,
147:> SQLite isolation, documented abort/delete lifecycle behavior, and
153:> Gate 2. Still open for Gate 0: the LLP 0009 isolation review, real-platform
154:> measurements (cold start, hibernation, alarms/PITR per facet, metered
155:> billing), and facet class migration semantics.
157:> **Progress note (2026-07-23, later same day):** the Gate 0 instruments
158:> exist — `cloudflare/spike-facets/gate0-probe-list.md` (P1–P8, awaiting
167:> pass/fail is on-platform only (probe list updated accordingly). Next
168:> sequential step remains the reviewer sign-off, then the suite-level
183:   app covers the base legs (isolation, storage, economics, lifecycle);
194:     ([LLP 0047](./0047-hosted-execution-limits.rfc.md)-adjacent probes in
198:     open item); and a **two-app adversarial leg** — two apps loaded
201:     cross-app binding attempts, and noisy-neighbor resource contention
202:     — the contention probe's pass rule (a threshold, or a judgment
203:     delegated to the LLP 0009 reviewer's pre-signed probe list) is fixed
210:   - **Storage semantics per facet:** SQLite limits, PITR/bookmarks,
211:     alarms, and hibernation for the facet's *role-local* state (app data
214:     version+rows+journal commit, the single-alarm dispatcher, PITR
216:   - **Economics:** cold-start delta from runtime loading; how facet
220:   - **Lifecycle:** facet class versioning against the `exports`
221:     migration model and its no-gradual-deploy constraint; code-update
223:     app-artifact versions coexisting with the coordinator's schema and
224:     host-op protocol versions during rollback; the DO class/state
228:     script-transfer migration vs. export/import through the journal,
237:     Gate 0 still requires it demonstrated on the suite harness itself,
240:**Gate 0 (go/reshape/kill)** — a checklist, evaluated per topology, its
244:(lockfile-resolved Node/Miniflare/workerd versions, compatibility date,
246:per-probe results, latency and cost numbers against the budgets below,
247:lifecycle findings, and an enumerated outcome `pass | reshape | kill |
251:1. *Isolation:* the ambient-denial and slow-action-non-blocking probes
255:   plus the two-app adversarial leg above; the binding envelope is
257:   off on this probe list *before* the spike's isolation leg runs and on
259:   (`cloudflare/spike-facets/`) is pre-leg reconnaissance: its probes
260:   inform the probe list but do not discharge (or contaminate) this
261:   criterion — the reviewer-signed list still precedes the suite-level
274:   LLP 0014, not a gate-time re-pin):* cold start defined as
281:   absolute delta ≤ 250 ms. Cost measured over one calendar UTC billing
292:   committed path passes Gate 0 only; **Phase 1 cannot start, and Gate 1
300:outside budget → kill with findings recorded; lifecycle/class-migration
304:### Phase 1 — dual-track profile
325:  single-sourcing, not artifact versioning; the artifact registry owns
326:  app-code versions). Note the identity-model inversion:
361:### Phase 2 — apps as data
364:not own hosted control planes, tenants, or project lifecycle, so the
384:- App registry: per-app artifact hashes and versions in the platform
398:  [LLP 0018](./0018-app-instance-boundaries.rfc.md) two-app validation
399:  matrix runs on the facets profile — code/schema isolation, version
401:  reset/seed/import/export, and per-app resource accounting — plus
408:  0's lifecycle findings;
409:- operational story: per-facet PITR/bookmarks, observability, and the
410:  resource-limit and isolation posture per LLP 0018 (0018 has no abuse
414:**Gate 2 (entry — before any live migration), all conjunctive:** the
417:and cannot authorize live migration (it exists only so Phase 2
418:development is not blocked on CC-1's review); live migration requires
421:admission/provenance/anti-rollback tests passing; the LLP 0018 two-app
423:enforced and demonstrated; PITR/observability operational; migration
438:diagnostics) and error rates within the pre-migration baseline, captured
439:as 14 days of All Aboard meters recorded in the Gate 0 comparison
440:artifact's format before migration — plus one deliberate, successful
442:Aboard's) within the Gate 0 budget.
444:### Phase 3 — full adoption and retirement
452:compatibility dates / runtime versions — without regression. (An actual
456:## Risks and mitigations
475:  Mitigation: topology B/C exist precisely for this; the Gate 0 isolation
476:  checklist (slow-action-non-blocking probe, LLP 0009 sign-off) is a hard
484:  before, not after, migration.
486:## Non-goals
494:## Open questions
496:1. Topology A, B, or C — Gate 0's evidence-driven output. The author's
499:   the Gate 0 write-up in LLP 0014 should say what evidence confirmed or
503:   amount to GA? (Gate 0 criterion 4 and Gate 2 entry both turn on the
514:   0086 open question 2; needs LLP 0009 review capacity — Gate 0
519:## Status
534:can start without them, but Gate 0 cannot complete. The Phase 0 spike
8:**Revised:** 2026-07-18 (handler bundle identity is closed at runtime: Snapback opts into a no-eval Ibex constructor, verifies the linked Hermes latch export before enabling it, Hermes patch 0010 closes the cached `Function("return this")` exception, both engines prove Function-family compilation unavailable before application evaluation, egress denies eval/WebAssembly while retaining fetch, and codegen's structural diagnostics are AST-backed defense in depth); 2026-07-18 (Promise completion authentication rejects Proxy-spoofed receivers and direct constructor reentry through a closure-private engine brand, enrolls rejection state before mutable public bookkeeping, derives canonical reaction snapshots from lexical arguments, binds them to the effective source only from the trusted initial handle path after alias traversal, gives adopters independent generations, multiplexes isolated generic and strict downstream observers, and defers generic reporting to a captured host task so authenticated reactions finish before classification); 2026-07-18 (Hermes action authority is bound at Promise reaction registration by a private one-shot scheduler token; ordinary enqueues never inherit ambient parent authority, while Promise's private factory may preserve only an authenticated real active scheduler across a no-frame internal adoption hop, never a sentinel, and any live user frame wins)
9:**Revised:** 2026-07-17 (Hermes patch 0009 replaces handler-reachable rejection assertions with a required one-shot engine observer: closure-private rejection generations are reported at reject time and completed only after the matching reaction executes or propagates and settles its child; native await, adoption, and combinators are covered, `_B`/`_C` are inert, and stale artifacts fail bootstrap); 2026-07-17 (Linux Hermes portability and adversarial closure: every harness observation child is explicitly guarded; `_C` records provisionally; both engines reject non-canonical Promise constructor paths before `then`, preventing decoy and no-op child capabilities; canonical Hermes handling requires a running sealed reaction; typed host branding and settlement diagnostic access use captured and guarded primitives); 2026-07-17 (Hermes harness-owned handler and settlement promises now receive an explicit sealed mediated reaction before native `await`, preserving handled typed host failures across engine hook-order differences without trusting reachable `_B` calls; the bootstrap also pins the captured `Function.prototype.call` used inside Ibex's `then` wrapper so selective intrinsic poisoning cannot blind the detached-rejection ledger and commit buffered writes); 2026-07-13 (audit blockers: Hermes preserves native Promise constructor identity but turns every handler-reachable then/promise `_B`/`_C` path into sealed state-validating mediators; Workerd settlement and detached-call quiescence share one invocation deadline, which aborts pending HOST fetches and fails closed); 2026-07-13 (whole-codebase security follow-up: the V8 harness now consumes trusted intrinsics exactly once before application evaluation, keeps its destructive rejection drain in the server closure, uses prototype-free Promise-channel records, and pins Response thenability and Promise species; local workerd uses independent invoke/host/response capabilities, authenticates response headers before bounded body reads, and emits only bounded, path/secret-sanitized stderr tails); 2026-07-12 (ENG-24559: settlement serialization and rejection inspection now use captured, non-destructive control-plane primitives and burn rejected warm VMs; ENG-24564: the workerd transport uses private materialization, authenticated local seams, and bounded reads; ENG-24340 final review follow-up: detached action lock acquisition is deadline/abandon-aware and the independent gate spans only final SQLite commit, never handler/plan/fan-out work; ENG-24351: codegen definition modules now cross an AST-resolved, permission-denied evaluation boundary rather than relying on ambient-token rejection; canonical evaluated values join artifact identity; ENG-24339: trusted invoke/settle helpers install before application source, are sealed and lexically linked, Ibex captures its original host transport, and action DB reads are rejected at the Rust host boundary); 2026-07-07 (DK-5 re-decided — triggers 1–2 fired with LLP 0040/LLP 0047 starting the same day; build the twin now as LLP 0048's workerd-hosted runner behind the RPC-shaped handler seam, no native embed; the enduring Hermes-local engine posture recorded — device parity with Exact, capability security by construction, footprint, spinup; ratified by Charlie in-session, applied by Claude); 2026-07-07 (ENG-23361: an unhandled rejection in a detached promise chain now fails the invocation instead of committing its partial work as success — the ctx bootstrap installs a rejection ledger on the vendored then/promise hook slots and the host sweeps it after every successful eval, `SNAPBACK_HANDLER_UNHANDLED_REJECTION`, nothing committed; §Invocation Isolation Obligation 3 updated); 2026-07-07 (ENG-23324: the DK-5 busy-loop rationale records the detached-action posture — actions run off the global write mutex on a watchdogged thread with per-host-call lock reacquisition, `action_wall_clock_timeout` now reports Enforced while query/mutation `wall_clock_timeout`/`cpu_budget` stay honestly Missing); 2026-07-06 (settlement is enforced, not assumed — ENG-23430: the invoke IIFE resolves to a tagged `{"r": …}` completion envelope and an untagged eval output is a failed invocation, `SNAPBACK_HANDLER_DID_NOT_SETTLE`, with no committed writes; §runtime conformance contract and §Invocation Isolation Obligation 3 updated); 2026-07-02 (§Decision DK-5 added — V8 conformance twin deferred with four named revisit triggers, LLP 0032 X2; earlier same day: §Secrets: the product layer above this floor — declared config, store seam, wizard, acquisition — is drafted as LLP 0036, which inherits this section's rules. Same day, LLP 0032 M2/DK-4 follow-through: §Invocation Isolation gains the as-built warm-VM design — pool keyed by module source, per-invocation baseline-restore reset, fail-closed burn, honest module-state limits; then hardened after adversarial review — an invocation-epoch stale-continuation guard closes cross-invocation context injection, the reset root-set broadened to iterator/generator prototypes and all constructors, a pool generation counter closes the read-lane check-in race; the 2026-07-01 revision recorded the decision itself)
12:## Summary
29:CPU/wall-clock budget for every invocation class.** Valet shipped no-op watchdog
30:stubs and was, in its own words, "unsafe against CPU-exhaustion attackers" on its
32:Action and nested Mutation VMs, asynchronously breaks CPU-bound JavaScript, and
40:## Threat Model
56:## Security Goals
67:## Hosted authentication edge
82:## Runtime Boundary
108:timers, returning the count executed — and the host's `drive_event_loop`
127:lock per tick, but when no timer or pending host work can advance a
141:0041/0048]`): V8 (`deno_core`) for self-hosted/cloud because of real CPU enforcement
143:untrusted code on Hermes is currently not safe against CPU-exhaustion attacks." The
149:### Decision DK-5 — V8 conformance twin timing (2026-07-02)
162:  `fetch`/timers/`Date.now`/`Math.random`) and dynamic-source syntax
175:  process while holding the global lock; after L6/L7 it cost one
181:  mutex for just that call — under a coarse wall-clock watchdog
190:  timeout stand (actions are not transactions, LLP 0028). CPU-bound outer-action
195:  §Resource Limits, with the capability report
214:4. the missing wall-clock/CPU enforcement becomes user-facing on the local
227:global-strip at module init, `ctx`-only powers, the tagged completion
288:- structured logging with redaction;
302:## Invocation Isolation
307:- global JavaScript state is cleared or isolated between invocations;
309:- timers and pending async work cannot outlive the invocation;
310:- memory limits and CPU limits are enforced;
319:rebound globals" was judged the cheapest but most fragile option — so pooling became
325:### Decision DK-4 — VM lifecycle for the trusted-local target (2026-07-01)
356:  proof obligations 1 (global state cleared/isolated) and 3 (no timers/async
358:  a warm VM that leaks a global between two invocations of the same app is a
366:  Requirements: per-invocation global state must not leak under the chosen
373:### DK-4 as-built — the warm VM pool and its per-invocation reset (2026-07-02)
384:enabled) timers and `fetch`; pooling them buys little and risks much, and
426:`require`, `fetch`, timers, and `WebSocket`, but does *not* deny the engine's
456:symbol keys) for: `globalThis`; the dispatch table `__snapbackHandlers` (one
466:host-provided globals (`console`/`crypto`/`TextEncoder`/`TextDecoder`), and —
470:prototypes are not named globals, but a poisoned `%ArrayIteratorPrototype%.next`
483:its methods) is captured at install time, so a handler overwriting the global
484:copies cannot blind the sweep — and the overwritten globals themselves get
490:resolver closing over it) in **module scope**, where no `globalThis` sweep can
536:transport before application code can wrap the global and observe an epoch.
543:regular-expression primitives, and reads application-controlled diagnostic
580:fails bootstrap, and later replacement of the public timer function cannot
582:compatibility diagnostic, not a hostile-code security boundary: application
583:code can intentionally cancel guessed public timer IDs, prevent the event, or
658:Ibex/workerd twin probes pin frozen-global, accessor, wrapper-interception,
663:error, thrown sweep error (e.g. a frozen `globalThis` making a delete or
672:- *Obligation 1 (global state cleared/isolated): met for the swept set —
673:  `globalThis` own properties, the dispatch table one level deep, and the
682:  handler persists across invocations on the warm path: no `globalThis` sweep
690:  module state *may* persist across invocations and code must rely on neither
692:  freshness of module state was already unportable to any pooled target;
699:- *Obligation 3 (timers/pending async cannot outlive the invocation): met,
701:  `setInterval` are denied as non-configurable ambient globals for
703:  timers) never pool. Microtasks: `ex_hermes_eval` drains the microtask queue
705:  no timer or host work can advance it further, returns the still-pending
727:  global name is necessarily knowable to handler code, so calling it early
756:  swept from `globalThis`) and
762:  through Rust, not VM globals — and the sweep removes any global residue.
763:  Per-user data can enter module state only if handler code puts it there:
765:- *Obligations 4 (memory/CPU limits) and 5 (log identity): posture
766:  unchanged.* Limits remain reported-Missing for this engine (§Resource
768:  invocation by design; the pool bound (below) is the memory control.
786:lane runs **without the global mutex**: an in-flight lock-free query holding a
788:check that pre-reload VM (with stale module state) back into the freshly
795:or the guard regresses: global add, global overwrite (restored to baseline),
802:reset-failure burn (a frozen `globalThis` must yield a fresh VM next
810:## Capability Model
815:  diagnostics;
820:Capabilities should be visible in generated manifests and runtime diagnostics.
826:action-only `ctx` fields and ambient `fetch`/`globalThis`, and its commit history
851:`Function.prototype` shape but replaces the global Function constructor and
854:denial diagnostic rather than trusting a platform TypeError. Egress changes which services an
857:cannot execute with `ctx.runMutation` authority. Codegen's AST diagnostics are
858:deliberately only the early, precise explanation of that runtime policy.
874:## Secrets
883:- logs and diagnostics redact secret values;
895:here (secret handles, redaction, no read-back, no value hashing, actions-only
919:policy is "explicit capability + redaction + honesty," not "the runtime makes
922:## Database Isolation
937:## Resource Limits
941:- invocation wall-clock timeout;
942:- CPU budget where the runtime supports it;
943:- memory budget;
956:worker→caller authentication. Startup/invocation diagnostics read only a tail
957:window from stderr and redact the private materialization path and every
961:or at least report" is load-bearing here: Valet *claimed* a 5s/300s wall-clock
963:synchronous FFI call, an async wall-clock timeout could not preempt a handler
966:0038/0048]`). A reported-but-unenforced CPU/wall-clock limit is a security hole, not
968:per engine; real wall-clock/CPU enforcement requires an engine watchdog, a
978:## Supply Chain and Generated Bundles
1001:diagnostics without treating that syntactic pass as the sandbox.
1009:network globals and denies dynamic code generation and ambient nondeterminism.
1013:applied to tooling: computed `Function`/`globalThis`/`process` tricks find no host
1030:## Validation Requirements
1037:- per-invocation global state does not leak under the chosen runtime policy;
1038:- logs redact secret values, and the audit log never stores a secret value or its
1040:- capability diagnostics explain denied operations;
1047:- a runaway handler is either terminated by an enforced wall-clock/CPU limit, or the
1051:## Open Questions
1054:  watchdog stubs — what is the concrete plan for an enforceable wall-clock/CPU limit
1058:- What is the minimum practical resource-limit set for local development?
1069:## Status
1079:target has an enforceable resource-limit and isolation story.

hook: PostToolUse
hook: PostToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '180,306p' llp/0087-facets-hosted-adoption.plan.md
sed -n '288,380p' llp/0009-code-execution-security.rfc.md
sed -n '680,775p' llp/0009-code-execution-security.rfc.md
sed -n '937,975p' llp/0009-code-execution-security.rfc.md
sed -n '1030,1052p' llp/0009-code-execution-security.rfc.md" in /Users/ccheever/projects/snapback
 succeeded in 0ms:
   Workers facts carry the pricing table and a dated GA determination.
2. Time-boxed spike: run one existing proof app under each viable
   topology candidate, behind the existing acceptance suites. The notes
   app covers the base legs (isolation, storage, economics, lifecycle);
   the coordinator/action-separation leg runs on the All Aboard profile —
   or on notes with an action-handler config added for the spike — because
   notes as deployed has no action handler to preserve (only All Aboard
   carries the separate action-handler service). Measure:
   - **Isolation** ([LLP 0009](./0009-code-execution-security.rfc.md)
     review): what a facet isolates; whether the binding envelope can be
     restricted to exactly the one `HOST` service binding the compiled-in
     handler receives today, and nothing else; whether a facet is a
     per-invocation kill domain or a long-lived isolate whose global state
     persists across invocations; whether ambient-denial and egress gates
     ([LLP 0047](./0047-hosted-execution-limits.rfc.md)-adjacent probes in
     the current suite) hold inside a facet; whether the
     coordinator/action separation survives topology A; CPU/memory
     attribution between supervisor and facet (the spike README's own
     open item); and a **two-app adversarial leg** — two apps loaded
     simultaneously under the candidate topology, probing global-state
     separation, loader-name collisions, artifact/cache confusion,
     cross-app binding attempts, and noisy-neighbor resource contention
     — the contention probe's pass rule (a threshold, or a judgment
     delegated to the LLP 0009 reviewer's pre-signed probe list) is fixed
     before the leg runs and recorded in the comparison artifact.
     (LLP 0018's matrix proves correctness against bugs and accidents,
     not adversarial isolation; the adversarial claim is LLP 0009's and
     must be tested at topology-selection time, not deferred to Phase 2.
     This leg is defense-in-depth for shared *trusted* operator code; it
     does not graduate hosted untrusted code — see Ratification posture.)
   - **Storage semantics per facet:** SQLite limits, PITR/bookmarks,
     alarms, and hibernation for the facet's *role-local* state (app data
     stays in the coordinator per the invariant above); confirm the
     coordinator's own contract primitives — the one-`transactionSync`
     version+rows+journal commit, the single-alarm dispatcher, PITR
     bookmarks — are unaffected by hosting facets.
   - **Economics:** cold-start delta from runtime loading; how facet
     duration and storage are actually billed (measure against the
     published 2026-05-26 pricing; do not assume); maximum loadable
     bundle size via Worker Loader.
   - **Lifecycle:** facet class versioning against the `exports`
     migration model and its no-gradual-deploy constraint; code-update
     skew between gateway, coordinator, and facet, including old and new
     app-artifact versions coexisting with the coordinator's schema and
     host-op protocol versions during rollback; the DO class/state
     transfer path for later consolidating today's per-app Workers into
     one platform script (the end state moves each app's coordinator DO
     namespace out of its per-app gateway Worker — name the mechanism,
     script-transfer migration vs. export/import through the journal,
     because Phase 2's rollback rehearsal must cover it).
   - **Local-dev parity:** whether Miniflare/`workerd` support Worker
     Loader and facets. The entire local proof
     (`cloudflare/test/local-suite.mjs`, 21 manifest checks: 20 gate
     suites plus the compatibility check, per
     `cloudflare/test/local-suite-manifest.mjs`) runs on Miniflare —
     **no Miniflare support, no adoption.** (The progress note reports
     this answered locally: works under the pinned Miniflare/workerd.
     Gate 0 still requires it demonstrated on the suite harness itself,
     not only in the spike sandbox.)

**Gate 0 (go/reshape/kill)** — a checklist, evaluated per topology, its
findings recorded as a machine-readable comparison artifact —
`cloudflare/generated/gate0-facets-comparison.json`, one row per topology
(A, B, C), each row carrying: repo SHA, toolchain identity
(lockfile-resolved Node/Miniflare/workerd versions, compatibility date,
recorded automatically rather than transcribed), the commands run,
per-probe results, latency and cost numbers against the budgets below,
lifecycle findings, and an enumerated outcome `pass | reshape | kill |
not-viable` (with `selectedTopology: null` permitted when the overall
result is kill) — plus prose findings in LLP 0014:

1. *Isolation:* the ambient-denial and slow-action-non-blocking probes
   (the `acceptance.egress.mjs` behaviors: no ambient fetch from app code;
   a deliberately slow action fetch blocks no concurrent query, mutation,
   or live push) pass with app code running under the candidate topology,
   plus the two-app adversarial leg above; the binding envelope is
   restricted to the single `HOST` binding; the LLP 0009 reviewer signs
   off on this probe list *before* the spike's isolation leg runs and on
   the results after. The micro-spike already run
   (`cloudflare/spike-facets/`) is pre-leg reconnaissance: its probes
   inform the probe list but do not discharge (or contaminate) this
   criterion — the reviewer-signed list still precedes the suite-level
   isolation leg on the candidate topologies.
2. *Storage:* the coordinator-contract primitives enumerated above are
   confirmed intact by the existing acceptance suites (the local-suite
   manifest checks plus `acceptance.egress.mjs`) passing with the
   candidate topology hosting the app code — not by inspection alone.
   For facet-local storage the observable is concrete: today the handler
   roles keep no durable role-local state, so the criterion is that
   nothing app-data-shaped appears in facet SQLite, checked by
   inspecting the facet database after a full suite run; if a topology
   introduces genuine role-local state, the receipt names it.
3. *Economics (budgets frozen before measurement; changing them after
   observing results requires a pre-measurement amendment recorded in
   LLP 0014, not a gate-time re-pin):* cold start defined as
   first-request latency after eviction of the loaded runtime — the
   eviction method must demonstrably discard the facet/loaded worker,
   not just coordinator in-memory state (the coordinator's `/evict` is a
   surrogate to be validated, not assumed) — p95 over ≥ 30 samples per
   topology, measured from the same location in the same session as the
   compiled-in baseline; budget: candidate p95 ≤ 2× baseline p95 and
   absolute delta ≤ 250 ms. Cost measured over one calendar UTC billing
   day per profile with a defined activity shape — acceptance-suite runs
   at a fixed cadence plus measured idle, reusing the existing
   billing-window methodology (`cloudflare/test/billing-windows.mjs`,
   `validate-idle-measurement.mjs`) — with the counted meters enumerated
   in the receipt; budget: ≤ 1.5× the deploy-time profile's cost on the
   same workload shape and window.
4. *Local-dev parity:* Miniflare support works under the local suite
   harness, **or** a committed path exists in the form of a citable
   Cloudflare statement (changelog, docs, or direct confirmation with a
   named contact), with an owner and a check-back date recorded. A
   committed path passes Gate 0 only; **Phase 1 cannot start, and Gate 1
   cannot pass, without working Miniflare support**, since Gate 1 is
   defined over the Miniflare-based local suite. This is the precise form
   of "no Miniflare support, no adoption."

Output: topology chosen; findings and the door-2 re-ratification (or
reaffirmation) recorded in LLP 0014. Failure modes: isolation inadequate →
topology B or kill; Miniflare gap → hold at Phase 0 and watch; economics
outside budget → kill with findings recorded; lifecycle/class-migration
semantics unworkable (no rollback-compatible transfer path) → reshape
(topology B/C) or kill.

### Phase 1 — dual-track profile

Entry requires the two authorization decisions named above (LLP 0014
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

### DK-4 as-built — the warm VM pool and its per-invocation reset (2026-07-02)

The gated leg shipped. This subsection is the as-built design: what the warm
path reuses, what proves the VM clean between invocations, and — most
importantly — the limits stated honestly. The implementation lives in
`crates/snapback/src/warm_vm.rs` (pool, setup/reset sources) and `crates/snapback/src/runtime.rs` (the warm
orchestration inside `run_ibex_handler_with_context`).

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
  (ENG-23361). Patched Hermes reports each real rejection and its opaque
  closure-private generation through the trusted-runtime-owned observer, then
  reports completion only after a reaction executes or propagates that exact
  generation through its immediate internal child capability. `_B`/`_C` are sealed inert, and neither
  public Promise bookkeeping nor attachment alone is accepted as handling
  proof. After every successful eval — i.e. after the *full* microtask drain,
  so chains that reject after the invocation promise settles are still seen —
  the host inspects that independent ledger and fails the invocation
  (`SNAPBACK_HANDLER_UNHANDLED_REJECTION`, nothing committed) if entries
  remain. Rejections handled anywhere before completion never trip
  it. On Ibex, inspection is deliberately non-destructive because its sealed
  global name is necessarily knowable to handler code, so calling it early
  may observe but cannot drain the invocation's reasons. Native constructor
  identity is preserved; a required authenticated observer covers native
  `await`, adoption, combinators, and explicit reactions, while every
  handler-reachable `_B`/`_C` path is inert and `__OriginalPromise` aliases only
  the public wrapper. On workerd, the event ledger's
  destructive take is closure-private and no sibling module exports it. Its
  handler settlement and detached-host-call drain consume one shared deadline;
  expiry wins any pending drain await, aborts the invocation-private HOST
  fetches, and returns a no-commit `SNAPBACK_HANDLER_DID_NOT_SETTLE` verdict
  tagged as the quiescence phase. Both ledgers use captured Map methods; a
  malformed report or a
  vendored-runtime upgrade that makes detection unsupported fails the
  invocation closed. A VM with any unhandled rejection is burned instead of
  returned to the warm pool. `crates/snapback/tests/unhandled_rejection_v0.rs` and the
  adversarial twin tests pin warm, fresh, action, early-inspection,
  serializer-poisoning, native-await, adoption, combinator, erased-reaction,
  stale-generation, and Proxy-receiver behavior (ENG-24559). Every continuation that does run therefore runs inside
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


hook: PostToolUse
hook: PostToolUse Completed
codex
The one-to-one mapping is complete. The revision contains direct coverage for all eight blockers; I’m doing a final signability check against Gate 0’s frozen thresholds and the corrected README claims, without expanding the review surface.
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba cloudflare/spike-facets/gate0-probe-list.md | sed -n '35,238p'
nl -ba cloudflare/spike-facets/README.md | sed -n '34,78p'
nl -ba llp/0087-facets-hosted-adoption.plan.md | sed -n '188,286p'" in /Users/ccheever/projects/snapback
 succeeded in 0ms:
    35	  shared platform Workers loading per-app code via Worker Loader;
    36	  coordinator calls them over service bindings.
    37	- **C — hybrid:** handler as coordinator facet; action as loader-fed shared
    38	  service.
    39	- **Baseline — compiled-in:** today's shape (static module), as latency
    40	  control and P4 contention control — a control, not a waiver.
    41	
    42	## Probes
    43	
    44	### P1 — Ambient egress denial
    45	
    46	App code (handler **and** action roles) attempts global `fetch` to an
    47	external origin. **Pass:** denied with the platform's capability error
    48	(error text/category recorded, not just an HTTP status), and a
    49	network-level observation (harness-side request log or platform egress
    50	log) confirms no bytes left. Matches the `acceptance.egress.mjs`
    51	ambient-denial behavior. Applies: A, B, C.
    52	
    53	### P2 — Binding-envelope minimality (reviewer wording, verbatim)
    54	
    55	> For every app-code role in topologies A, B, and C, `Reflect.ownKeys(env)`
    56	> is exactly `["HOST"]`, with no symbol keys and no additional
    57	> capability-bearing inherited properties. Direct reads of `LOADER`,
    58	> coordinator/storage bindings, handler/action service bindings,
    59	> registry/artifact bindings, and an injected secret-canary binding return
    60	> `undefined` or a capability-denied error. `HOST` is app- and role-scoped:
    61	> it exposes only the declared host-operation protocol and cannot address
    62	> another app, raw coordinator storage, control-plane operations, arbitrary
    63	> service bindings, or arbitrary outbound URLs. Run the enumeration and
    64	> active-access attempts from both handler and action code.
    65	
    66	The canary binding is injected into the loader/service environment
    67	deliberately so the probe fails if any *future* platform secret leaks into
    68	the loaded code's envelope, not only currently known names. Applies: A, B, C.
    69	
    70	### P3 — Slow-action non-blocking
    71	
    72	A 1.5 s action is in flight; ≥ 20 **concurrently dispatched** queries plus
    73	≥ 1 mutation and ≥ 1 live-push delivery proceed meanwhile. **Pass:**
    74	concurrent query/mutation p95 unaffected (budget: ≤ 100 ms local; the
    75	on-platform budget is fixed in the receipt before the on-platform run).
    76	Verifies the LLP 0040/0049 slow-action property per topology. Applies:
    77	A, B, C.
    78	
    79	### P4 — Two-app adversarial leg
    80	
    81	Two halves, both required.
    82	
    83	**(a) Contention and termination — on-platform authoritative; budget
    84	pre-registered (reviewer wording, verbatim):**
    85	
    86	> For CPU-spin and allocation-balloon variants separately, run at least
    87	> five overlapping attack intervals and collect at least 30 app-2 query
    88	> samples per topology. Compare against same-session, same-location app-2
    89	> idle measurements. App 2 passes when its error rate is zero and
    90	> attack-period p95 is no greater than `max(2 × idle p95, idle p95 +
    91	> 100 ms)`. Issue app-1 termination while the adversarial request is still
    92	> active. The request must terminate with the documented
    93	> abort/resource-limit category; a previously acquired stale stub must
    94	> fail with the supplied abort reason; app 2 must remain within the same
    95	> latency/error budget during and after termination. Record the
    96	> compiled-in baseline as a control, not as a waiver.
    97	
    98	Local (Miniflare) runs verify only the deterministic termination
    99	semantics; the 2026-07-23 reconnaissance showed local starvation in every
   100	topology including the baseline, so local contention numbers are an
   101	instrument-limitation control in the receipt, never a pass. For B and C's
   102	shared action service the receipt must name the **concrete per-app
   103	kill/invalidation primitive**; if none exists, that topology fails P4 —
   104	"per-app service isolation" is not evidence.
   105	
   106	**(b) State, cache, artifact, and binding confusion:** with two apps
   107	loaded: same loader name/content hash requested by two apps with
   108	different bytes (must not alias); app 1 attempting to select app 2's
   109	artifact identifier (must fail with a coded error); global/module/cache
   110	state separation across apps; stale-cache behavior after app 1 updates its
   111	artifact; app 1's `HOST` attempting operations against app 2 (must fail
   112	closed); per-app log and error attribution is unambiguous.
   113	
   114	Applies: A, B, C.
   115	
   116	### P5 — Storage invariant
   117	
   118	Inspect facet/loaded-worker SQLite after a full probe run. **Pass:**
   119	nothing app-data-shaped in facet SQLite — app rows, version counter,
   120	journal, outbox, cron, and subscription state live only in the coordinator
   121	(LLP 0014 door 1). The suite-level leg's expected facet table set is
   122	**empty** for today's handler/action roles; any role-local state a
   123	topology introduces must be enumerated in the receipt. (The recon
   124	harness's `scratch` table is an artifact of the recon app, not license for
   125	the real roles.) Applies: A, C; B when a service uses DO state.
   126	
   127	### P6 — Lifecycle and stub semantics
   128	
   129	`facets.abort(reason)` then re-`get`; `facets.delete`; calls on stale
   130	stubs; abort *during* an in-flight request. **Pass:** abort halts and
   131	invalidates stubs (calls throw the supplied reason); storage persists
   132	across abort/restart; delete permanently destroys the facet DB; every
   133	failure mode surfaces as a distinguishable error the host maps to a stable
   134	`SNAPBACK_*` code. Applies: A, C (facet mechanics); B analogues via its
   135	kill primitive from P4(a).
   136	
   137	### P7 — Cold start with validated eviction
   138	
   139	First-request latency after **demonstrably discarding** the loaded
   140	worker/facet (the eviction method must be shown to discard the runtime,
   141	not merely coordinator in-memory state). **Pass:** p95 over ≥ 30 validated
   142	cold samples per topology, same session/location as the compiled-in
   143	baseline, meeting **both** frozen budgets: `candidate p95 ≤ 2× baseline
   144	p95` **and** `candidate p95 − baseline p95 ≤ 250 ms` (LLP 0087's absolute
   145	budget). Applies: A, B, C vs Baseline.
   146	
   147	### P8 — Version skew, rollback, and migration
   148	
   149	Load v1; while a v1 request is **genuinely in flight**, begin serving v2.
   150	**Pass:** the in-flight v1 request completes on v1; no request observes
   151	mixed versions; rollback to v1 works; the old version is discardable and
   152	its resources released; host-op/schema protocol skew between coordinator
   153	and loaded code fails closed with a coded error; facet-class migration
   154	findings (rename/replace of the loaded DO class) are recorded per LLP
   155	0087's lifecycle item. Applies: A, B, C.
   156	
   157	### P9 — Invocation lifecycle and async quiescence
   158	
   159	For each role and topology: write module-scope, instance, and global state
   160	in invocation A; observe from invocation B and from app 2 (app-2 leakage =
   161	fail). Start detached promises, timers, and `waitUntil` work; return; prove
   162	the detached work cannot later execute with invocation B's `HOST`/auth
   163	context. Record whether the runtime is fresh, reset, or long-lived —
   164	characterization, not pass/fail (LLP 0009's runtime-policy honesty).
   165	Hibernate/evict, then repeat the checks. Applies: A, B, C.
   166	
   167	### P10 — Alarms, hibernation, and PITR in facets
   168	
   169	Whether a facet can schedule an alarm at all; alarm wake-up from
   170	hibernation; which bindings app code sees during `alarm()` (must satisfy
   171	P2); interaction of `facets.abort`/`delete` with a pending alarm;
   172	PITR/bookmark behavior of facet SQLite; and **non-interference with the
   173	coordinator's single-alarm dispatcher** (LLP 0014 platform fact: one alarm
   174	per object; LLP 0028's dispatcher must stay sole owner of coordinator
   175	scheduling). Applies: A, C (facet roles); B for its DO state if any.
   176	
   177	### P11 — Error boundaries and diagnostics
   178	
   179	For each of: synchronous throw, rejected handler promise, detached
   180	rejection, `HOST`-call rejection, malformed result shape, and
   181	loader/module-initialization failure. **Pass:** a distinguishable stable
   182	`SNAPBACK_*` category per class; **no partial coordinator commit** (no
   183	partial rows/version/journal/outbox effects from the failed invocation);
   184	diagnostics are bounded and redacted (no app-code source or secrets in
   185	platform logs beyond policy); the next invocation either succeeds in a
   186	clean runtime or fails per a documented burn/restart policy. Applies:
   187	A, B, C.
   188	
   189	### P12 — Per-invocation-class resource honesty
   190	
   191	For each invocation class (query/handler, mutation, action, alarm, and
   192	load/module-initialization): deliberately exceed the candidate CPU,
   193	wall-clock, and memory limits and record what actually happens, as a
   194	matrix of `Enforced | Advisory | Missing` — plus **attribution**: which
   195	worker/facet/coordinator is metered for the CPU and memory. Trusted code
   196	may tolerate `Missing`; the receipt may not claim enforcement that was not
   197	demonstrated (LLP 0009 §resource limits). Applies: A, B, C (+ baseline
   198	column for comparison).
   199	
   200	### P13 — Scale and retention
   201	
   202	Repeated load/dispose of many content hashes with memory measured to a
   203	plateau or documented limit; concurrent facet/loaded-worker count up to
   204	and just beyond the supported limit; largest accepted and first rejected
   205	module/bundle size; at every limit, failure is recoverable and coded and
   206	does not disturb the other app; abort/delete/version-discard demonstrably
   207	release runtime/cache resources. Applies: A, B, C.
   208	
   209	## Instruments — honest coverage statement
   210	
   211	- `spike.mjs` — micro-spike. Reconnaissance shapes of P1/P5/P6 for a
   212	  single facet. Discharges nothing.
   213	- `harness.mjs` — per-topology reconnaissance. It implements **partial,
   214	  reconnaissance-grade shapes** of P1 (handler route only, status-code
   215	  check only), P2 (`Object.keys` enumeration only — no canaries, no active
   216	  access attempts), P3 (sequential queries, no mutation/live-push), P4
   217	  (contention timing + post-hoc termination only), P5 (recon app's own
   218	  table), P7 (10 restart samples, warm-only for topology B), and P8
   219	  (sequential version switch only). It does **not** implement P6, P9–P13,
   220	  or any probe's full criterion, and its output is never a probe pass —
   221	  recon results inform instrument design and nothing else.
   222	- The suite-level leg (post-sign-off) reuses the existing acceptance
   223	  behaviors (local-suite manifest checks, `acceptance.egress.mjs`) with
   224	  app code hosted under each candidate topology, extended to the full
   225	  criteria above; on-platform legs cover P4(a), P7, P10, P12, and P13
   226	  where local runs are non-authoritative.
   227	
   228	## Reviewer sign-off
   229	
   230	- [ ] **Pre-leg:** probe list approved (probes sufficient and correctly
   231	      scoped for the trusted-code posture; budgets pre-registered) —
   232	      reviewer: ____________, date: ____________
   233	- [ ] **Post-leg:** results reviewed against this list — reviewer:
   234	      ____________, date: ____________
   235	
   236	Amendments after pre-leg sign-off require reviewer re-approval; record
   237	deltas here with dates. Review artifacts: `reviews/gate0-probe-list.codex.r1.md`
   238	(round 1, REJECT — all required changes applied in v2).
    34	  adoption") because the whole local proof runs on Miniflare. Both
    35	  primitives work under the exact pinned versions the proof uses.
    36	- **The egress model composes with Snapback's.** `globalOutbound: null`
    37	  yields deny-by-default with capability-shaped errors — the same posture
    38	  as the LLP 0047 action-egress gating.
    39	
    40	## The per-topology reconnaissance harness (`harness.mjs`)
    41	
    42	```
    43	node cloudflare/spike-facets/harness.mjs   # pinned Node; ~1 min
    44	```
    45	
    46	Runs **reconnaissance-grade partial shapes** of probes P1/P2/P3/P4/P5/P7/P8
    47	from `gate0-probe-list.md` (see that file's "Instruments — honest coverage
    48	statement" for exactly what each shape omits; P6 and P9–P13 are not
    49	implemented) against topologies A (facet family), B (loader-fed shared
    50	services), C (hybrid), and the compiled-in baseline. It emits
    51	reconnaissance JSON — explicitly **not** the Gate 0 receipt, and its green
    52	results are instrument validation, never probe passes.
    53	
    54	Reconnaissance results (2026-07-23, Node 24.18.0 / miniflare 4.20260706 /
    55	workerd 1.20260707):
    56	
    57	- **Recon shapes of P1 egress denial, P2 envelope enumeration, P3
    58	  slow-action non-blocking (query p95 ≈ 4–7 ms during a 1.5 s action), P5
    59	  storage inspection, and P8 sequential version switch: green in all three
    60	  topologies.** These are instrument-validation results, not probe passes
    61	  — the full criteria run post-sign-off.
    62	- **P4 adversarial: not locally answerable.** App 2 starves during app 1's
    63	  CPU spin in every topology *including the baseline* — local workerd does
    64	  not exhibit production isolate scheduling, so P4's contention half is
    65	  strictly an on-platform question. Termination semantics (abort while
    66	  misbehaving) do verify locally.
    67	- **P7:** facet abort/restart costs tens of ms locally (A ≈ 41 ms p95,
    68	  C ≈ 5 ms) vs warm p50 ≈ 2–5 ms; true cold-start comparison needs the
    69	  on-platform run with validated eviction.
    70	
    71	## What this does NOT establish (open for Gate 0)
    72	
    73	- LLP 0009 isolation review (what the isolate boundary actually guarantees;
    74	  CPU/memory attribution between supervisor and facet; whether the
    75	  coordinator/action-handler service split survives colocation).
    76	- Behavior on the **real** platform: cold-start delta, hibernation
    77	  interaction, alarms-per-facet, PITR-per-facet, and measured billing
    78	  (pricing page: billed since 2026-05-26 — $0.002/dynamic-worker/day beyond
   188	   - **Isolation** ([LLP 0009](./0009-code-execution-security.rfc.md)
   189	     review): what a facet isolates; whether the binding envelope can be
   190	     restricted to exactly the one `HOST` service binding the compiled-in
   191	     handler receives today, and nothing else; whether a facet is a
   192	     per-invocation kill domain or a long-lived isolate whose global state
   193	     persists across invocations; whether ambient-denial and egress gates
   194	     ([LLP 0047](./0047-hosted-execution-limits.rfc.md)-adjacent probes in
   195	     the current suite) hold inside a facet; whether the
   196	     coordinator/action separation survives topology A; CPU/memory
   197	     attribution between supervisor and facet (the spike README's own
   198	     open item); and a **two-app adversarial leg** — two apps loaded
   199	     simultaneously under the candidate topology, probing global-state
   200	     separation, loader-name collisions, artifact/cache confusion,
   201	     cross-app binding attempts, and noisy-neighbor resource contention
   202	     — the contention probe's pass rule (a threshold, or a judgment
   203	     delegated to the LLP 0009 reviewer's pre-signed probe list) is fixed
   204	     before the leg runs and recorded in the comparison artifact.
   205	     (LLP 0018's matrix proves correctness against bugs and accidents,
   206	     not adversarial isolation; the adversarial claim is LLP 0009's and
   207	     must be tested at topology-selection time, not deferred to Phase 2.
   208	     This leg is defense-in-depth for shared *trusted* operator code; it
   209	     does not graduate hosted untrusted code — see Ratification posture.)
   210	   - **Storage semantics per facet:** SQLite limits, PITR/bookmarks,
   211	     alarms, and hibernation for the facet's *role-local* state (app data
   212	     stays in the coordinator per the invariant above); confirm the
   213	     coordinator's own contract primitives — the one-`transactionSync`
   214	     version+rows+journal commit, the single-alarm dispatcher, PITR
   215	     bookmarks — are unaffected by hosting facets.
   216	   - **Economics:** cold-start delta from runtime loading; how facet
   217	     duration and storage are actually billed (measure against the
   218	     published 2026-05-26 pricing; do not assume); maximum loadable
   219	     bundle size via Worker Loader.
   220	   - **Lifecycle:** facet class versioning against the `exports`
   221	     migration model and its no-gradual-deploy constraint; code-update
   222	     skew between gateway, coordinator, and facet, including old and new
   223	     app-artifact versions coexisting with the coordinator's schema and
   224	     host-op protocol versions during rollback; the DO class/state
   225	     transfer path for later consolidating today's per-app Workers into
   226	     one platform script (the end state moves each app's coordinator DO
   227	     namespace out of its per-app gateway Worker — name the mechanism,
   228	     script-transfer migration vs. export/import through the journal,
   229	     because Phase 2's rollback rehearsal must cover it).
   230	   - **Local-dev parity:** whether Miniflare/`workerd` support Worker
   231	     Loader and facets. The entire local proof
   232	     (`cloudflare/test/local-suite.mjs`, 21 manifest checks: 20 gate
   233	     suites plus the compatibility check, per
   234	     `cloudflare/test/local-suite-manifest.mjs`) runs on Miniflare —
   235	     **no Miniflare support, no adoption.** (The progress note reports
   236	     this answered locally: works under the pinned Miniflare/workerd.
   237	     Gate 0 still requires it demonstrated on the suite harness itself,
   238	     not only in the spike sandbox.)
   239	
   240	**Gate 0 (go/reshape/kill)** — a checklist, evaluated per topology, its
   241	findings recorded as a machine-readable comparison artifact —
   242	`cloudflare/generated/gate0-facets-comparison.json`, one row per topology
   243	(A, B, C), each row carrying: repo SHA, toolchain identity
   244	(lockfile-resolved Node/Miniflare/workerd versions, compatibility date,
   245	recorded automatically rather than transcribed), the commands run,
   246	per-probe results, latency and cost numbers against the budgets below,
   247	lifecycle findings, and an enumerated outcome `pass | reshape | kill |
   248	not-viable` (with `selectedTopology: null` permitted when the overall
   249	result is kill) — plus prose findings in LLP 0014:
   250	
   251	1. *Isolation:* the ambient-denial and slow-action-non-blocking probes
   252	   (the `acceptance.egress.mjs` behaviors: no ambient fetch from app code;
   253	   a deliberately slow action fetch blocks no concurrent query, mutation,
   254	   or live push) pass with app code running under the candidate topology,
   255	   plus the two-app adversarial leg above; the binding envelope is
   256	   restricted to the single `HOST` binding; the LLP 0009 reviewer signs
   257	   off on this probe list *before* the spike's isolation leg runs and on
   258	   the results after. The micro-spike already run
   259	   (`cloudflare/spike-facets/`) is pre-leg reconnaissance: its probes
   260	   inform the probe list but do not discharge (or contaminate) this
   261	   criterion — the reviewer-signed list still precedes the suite-level
   262	   isolation leg on the candidate topologies.
   263	2. *Storage:* the coordinator-contract primitives enumerated above are
   264	   confirmed intact by the existing acceptance suites (the local-suite
   265	   manifest checks plus `acceptance.egress.mjs`) passing with the
   266	   candidate topology hosting the app code — not by inspection alone.
   267	   For facet-local storage the observable is concrete: today the handler
   268	   roles keep no durable role-local state, so the criterion is that
   269	   nothing app-data-shaped appears in facet SQLite, checked by
   270	   inspecting the facet database after a full suite run; if a topology
   271	   introduces genuine role-local state, the receipt names it.
   272	3. *Economics (budgets frozen before measurement; changing them after
   273	   observing results requires a pre-measurement amendment recorded in
   274	   LLP 0014, not a gate-time re-pin):* cold start defined as
   275	   first-request latency after eviction of the loaded runtime — the
   276	   eviction method must demonstrably discard the facet/loaded worker,
   277	   not just coordinator in-memory state (the coordinator's `/evict` is a
   278	   surrogate to be validated, not assumed) — p95 over ≥ 30 samples per
   279	   topology, measured from the same location in the same session as the
   280	   compiled-in baseline; budget: candidate p95 ≤ 2× baseline p95 and
   281	   absolute delta ≤ 250 ms. Cost measured over one calendar UTC billing
   282	   day per profile with a defined activity shape — acceptance-suite runs
   283	   at a fixed cadence plus measured idle, reusing the existing
   284	   billing-window methodology (`cloudflare/test/billing-windows.mjs`,
   285	   `validate-idle-measurement.mjs`) — with the counted meters enumerated
   286	   in the receipt; budget: ≤ 1.5× the deploy-time profile's cost on the

hook: PostToolUse
hook: PostToolUse Completed
codex
1. **ADDRESSED** — P9 covers module/instance/global state, detached promises/timers/`waitUntil`, cross-invocation authority, runtime persistence characterization, and post-hibernation/eviction repetition; P10 separately covers alarms, wake-up, abort/delete, PITR, and dispatcher noninterference ([v2 P9–P10](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:157)).

2. **ADDRESSED** — P11 enumerates all requested failure classes and requires stable `SNAPBACK_*` categories, no partial coordinator commit, bounded/redacted diagnostics, and documented clean-restart or burn behavior ([v2 P11](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:177)).

3. **ADDRESSED** — P12 tests CPU, wall-clock, and memory across query/handler, mutation, action, alarm, and initialization, recording `Enforced | Advisory | Missing` plus metering attribution ([v2 P12](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:189)).

4. **ADDRESSED** — P4 adopts the requested pre-registered contention threshold and termination procedure, requires concrete B/C kill primitives, and adds every requested state/cache/artifact/binding-confusion and attribution check ([v2 P4](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:79)).

5. **ADDRESSED** — P13 covers repeated content-hash load/disposal, memory plateau or documented limit, concurrency boundaries, accepted/rejected bundle sizes, recoverable coded failures, app-2 noninterference, and resource release ([v2 P13](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:200)).

6. **ADDRESSED** — P2 uses the requested exact `Reflect.ownKeys(env) === ["HOST"]` criterion, inherited-property restriction, forbidden-binding probes, injected secret canary, scoped `HOST`, and both handler/action roles ([v2 P2](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:53)).

7. **ADDRESSED** — P7 requires validated eviction, at least 30 cold samples, and both frozen latency limits; P8 adds a genuinely in-flight v1 request, rollback, discard/resource release, protocol skew, and facet-class migration findings ([v2 P7–P8](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:137)).

8. **ADDRESSED** — The instrument statement now expressly labels `harness.mjs` partial reconnaissance, enumerates its omissions, and says it produces no probe passes; the README repeats that correction ([v2 coverage statement](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:209), [README](/Users/ccheever/projects/snapback/cloudflare/spike-facets/README.md:40)).

Overall, v2 is sufficient for the suite-level isolation leg. The load-bearing P4 budget is numerically pre-registered, including sample counts and before/during/after termination behavior; P7 carries both frozen cold-start limits. The local P3 limit is fixed, while its platform threshold must be entered in the receipt before that run. Amendments require reviewer re-approval. I found no genuine v2-introduced defect.

VERDICT: APPROVE
REQUIRED-CHANGES: none
ADVISORY: none
hook: Stop
hook: Stop Completed
tokens used
50,604
1. **ADDRESSED** — P9 covers module/instance/global state, detached promises/timers/`waitUntil`, cross-invocation authority, runtime persistence characterization, and post-hibernation/eviction repetition; P10 separately covers alarms, wake-up, abort/delete, PITR, and dispatcher noninterference ([v2 P9–P10](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:157)).

2. **ADDRESSED** — P11 enumerates all requested failure classes and requires stable `SNAPBACK_*` categories, no partial coordinator commit, bounded/redacted diagnostics, and documented clean-restart or burn behavior ([v2 P11](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:177)).

3. **ADDRESSED** — P12 tests CPU, wall-clock, and memory across query/handler, mutation, action, alarm, and initialization, recording `Enforced | Advisory | Missing` plus metering attribution ([v2 P12](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:189)).

4. **ADDRESSED** — P4 adopts the requested pre-registered contention threshold and termination procedure, requires concrete B/C kill primitives, and adds every requested state/cache/artifact/binding-confusion and attribution check ([v2 P4](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:79)).

5. **ADDRESSED** — P13 covers repeated content-hash load/disposal, memory plateau or documented limit, concurrency boundaries, accepted/rejected bundle sizes, recoverable coded failures, app-2 noninterference, and resource release ([v2 P13](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:200)).

6. **ADDRESSED** — P2 uses the requested exact `Reflect.ownKeys(env) === ["HOST"]` criterion, inherited-property restriction, forbidden-binding probes, injected secret canary, scoped `HOST`, and both handler/action roles ([v2 P2](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:53)).

7. **ADDRESSED** — P7 requires validated eviction, at least 30 cold samples, and both frozen latency limits; P8 adds a genuinely in-flight v1 request, rollback, discard/resource release, protocol skew, and facet-class migration findings ([v2 P7–P8](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:137)).

8. **ADDRESSED** — The instrument statement now expressly labels `harness.mjs` partial reconnaissance, enumerates its omissions, and says it produces no probe passes; the README repeats that correction ([v2 coverage statement](/Users/ccheever/projects/snapback/cloudflare/spike-facets/gate0-probe-list.md:209), [README](/Users/ccheever/projects/snapback/cloudflare/spike-facets/README.md:40)).

Overall, v2 is sufficient for the suite-level isolation leg. The load-bearing P4 budget is numerically pre-registered, including sample counts and before/during/after termination behavior; P7 carries both frozen cold-start limits. The local P3 limit is fixed, while its platform threshold must be entered in the receipt before that run. Amendments require reviewer re-approval. I found no genuine v2-introduced defect.

VERDICT: APPROVE
REQUIRED-CHANGES: none
ADVISORY: none
