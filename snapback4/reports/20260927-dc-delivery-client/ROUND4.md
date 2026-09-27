# Lane DC, round 4 — retained manifest debt and bounded receipt retries

2026-09-27, branch `sb4-intent/dc-delivery-client`. Local commits only;
no push, publication, version change, new dependency, shared tool installation,
or budget increase. Read all four prior prompts, reports and DC journal entries,
and both complete round-3 reviews before the repairs.

First fetched and merged `origin/main` as `d5ee26744`. Both parent journals
remain subsequences of the merged journal. Local publication keeps DC's
synchronous acceptance and main's server-read tracking. Main's split React
harness retains the DC receipts cases and main's clock and shared-journal cases.

## Files and findings

Paths below are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `crates/snapback4-device/src/device/delivery.rs` | Finding 1: keep unresolved manifest descriptors (without compiled columns) and their debt on older-schema reads. Move descriptors into the reconciled list; matching fingerprint adoption replaces them with the compiled descriptor. Removing a previously compiled binding drops only its fingerprint’s groups; old compiled publications cannot collect into newer manifest debt. |
| `crates/snapback4-device/tests/delivery.rs` | Intervening reads, close/reopen, matching adoption, later publication and compiled removal, on memory and SQLite, both without a compiled binding and with an older fingerprint at the same identity. |
| `packages/snapback4/src/delivery.ts` | Finding 2: startup waits for intersecting ready parked retries, excluding later debt and newly exhausted retries. Finding 3: replay-first `E_BOUND`, eight new-id burst retries, eight persisted wake retries, and a terminal parked state. Consume each bound wake once. No timer for a manifest-free answer. |
| `packages/snapback4/src/delivery-state.ts` | Persist bound replay/burst/wake counters on attempts and distinguish bound/terminal parks. |
| `packages/snapback4/src/local.ts` | Keep both merge behaviors; remove redundant comments to remain at 1,499 lines. |
| `packages/snapback4/test/delivery.test.mjs` | Exact persisted-41/post-start-1 startup race, session exhaustion, and dormant-queue timer regression. |
| `packages/snapback4/test/delivery-bound.test.mjs` | Backlog twice then third-id success; committed success hidden by a denial; no new id without a failed receipt; backoff, burst, wake spacing/coalescing, actual slow timer, restart and final cap. |
| `packages/snapback4/test/delivery-web.test.mjs` | Intervening-read adoption and compiled removal on wasm; actual local activation of 300 disjoint rows pauses at capacity and resumes after reporting; memory commit-gap test. |
| `packages/snapback4/test/web-review.test.mjs` | Actual IndexedDB commit-gap test and source override that injects an await after the passing guard. |
| `packages/snapback4/test/react.test.mjs`, `test/helpers/react-harness.mjs` | Merge main's harness split with the existing SDK-owned-delivery receipt recipe and tests. |
| `../llp/3000.022-delivery-the-sdk-reports.rfc.md` | Revised metadata and the requested §4 outcome-table row, including the eight-wake cap and why a denial needs same-id replay. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Explain replay-first bounds, retry/wake budgets, persistence and terminal notification. |
| This report and `JOURNAL.md` | Round record, measurements and verification. |

## Forms and behavior

No new Quarry syntax or wire field. The existing compiled/manifest/report
forms remain compatible. A manifest descriptor can be:

```json
{"table":"messages","mutation":"delivered","args":["conversation","from","through"],"fingerprint":"fixture:messages","rows":[["c",41]]}
```

An ordinary `delivery/read` under a schema without this binding now preserves
its debt. Adoption with the same fingerprint and compiled `group`/`position`
columns replaces the descriptor without losing that debt. Removing the compiled
binding later drops it. An older compiled fingerprint at the same `(table,
mutation)` cannot append rows to the new manifest debt or delete it when the
matching schema is adopted.

The direct request remains:

```json
{"id":"example-id","args":{"conversation":"c","from":41,"through":41},"store_id":"S","delivery":{"fingerprint":"fixture:messages"}}
```

For `{"denied":{"code":"E_BOUND"},"head":10}`, replay `example-id`.
A replayed `{"state":"sent","head":10}` retires the interval and mints
nothing. Only a replay with `{"state":"failed","why":{"code":"E_BOUND"},"head":10}`
permits the next id. New ids use 1, 2, 4, 8, 16, 32, 60 and 60-second backoff;
each id's first bound result is replayed with that same id. After those eight,
park without notification. Start, reconnect and the ten-minute timer permit
one new id per wake, at least 30 seconds after the last attempt. After eight
wake retries also fail and are confirmed by replay, notify once and retain a
terminal parked interval. This permits at most 17 dispatched ids for continuously bound
retained debt. Neither reconnect nor restart resets its counters; repeated
manifests do not revive terminal debt.

The cap of eight wakes is the engineering choice left open by the supervisor;
it is stated in the LLP and public operations documentation. The supervisor's
explicit amendment governs this work; LLP 3000.025 is not yet present in the
merged tree. The engine, server and DS/ER producer paths are not modified.

## Discriminating evidence

- Before the fix, the intervening read fails on **memory, SQLite and wasm**:
  expected manifest position 41, found no groups. Afterward adoption preserves
  owed/reported/refused state, and compiled removal still deletes it.
  A final check with an older compiled fingerprint reproduced another edge:
  publication appended position 43 under the new fingerprint, then adoption
  deleted its debt by table/mutation. Fingerprint-specific collection and
  retirement fix both. The expanded memory/SQLite/wasm cases pass; reverting
  fingerprint-specific retirement also fails the adoption assertion.
- Before the startup fix, position 1 dispatches while persisted retry 41 is
  ready and parked, and `flushed()` incorrectly returns true. Both omitting
  ready parks from the pending check and the reviewer's exact empty-snapshot
  filter mutation fail the added regression. An exhausted retry no longer
  holds the barrier; later traffic never joins the startup snapshot.
- Five of the first six bound tests fail before the new policy. Removing the
  first replay, allowing a bare denial to mint, resetting the burst on reconnect,
  or retaining a live park past the wake cap each fails its targeted test.
  A separate regression exposed and fixes spending one wake on multiple bound
  intervals after the first succeeds; later manifests also cannot spend it again.
- The blocked activation witness uses `localDelivery` and the actual wasm
  device. It stores 300 disjoint coordinates before viewer registration,
  observes a `blocked: true` enumeration page, holds the first report, then
  releases it and reports every exact run through position 600. Mutating
  `enumerationDone` to true on `blocked` fails that test.
- The memory and real Chromium/IndexedDB commit-gap tests queue a fence change
  from inside a passing guard. Current code commits in that same turn, before
  the queued change; a subsequent stale save is rejected. Injecting an await
  between the passing guard and the memory write or explicit IDB commit lets
  the queued change overtake commit and fails the test. This tests the absence
  of the gap without introducing an async gap into production.
- Main's newly merged React clock fixture found an unnecessary 250 ms timer
  after queries without delivery manifests. The queue now remains dormant;
  both the focused timer test and the full React harness pass. Restoring the
  unconditional schedule fails the focused test.

## Verification and size

Same no-optimizer production path as rounds 1–3: Rust 1.97.0,
wasm-bindgen 0.2.127, Node 24.13.1, Bun 1.3.14. The task-local bin contains
symlinks to existing Node/Bun; no tool was installed. Frozen install passed.

| Artifact | Raw B | Gzip B |
|---|---:|---:|
| Accepted round-1 remainder | 2,024,468 | 585,362 |
| Merged round-4 base, rebuilt | 2,022,931 | 585,318 |
| Full-suite artifact, before final rebinding edge | 2,023,287 | 585,349 |
| Final round 4 | **2,023,290** | **585,362** |
| Final round 4 minus accepted round 1 | **−1,178** | **0** |

The final round adds 359 raw / 44 gzip bytes against its rebuilt merged base
and exactly fits the supervisor’s accepted remainder. The checked-in gate
remains 572,841 B, so the final artifact reports 12,521 B over; integration
owns that already accepted ratchet change. Moving existing descriptors and
using fingerprint-specific removal keeps the repair within the allowance.
Production SHA-256:
`ed39afba813ad4561a5582110b878027603d72f9227079d36d093ad4e934714c`.

- Final delivery, source-census and Chromium persistence run: **138 passed**,
  zero failures or skips. Final queue subset: **61/61**, including nine bound
  cases. An earlier queue/React combined run passes **107/107**.
- Whole guide: **86/86**.
- Artifact serde-family and forbidden-server/Unicode checks pass.
- Package build/typecheck, README budget **300/300**, whitespace check and
  reference audit pass (517 LLPs, 9,640 references, zero errors/unchecked).
- Final complete device crate: **1,346 passed**, zero failed, three existing
  ignores; all 67 test binaries, 503 executions plus doctests. The expanded
  delivery target passes **26/26**.

Preflight corrections (not hidden by the passing rechecks): the added memory
restart test initially used `drop` instead of the host fixture's `close`, so
its reopen correctly refused an unsaved store. That fixture error is ours;
the corrected test uses the same host-close path as existing restart tests.
Main's clock test exposed the dormant queue timer, fixed in `16d156f47`.
The one-wake/two-interval test exposed and fixes bound wake reuse in this
round's initial implementation. One optional docs-budget invocation named a
nonexistent `readme-budget.mjs`; rerunning the actual `docs-budget.mjs` passed.
The final adoption-edge experiment first named the source from the wrong
working directory; it made no edit, and the corrected command succeeded.
Deliberate pre-fix/mutation failures are retained as regression evidence.

Implementation commits: `c7c234475` (findings 1 and 4), `16d156f47`
(findings 2 and 3, with the LLP row and dormant-queue correction), and
`3de80ad3c` (finding 1’s older compiled fingerprint edge).
All carry `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

Ran `scripts/test.sh` **exactly once**, exit 1. Exact summary:

```text
== 1 failure(s) in 1501 s
   wasm build
```

| Failure | Classification | Evidence |
|---|---|---|
| `wasm build` | **Baseline: accepted remainder exceeds unchanged gate** | That run rebuilt 2,023,287 B raw / 585,349 B gzip: 12,508 B above the checked-in 572,841 B gate, but 13 B below the accepted 585,362 B remainder. The final additional fingerprint fence reaches, but does not exceed, that remainder. |

No lane-owned or environmental full-suite failure. Every other phase passes:
Rust **3,933 passed / 24 ignored** across 246 binaries and 959 executions plus
doctests; main client **2,749 passed / 10 skipped**, seven additional client
shards **56/56**; models **78/78**; fixture wrappers **9/9**; all builds,
typechecks, docs-budget and release-guard phases except the stated wasm gate.
The inherited 60-second suite budget is exceeded and unchanged.

The final fingerprint edge was found after the full run's Rust/client phases.
The two added native cases and one added wasm case are therefore covered by
the final affected/device reruns, not claimed as part of that one full run.
The whole guide has no changed inputs after its passing run. No second full
suite was started.

Final complete device rerun exits **0**: **1,346 passed / 0 failed / 3 ignored**
across 504 result summaries, including doctests. All final affected and census
reruns also exit 0. There is no unresolved lane-owned failure.

## Reproduction and evidence

From `snapback4/`, use the existing worktree-local Node/Bun links and exclude
this host’s incompatible shared wasm optimizer, as in previous rounds:

```sh
export PATH="$PWD/target/lane-dc-round4/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin"
export CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/web-review.test.mjs
cargo test -p snapback4-device
cargo test -p snapback4-lang --test guide
node scripts/attribute-wasm.mjs --families --check-families --check-absent
bash scripts/build-wasm.sh
# The last command reproduces the sole baseline failure; inspect its size line.
# The exact full-run command was scripts/test.sh (once).
```

Final device rerun uses a copy of `scripts/run-rust-tests.mjs` under
`target/lane-dc-round4/`, replacing its two `--workspace` arguments with
`-p snapback4-device` and retaining its artifact inventory, all assertions,
seeds, deadlines and doctests; eight bounded processes. This runs the same
complete package inventory as the canonical `cargo test` command above.

Raw logs and deliberate mutant evidence remain in ignored
`target/lane-dc-round4/`: `full-suite.log`/`.exit`, `wasm-final.log`,
`affected-rebinding-final.log`, `device-rebinding-final.log`, `guide.log`,
`artifact-census-final.log`, and the named `*-mutant.log` files. The full-run
wasm is saved as `qualified-before-suite.wasm`; it was byte-identical before
and after that run. The final artifact hash above covers the subsequent
fingerprint fence.

Open baseline: run `bash scripts/build-wasm.sh` to reproduce the unchanged
size-gate failure. The existing tracked diet issue remains
`issues/20260913-snapback4-wasm-device-diet.md`; no duplicate ticket or budget
change was made.

## Scope and remaining limits

No design deviation from the four requested repairs. Existing limitations
from round 3 remain: hosts without conditional supplementary persistence
(process/Expo and unsupported custom adapters) omit fallback-manifest debt;
ordinary device publication collection remains transactional. Reproduce that
existing omission with a process/Expo or custom handle without
`[deliveryCommit]`: accept a server-only manifest row, then read delivery debt;
the answer resolves but no supplementary debt is written. This is the approved
under-reporting fallback, not an unguarded write. No new complete
comparative choreography, DS/ER server integration, full wasm path matrix,
native process-kill witness or IndexedDB crash witness is claimed. The browser
witness checks transaction order/abort, not a browser crash.

Used `llp-orient` from the initialized lane-a5 vendor checkout because this
worktree's skill link is uninitialized. Context: LLP 3000 §§1–4 (fence and
budgets), LLP 3000.022 §§3–5 (collection, retries, identity and acceptance),
LLP 3000.018 §3.2 (overtaken replies), and LLP 3000.002's device-codec diet.
The delivery RFC remains in `llp/current/`; no new LLP or gate was added.
