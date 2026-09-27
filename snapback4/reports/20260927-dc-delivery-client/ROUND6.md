# Lane DC, round 6 — one persistent group bound budget

2026-09-27, branch `sb4-intent/dc-delivery-client`. Local commits only; no push
or publication. Read rounds 0–5 prompts, reports and journal entries and
Astra's full round-5 NOT READY review. Grok supplied no round-5 review.

Fetched and merged `origin/main` first in `4cef35d70`; the only conflict was
JOURNAL.md. A subsequence check confirmed both complete parent journals remain
in order. Implementation and its documentation are in `57d8f1044`; `454fccead` fixes
the full-run consumer TypeScript narrowing regression. `d9d6e681c` pins an
immediate terminal refusal on the last full/start wake; `633c02d67` notifies
activation when the pump disposes of an interval without transport.

## Files and findings

Paths are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `packages/snapback4/src/delivery-state.ts` | Group-owned `BoundBudget` stores burst count, wake count, spending coverage and last-attempt timing; attempts keep only a replay flag. Interval trimming preserves accounting. Whole-group eviction saves and restores it in fingerprint-scoped tombstones. |
| `packages/snapback4/src/delivery.ts` | One debit path for replacement ids, including resumed full/start parks and changes to recorded retryable refusal types. Every replay-confirmed bound failure joins the shared budget. Success subtracts its spending coverage and clears the counters only when that coverage is finished. Unrelated success cannot reset it. Membership refusal retains the budget with retired state. Terminal exhaustion persists refused coverage and notifies once. |
| `crates/snapback4-device/src/device/delivery.rs` | Both native collectors and wasm keep group accounting while trimming debt, carry it into retirement and restore it by fingerprint. Removes round 5's partially-spent-budget saturation workaround. Refused-set saturation is unchanged. |
| `packages/snapback4/test/delivery-bound.test.mjs` | Rewrites round 4/5 fixtures for group accounting. Adds full/start/restart cycles, recorded-refusal transitions, successful versus unrelated coverage, interval split/merge, stale tombstone clearing, group-dropping/range refusals and two spending intervals sharing one allowance. |
| `packages/snapback4/test/delivery.test.mjs` | Rewrites persisted bound-startup fixtures; checks fingerprint-scoped restoration of the budget as well as refusal suppression. |
| `crates/snapback4-device/tests/delivery.rs` | Memory/SQLite pressure and restart coverage now checks retained counters rather than saturation; includes attempt, bound, retry, full, start and stopped states under both interval and 4,096-group eviction. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Group budget lifetime, successful-coverage reset and tombstone behavior. |
| `../llp/3000.022-delivery-the-sdk-reports.rfc.md` | Requested one-sentence E_BOUND-row amendment, Revised entry, and replacement of obsolete per-attempt/saturate-on-pressure prose. |
| `JOURNAL.md`, this report | Append-only round record, measurements, tests and exact full-suite result. |

## Behavior and examples

No new Quarry form, public API or request field. Existing accepted manifests
still report only their collected positions:

```json
{"fingerprint":"fixture:messages","table":"messages","mutation":"delivered","args":["conversation","from","through"],"rows":[["c",41]]}
```

The direct report remains:

```json
{"id":"bound-10","args":{"conversation":"c","from":41,"through":41},"store_id":"S","delivery":{"fingerprint":"fixture:messages"}}
```

After eight burst replacements and one wake replacement, the internal group
record is equivalent to:

```json
{"bound":{"retries":8,"wakes":1,"runs":[[41,41]],"at":600000}}
```

`RUNS_FULL` or a start park can discard an attempt, but cannot discard that
record. Restart restores it, and the next replacement spends wake 2. Four
alternating full/bound or start/bound cycles end at exactly 17 distinct ids,
one `onDeliveryRefused` with `E_BOUND`, and `refused: [[41,41]]`. A final wake
ending in full/start also refuses immediately, without waiting for another wake. Later pressure,
recollection, reconnect and restart stay silent for 41.

Recorded `E_CONFLICT` and another retryable refusal (`E_BUSY` fixture) also
spend that allowance. A new id resets only its replay flag. `denied: E_BOUND`
without a failed receipt remains uncertain and replays the same id. A hidden
committed success still executes once and clears the covered spending debt.

Two distinct intervals have two initial ids, but share the same sixteen
replacement ids (eight burst plus eight wakes); each terminal interval gets
one callback. The cap does not limit ordinary successful reports for new rows.
Spending coverage remains on the group through merges/splits, so unrelated
success cannot replenish counters and partial success cannot forget the rest.

## Test discrimination

The queue subset passes 88/88 tests after the consumer-typing correction;
the broader delivery, browser persistence and source-codec run passed 163/163
before that runtime-equivalent guard. The corrected routes target passes 9/9; the final queue/activation follow-up
passes 91/91. The actual wasm collector
still passes the 17-id terminal pressure/recollection test. Native delivery
passes 30 tests, including both storage implementations and all six pressure
locations.

Nine isolated module-loader mutations fail without editing production files:

1. Delete the group budget when parking full: the full/restart cycle fails.
2. Delete it when parking start: the start/restart cycle fails.
3. Delete it when transitioning to a recorded retryable refusal: both refusal
   transition tests fail their spent-allowance assertion (Astra's surviving
   per-attempt mutation, translated to the new owner).
4. Clear it on any success: the unrelated-success assertion fails.
5. Keep the replay flag set after minting a different id: the replay-first
   assertion fails.
6. Skip the debit on a resumed/recollected interval: wake, restart, pressure
   and cumulative-cap assertions fail.
7. Omit accounting from the retired tombstone: all partial group-eviction and
   membership-refusal preservation cases fail.
8. Omit the second interval from shared spending coverage: its wake count fails.
9. Defer a definitive full/start refusal on the last wake until another wake:
   both immediate-terminal-callback assertions fail.

The original replay-first, backoff-versus-park, startup barrier, transport park,
pressure/refusal suppression, acceptance, outbox and blocked-activation
witnesses remain. Refused-set saturation still stops at 64 intervals.

## Qualification

Evidence: `target/lane-dc-round6/`. Frozen Bun install, package build/typecheck,
reference audit and whitespace checks pass. Existing worktree-local Node/Bun
symlinks and the existing Cargo tools were used; no tool was installed on a
shared path. Node 24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen 0.2.127; the same
no-wasm-opt configuration as prior accepted measurements.

| Device wasm | Raw B | Gzip B |
|---|---:|---:|
| Round 5 | 2,022,790 | 585,118 |
| Round 6, including merged main | 2,022,584 | 585,153 |
| Accepted round-1 remainder | 2,024,468 | 585,362 |
| Unchanged checked-in gate | — | 572,841 |

Round 6 is **209 B below** the accepted remainder, and 35 B gzip above round 5
including the merged main changes. The checked-in gate still reports the
baseline overrun of 12,312 B. No budget, compiler profile, codec allowance or
meter changed. Production wasm SHA-256:
`9f5baab9254c95c2a173141e28a59f776a6e95a9f65e17ae8c9ec4745d7d3f4f`.
Artifact serializer-family and forbidden-code/Unicode absence checks pass.

Complete device: 1,361 passed, zero failed, three ignored. Whole guide: 86 passed, zero failed.
Reference audit: 518 LLP docs, 9,656 refs, zero errors and unchecked refs.

Ran `scripts/test.sh` exactly once, exit 1. Exact summary:

```text
== 2 failure(s) in 1548 s
   wasm build
   cargo test
```

| Failure | Attribution and final disposition |
|---|---|
| `wasm build` | **Baseline**: 585,153 B gzip exceeds the unchanged 572,841 B gate by 12,312 B, while staying 209 B below the supervisor's accepted remainder. Reproduce with `bash scripts/build-wasm.sh` on this toolchain. No budget change. |
| `cargo test`: `snapback4-lang::routes::generated_route_handlers_typecheck_against_the_real_runtime` | **Ours, fixed**: `TS2345` at `delivery.ts:170`, an inferred optional refusal value under consumer TypeScript options. Fixed by explicit value narrowing in `454fccead`; all nine route tests and all 88 queue tests pass afterward. The full-run red remains recorded. Reproduce the old failure on `57d8f1044` with `cargo test -p snapback4-lang --test routes generated_route_handlers_typecheck_against_the_real_runtime`. |

No environmental failure. The full Rust phase records **3,961 passed, one
failed, 24 ignored**. Main client tests pass **2,778**, with ten existing skips;
all seven additional shards pass **56/56**; fixture wrappers pass **9/9**.
All **78/78** seeded client model tests pass. Every other full-suite phase passes. The inherited 60-second
whole-suite timing target remains exceeded; no timing threshold changed.

Reproduction from `snapback4/`, using the worktree's existing pinned Node/Bun
bin directory plus Cargo/system tools (excluding shared incompatible wasm-opt),
`CARGO_INCREMENTAL=0`, `CARGO_BUILD_JOBS=8`, dev/test debug info disabled and
`ulimit -n 65536`:

```sh
export PATH="$PWD/target/lane-dc-round5/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin"
export CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/web-review.test.mjs
cargo test -p snapback4-device --test delivery
cargo test -p snapback4-lang --test guide
node scripts/attribute-wasm.mjs --families --check-families --check-absent
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

The complete-device run reused the previous worktree-local copy of the normal
Rust test driver with its workspace selectors narrowed to `snapback4-device`;
it retains the full Cargo inventory, sharding and doctests. The full suite
runs the original driver. Its route-consumer typing failure was fixed while
the Rust phase was still running, before the client phase; the focused route
and queue rechecks passed. The one-line activation notification was added
during the client phase and passes the final 91-test queue/activation recheck. No second full-suite invocation.

Preflight failures were ours and fixed before the full run: optional-field
TypeScript construction, two fixtures still assuming per-attempt counters or
per-interval wake timing, and an explicit undefined property breaking exact
manifest-adoption equality. Mutation failures are deliberate negative controls.

## Decisions, deviations and remaining limits

Used `llp-orient` from the initialized lane-a5 checkout. Governing context:
LLP 3000 §§1–4, LLP 3000.022 §§3–5 (in current), LLP 3000.021 §3.2 as amended,
and LLP 3000.002's codec/wasm constraints. No new LLP or gate.

Engineering details where the brief is silent: merged spending
coverage identifies which success may release the shared allowance; all
outstanding spending coverage must succeed before counters clear. A start
park of a budget-bearing interval defers intermediate application notification
so the requested cycle has exactly one terminal callback. Ordinary start
parks without a bound budget keep their existing callback. Group-dropping
server refusals retain accounting in tombstones; explicit device Left, binding
replacement and store/viewer lifetime fences keep their existing meaning.
These choices are stated in the governing delivery document. No change to
acceptance, authorization, disclosure, outbox order or engine meters.

Open baseline: `bash scripts/build-wasm.sh` reproduces the unchanged checked-in
size gate; the supervisor owns applying the already accepted remainder.
Online queues are memory-only, so a new process starts fresh. The previous
conditional-host limitation also remains: accept a fallback manifest on a
process/Expo or custom device without `deliveryCommit`, then read delivery
state; the answer resolves but supplementary debt is omitted. Ordinary device
publication remains transactional. Full comparative choreography, DS/ER server
integration, complete wasm path parity and native/IndexedDB crash witnesses
remain outside this round's claim. No push or publication.
