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
