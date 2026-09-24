LLP 3000.013 integration, round 5 part f — 2026-09-24

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`.
Merged exactly the requested K and P commits after reading their external
final reports, K's committed round 0–7 journal reports, and P's committed
[initial](./20260924-intent-lane-p.md) and
[round 1](./20260924-intent-lane-p-round1.md) reports. No push or publication.

The issue tracker's requested `card: constant` verdict is unsafe. That part
is stopped, with an executable counterexample below. Every other requested
operation runs and retains its expected certificate class.

| Source | Merge | Build before the next merge |
|---|---|---|
| K `a8a3b7595` | `0faed903f`, `--no-ff` | Workspace passed, 6.03 s |
| P `39cdac19d` | `d087fa873`, `--no-ff` | Workspace passed, 11.17 s |

K conflict resolutions, all paths below `snapback4/` unless stated:

| File | Resolution |
|---|---|
| `JOURNAL.md` | Keep the original integration history and every K entry verbatim. |
| `crates/snapback4-lang/src/bind/actions.rs` | Keep H's filter-source map and K's constraint-domain state in binder construction. |
| `crates/snapback4-lang/src/bind/program.rs` | Keep H source fields, A variant/predicate context, and K constraint domains. |
| `crates/snapback4-lang/src/bind/program/expr.rs`, `conditional.rs` | Use K's extracted conditional binder, including per-arm wildcard authorization; carry A's variant context, isolated setup, logical site reuse and maximum site count into it. |
| `crates/snapback4-lang/src/bind/program/reads.rs` | Retain A's nullable seek admission and recovery text; construct K object fields with explicit non-spread status. |
| `crates/snapback4-lang/src/guide/codes.rs` | Union all codes. |
| `crates/snapback4-lang/src/guide/reads.rs` | Preserve F's refusal prose and A's planner examples; add K's mixed-key and written-order explanation without duplicating the older positional-scan paragraph. |
| `crates/snapback4-lang/src/guide/writes.rs` | Preserve F's executed-write refusal examples and add K's residual write-test guidance. |
| `crates/snapback4-lang/src/print.rs` | Keep one H precedence-aware, source-aware renderer. Add K object spread and grouped rewrite roots without replacing authored source excerpts or introducing a second printer. |
| `crates/snapback4/tests/scale.rs` | Retain A/O/H classes and add K's three constant spread examples to the census. |

The parser and AST merged automatically. K's executable rewrite tests,
mixed-key tests, conditional shapes, and A's presence-variant tests pass.

P conflict resolutions:

| File | Resolution |
|---|---|
| `../llp/3000.013-quarry-states-intent.rfc.md` | Retain A/L revision history and P's physical-expiry-cap contract and section 11.1. |
| `JOURNAL.md` | Append both P reports verbatim. |
| `crates/snapback4-core/src/engine/admission.rs`, `read_only.rs` | Keep A's shared recursive effect checker; recognize P's `DeleteTarget` as an impure statement there instead of reviving a duplicate inline checker. |
| `crates/snapback4-lang/src/bind/program.rs` | Combine P alternate-key target deletion with K's residual write-test refusal. |
| `crates/snapback4-lang/src/guide/prediction.rs` | Preserve F's lead and examples, then explain P's deferred prediction when expiring-cap occupancy is unknown. |
| `crates/snapback4-lang/tests/lowering/README.md` | Keep K's six new goldens and P's sixteen intentional alternate-delete IR migrations. |
| `metrics/wasm-budget.json` | Preserve both measurement histories, then record the integrated measurement and ratchet described below. |

No feature, diagnostic, compiled example or lane test was removed. K's
implementation file map is in its eight dated journal entries; P's two
linked reports describe its storage, engine, device and disclosure changes.

Integration-specific files:

| File | Change and evidence |
|---|---|
| `crates/snapback4-lang/tests/fixtures/intent-issues.q` | Exact 47-line issue tracker from round-i-5 section 4, without changing its rules or adding caps. |
| `crates/snapback4/tests/intent_issue_tracker.rs` | Four tests: certificate/source preservation; original server versus acquired memory device; original server versus acquired/reopened SQLite device; 9,000-hidden-label growth counterexample and constant scoped control. |
| `crates/snapback4-lang/tests/fixtures/intent-clique.q` | Mixed positional/named admin probe and spread `socialProfile`, with its required `followerCount` view. Refresh the abridged-fixture comment. |
| `crates/snapback4-lang/tests/intent_target.rs` | Execute the added profile read, including zero followers and false following; allow the intended inherited-sync note for the new aggregate view. |
| `crates/snapback4-sim/tests/fixtures/intent-clique.q` | The complete target retains Following and the digest; adopt the mixed admin probe and spread profile read. |
| `crates/snapback4-sim/tests/intent_integration.rs` | Compare shortened empty-search browsing with the old explicit branch, and spread with the old wildcard projection, then run the complete target as before. |
| `crates/snapback4/src/scale/display.rs` | End the scale summary with exactly “— `check --cost` gives the certificate”. |
| `crates/snapback4-lang/src/guide/types.rs` | Keep F's definition/example ordering while preserving K's default-text explanation. |
| `crates/snapback4-lang/tests/guide/definitions.rs`, `refusal_actions.rs` | Pin definitions and concrete recovery actions for all seven new K codes. |
| `crates/snapback4-lang/tests/aggregate_copies.rs` | Update two expected excerpts for the single printer's precedence-correct removal of redundant parentheses. The authorization and provenance assertions remain. |
| `crates/snapback4/tests/scale_windows_expiry.rs` | Pin A's nonuniform-authority fallback and retain H's edge-window plus separate per-row-rule warning for an authored calendar merge. |
| `packages/snapback4/test/fixtures/word-expansion.json` | Refresh exactly 44 source-caption leaves from `messages[] matching q` to the authored `messages matching q`; executable IR, snapshots and every other field are identical. |
| `packages/snapback4/README.md` | Three model lines expose the structural scale certificate; link the complete list from the reference map. Budget remains 300/300 lines. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Add a compiled/typechecked React list with keyed rows, continuation, first-answer loading, refusal, incomplete and stale-answer rendering, plus unmount/remount guidance. Uses current `usePage`; no J semantics change. |
| `metrics/wasm-budget.json`, `JOURNAL.md`, this report | Record measurement, ratchet reason, qualification and the stopped certificate requirement. |

Issue-tracker results, with zero compilation diagnostics:

| Operation | Certificate and execution |
|---|---|
| `board` | All four status/assignee presence variants are constant, including both absent. Each returns exactly the authorized requested subset. |
| `overdue` | Constant; nullable deadlines are excluded, done issues are excluded, and the time predicate seeks its bounded ordered domain. |
| `counts` | Constant; maintained values are todo 3, doing 1, done 1 after real seed maintenance. |
| `withLabel` | Grows with issues skipped by the authored `exists issueLabels[.id, label]`; it runs without refusal and a hidden matching label grants no result. |
| `find` | Present search grows with words/candidates; empty search is constant browsing. Both return the same authorized five seeded issues. |
| `card` | Grows with `issueLabels` skipped by its per-row read rule. Spread fields equal `issues[id] { * }` on the server and devices. |

The exact supplied fixture declares no synced table. To execute on devices,
the test compiles an explicit companion adding only membership audiences:
`orgs` syncs to `members[.id]`; `members`, `issues` and `issueLabels` sync to
`members[.org]`; the aggregate inherits its audience. Rules remain identical.
The unchanged original program runs on a separate server, and its answers
are compared with the companion server and devices. Devices acquire pages
of two, close and reopen before executing every operation. This is an
explicit fixture adaptation, not an inferred change to sync defaults.

The exact fixture emits two existing notes on `card`: `N_NO_CURSOR` and
`N_NEVER_COMPLETE`. The request requires no diagnostic, not no note for this
fixture. Guide blocks separately pass the stricter no-note check.

Stopped requirement and reproduction: `issueLabels.org` is independent of
the referenced `issues.org`. A permitted member of another organization can
insert arbitrarily many labels referring to Alice's issue while keeping each
label unreadable to Alice. Put 9,000 such labels before the one visible label
in label order. The original `card` exhausts its meter with an incomplete,
empty label list. A constant certificate would misstate that work; dropping
the read rule would disclose the hidden labels. The test control adds
`and .org = i.org`, returns the visible label in fewer than ten examined rows,
and has a constant certificate. That control narrows scope and is not silently
substituted for the original program. Reproduce with:

```sh
cargo test -p snapback4 --test intent_issue_tracker card_hidden_label_counterexample_keeps_the_growth_warning -- --exact
```

Representative integrated forms now compile and run:

| Form | Example |
|---|---|
| K default bounded text | `title: text` in the issue tracker. |
| K mixed keys and tests | `exists members[.org, viewer, role = 'admin']`. |
| K spread | `return { ...i, labels: issueLabels where .issue = id first 20 by .label }`. |
| K duration schedule | `schedule sweepEvery every 2m: sweep`; K tests pin the period and clock offset in compiled schedule rewrites. |
| A presence variants | `issues where .org = org and (status = null or .status = status) and (assignee = null or .assignee = assignee) last 50 by .at after c`. |
| A search browse | `profiles matching q last 20 by .createdAt after c` replaces the explicit empty-directory branch. |
| P expiring caps | `cap 2 by owner` with `expire at .expiresAt` uses maintained physical occupancy, authorization before expiry charges, and deferred device prediction where occupancy is unknown. |

Clique's complete simulator target compiles with no diagnostic. `home`
(Following), `global` (planned union), `trending` (both time bounds),
`userPosts`, `thread`, `people`, `socialProfile`, `insights`, `history` and
`searchAll` execute. Following retains delivery, pagination, repost shaping,
removal and lifecycle coverage. The digest still uses an unpaged predicate
count without `by`, seeks both range endpoints, streams 5,000 inputs and runs
through automatic chunks, reopen and once-only retries. No target form is
left with a diagnostic. The language fixture remains intentionally abridged;
the full program lives in the simulator fixture.

Following latency on the integrated tree, with
`SNAPBACK4_BENCH_ASSERT=1 SNAPBACK4_BENCH_MAX_RATIO=3` and all four ignored
`maintenance_latency` tests run serially:

- Post p95: five followers **2.255 ms**, 900 followers **2.166 ms**;
  ratio **0.961**, below both 3x and 1.5x, and below 50 ms.
- Twenty posts reached all 900 followers in **10,130.065 ms** total,
  **10,098.530 ms** after the last acknowledgement.
- Under eight sustained request streams, **901 copies** completed in
  **1,526.991 ms**, post latency was **23.576 ms**, and 6,678 foreground
  requests had home p95 **2.946 ms**.
- Isolated delivery: 900 copies in **149.402 ms**, **166.002 microseconds/copy**.
  All four witnesses passed in 36.21 s. Profile-only durability comparisons
  did not change production's `synchronous=FULL` policy.

WASM: Rust 1.97.0 / wasm-bindgen 0.2.127, without wasm-opt, rebuilt to
**1,760,451 B raw / 490,643 B gzip**. Relative to part e's recorded
1,751,888 / 488,046 artifact, that is **+8,563 raw / +2,597 gzip** for the
integrated device containing P's maintained physical-cap occupancy, deferred
expiring-cap prediction and private alternate-delete resolution with
authorization before expiry charges. K authoring and certificate rendering
are outside the device artifact. This is a whole-artifact comparison against
the previous recorded build, not independent component attribution or a
freshly rebuilt control. The inherited 489,000-byte ceiling was exceeded by
1,643 bytes; the new **491,000-byte** ceiling leaves **357 bytes**. Runtime
examined, steps, heap and write ceilings remain unchanged.

Qualification and failure classification:

- Targeted K/A language tests, H source tests (9), P expiry-write tests (21),
  issue-tracker tests (4), Clique simulator tests (3), and latency tests (4)
  pass. Guide's 80 tests pass, including every compiled no-note block and all
  code-definition/recovery pins. The existing README example harness
  typechecks the new list component against the generated API stub.
- The first full suite ended **`== 1 failure(s) in 347 s`**, category
  `cargo test`: six assertions across five targets failed. These were ours
  to reconcile, not environmental or the old main baseline: two
  `aggregate_copies` string expectations; `intent_target` and `natural_forms`
  referencing my initially omitted `followerCount` declaration;
  `uniform_word_expansion` source captions; and the stale planned-window
  expectation in `scale_windows_expiry`. All repairs preserve the stronger
  behavior and have passing targeted retests.
- Earlier focused failures were integration guide inventory/order/link
  checks and two new fixture tests that initially used raw loading instead
  of seed maintenance. Those were corrected. The new aggregate declaration
  legitimately introduced `N_MAINTAIN_SYNCED` in the abridged fixture; its
  allowed-note assertion now names it. A transient new assertion used
  `Option` where `Value::field` returns `Result`; that test-authoring compile
  error was corrected before final qualification.
- The first WASM build correctly failed the inherited size gate; the
  measured, justified ratchet above repairs that integration failure.
- Final full-suite result: **`== 0 failure(s) in 350 s`**, exit 0. All stages
  passed: workspace build, WASM/size gate, docs budget, release guard,
  package typecheck/build, chat check, Rust targets/doctests, chat/Expo
  typechecks, fixture wrapper tests and client tests. This uses the normal
  parallel client harness, eight Rust test processes and four test threads
  per harness, with debug info and incremental compilation disabled.
  Existing explicit skips and ignored tests remain skips, not passes.
- No intermittent client failure occurred in either full run; no test
  was rerun until green without diagnosing its deterministic failure.
- `./ref-check --verbose`: 505 LLP documents, 9,253 references,
  0 errors, 0 unchecked. All 97 changed source files are at most 1,500 lines;
  the largest is `check.rs`, 1,487. Journal preservation was checked against
  the previous integration and both merged branch histories, byte for byte.

Follow-up commits: `e15d67613` reconciles guide/certificate expectations;
`29de33694` adds cross-lane fixtures, compatibility checks and documentation.
The qualification commit contains this report, the journal and WASM ratchet.

Explicitly deferred as requested: J's client semantics, K round 8+ RowMixed
join, P round 2 device occupancy transport. This does not claim a new native
simulator run on Linux or PostgreSQL runtime qualification. No version bump,
publication or push. The only open part-f design issue is the unsafe
requested `card: constant` classification described above.

Logs live under `~/sb4-intent/integration-r5f-`: `build-k`, `build-p`,
`lang-focused`, `guide`, `cross-focused`, `issue-final`, `target`, `latency`,
`wasm`, `fixture-update`, `fixture-audit`, `language-repair`,
`target-repair-final`, `window-repair`, `suite-1`, `suite-2`, `ref-check-final`.
