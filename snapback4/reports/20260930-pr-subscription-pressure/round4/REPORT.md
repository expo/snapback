# PR round 4 — invalidate saved memory independently of owners

Branch `sb4-intent/pr-subscription-pressure`. Read rounds 0–3's prompts/reports
and both complete round-3 reviews. Merged `origin/main` **6e03a7e7c9** first into
round 3 **88dcf7bd86**, producing **8d4d1c6caf** without conflicts. Both sides
remain; main changed only two unrelated repository documents. Nothing pushed or
published.

## Repairs

1. **Remembered answers:** accepting `/changes` now invalidates every remembered
   answer whose tables intersect the notification, independently of live owners.
   Omitted tables clear all; explicit empty tables clear none; unknown memory
   dependencies stay conservative. An empty subsequent sync footprint cannot
   resurrect online-only memory. The existing authority revision also retires
   older evaluations, including a first reply with no saved key, a recovery
   candidate already copied from memory, and a one-shot facade result awaiting
   approval. Credential rotation and terminal partition refusal now clear memory
   as their existing hard boundary requires. This keeps one revision domain.
2. **Cancellation:** the resumed metadata read uses `duringRead(captureStore(),
   signal)`. Close and the existing 30-second expiry release `running` even when
   an adapter never releases its response. Both cancellation and deterministic
   lifetime controls pass on both devices; the unchanged reviewer wall-clock
   expiry reproduction also passes after 30 seconds on each device.
3. **Queue cost:** two insertion-ordered pending maps hold ordinary and priority
   work. Selection inspects their heads, skipping at most the eight active
   owners. The existing urgent marker preserves priority across active/delayed
   requeue, and the existing counter limits overtaking to eight starts. No
   backlog array copy, new timer, capacity or public surface. FIFO, duplicate
   coalescing, cancellation, retry and inspection remain covered.
4. **Inherited cuts:** one map retains only the highest unpublished notification
   cut per table, plus an unknown-table entry. Publication removes reached cuts;
   hard reset clears the map. A resumed owner inherits only intersecting cuts;
   unknown query dependencies match all. The detach epoch still discards any
   saved answer after evidence, even unrelated evidence. Its reevaluation can
   publish authorized local rows immediately when tables are disjoint. The
   intersecting test continues to reject every old-replica callback across a
   1.25-second unpublished window.

The new state is bounded by the pending notification's distinct table names,
not by closed handles or event history. There is no second publication watermark,
closed-handle registry, saved-answer epoch, result cache or ordering protocol.
The actual device watermark still reconciles a resumed owner once. The
conservative revision fence can retry a disjoint **in-flight** read after
nonempty/unknown notifications; completed disjoint memory survives. Quiet empty
polls advance only the detach epoch. This cost and the existing fully occupied
online-sibling exception remain explicit in LLP 3000.023 §10 and the client
reference.

[SAVED-ANSWERS.md](SAVED-ANSWERS.md) audits all evidence channels and remembered,
recovery, facade, peek, linger and page reuse paths. Recovery reads the same
RememberedAnswers map; it has no separate persistent cache. Existing facade
validation/followers and final approval predicate consume the repaired source
fences, so no facade-specific mechanism was added. The no-owner revocation was
reported by Astra on round 2 as well; this round independently reproduces it on
round 3, without claiming a new round-2 or current-main experiment.

## Detecting regressions and affected checks

The four new repository files contain **23 tests**. Against round-3 SDK modules
with the same current server/devices, **20 behavioral regressions fail**:

- Eight memory/candidate cases: no-owner revoked answer, unremembered first
  reply, copied recovery candidate and pending facade approval, each on wasm
  and process.
- Four more no-owner cases: credential rotation and terminal partition refusal,
  each on both devices.
- Four watermark cases: close/resubscribe and 30-second attempt expiry, on both
  devices. Deterministic tests deliver the actual registered lifetime callback;
  they do not shorten the product timeout.
- Two unrelated-table resumed-handle cases.
- Two scheduler scaling cases, ordinary-only and priority-only.

Two intersecting-table controls already pass round 3. The remaining new unit
checks the unknown-table/dependency rule and clearing cuts at publication; it
uses the new method and is excluded from behavioral before/after claims.
`round3-control-final.log`, `round3-candidates-control.log` and
`round3-other-evidence-control.log` retain the detecting failures. The control
copies the built SDK to `target/pr-round3/dist` and transpiles `local.ts`,
`local-reads.ts` and `read-work.ts` from `88dcf7bd86` with the workspace TypeScript
ES2022/ESNext target and relative-import rewriting. No production artifact swap.

- Broad affected run: **779 passed / one failed**, of 780. The failed old online
  test inspected `pending`, now the ordinary queue, to assert urgent work was
  queued. It now asserts `state(owner) === 'queued'`; its loading/withdrawal and
  eight-active checks are unchanged. Corrected round-1/online run: **17 passed**.
- Final focused regressions, round-1 fixes, online priority and continuous-hot
  fairness: **41 passed, zero failed**. Ordinary progress remains bounded; no
  existing assertion, timeout, concurrency limit or skip was relaxed.
- New regressions plus delivery fault/boundary checks before the final four
  audit cases: **340 passed** (19 new checks plus 321 delivery checks). The
  final four additional audit cases pass separately and in the 41-test run.
- Whole guide: **106 passed, zero failed**. The client card stays at its existing
  114 lines / 1,196 words; details live in the linked client reference.
- SDK build/typecheck pass. Regenerated the changed await classification through
  `awaitBoundary()`. Ref-check: **525 LLP docs / 10,015 refs, zero errors and
  zero unchecked references**. `local.ts` remains exactly **1,500 lines**.
- Separate real wall-clock attempt-expiry checks: **2 passed**, approximately
  30.6 seconds wasm and 30.2 seconds process, with replacement data and
  `running: false` while the obsolete response remained held.

All development failures and expected controls are classified individually in
[FAILURES.md](FAILURES.md). The full-suite result and input boundary are recorded
in the completion section below.

## Scheduler measurements

Deterministic scaling tests count actual keys inspected, without timing thresholds:
**1,124 visits for 1,000 jobs; 11,249 for 10,000**, in either class. Round 3 visits
**562,500 / 1,125,000** keys for only 1,000 ordinary/priority jobs and fails the
linear-work bound. The revised test wraps only the scheduler's own collections,
not global collection prototypes.

`queue-cost.mjs` is a rerunnable, uninstrumented scheduler-only measurement.
Four warm-ups precede ten alternating samples per version, with the order
reversed each repetition. Median enqueue/drain milliseconds on this shared host:

| Pending work | Jobs | Round 3 | Round 4 |
| --- | ---: | ---: | ---: |
| Ordinary | 1,000 | 3.076 | 1.818 |
| Ordinary | 10,000 | 140.613 | 25.082 |
| Priority | 1,000 | 8.088 | 2.175 |
| Priority | 10,000 | 462.708 | 26.253 |

Raw samples are in `queue-cost.jsonl`. These are queue-cost observations, not
application-latency claims. Starts/turn and active slots remain eight.

## Convergence and LL

The unchanged Chromium/real-device harness mounts 124 observations per device.
Both tiers' normal runs deliver **42 unique messages per history**, zero history
withdrawals/gaps, and peak **116 queued / eight active**. Forced 1,100-ms attempts
also converge exactly once. All four forced withdrawals record `queued: false,
inFlight: true`; the original gap assertion remains. Every render/publication
and pressure trace is retained in `convergence-{final,active}-{wasm,process}.json`.

The unchanged viewed-media LL harness completed **640 actions without timeout**,
20 repetitions of all eight flows per tier/load cell, on CPUs 0–3. Historical
round-3 final → round-4 maximum flow publication p95, milliseconds:

| Tier / load workers | Round 3 | Round 4 |
| --- | ---: | ---: |
| Wasm / 0 | 70.583 | 95.269 |
| Wasm / 3 | 93.483 | 107.138 |
| Process / 0 | 127.581 | 71.543 |
| Process / 3 | 179.059 | 172.251 |

The higher wasm samples are retained. This round overlapped the full Rust suite
and other sessions; zero load workers is not an idle host. This historical
comparison does not isolate a causal speedup/regression or certify a universal
latency bound. Asset-home medians are unchanged for every flow, including zero
for reaction flows. Query counts remain schedule-dependent and are reported
per flow in [LL-TABLES.md](LL-TABLES.md). The full stage/work distributions, raw
traces, host load and matching SDK/device/instrumented-server hashes are retained.

## Wasm

The full suite rebuilt the device: **1,983,105 bytes raw / 595,440 bytes gzip**,
exactly the unchanged **595,440-byte** ratchet. No Rust/wasm-source or budget
change. The suite's release guard passed.

## Completion: one full-suite invocation

Ran exactly once with the package SQLite policy:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Exit **0**. Exact summary:

```text
== 0 failure(s) in 1244 s
```

Every stage passes: Rust **4,368 passed / 33 existing ignores**; fixture wrappers
**9 passed**; client pool **5,450 tests, 5,440 passed, zero failures, ten existing
skips**; serial models **79 passed**, including both full 5,000-sequence walks.
All original counts, timeouts and concurrency settings are preserved. The Rust
phase took 491 seconds, client pool 412 and serial models 300. The inherited
nominal 60-second suite budget remains exceeded. Full-run failures: **ours 0,
baseline 0, environmental 0**. Existing skips are listed in [SKIPS.md](SKIPS.md).

Production sources remained unchanged for the whole run. Of 1,664 captured
inputs, only two test files changed after launch: the old round-1 private queue
assertion and four additional no-owner credential/partition-refusal cases in the
new memory file. Both changes completed **before the client pool started**, while
Rust tests were still running; `CLIENT-PHASE-BOUNDARY.json` records the hashes
and absence of the client-phase log. All final 1,664 hashes remained unchanged
through completion, and all LL SDK/device/server hashes still match. This is not
an unchanged-test-tree claim from suite launch; the full client pool ran the
final test versions, including all 23 new tests. `QUALIFICATION.json` and
`FULL-CONSISTENCY.json` record the boundary and results.

Large logs and raw traces are retained as `.gz`; ledger references use their
original run names. The report includes rerunnable tests/measurement and
SHA-256 artifacts. Final local commit includes the requested
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer. No push or publication.
