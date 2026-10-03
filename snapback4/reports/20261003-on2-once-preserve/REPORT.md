# ON2 — once columns preserve history under the bytes-once contract

2026-10-03, eb1000, branch `sb5/on2-once-preserve`, base
`1b879881bee0079c357356685f1a671fe0aed13b`. Local commit only; no push or publication.

## Decision and scope

`revocation::Dependencies::table` previously marked a whole table unknown whenever
any column recursively contained a once image. Remove that check and its unused
recursive helper. The shared server/device classifier otherwise stays identical:
asset edits, deletes, policy inputs, expiry and unknown/opaque evidence keep their
existing treatment. The change adds no runtime machinery, wire fields, masking,
cache, ledger or timeout. Lane ON's parked prototype is not used.

Charlie's 2026-10-03 ruling is recorded in LLP 3000.023 §12: once protects served
bytes, not the handle or metadata. Consumption cannot revoke row membership,
order, other columns or handle disclosure. A visible handle grants no bytes.
The existing asset endpoint remains responsible for single serving and HTTP 410
`E_ASSET_VIEWED`. The assets guide now shows an `Opened` render branch for
`useAsset`; the ticket is resolved under `issues/closed/`.

Orientation used the local SB4 command sheet, NOT-DOING, RULES, journal tail,
LLP 3000 (especially §7's asset/home/security decisions), the adopted design
brief LLP 2000.000, LLP 3000.023 §§3.4/10/12, the asset card, and LM's report and
settlement test. The broken local `llp-orient` link was resolved read-only from
`/home/ccheever/lanes/suspect/vendor/llp/skills/llp-orient/SKILL.md`. This context
requires the existing hard withdrawals and excludes any new handle-hiding
contract. No new LLP or hand-off is needed; the governing accepted RFC is updated.

## Reproduction and regressions

Before runtime edits, rebuild base and run LM's unchanged settlement test.
All four reproduction cases pass: `once=true` has `during: [{loading:true},
{loading:true}]` on process and wasm, with empty Pages; paired ordinary-column
controls keep both histories. The raw traces are `base-settlement-*.json.gz`.
Base binary SHA-256: `b5a226287f2e5e1c8ef2b3d2dd8e7d6d972e1b0c9be191792eddb53a138e6d12`.
Base optimized wasm SHA-256: `6d436f5ce09e6c6e86dcb5f33c04fcd7e1e2809f32d9ff1c69d9dbe18ad55bd8`.

The revised LM test holds actual replacement work across real offline-send
settlement, checks history and Pages at 999, 1,000 and 5,000 ms, then requires
both sends exactly once on both devices. Its hold permits an obsolete attempt
to finish when revocation evidence still awaits the replacement; otherwise
holding before the timer starts would be a vacuous retention test.

`once-preservation.test.mjs` adds 13 cases: online ack retention with a consumed
handle, and each of online/process/wasm for second-fetch refusal plus physical
row deletion, the exact membership-revocation deadline, account change, and a
real second-store switch. Asset bytes match the PNG; repeated SDK fetch refuses
`E_ASSET_VIEWED`, raw HTTP returns 410, and re-query still carries the same asset
metadata. Account tests exercise `createApp` session retirement, with only auth
issuance mocked and authenticated transport mapped to development personas.
Store tests redirect to an independently created real server. They require a
withdrawal before a new-store answer and reject old handles after that boundary.

The final regressions on preserved base artifacts produce exactly 3 failures
and 14 passes: process/wasm once settlement and online retained history after
viewing. All hard-boundary controls pass on base. An external ESM loader redirects
only the existing fixture's wasm read to the preserved base device; no SDK code
is changed for that run. See `final-regressions-on-base.log.gz`.

The existing Rust asset soundness test now certifies per-reader consumption,
checks unchanged query handles/metadata for all six viewers, and still requires
`E_ASSET_VIEWED` only for the consumer and `E_ASSET_UNKNOWN` after clearing.
All five soundness tests pass, including the corpus model: 90 schemas, 11,520
commits, 604,650 certified checks, 888,971 retained rows and 3,269,436 fields.

## Commands and qualification

All build/test commands use:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export CARGO_TARGET_DIR=$HOME/sb5-lanes/target CARGO_INCREMENTAL=0
cd ~/sb5-lanes/lane-on2/snapback4
```

`bun install --frozen-lockfile` precedes the build. Because existing scripts
address `target/` directly, this lane copies the freshly compiled native binary
and raw wasm from the shared Cargo target into real local directories. There
are no target symlinks. Focused tests use the preserved ON2 binary through
`SNAPBACK4_BIN`; this avoids another lane replacing the shared executable.

Commands include `cargo build -p snapback4`, the web-feature wasm-profile build,
`bash scripts/build-wasm.sh`, package `build`, `cargo test -p snapback4-lang
--test revocation_soundness -- --nocapture`, `cargo test -p snapback4-lang --test
guide`, and `node --test packages/snapback4/test/wasm-budget.test.mjs`.
The affected client invocation uses concurrency 4 over `once-preservation`,
`live-margin-settlement`, `revocation-retention`, `answer-withdrawal`,
`answers-stay-*`, `retention-store-withdrawal`, `asset-lists`,
`asset-blob-lifecycle`, and `app-store-replacement`.

Paired locked wasm build: base **2,048,753 B raw / 617,410 B gzip**;
fixed **2,048,676 B raw / 617,327 B gzip**, a reduction of **77 raw / 83 gzip B**.
The cap stays **618,040 B**, leaving **713 B**. No growth or budget increase.
The two wasm budget tests pass. The affected client run passes **380/380**,
and the final whole guide passes **111/111**. The reference audit passes with
527 LLP docs, 10,267 refs, zero errors and zero unchecked references.
All raw command logs are gzip-compressed without text changes.
The single complete-suite run and its classifications follow below.

## Development failures (not waived product checks)

- The first revised settlement gate held an obsolete attempt before revocation
  began and therefore also passed on base. Corrected using the pending-evidence
  state; the final paired base run is causal. `regression-on-base.log.gz` records
  the rejected oracle; `final-regressions-on-base.log.gz` supersedes it.
- Initial account/store harnesses used a one-day synthetic session without a
  refresh reply and parked a startup probe. Those harness errors caused hangs;
  the corrected transport supplies refresh and allows probes. A store assertion
  also wrongly required indefinite absence after successful reacquisition;
  it now observes the withdrawal and excludes the old handle afterward.
  `once-final.log.gz` records all 13 corrected controls passing. Obsolete hung
  harness sessions were interrupted through their recorded tool session IDs
  after the corrected run; their partial logs remain as development evidence.
- The first guide edit placed a code fence inside the diagnostic excerpt and
  changed its pinned defining sentence. The whole-guide check caught lost
  recovery prose. The final card preserves that paragraph and adds the render
  example after it, without relaxing any check or card budget. The assets card
  grows by 12 lines / 81 words; the bounded client card and README are unchanged.

A preparation copy to the running pinned binary initially returned `Text file
busy`; the final preparation atomically replaces a separately copied file.
This was an owned-artifact setup error, not a product failure.

## Complete-suite failure classification

`snapback4/scripts/test.sh` ran **once**, exit 1. Its summary line, verbatim:

```text
== 2 failure(s) in 1681 s
```

The failed phases are `cargo test` and `client tests`. The client pool reports
6,021 cases: **5,970 passed, 40 failed, 11 skipped**; all **79 serial model tests
passed**, including both 5,000-sequence session models and the 3,000-sequence
online model. Cargo has four failed targets containing 18 failed tests.
Builds, wasm budget, docs budget/whole guide, release guard, package checks,
chat/Expo checks and all nine fixture wrapper tests pass. `full-suite.log.gz`
preserves the entire canonical output; `full-suite.exit` records its exit code.
The canonical run remains red; it has not been rerun or relabeled after the
focused corrections. Every failure is classified below.

**Inherited from base (four Rust assertions).** The unchanged test sources
require no notes, but the already-landed compiler emits `N_SHAPE_METER`:

- `prefix_reads::explicit_caps_stay_silent_and_predicting_short_pages_stay_refused`
- `prefix_reads::prefix_reads_compile_without_notes_and_caps_follow_one_schema_number`
- `membership_search::edges::calendar_repair_executes_the_same_offset_boundary_predicate`
- `membership_search::refusal_rewrite_compiles_on_its_schema_and_keeps_filters_in_both_searches`

`base-inherited-rust.json` contains all four failing compiler inputs and the
preserved base binary's `check --json` output: each compiles and emits the same
note. This is a direct base-compiler reproduction, not a claim to have rerun
all Rust targets on base. The original baseline test reproductions are already
tracked in `issues/20261003-snapback4-shape-meter-test-expectations.md` and
`issues/20261003-snapback4-shape-meter-note-breaks-prefix-and-membership-search-tests.md`.

**Environmental (13 witness unit tests).** The native helper locates a sibling
`target/debug/snapback4` through `current_exe`, ignoring `SNAPBACK4_BIN`.
Another shared-target build replaced that executable during the suite. All 13
owned fixture stderr logs report `unknown verb --internal-witness-process`;
the observed shared binary's SHA-256 is
`c9c4c6ebc63fe76ad257d585502233a3fe36daf592ce783b8e99d6c5ccdf9254`, whereas ON2's
preserved final binary is
`8f7ce41698c2b344df7f7643e7cf40ec1a32d505741bd4ac710baa7d89375c3a`.
See `shared-binary-interference.json`. These tests failed:

- `verbs::witness::preparation::tests::preparation_cleans_term_resistant_descendants_before_releasing_lease`
- `verbs::witness::preparation::tests::recovery_direct_node_drains_final_empty_snapshot_joiner`
- `verbs::witness::preparation::tests::recovery_direct_node_drains_late_group_member`
- `verbs::witness::preparation::tests::recovery_keeps_group_custody_after_anchor_exit`
- `verbs::witness::preparation::tests::recovery_shell_shim_drains_final_empty_snapshot_joiner`
- `verbs::witness::preparation::tests::recovery_shell_shim_drains_late_group_member`
- `verbs::witness::preparation::tests::recovery_volta_style_shim_drains_final_empty_snapshot_joiner`
- `verbs::witness::preparation::tests::recovery_volta_style_shim_drains_late_group_member`
- `verbs::witness::preparation::tests::stalled_resolver_sigint_is_bounded_journalled_and_drained`
- `verbs::witness::preparation::tests::stalled_resolver_sigkill_triggers_watchdog_before_recovery`
- `verbs::witness::preparation::tests::stalled_resolver_sigterm_is_bounded_journalled_and_drained`
- `verbs::witness::preparation::tests::stalled_resolver_timeout_is_bounded_journalled_and_drained`
- `verbs::witness::recovery::tests::recovery_drains_a_live_preparation_descendant_before_finishing_even_with_a_live_wrapper`

Copying the same compiled unit-test executable and ON2's preserved CLI into a
private sibling layout, then running `verbs::witness:: --test-threads=1`, passes
**42/42**, including all 13 failures. See `witness-isolated.log.gz`. No witness
code or suite setting is changed, and the complete suite is not rerun or
relabeled green.

**Environmental (one witness CLI integration test).**
`witness::preparation_selectors_are_exclusive_and_repack_is_withdrawn` embeds
`CARGO_BIN_EXE_snapback4`, the same replaced shared executable. Its seven exact
CLI flag/refusal pairs match only 5/7 on that executable and 7/7 on ON2's
preserved binary. `witness-cli-pair.json` records the arguments, expected prose,
exit status, stderr and both hashes. This is the same artifact interference,
not an ON2 behavior change.

**Ours (four obsolete once-dependent deadline expectations; corrected).**
`live-propagation.test.mjs`'s `child-add`, `expire=true` cases on process/wasm,
each with omitted keep and `keep=true`, expected a reaction insertion to withdraw
its decorated answer. Their fixture has a nullable `oncePhoto` column; that
blanket unknown dependency was the only reason this safe insertion had a bound.
The bytes-once ruling intentionally removes it. Preserve the one-second deadline
assertion but drive it with `child-remove`, an actual revocation, for both keep
policies on both devices. No runtime change follows the canonical run.

The corrected `live-propagation*.test.mjs` plus ON2's settlement/once controls
pass **55/55** in `post-suite-controls.log.gz`, including all four real-removal
deadline cases. Combined with the earlier 380 affected tests, these cover 418
distinct affected cases (the 17 ON2 controls ran in both invocations). The
canonical failure record is retained and is not relabeled as a passing run.

**Environmental, caused by ON2's setup (36 witness-acquire client tests).**
The private `SNAPBACK4_BIN` copy is outside the checkout. `witness/acquire.rs`
finds its packaged JavaScript helper relative to the executable, so every
CLI-mediated acquire case refuses with `E_WITNESS_PROCESS: install the matching
snapback4 client package to run witness acquire`. Direct helper cases pass.
This setup mistake is distinct from the shared-binary interference above.
The checkout's real `target/debug/snapback4` is byte-identical to the private
copy (SHA-256 `8f7ce41698c2b344df7f7643e7cf40ec1a32d505741bd4ac710baa7d89375c3a`).
With `SNAPBACK4_BIN` pointing there, the complete unchanged
`witness-acquire.test.mjs` passes **43/43** in `witness-acquire-layout.log.gz`.
No helper, product code, assertion, or global test setting is altered.

`failure-classification.json` enumerates all 58 failures in the Rust and client
pool phases individually: **4 ours**, **4 inherited**, **50 environmental**.
The 4 ours are corrected; all 50 environmental failures have isolated paired
or passing evidence as described above. The Linux run skips the three published
0.2.33 native capability comparisons because they require darwin-arm64; their
known Darwin failures are not claimed as observed failures in this run.

## Final state

The final source passes 418 distinct affected client cases, all five Rust
preservation soundness tests, all 111 guide tests, both wasm budget tests,
and the reference audit. The four ON2-dependent stale test expectations found
in the canonical run are corrected and pass with genuine deletion triggers.
There are no unresolved ON2 product failures. The four inherited compiler-note
assertions remain in their existing tickets; environmental controls pass or
match the paired expected output without a product change.

The production delta is two explanatory comment lines and seven removed lines
in the preservation classifier; server fetch authorization and SDK runtime code
are untouched. Documentation and regression/evidence files account for the
additional source. The wasm output shrinks, and no budget is raised. Commit
locally with the dated JOURNAL entry and the requested co-author trailer; do not
push or publish. The handoff is also written to `~/sb5-lanes/on2.report.md`.

## Round 1 — both review coverage gaps closed (2026-10-03)

Reviewed `3717a68cf9` against `~/sb5-lanes/reviews/on2-r0.astra.md` and
`~/sb5-lanes/reviews/on2-r0.grok.md`. Both reviews were READY WITH CHANGES;
this round addresses their two Low items without changing runtime code.

The assets card's `OncePhoto` fence now imports `useAsset` from
`snapback4/react`. The existing README/example compilation test extracts that
exact fence, requires it to exist exactly once, and compiles it as a separate
TSX module against the real package source, using the same strict TypeScript
program as the conversation-screen example. No ambient hook declaration or
copied replacement snippet supplies the missing import. Diagnostics identify
the original `guide.rs` line. A guide test independently pins the bytes-once,
retained metadata, handle-authority and `E_ASSET_VIEWED` / “Opened” sentences.

The asset soundness test adds the required scalar `image <=1000 once` to its
existing shape list. It keeps the `docs` preservation assertion, unchanged
query handles/metadata, consumer-only `E_ASSET_VIEWED`, successful access for
every other viewer, and the non-preserving `clear` with `E_ASSET_UNKNOWN`.
Because a required image cannot be assigned null, `clear` deletes its home row;
optional shapes still clear the column to null. Five shapes across four seeds
now exercise 40 real mutations, 8 consumptions, 288 access checks and 20 sweeps.

All reviewer mutations were executed independently and restored:

| Mutation | Observed failure |
| --- | --- |
| Delete the complete `OncePhoto` TSX fence | Required-fence assertion, exit 1 |
| Remove its `useAsset` import | TS2304: cannot find `useAsset`, exit 1 |
| Replace `asset.why.code` with `asset.refusal.code` | TS2339 on `refusal`, exit 1 |
| Replace `asset.why.code` with `asset.denied.code` | TS2339 on `denied`, exit 1 |
| Mark only required `ColumnType::Image { once: true, .. }` unknown before `asset(kind)` | `preserved.contains("docs")` fails at the bytes-once assertion, exit 101 |

The last mutation leaves optional and nested image handling alone, reproducing
Grok's precise coverage gap. `round1/tsx-mutations.json` and
`round1/required-once-mutation.json` record the test commands and exit statuses;
the corresponding `mutation-*.log.gz` files retain the full failures.

Final qualification uses the requested environment:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH CARGO_TARGET_DIR=~/sb5-lanes/target CARGO_INCREMENTAL=0
cd ~/sb5-lanes/lane-on2/snapback4
cargo test -p snapback4-lang --test guide --test revocation_soundness -- --nocapture
SNAPBACK4_BIN=$HOME/sb5-lanes/on2-artifacts/snapback4 node --test packages/snapback4/test/readme-examples.test.mjs packages/snapback4/test/once-preservation.test.mjs packages/snapback4/test/wasm-budget.test.mjs
```

The restored final source passes **112/112 guide tests**, **5/5 revocation
soundness tests**, **13/13 once-preservation client tests** (online, process and
wasm), **8/8 example tests**, and **2/2 wasm-budget tests**. The corpus again
covers 90 schemas, 11,520 commits and 604,650 certified checks. Final logs are
`round1/rust-final.log.gz` and `round1/client-final.log.gz`. The native client
fixture uses the preserved round-0 ON2 binary, SHA-256
`8f7ce41698c2b344df7f7643e7cf40ec1a32d505741bd4ac710baa7d89375c3a`.
The unchanged round-0 wasm artifact is remeasured at **2,048,676 raw / 617,327
gzip bytes**, **713 bytes** below the unchanged **618,040-byte** cap; the budget
helper accepts it. `round1/wasm-size.json` records its hash and provenance;
this round does not claim a new wasm build. `./ref-check --verbose` passes
with 527 LLP docs, 10,268 refs, zero errors and zero unchecked references.

The first Rust run used the requested new shape with the old
fixture unchanged. Its `clear` failed compilation with `E_QUARRY_TYPE` because
the required image was assigned null. `round1/rust-tests.log.gz` retains this
development failure; the valid home-deletion fixture passes its directed rerun
in `round1/assets-corrected.log.gz` and the final complete soundness target.
No final ordinary check fails. The round-0 complete-suite red above remains
unchanged; the complete suite was not rerun this round.

Append the dated JOURNAL entry and commit locally with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. No push or publication.
