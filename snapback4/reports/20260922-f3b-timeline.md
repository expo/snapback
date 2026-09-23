# F3b — declared Following on devices and snapshot recovery

**Status:** complete; all requested verification passed; ready for supervisor review.
**Base:** `4218f4a4fff4be87c22def2182230e560b2654b6`, branch `sb4-03/f3b-timeline`.
**Date:** 2026-09-22.

The worktree was already reset to the commissioned F3a review commit when
this restarted lane began; all untracked evidence was intact. The preserved
provisional patch and device tests were reused, adapted to F3a's digest IDs,
renamed followed index, fail-closed removal and scoped RAII write authority,
and verified before extending them. No commit, push, stash or `llp/` edit.

## Governing context

Read-only LLP orientation covers the timeline transition, classification,
provisional device transaction, partition stream and SDK recovery paths.
[LLP 3000.007.003 §3.3 and §5](../../llp/3000.007.003-the-engine-writes-derived-data.rfc.md),
**revision 7 at `b86c35fdf`**, governs this lane. Its exact text was read via
Git after fetching the updated main; the older checked-out LLP is untouched.
[LLP 3000 §1 and §4](../../llp/3000-snapback4.explainer.md) governs the shared
interpreter and workspace fence. F3a's two reports and the executable feeds
and timelines cards supplied the current oracle and integration constraints.
The lane needs no new design decision or LLP hand-off.

Revision 7 replaces the original universal composed-commit bound with two
obligations: bound the form's derived contribution, and prove SDK snapshot
recovery of an oversized historical commit. No write-time enforcement was added.

## Classification, shared execution and identity

| Transition | Device behavior |
| --- | --- |
| Profile insert | Predicts profile plus mode if required inputs are held |
| Post insert | Predicts app card, source event and deliveries; one follower means four rows |
| Repost insert | Predicts attribution, distinct source event and deliveries when the original is live and held |
| Removal flag / repost delete | Predicts app change, tombstone and source/broadcast removals |
| Follow / unfollow | Queues the whole mutation with zero rows, including the application edge |
| Unheld input / partial acquisition | Queues the whole mutation with zero rows |
| `<name>[viewer]` read | Uses the existing held-row merge, tombstone filtering, cursor and completeness semantics |

`schema/timeline.rs::Timeline::inputs` names implicit transition dependencies;
`lang/src/bind/timeline.rs::write_site` feeds them into existing residency
classification. Synced inputs are Held; online-only slot counts are Server.
The runtime rejects device follow/unfollow even with classification metadata
stripped. Point/scanned inputs preserve unknown coverage; retained-only point
images cannot justify a prediction. Foreign inbox outputs need not be held.

`core/src/engine/timeline.rs` is the single server/device implementation of
profile registration, posting, reposting, removal and delivery. Its new
`timeline/online.rs` contains only follow/unfollow, promotion and slot accounting
and is excluded from the web build. F3a's scoped write authority and ordinary
validation, constraints, indexing, transaction and meter paths remain in use.

The shared `timeline_insert` calls the existing pure
`schema::timeline::owned_id`, with the same public natural-key inputs on every
host. Non-event owned rows consume no caller IDs. Originals keep their post
ID; a repost consumes IDs for its app attribution and fresh public source event.
Tests assert exact predicted/server row identities and values with the same
admitted event-ID supply. Settlement removes foreign provisional copies,
refusal withdraws all predicted changes, and reconnect replay preserves rows
and the minted repost IDs. No serialized IR/value/key encoding changed.

## Derived byte bounds and actual promotion pages

`check --cost` now reports per-operation derived stream contributions, including
conservative per-event framing and commas. It sums all recipient rows, so it
bounds any one recipient's derived part. Application rows, acknowledgements
and outer reply framing are separately excluded and explicitly named. Online
counts and unreadable internal totals never enter the sync stream.

| Operation | Derived bound (B) | Margin below 16,777,216 B |
| --- | ---: | ---: |
| Profile insert | 385 | 16,776,831 |
| Pushed event insert | 51,653 | 16,725,563 |
| Shared event insert, including saturated own copy | 2,854 | 16,774,362 |
| Removal | 895 | 16,776,321 |
| Follow backfill | 861,540 | 15,915,676 |
| Maximum-backfill promotion | **888,757** | **15,888,459** |
| Unfollow | 148,149 | 16,629,067 |
| Purge chunk | 148,305 | 16,628,911 |
| Unchanged flag / profile deletion / activation | 0 | 16,777,216 |

The ordinary regression asserts that promotion is the largest listed derived
contribution and fits with 512 B additional framing reserve. A deliberately
conservative 512-byte declaration-name case is also asserted against the ceiling
(the portable table-plus-index label bound): **1,355,101 B**, margin
**15,422,115 B**. Actual admitted names are smaller due to portable index labels.
These are bounds for one listed operation, not admission guarantees for arbitrary
compositions or later application-row growth.

A separate real-engine trace registers authors, publishes 1,000 events, follows
from 50 readers, then promotes on reader 51 with the newest 865-event backfill.
Setup uses ordinary mutations, default meters and maximal 135-byte public
identities. Promotion writes exactly 1,023 rows. Plain encoded stream replies,
including actual store identity, measured:

| Recipient class | Actual reply (B) | Derived events (B) | Reply margin (B) |
| --- | ---: | ---: | ---: |
| Triggering reader | **834,456** | 833,859 | **15,942,760** |
| Author | 1,459 | 862 | 16,775,757 |
| Existing follower | 1,459 | 862 | 16,775,757 |
| Public-only reader | 962 | 365 | 16,776,254 |

The bound is **asserted**, not enforced by a new write-time rule. The original
maximum-width arbitrary-app/composition matrix was superseded by revision 7.
The CLI's actual `check --cost --residency --verbose` output is retained in
`/tmp/sb4-f3b-evidence/cost-residency.log`.

## Positive SDK regression and preserved counterexample

`experiments/f3b-deliverability/reproduce.mjs` now drives `createLocalClient`
on the real WASM/memory and native/SQLite process devices. The ordinary package
test invokes that same experiment. It uses the existing fixture, actual HTTP
encoding, public operations and default ceilings. `/sync` responses are never
mocked or rewritten. Fault injection delays the link and mutation submission;
direct device calls only inspect state/outbox evidence.

1. Both clients acquire watermark 1 and each queues a predicted timeline post.
2. A server mutation publishes a post plus 1,021 empty notes (1,024 writes).
3. Each note grows in its own mutation to 9,000 newline characters. Each
   individual encoded update fits the ceiling.
4. Both clients remain behind the original commit. It now exceeds the ceiling
   because stream replay substitutes current row images.
5. Each SDK reduces its request to limit 1, receives `snapshot: true`, restarts
   from snapshot and reaches watermark 1,023 in the same generation.
6. Each client's Following contains the server event and its pending post;
   pending write ID, arguments, event IDs and predicted keys survive unchanged.
7. Mutation submission is released. Both writes settle, outboxes empty, and
   both complete Following pages exactly equal the server's three events.

Focused result: **passed in 29.783 s** in the final affected-package run. Actual first HTTP response: **150,928 B**;
largest later one-row response: **18,317 B**; both clients recover, each with
one pending write intact. This is a positive SDK regression of recovery, not
a claim that the historical commit becomes stream-deliverable.

The original counterexample remains valid and is retained in
`timeline_delivery_counterexample.rs`, the experiment's fixture, and this
report. On original F3a `55a9c0fd9c`, the preserved Rust measurement was:

| Recipient / historical commit | At admission (B) | After later growth (B) |
| --- | ---: | ---: |
| Public-only | 146,471 | **18,524,473** |
| Author | 146,714 | **18,524,716** |

The largest later commit was only 18,313 B. The original HTTP run measured
150,852 B initially and 18,317 B for the largest update. Its direct devices
remained at watermark 1 with empty Following while the server had one event.
That original run intentionally did not drive SDK recovery and made no
permanent-wedge claim.

The retained Rust experiment also passes on this reviewed-F3a-based lane.
The public-only measurements remain 146,471 → 18,524,473 B. Digest-owned IDs
make the author measurements 146,790 → 18,524,792 B, exceeding the ceiling by
1,747,576 B. Its largest later commit remains 18,313 B. This ignored evidence
test was explicitly run; the positive SDK regression is an ordinary package test.

Original stop reasoning, now resolved: sizing newly admitted row images cannot
keep an old commit below the ceiling after later updates. The stream's
current-image replacement is intentional. Revision 7 chose bounded derived
rows plus existing snapshot restart, and this lane implements/tests that ruling.
The complete original report is also preserved at
`/tmp/sb4-f3b-evidence/original-stop-report.md`.

## WASM and commit/journal wording

The reviewed F3a baseline is **1,616,682 B raw / 448,774 B gzip**, from its
round-1 report (the earlier brief's 447,508 B predates those review fixes).
F3b measures **1,639,719 B raw / 456,166 B gzip**: **+23,037 raw / +7,392 gzip**.
The prior 452,000 B budget was exceeded by 4,166 B. The authorized ratchet is
now **457,000 B**, leaving **834 B**, rounded to the next 1,000 B.

Attribution is to the shared device transition feature as a whole: profile,
event and removal derivation; held-input checks; and the shared timeline-insert call to the existing
digest identity helper. Individual subcomponent deltas were not measured.
No duplicated server/device implementation was added. Excluding online-only
follow/promotion/slot helpers minimizes web reachability. Cost reporting and
compiler classification add no runtime web implementation.

Commit/journal-ready wording: “Enable the declared Following timeline in the
shared device interpreter, with held-input rollback and digest owned IDs.
Following edge mutations remain queued because slot accounting is online-only.
Prove SDK snapshot recovery of an oversized historical timeline commit on WASM
and SQLite with pending writes intact. The shared transition feature adds
7,392 B gzip over reviewed F3a; raise the WASM ratchet from 452,000 to 457,000 B.
Online-only promotion code stays out of the web build.”

The supervisor owns the commit and journal landing. This lane leaves the
existing 46,398-line journal untouched, consistent with the commissioned
1,500-line file constraint; the exact paragraph above is ready for its entry.

## Mutation proof

In `/tmp/sb4-f3b-evidence/mutation-copy/`, the sole runtime mutation made device
posting assume an unpromoted author mode without reading/checking coverage.
Both `declared_timeline_unheld_memory` and `declared_timeline_unheld_sqlite`
failed: each predicted four rows with `predictable: true` despite an unheld
mode. Exit **101**, **0 passed / 2 failed**, 53.676 s including compilation.
The mutation was restored in a `finally` block. SHA-256 manifests of every
one of **1,198 copied files** compare byte for byte before/after restoration.
The primary worktree was never mutated. Logs and both manifests are retained
as `mutation-proof.log`, `mutation-proof.json`, and `mutation-summary.log`.

The temporary copy reused the native Cargo target directory. Although all
copied sources were restored, the first broad device check reused its mutant
core artifact and failed four tests (missing mode and promoted delivery, both
stores). This failed run is preserved in `verify-device.log`. The source digests
were checked equal, then the core's 20 fingerprint cache directories were
invalidated. Subsequent compilation explicitly rebuilt the primary core. The
fresh full device result below is the qualification result; future mutation
proofs should use an isolated target directory to avoid this cache ambiguity.

## Verification

Results and full output are retained under `/tmp/sb4-f3b-evidence/` in
`verify-results.json`, `final-checks.json`, and the named command logs.
All commands use non-login shells, the commissioned Node 24.18.0 PATH,
`CARGO_BUILD_JOBS=4`, and four Rust test threads. Heavy command invocations are
serial. The final suite runs once after the direct checks, with
`SNAPBACK4_RUST_TEST_PROCESSES=1` and `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`
to limit contention on this shared host.

| Command | Result |
| --- | --- |
| `cargo test -p snapback4-device` | Fresh run exit 0; 909 passed, 3 ignored; 445.786 s, including 4m 23s compilation |
| `cargo test -p snapback4-lang` | Exit 0; 360 passed, 4 ignored; 104.243 s |
| `cargo test -p snapback4` | Exit 0; 324 passed, 2 ignored; 143.806 s |
| `cargo test -p snapback4-sim` | Exit 0; 505 passed, 4 ignored; 198.093 s |
| `cargo test -p snapback4-core --test corpus` | Exit 0; 18 passed; 4.060 s |
| `cargo test -p snapback4 --test timeline_delivery_counterexample -- --ignored --nocapture --test-threads=1` | Exit 0; 1 passed; 2.785 s |
| `cargo test -p snapback4 --test timeline_delivery -- --nocapture` | Exit 0; 1 passed; 6.798 s; final measurement output retained |
| `node --test --test-concurrency=1 packages/snapback4/test/timeline-delivery.test.mjs packages/snapback4/test/wasm-budget.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs` | Exit 0; 29 passed; 37.594 s |
| `bun run --cwd packages/snapback4 typecheck` | Exit 0; 0.674 s |
| `bash scripts/build-wasm.sh` | Exit 0; 456,166 B gzip under 457,000 B; 1.511 s |
| `node scripts/docs-budget.mjs` | Exit 0; README 300/300, executable guide check passed |
| `git diff --check` | Passed |
| `scripts/test.sh` — invoked once, last | Exit 0; exact summary below |

The language run includes every executable Quarry guide block. The device
regressions cover twelve cases across the two stores. The read test also checks
that interrupted acquisition reports unknown coverage, following the existing
API's acquisition refusal rather than returning a complete Following page.

Final full-suite result, verbatim:

```text
== 0 failure(s) in 1174 s
```

Load averages (1 / 5 / 15 minutes): **21.06 / 23.22 / 24.06** at start;
**29.04 / 37.51 / 36.89** at completion. Wall time recorded by the wrapper:
1,174.290 s. Every group passed, including the release guard, executable
documentation, app checks, fixture wrappers, the macOS witness and doctests.
The full client run reports **953 passed / 3 skipped / 0 failed**; its timeline
recovery case passed again in 28.522 s with the same measured bytes and final
three-event Following page. Rust executed all 811 scheduled test executions
plus workspace doctests. The complete log is `restart-full-suite.log`, with
load/exit metadata in `restart-full-suite.json`.

This serial, loaded-host run exceeded the existing 60 s suite target; the
workspace test compilation alone took 6m 11s. No timing-budget qualification is
claimed. The full suite was not repeated. All 18 changed/added files are under
1,500 lines (largest: `feeds.md`, 1,460); no unrelated changes or LLP edits.

## Files changed

All paths below are relative to `snapback4/`:

- `crates/snapback4-core/src/engine/timeline.rs`
- `crates/snapback4-core/src/engine/timeline/online.rs` (new server-only module)
- `crates/snapback4-core/src/schema/timeline.rs`
- `crates/snapback4-lang/src/bind/timeline.rs`
- `crates/snapback4-lang/src/guide/codes.rs`
- `crates/snapback4-lang/src/guide/feeds.md`
- `crates/snapback4-lang/src/guide/timelines.md`
- `crates/snapback4-device/tests/timeline.rs` (both-store regression suite)
- `crates/snapback4/src/timeline_cost.rs`
- `crates/snapback4/tests/timeline/admission.rs`
- `crates/snapback4/tests/timeline_delivery.rs` (derived bounds and measurement)
- `crates/snapback4/tests/timeline_delivery_counterexample.rs` (retained evidence)
- `experiments/f3b-deliverability/schema.q`
- `experiments/f3b-deliverability/reproduce.mjs`
- `experiments/f3b-deliverability/README.md`
- `packages/snapback4/test/timeline-delivery.test.mjs`
- `metrics/wasm-budget.json`
- `reports/20260922-f3b-timeline.md`

## Observations not changed

Existing compiler warnings and named conformance skips are not repaired here.
Historical arbitrary-application row growth remains possible by design. The
asserted byte bound covers derived events, while SDK recovery covers oversized
historical composition. The test link delays do not qualify browser persistence
or a physical Expo device; they exercise the shipped WASM and native SQLite
implementations through the real SDK.
