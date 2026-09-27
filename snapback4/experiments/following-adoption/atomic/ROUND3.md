# Lane FA round 3: reconcile atomic launch with main's preflight

Merged `origin/main` at `5cb94a8a07458b9e1b62c1a44842fdda8e96002f`
(including calibration-23 landing `166fe0579`) into
`sb4-intent/fa-following-adoption`. Kept both journal histories: a line-multiset
comparison finds zero missing lines from either parent. This round commits
locally; it neither pushes nor publishes. The whole atomic launch still awaits
both reviewer families.

## Finding and resulting program

The landed preflight and the lane's launch implement different versions of the
same adoption contract. Retaining an empty-source check would reject valid dev
launches. Merely removing it would omit the copy ceiling and fresh-name checks.
Both CLI check and runtime now call `timeline_launch::preflight`, which performs
the structural checks, retirement-aware source estimate and admission. Runtime
calls it before the activation transaction and again under the writer lock.
Entry points (paths relative to `snapback4/`):
`crates/snapback4-core/src/store/timeline_launch.rs:58`,
`crates/snapback4-core/src/store.rs:119`,
`crates/snapback4-core/src/store/activation.rs:65`,
`crates/snapback4/src/verbs/adoption.rs:10`.
Retirement uses the same pinned-time predecessor predicate as runtime activation;
counts exclude rows it will remove. Orphan reposts now fail in that shared
preflight, before construction.

The builder can add this to existing qualifying posts, reposts and follows:

```quarry
view activity:
  posts where .parent = null and not .removed { post: .id, actor: .author, at, repost: false }
  reposts { post, actor, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] }
```

This starts the feed now: all own retained events and the newest 1,000 live
events per current follow, with no refill on removal. Repost identities and
edge epochs are fresh; delivery history is not reconstructed. Launch can include
older events a historical inbox never received. Devices reacquire at generation
publication. Writes and syncs wait; detached reads retain the predecessor.

`check`, including `check --store <path>`, reports `N_TIMELINE_ADOPT` at the
view: the launch contract, sources, copies, estimated writer-lock time and
deployment flag. Dev succeeds automatically. Deploy requires
`--allow-feed-adoption`; the flag never overrides the unchanged 5,000,000-copy
ceiling. The ceiling refusal includes the estimate and planned `home` alternative.
The CLI and runtime equality tests fail on a diverging verdict. Check changes
neither database nor WAL bytes.

The feeds card removes the ordering rule and remains short: **17,630 bytes**,
65 fewer than round 2. The incoming LLP 3000.016 §2.1a and LLP 3000.015 §2
paragraphs are amended in place, preserving the receipt-gap guidance. Ticket
item 2 records FA's branch reconciliation and pending review/landing. Item 1
remains lane ER's work; the ticket stays open.

## Governing context and review scope

Scope: Following activation, check diagnostics, guide and their tests.
[LLP 3000.026 §§3–4](../../../../llp/3000.026-following-over-a-populated-store.rfc.md#3-launch-contract)
(current, Draft) records the supervisor-commissioned atomic implementation.
[LLP 3000.016 §2.1a](../../../../llp/3000.016-following-on-a-bounded-device.rfc.md#21a-owned-events-follow-their-source-rows)
(Implemented) governs filled slots and device reacquisition;
[LLP 3000.014 §7](../../../../llp/3000.014-a-child-reads-through-its-parent.rfc.md#7-activation)
governs retirement before capture/projection;
[LLP 3000.019 §3.6](../../../../llp/3000.019-what-the-builder-still-wrote.rfc.md#36-p10-adding-a-view-never-stalls-reads)
(current) governs detached predecessor reads. None is in `foundation/`.
Authorization, device floors, meters and the wasm budget remain unchanged.
The atomic transaction is the commissioned long-lock exception to short online
adoption. No chunks, application fence, reservations, staging image or roster
tasks were introduced. Skill hand-off: none in this round; supervisor review
follows this commit.

## Rejected options retained for review

These are the existing design's counterexamples, retained rather than reopened.
Section references in this table refer to LLP 3000.026.

| Rejected option | Counterexample / tradeoff |
|---|---|
| Delete the guard and claim history | Same sources yield 1,001 early-follow copies or 1,000 late-follow copies; repost ids also differ (§2) |
| Infer epochs from `.at` or application ids | Equal/backdated timestamps and reused follow ids cannot distinguish refollow; old cleanup can delete new copies |
| Hash repost source id across incarnations | Tombstones or saved ids can name a recreated event. First-use restriction excludes retired-name reuse; A-salting is additional protection, not its justification |
| Replay ordinary mutations as importer | Retained repost of a removed original refuses; effects can repeat and a second declaration remints the first one's repost slots |
| Skip birth records | Later backfill parks `FEED_APP_NOT_FOUND` at `work.rs:87`; guessed order crosses the admission boundary |
| Same-name re-add beside a literal default | Offline device preserves stale same-named images; fresh slot namespace forces reacquisition (probe) |
| Copy all history per edge | 1,001 pre-launch events exceed the ordinary follow window; sound as a different product contract, unbounded per edge |
| Only global newest 1,000 | Quiet followed actor's sole event lies behind 1,000 unrelated posts |
| Treat missing task/slot as done/absent | Undiscovered reader B gets complete empty home; unfilled repost slot fabricates absence |
| Wait without id reservation / fence only HTTP | Retried waiters run twice; an independent job's receipted removal vanishes under a staged swap |
| Unchanged live backfill or last-id source walk | Continuous backdated inserts prevent exhaustion; behind-cursor inserts are missed; removals refill a supposedly frozen window |
| Oldest-first or actor-by-actor copying | Partial home shows old events before uncopied newer roster members; per-reader merged order is required |
| Add a Work kind enum | Shared Work schema changes force unrelated devices to drop images (`successor.rs:246`); use a cursor tag |
| One giant transaction as an **online** publisher | Crash loses all progress and writes/syncs wait; accepted instead as bounded atomic launch with explicit release opt-in (§4) |
| Planned query as scalable adoption replacement | Sparse 9,000-row suffix cuts with no continuation; no materialized inbox or offline floor |


## Measurements and qualification

The round-2 timing samples remain **46.901 s** of writer lock at 1×
(340,697 copies) and **696.667 s** at 10× (3,407,033 copies), measured through
release-profile `Engine::adopt` on the calibration-22-shaped fixtures described
in [REPORT.md](./REPORT.md). They were not re-timed in this round. The estimator
still uses 7,000 logical row writes/s, and the hard ceiling is still 5,000,000
copies. This round adds correctness coverage for retirement-aware estimates and
preflight admission, not an online performance claim.

Post-merge affected checks:

| Check | Result |
|---|---:|
| Atomic launch (including parent-invoked process-death child) | 7 passed |
| Retained-source research regressions | 4 passed |
| Language Following / background / epoch | 8 / 17 / 1 passed |
| Whole guide | 86 passed |
| CLI Following / timeline / adoption / delivery / counterexample | 2 / 23 / 14 / 1 / 1 passed |
| Core activation equivalence | 6 passed |
| HTTP query/sync/write launch isolation | 1 passed |
| Complete device package | 1,324 passed, 0 failed, 3 existing ignored; 67 harnesses |
| JavaScript wasm codec census | 26 passed |

The new comparison fixtures cover valid originals/reposts/edges, orphan reposts,
self-follows, first-use namespace refusal, the copy ceiling, unchanged adoption,
and the eight expiry × read-through-change × existing-declaration cases.
They compare check/API/runtime, copies actually constructed, located notes and
refusals, deployment guidance, and unchanged database/WAL bytes. Ceiling refusal
also observes zero SQLite writes. The ordinary guide still compiles and executes
the planned `home` alternative.

The full script's production device wasm is **1,981,590 B raw / 572,608 B gzip**,
**233 B below the unchanged 572,841 B budget**, built with Rust 1.97.0 and
wasm-bindgen 0.2.127, without wasm-opt. No device protocol or budget change was
made by this reconciliation; main's device changes are retained.

Ran `scripts/test.sh` **exactly once**, exit 0, starting at
`2026-09-27T14:35:08Z`. Exact summary:

```text
== 0 failure(s) in 1461 s
```

**Every full-suite failure: none.** Ours: 0; baseline: 0; environmental: 0.
Rust: **3,939 passed, 0 failed, 28 ignored**, across 248 test binaries and
961 executions (936 s, including compilation). Ordinary client tests and all
seven extra shards: **2,701 passed, 0 failed, 10 skipped** (194 s). Client models:
**78/78** (264 s). Fixture wrappers: **9/9**. Build, wasm, docs budget, release
guard, package build/typecheck and both app typechecks all pass. The inherited
60-second total budget remains exceeded and unchanged; it is not a failure the
script counts. No product or test source changed during or after the full run.

Full-log SHA-256: `09b6e57bf33bc74826908f6a0be46f486ed7cfa1f12c99a33275034e900be515`.
Raw wasm SHA-256: `f31efbe90951a07e45d98bb115f907030da51fc36d2bf6afce6941d0ce04e93c`.

The run uses Node 24.13.1, Bun 1.3.14, eight Cargo build jobs, development/test
debug information disabled, incremental compilation disabled,
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, and fd limit 65,536.
`bun install --frozen-lockfile` passed before JavaScript tests, with no dependency
changes. No tool was installed. Removed only this lane's inactive incremental
build cache when shared disk space fell to 26 GB; source and evidence were kept.
Raw logs, exit statuses and the full-script start marker are under ignored
`snapback4/target/fa-round3/`.

Every preliminary failure is accounted for:

- **Ours — diagnostic location.** The first `timeline_adoption` run passed 13
  tests and failed `check_and_runtime_refuse_the_copy_ceiling_and_owned_name_reuse`.
  The first-use refusal omitted the colon used to locate a named view and fell
  back to `schema.q:1`. Corrected it; all 14 adoption tests pass in the affected
  rerun, including the real declaration-site assertion.
- **Ours — command selection, no test executed.** The first HTTP test command
  incorrectly selected `--lib` for the CLI binary package and returned
  `no library targets found in package snapback4`. The corrected `--bin
  snapback4 atomic_feed_launch_keeps_queries_reading_and_holds_sync_and_writes`
  ran and passed its one test.
- **Baseline archival whitespace.** Whole-merge whitespace inspection reports
  12 whitespace findings in four verbatim incoming publication logs: the first
  and second `publication-dry-run.log` and `simulator-ready.log` under
  `reports/20260927-publication-0.4.5/`. They are unchanged from the merge parent.
  Edited source, LLPs and ticket pass the scoped whitespace audit. No product
  failure is attributed to these archived logs.

Final reference audit: **518 LLP documents, 9,638 references, zero errors and
zero unchecked references**. Edited source, documentation and ticket pass the
scoped whitespace audit; the four archival logs above retain their incoming bytes.

## Open questions for the supervisor

Review the **whole atomic launch**, including round 2, with both families before
landing. No additional author ruling is requested by this reconciliation. The
online publisher remains unbuilt under LLP 3000.026 §8, retaining every earlier
review requirement and the five-second fence gate. The 1×/10× timing samples
remain fixture observations, not production latency guarantees.
