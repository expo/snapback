# DC round 15 — deterministic delivery queue fixtures

2026-09-28, `sb4-intent/dc-delivery-client`. First ran `git fetch origin &&
git merge origin/main`: fast-forward from `b66a2cee4` to `b8400c291`, with no
conflict. Read rounds 12–14, their binding constraints, Snapback 4's command
sheet, root/design brief, exclusions and journal. No push or publication.

## Finding: fixture scheduling, not a product defect

[LLP 3000.022 section 4](../../../llp/3000.022-delivery-the-sdk-reports.rfc.md#4-how-it-reports)
requires an uncertain attempt to retain its ID through eight retries, then
park until reconnect or start. `DeliveryQueue.reconnect()` clears the offline
gate, marks retry parks ready and schedules a zero-delay pump. It does **not**
wait for transport or settlement. When a slot and the group's turn are
available, the pump restores the retained attempt, resets its retry count
and `readyAt`, and resends the same ID with its original collection boundary.
The 30-second minimum belongs to `RUNS_FULL`, not this exhausted retry.

The reported failure has an additional send beyond the initial replay:

1. Nine lost sends of `[1,1]` park the original ID.
2. Recollection of `[1,1]` and `[3,3]` updates that parked attempt's boundary.
   A different ID reports `[3,3]`, receives `RUNS_FULL`, and parks.
3. Reconnect resends the original `[1,1]` ID. Its `NOT_MEMBER` reply preserves
   the later collection, leaving owed `[[1,1],[3,3]]` and clearing the parks.
4. A **new-ID** `[1,1]` report has a fresh collection boundary. The old
   fixture returns `NOT_MEMBER` to this request too. With no subsequent
   collection, its reply correctly removes the group.

The original assertion raced step 4's scheduled send. The unchanged round-12
probe reproduced the exact undefined `owed` failure and logged the original
ID nine times, interval 3, the original-ID replay, then a new-ID interval 1.
All state changes follow the documented event order; no runtime change is
needed. Production queue/state, retries, timers, public API, wire forms and
collection policy remain unchanged.

## Changes and complete scheduling audit

Only `packages/snapback4/test/delivery.test.mjs` changes executable behavior.
The harness exposes a settlement-count promise through the existing
`onSettled` callback. Tests can await committed outcomes rather than assume
eight `setImmediate` turns imply one particular send order. The helper does
not alter the scheduler, transport deadlines, or existing `settle()` duration.

| Assertion found | Deterministic control |
| --- | --- |
| Exhausted attempt's `owed` boundary, formerly line 184 | Separate deferred replies for the original-ID replay and its new-ID successor. Assert nine sends with one ID, the exhausted park, interval 3 running, the retained boundary, same-ID reconnect, and preservation after its reply. Two cases then choose whether the fresh reply is held or has arrived before inspection: held means exact owed `[[1,1],[3,3]]`; arrived means the group is gone. Both finish by asserting deletion after the fresh `NOT_MEMBER`. |
| `generation and viewer fences reject callbacks` | The original shared one promise between the obsolete request and the new photos request; resolving it could also report the successor before inspecting owed `[2,2]`. Give the successor its own deferred reply, explicitly dispatch it, assert retained debt after the old callback, then release and await its successful report. |
| `a pre-transport serial gate race spends no retry and keeps its persisted id` | A scheduled retry could succeed and remove `attempt` before the assertion read `attempt.retries`. Hold that reply, assert zero retries, the same ID and exact owed debt, then release it and await reported coverage. |

Searched all delivery/queue/refusal test paths and read every `settle()` use.
The queue file is `delivery.test.mjs`; there is no separate queue test file.
Only it and `delivery-refusal.test.mjs` use the eight-turn helper. Refusal
tests already mock `setTimeout`, return immediate fixed replies, and explicitly
pump each interval; their inspected start parks cannot be consumed by a real
timer during `settle()`. Its wasm storage operations finish through the device's
promise chain. No competing independently timed transport response was found.
The adapter cases in `delivery-clients.test.mjs` use 30 turns with mocked timers
and immediate fixed replies as well. No change was needed in either file.

Other delivery assertions either inspect stable settled state (reported,
refused, offline, backoff or parked debt), freeze the relevant timers, or
already keep the next send pending: slot/fairness, stale group, online
membership, cap/eviction, binding replacement and startup-barrier tests.
The older-membership reported/refused cases freeze timers. The lost-recorded
membership case already holds subsequent sends. No other assertion with the
reported race was found. Other delivery integration tests use explicit gates
or bounded eventual-condition waits rather than this eight-turn assumption.

Controlled scheduler probes supplement the repetition results:

- An extra pump in each `flush()` fails the old exhausted-boundary and
  serial-gate assertions. The generation case still passes this particular
  probe because its final wait calls `settle()` directly.
- Pumping specifically after the old generation test resolves its shared
  promise fails its owed assertion: actual `[]`, expected `[[2,2]]`.
- All **4/4** fixed cases pass with the extra pump. The production implementation
  is never substituted or edited by these probes.

## Load repetitions

Host `expose-builder-pixel`, Linux 6.8.0-138-generic, Node 24.13.1. Eight
Python busy loops and all repetition child processes share CPU affinity
`92,93,94,95`. They run from this worktree; no system load service or tool
installation. Each iteration launches a fresh Node test process. Every run's
exit, test totals and duration is recorded, including failures (none).

| Run | Pass count | Test-case passes |
| --- | --- | --- |
| Entire `delivery.test.mjs`, including both exhausted-boundary orders | **200/200** | **12,000** |
| Generation/viewer fence alone, additional repetitions | **100/100** | **100** |
| Serial-gate race alone, additional repetitions | **100/100** | **100** |

Total elapsed 96.428 seconds. Load workers consumed 327.45 CPU seconds in
aggregate; individual counters and their eight recorded PIDs are in
`round15/repetitions.json`. All were terminated by their recorded process
handles and reaped in `finally`. No unrelated process was touched. There were
zero failed, cancelled or skipped test cases across the 400 executions.

## Qualification and failures

The final requested checks and their totals are recorded in
`round15/verification.json`; compressed logs sit beside it.

| Check | Result |
| --- | --- |
| Delivery, queue, refusal, CAS, activation, presence, browser, prediction routing and source census | **436/436 passed**, zero failed/cancelled/skipped |
| Approval lifecycle/model/oracle, 240 seeds | **874/874 passed**, zero failed/cancelled/skipped |
| Initial delivery file / refusal audit | **60/60** / **30/30 passed** |
| Fixed cases with additional pumps | **4/4 passed** |

Package build,
typecheck and the merged CLI build pass. No tools were installed. Bun 1.3.14,
Rust 1.97.0; Cargo used eight jobs, incremental/dev debug disabled and the
packaged SQLite flag. The delivery/presence/browser group uses eight concurrent
files. Approval uses `SNAPBACK4_APPROVAL_MODEL_SEEDS=240`.

Failure disclosure:

- **Baseline, intentionally reproduced:** round-12 probe: one exhausted-boundary
  failure; extra-pump baseline batch: exhausted-boundary and serial-gate failures
  (generation passes); dedicated baseline generation probe: one owed assertion
  failure. Four assertion failures in three expected-red commands, all against
  unchanged baseline test logic and the unchanged production implementation.
- **Ours:** none in the new fixture or qualification runs.
- **Environmental:** none in test/build qualification. Read-only orientation
  encountered missing prior ignored `target/` artifacts and a guessed queue
  filename; the tracked reports, actual test paths and a local CLI build supplied
  the inputs. No qualification was skipped for these inspection misses.

The root reference audit passes: 521 LLP documents, 9,744 references, zero
errors or unchecked references. Changed source is 311 lines, below the
1,500-line cap. Whitespace passes. Wasm was remeasured, not rebuilt:
2,019,815 B raw / 585,193 B gzip, SHA-256
`fcb6e9a265f5c317efc6592eadd81cc439b9cf3a0d7310b2ebf6ef7de9286dd1`,
identical to round 14 and 1,000 B under the unchanged 586,193 B cap.

**Did not run `scripts/test.sh`.** The supervisor owns the landing suite.
No new full-suite, macOS, publication, comparative-performance or crash claim.
No product defect or design deviation found, no new outstanding issue. This
closes the delivery fixture race explicitly left open in round 12; unrelated
historical failures retain their original reports and disposition.

## Context and reproduction

Scoped `llp-orient` used the initialized sibling skill at
`/home/ccheever/sb4-intent/lane-a5/vendor/llp/skills/llp-orient/SKILL.md`.
Scope: queue test fixtures and retry/collection semantics. Governing in-flight
documents in `llp/current/`: LLP 3000 sections 3–4, LLP 3000.019 section 4 and
LLP 3000.022 section 4 (including stale callbacks). Read the receipts card and
client-operations delivery guidance. Active constraints and rationale are the
same-ID uncertain retry, original collection boundary and event ordering in
LLP 3000.022 section 4. No open design question or new LLP is needed; docs are
this report and the append-only journal. Hand-off: none.

From `snapback4/`:

```sh
mkdir -p target/lane-dc-round15
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build -p snapback4
python3 reports/20260927-dc-delivery-client/round15/repeat.py
node --test --test-concurrency=8 --test-reporter=tap packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/presence*.test.mjs packages/snapback4/test/web-review.test.mjs packages/snapback4/test/prediction-routing.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs
SNAPBACK4_APPROVAL_MODEL_SEEDS=240 node --test --test-reporter=tap packages/snapback4/test/approval-*.test.mjs
(cd .. && ./ref-check --verbose)
node --import ./reports/20260927-dc-delivery-client/round15/extra-pump.mjs --test --test-name-pattern='an exhausted attempt retains|generation and viewer fences|a pre-transport serial gate race' packages/snapback4/test/delivery.test.mjs
```

For the expected-red baseline controls, prepend `DELIVERY_BASELINE=1` to the
last command, or import `round15/generation-pump.mjs` with the generation test
pattern. Both select baseline test source from `b8400c291` in memory.
`round15/inputs.json` records the tested source hashes and merge/tool inputs.
The local commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
