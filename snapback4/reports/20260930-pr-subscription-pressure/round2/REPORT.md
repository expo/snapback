# PR round 2 — validate saved answers before reuse

**Main has the reused-closed-handle defect.** The corrected control builds the
SDK from merged main `cb64e6aa11` and fails all four wasm/process ×
published/staged removal cases on the behavioral assertion. The native server
and device are current in this control, isolating the old SDK. The two earlier
control setup mistakes are recorded in [FAILURES.md](FAILURES.md); neither is
used as evidence about main.

Branch `sb4-intent/pr-subscription-pressure`. Merged `origin/main` first into
round 1 `c3c4ed0976`, producing merge commit `2a10a83e7a`. The sole conflict was
the append-only journal; both entries were preserved. Both full round-1
reviews and both prior prompts/reports were read. Nothing pushed or published.

## Review repairs and reuse audit

1. **Saved local handles:** `observeWatch` validates before returning a saved
   snapshot or reinserting its owner into the live map. Pending audience cuts,
   terminal refusals, incarnation changes and missed revisions precede reuse.
   Resubscribing an old handle also joins an existing live same-key owner
   instead of replacing it. A detached handle that missed any commit is
   conservatively loading until reevaluated, including a disjoint commit:
   there is no unbounded retired-handle or historical-removal registry.
2. **Server-backed and combined answers:** the query endpoint supplies optional
   audience dependencies. Local routing preserves them in whole-server answers,
   recovery memory and both composition paths; composition unions dependencies.
   An online-only profile plus a statically room-prefixed history therefore
   retains room 2 while room 1 withdraws, with all eight slots occupied. Both
   published and staged removals are covered on both devices, as is composition
   with retained history.
3. **Closed facade deadlines:** the first bounded deadline observed after close
   is captured before adopting the source snapshot. A closed facade exposes a
   fixed copy of that deadline, which can shorten but cannot move later. Its
   live peer retains the ordinary pauseable clock. The tests cover closing
   before and after bounded revalidation, stable snapshot identity, same-answer existence metadata, a later
   queue pause, and withdrawal at the original deadline.
4. **ObserveOptions:** comments now say that omitted/true retain plain
   revalidation indefinitely; change evidence bounds both. The local clock
   excludes capacity wait and the online evidence clock includes it. `true`
   also adds the existing 30-second linger. The comment regression fails on
   round 1; the behavioral test checks both retaining policies.
5. **Online sibling reads:** `/changes` remains table-wide. Its bounded journal
   has no per-viewer audience history, and journal saturation broadens evidence
   further. Supplying precise groups would require a separately designed
   authenticated history protocol. Evidence-triggered reads now precede ordinary
   pending reads, including when evidence arrives during an active attempt that
   must retire and requeue. The tests put a still-authorized sibling behind 40
   ordinary reads, release one of eight slots, and require the sibling to start
   next without blanking. There is no preemption or new capacity: if all eight
   attempts stay occupied for the entire second, the online sibling still
   withdraws. This exception remains documented.

The saved-answer audit also covers these paths:

| Path | Boundary before exposure |
|---|---|
| Raw resubscribe / getSnapshot | Validate authority and pending cut before reading or reinserting the saved owner. |
| `keep: true` lingering handles | Live-map owners receive every scope/refusal/reset; resumed handles validate before acquisition. Expired lingers already reset. |
| `keep: false` | Immediate withdrawal policy remains; included in the same remount matrix. |
| `peekObservation` | Only live-map owners are eligible; synchronous withdrawal precedes callbacks. Detached saved owners cannot enter through peek. |
| createApp facade (`guardClient`) | Peeks and underlying snapshots share those fences; closed deadlines are frozen on first observation. |
| Remembered whole-server answers | Audience loss retires matching memory even with no mounted owner, fencing older in-flight cache writes. Sibling memory survives this scope fence; ordinary commit invalidation still applies. |
| One-shot fallback and delayed facade approval | Evaluation checks cuts; final publication rechecks cuts and terminal feed/partition refusal after approval waits. |

The one-shot audit found a second terminal-refusal edge: a previously evaluated
query could wait at facade approval and publish afterward. A separate control
removes only the final publication check, keeping the handle fix, and both
device tests fail specifically on that stale approval. Repeated terminal checks
compare stable refusal codes to avoid recursive facade notifications at close.

## Precision and disclosure limits

Server scope metadata comes from the public program and caller inputs across
**all** branches, never from hidden row contents or the executed branch. Literal,
viewer and unshadowed argument prefixes narrow audience columns; the validated
schema audience inversion carries those same keys into membership dependencies.
The HTTP tests compare both branches and visible/hidden point results to ensure
metadata does not disclose which branch or hidden audience was read.

The documented conservative exceptions are by-ID reads without a public
audience prefix; computed/rebound selectors; unpinned audience dimensions;
recursive/native dependencies; unmapped rule/derived dependencies; mixed search
composition without a certified device trace; and legacy/absent metadata.
Unknown scope matches the table. Missing metadata from either side of a
composition widens the answer. Metadata exceeding 128 dependency visits or
16 KiB is omitted rather than truncated. Empty dependency tables still never
match a scope removal. These exceptions are described in LLP 3000.023 §10 and
the client reference; the client guide links to that reference within its budget.

## Verification

- Final affected run: **138 passed, 0 failed**, including all subscription-pressure
  tests, per-row work, raw deadlines and facade lifecycle checks. The five new files contain **30 tests**.
- Round-1 negative control: **18 failures / 12 passes** across those 30 tests.
  Every review repair has a detecting regression; the passing cases retain
  coverage for behavior already correct in round 1. The public-plan disclosure
  check uses the current server in this SDK-isolation control.
- Broad development run: **811 tests, 808 passes, 3 failures**. Two dormant
  refusal cases exposed the additional scheduling reset fixed here. The existing
  wasm 1,000-hook browser case timed out acquiring its initial ready state while
  development artifacts were being rebuilt; it passed in isolation on final
  bytes, with zero loading renders and 1,000 completed replacements. This is
  classified as our contaminated development run, not proof of an inherited red.
- Affected native server tests: **169 passed, 1 failed, 4 declared ignored,
  43 filtered**. The unchanged `/changes` engine-versus-poll timing test failed
  under simultaneous compilation/testing; its isolated rerun passed. See the
  environmental timing classification and exact measurements in the ledger.
- Whole guide: **105 passed, 0 failed**. Build and typecheck passed.
- Corrected facade lifecycle/deadline checks: **54 passed, 0 failed**. Four
  existing cross-handle object-alias assertions were replaced by equal answer
  identity, equal contents and stable snapshots within each handle; independent
  closed deadlines require an independent copy. The single full run had already
  evaluated the old assertions, so its failures remain in the recorded result.
- Reference validation: **525 LLP docs / 10,002 refs, 0 errors, 0 unchecked**.
- Four existing raw-resubscription cases expected revoked rows to return until
  a one-second timeout. They now require withdrawal before resubscription and
  reject every stale callback, while proving delivery of the authorized null
  replacement. These are intentional corrections for the requested hard
  authority boundary, not allowances for stale data.
- **Full suite: exit 1**, invoked **once** with
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`.
  Exact summary: **`== 1 failure(s) in 1260 s`**. The sole failed step was
  `client tests`: **5,375 tests, 5,357 passes, 8 failures, 10 existing skips**.
  All eight failures are **ours**, the four obsolete facade object-alias
  assertions and four revoked-row redisplay assertions described above; every
  name is listed in [FAILURES.md](FAILURES.md). They all pass after correction
  in the **138-test** final affected run. All **79 serial client models** passed,
  as did every other full-suite step, including the native timing case that had
  failed during development. This is not a green full-suite result, and no
  second full invocation is claimed. [SKIPS.md](SKIPS.md) lists the ten inherited
  client skips. The 1,260-second runtime exceeds the nominal 60-second budget;
  that suite-duration issue is inherited (round 1 took 1,268 seconds).

[QUALIFICATION.json](QUALIFICATION.json) records the result and source boundaries.
The full suite began before the last closed-facade existence-copy correction;
that SDK edit and its test were rebuilt and typechecked **before** the full
client pool started, recorded in `CLIENT-PHASE-BOUNDARY.json`. Native inputs did
not change. Only the two existing test files changed after the client pool
began, to correct the eight obsolete expectations. All **224 SDK file hashes**
match before/after the full client phase. All **1,652 final input hashes** match
the final snapshot; the before-full, before-client, final and after-full
manifests expose the intermediate differences rather than claiming an unchanged
source tree throughout the run.

All failed checks, including introduced defects, invalid control setups and
deliberate negative controls, are retained and individually classified in
[FAILURES.md](FAILURES.md). Raw logs/traces are compressed after completion;
the ledger uses their original run names. No timeout, test count, work limit or skip was changed. The existing assertion
changes are described explicitly above.

## Convergence

The unchanged real-device/Chromium harness mounts 124 observations per device.
Normal wasm and process runs each finish with **42 messages / 42 unique IDs** on
both devices, no history gaps or withdrawals, and peak **116 queued / 8 active**.
With the history attempt deliberately held for 1,100 ms, all four histories
again converge to 42 unique messages; each has one legitimate timeout, recorded
with `queued: false, inFlight: true`. No weakened gap assertion was reinstated.
The raw publication, render and pressure traces are retained in
`convergence-{final,active}-{wasm,process}.json.gz`.

## LL measurements

The unchanged harness measures 20 repetitions of eight flows per cell on four
pinned cores, with zero or three load workers. The eight-cell paired matrix
alternates the round-1 SDK with the initial round-2 SDK on the same current
server/device; it isolates SDK behavior, not the new server metadata cost.
Two later four-cell matrices cover final queue/refusal fixes. The last measured
raw-client paths match the final code; the subsequent closed-facade metadata
copy correction is outside this harness, which uses `createLocalClient` directly.

For the complete end-to-end before/after record, the first column below is the
prior round's final measurement with its original server/device. The middle
column is this round's fresh SDK control using the current server/device. Values
are the maximum of the eight flow publication p95s, in milliseconds:

| Tier / workers | Prior round-1 final | Round-1 SDK on current server | Last round-2 measurement |
|---|---:|---:|---:|
| Wasm / 0 | 47.257 | 47.273 | 49.887 |
| Wasm / 3 | 92.070 | 87.671 | 93.894 |
| Process / 0 | 81.163 | 93.734 | 73.857 |
| Process / 3 | 195.408 | 228.996 | 187.869 |

All **2,560 actions in 16 complete cells** finished without timeout. The separate
incomplete `verified` matrix was invalidated by our SDK rebuild/navigation and
is excluded. [LL-TABLES.md](LL-TABLES.md) records every flow's publication/React
p95, server-query and asset-home counts. Hashes and raw traces are retained.
Other lanes and this lane's tests shared the host; no-load means no harness
workers, not an idle machine. The prior-round comparison also spans main's
merge. These observations show successful live paths and no added read loop in
the measured flows; they do not isolate a causal performance change or certify
the static scope planner's cost for every query shape.

## Wasm ratchet

**1,983,105 raw / 595,440 gzip bytes**, exactly the existing 595,440-byte budget.
No increase or budget-file change. Scope metadata is added at the native HTTP
boundary; the device core is unchanged in this round. `local.ts` and `serve.rs`
remain at 1,500 lines. PQ's eight starts/eight active limits and opt-in inspection
collection remain unchanged.
