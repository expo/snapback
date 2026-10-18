# LANG4 — wave 15 delivery

Branch `sb4-w15-lang4`, base `ccb9f752d1`; target integration release 0.4.32. No push or version bump. Evidence lanes were read-only. Implementation is complete; the verification ledger below distinguishes passing checks from environmental preconditions.

## Changes and commits

| Item | Result | Commits |
|---|---|---|
| P27 | Preserve a declared cursor when an authority-branch view plan falls back to an ordinary read. Execute both continuation pages in regression tests; no false `N_NO_CURSOR`. | `631ca278d1`, `7e0a39679d` |
| P28 | Follow mandatory later same-table/same-id lookups along committing atomic paths. Optional loops, early returns and unrelated ids retain the note. Loops with escaping returns require proof in the same iteration. | `631ca278d1`, `7e0a39679d`, `c3e06e1f48` |
| P29 | Shape-join errors name both incompatible row tables, including rows nested in containers. | `631ca278d1` |
| P30 | Maintained predicates accept typed literal `in [...]`, lowered to existing equality/OR. Empty membership validates the scalar operand; incompatible operands and nonliteral lists refuse. | `631ca278d1`, `7e0a39679d` |
| P31 | Cascade bounds name the enabling `delete <-` rule and site, offer `delete <- deny`, and retain contextual reservation arithmetic in `why`/verbose output. Deny rules are not called enabling rules. | `631ca278d1`, `7e0a39679d`, `c3e06e1f48` |
| P32 | `E_QUARRY_DUPLICATE_RULE` has its own card. Keep the first rule/table for error recovery, avoiding an unknown-table cascade while refusing compilation. Historical recorded-rule expectations updated in `c6631432f5`. | `631ca278d1`, `c6631432f5` |
| Probe/sync/immutable notes | Cite physical unique indexes; explain ordinary versus held offline reads; silence immutable patches proven equal to pinned keys through pure computed locals. Existing authority and stale-snapshot protections remain tested. | `631ca278d1`, `7e0a39679d` |
| Human/service require | A service alternative cannot discharge an unproven human branch. Normalize unambiguous positional viewer/literal witnesses; describe missing proof without claiming roles are disjoint. | `631ca278d1`, `7e0a39679d`, `acf78aed5e` |
| Query branch wider than read rule | `N_QUERY_FILTERED` follows returned read origins through filters, aliases, containers, assignment, implicit returns, concatenation and loop append. It respects physical versus caller-visible negative witnesses. A 512-transition bound emits an honest review note on exhaustion. No authorization change. | `631ca278d1`, `7e0a39679d`, `8a7c4f8b25`, `acf78aed5e` |
| Reviewed notes | `check --ack-notes` writes shareable `snapback/check-notes.json`. Any Quarry source-byte/module-set edit invalidates review; changed finding fingerprints invalidate that finding. Only static compiler notes qualify. JSON always retains `notes`, `newNotes`, `acknowledgedNotes`, including failed checks. Compile/review snapshots cannot race silently; malformed files refuse without overwrite. | `631ca278d1`, `7e0a39679d`, `8a7c4f8b25`, `acf78aed5e` |
| Bounds and recipes | Atomic fanout advice no longer suggests paging. `guide cleanup` supplies executable mark/cleanup/remove and active-row/history recipes. The exact published blocks and acknowledgement command run through installed local tarballs. | `631ca278d1`, `7e0a39679d`, `acf78aed5e`, `f1f0d45aa7` |
| Checked reference decision | Reviewed and declined a new `checked` spelling for 0.4.32: shorthand would promise integrity that jobs/fixtures and unresolved adoption/keep/forward semantics do not establish. Explicit physical existence and required readable/active-row guards are implemented and tested as the supported option. | `631ca278d1`, `7e0a39679d`, `acf78aed5e` |

LANG4 has no R1–R7 item assigned: the analysis classifies P27–P32 as persisting defects verified on both versions. The cursor execution regression is isolated in `7e0a39679d`; all six diagnostic defects have regression tests.

## Design and reviews

Governing context: LLP 3000, 3000.013 maintained predicates, 3000.039 reference/delete semantics, and 3000.036.002 intent-aware notes. The amendment is [LLP 3000.036.002 §13](llp/3000.036.002-intent-aware-lints-and-bootstrap.rfc.md#13-wave-15-lang4-notes-builders-can-review); 3000.039 §7 documents later mandatory lookups. The normative contract and checked-reference decision received independent **Muse R5 READY** and **fresh Codex R7 READY**. Verbatim reviews, briefs and provenance are under `llp/reviews/3000.036.002-wave15-lang4-*`. Intermediate material findings were repaired and reviewed again. One stalled Muse source audit is recorded as unavailable, not represented as a review verdict.

RULES5 owns authorization recipes and LIVE/read-through-live changes. KIT4 owns the wider proof kit/test runner; neither area was changed here. The guide changes entry is under 0.4.32 in `snapback4/packages/snapback4/CHANGELOG.md`; package versions remain 0.4.31.

## Verification ledger

Durable evidence: [reports/20261018-lang4](snapback4/reports/20261018-lang4/). Logs are gzip-compressed; campaign reports and exact survey deltas are JSON.

| Check | Result |
|---|---|
| Full Cargo, five crates | The initial 60-minute command reached its deadline during language revocation tests (exit 124). All 60 unfinished language files then pass (637 tests, one default ignore), and remaining doctests pass. Full simulation passes separately (749 tests, 7 default ignores, zero failures; 45 targets including doctests). The initial run completed 295 targets with 5,078 passed, four failed and 37 default ignores; all four failures were fixed and their complete affected files rerun. All 394 integration targets, five unit targets and five doctest groups are covered; no unresolved failure or unfinished target remains. Target coverage is mechanically checked against Cargo metadata. Includes `snapback4-core`, `snapback4-lang`, `snapback4`, `snapback4-device`, `snapback4-sim`, `--no-fail-fast`. |
| Final affected language tests | PASS: recorded-round1 5/5 on Linux and Mac after the dedicated-code assertion repair; 125 guide-corpus tests and 15 wave15 tests. Reference-actions and 16 wave14 LANG3 regressions also passed. |
| CLI note tests | PASS: final general `check` 105/105 and `check_notes` 12/12, one source-snapshot race unit test; final note presentation unit tests 3/3. The full run exposed an outdated reference-note snapshot and an empty-context `why` formatting failure; both are repaired in `c3e06e1f48` and this rerun passes. |
| Authoring census | PASS: all 88 `readauth` tests after adding the seven online-only cleanup mutations; 504 mutation occurrences, unchanged 94 private predictable write sites. Inventory repair `f1f0d45aa7`; Linux and Mac both pass 88/88. No new private outcome case is needed. |
| Affected client tests | PASS: 19 tests, zero skipped (cleanup/active references, README examples, guide types, intent views and upgrade history). |
| Installed packed tarballs | PASS: two exact guide-block tests, including `check --ack-notes`, through installed client/platform tarballs. Local debug platform package, not a publication receipt. |
| Mac Studio | PASS on language/acknowledgement implementation `acf78aed5e`: 15 wave15 tests, 12 check-notes tests, one review-race unit test, binary build, two exact recipe tests including acknowledgement. Final formatting repair `c3e06e1f48` additionally passes 105 general check tests and 12 note tests. That broader Mac attempt initially lacked TypeScript; installing pinned test dependencies in the scratch directory resolved both setup failures. Own scratch `~/sb4-ws-lang4` only. |
| Difftest `run` | PASS: seed 0, 20,000 schemas; no unexpected bind refusal or oracle disagreement. |
| Difftest `run-devices` | PASS: seeds 0–999; no disagreement/signature. |
| Difftest `run-lean` | 20,000 cases: 16,697 passed, 3,173 unsupported, 130 differences in four already-existing signatures; **no new signature**. Details below. |
| 100-schema check survey | PASS before/after: all 100 compile; all 100 main-schema SHA256 values unchanged. Nine removed notes, 15 added notes, 28 wording changes, each explained in [SURVEY.md](snapback4/reports/20261018-lang4/SURVEY.md) and exact JSON. Totals 452 → 458. |
| Wasm | PASS: 2,372,829 B raw, 723,275 B gzip, 545,364 B Brotli. Budget 723,775 = measured gzip + exactly 500 B. No runtime IR/protocol addition. Strict family/absence checks pass; Brotli measured using Node zlib quality 11 because CLI is unavailable. |
| `./ref-check` | PASS: 551 LLP docs, 11,392 refs, zero errors/unchecked. |
| `node scripts/docs-budget.mjs` (Snapback4) | PASS: README 317/320 physical lines. |
| Root install/hoist and inventory/guide | Root frozen install and hoist PASS. Inventory exits 1 on missing Snapback1 generated transclusions. Guide reports 19 passed, 0 failed, 0 skipped, 3 generated-artifact preconditions (exit 1). Logs retained; the Snapback4 packed guide tests pass independently. |

Known Lean signatures (all pre-exist in `snapback4-difftest/cases/found`): `lean--code--E_RULE~NOT_FOUND` (3), `lean--continuation-next--next~no-next` (35), `lean--next--next~no-next` (67), `lean--prelude-code--E_RULE~NOT_FOUND` (25). Runtime campaigns include the cursor repair. Subsequent changes affect only compiler diagnostics/presentation; final affected tests cover them.

All shell commands were bounded with `timeout`; remote children additionally use Python subprocess deadlines because GNU timeout is absent on the Mac. All Cargo commands carried the requested incremental/debug environment settings. Shared-disk ENOSPC was recovered by pruning only obsolete, inactive executable versions in this worktree's own target directory; the failed build then passed on retry. No other worktree or machine scratch area was modified.

## Remaining delivery qualification

All five-crate targets are covered and repaired failures have passing complete-file reruns. The bounded language remainder and full simulation both exit 0. The original full command reached its 60-minute deadline; coverage continues from unfinished targets without repeating completed expensive files. Root checks remain unqualified because retired Snapback1 generated artifacts are absent: `competitive-checkpoint/.../startReply.args.schema.json` and `todo-v2/.../contract/{setCompleted.mutation.ts,runtime-links.ts}`. Restoring dependencies removes the earlier transient dependency failures (the final guide run has zero failed checks). The full run additionally exposed the authoring-census inventory change and a historical duplicate-rule code expectation; the complete 88-test readauth and five-test recorded-round1 files pass after their repairs, on Linux and Mac. No product item is deferred; checked-reference syntax is an explicit reviewed decision above. Root Snapback1 generated-demo preconditions are recorded rather than repaired across the workstream fence. No publication, integration or push is claimed.
