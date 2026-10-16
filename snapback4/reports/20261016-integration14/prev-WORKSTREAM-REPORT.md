# Workstream PREV — 0.4.30

Base: `59fb4ead1b` (0.4.29); branch `sb4-w13-prev`. Initial `git status` and `git log sb4-loop..HEAD` were empty. Version numbers are unchanged. No origin push or publication; branch transfers are only to the explicitly authorized Mac scratch clone.

## Scope and governing context

This work implements fix-list #7 (R2, F1, DT7), H9's preview-noise qualification, literal-backfill narration and the adjacent bridge recipe. Read Snapback 4's fence, root/design brief, NOT-DOING, JOURNAL and the wave-13 analysis's Publish gate, prioritized list, ledger, harness and R2/DT2/DT7 sections. `llp-orient` context: LLP 3000.000.000 §§9–13 governs exact private previews, retained storage and clause narration; LLP 3000.000.000.000 §4 governs conservative dormant visibility. Supporting definitions: LLP 3000.007.001 maintained columns; LLP 3000.022 receipt/delivery identities; LLP 3000.039 reference/delete semantics. Active constraints: no admission/retention changes; actual private snapshot counts; no invented per-viewer query result; privileged operator output only; disjoint row/cell/index ownership; Unknown remains unproved; only stable program existence is Boolean. Hand-off: no product item deferred; this is workstream qualification, not the cross-workstream publication gate.

## Changes by item

- **R2:** compare each compiled guard's consulted schema and lexical/control inputs. Track selected indexes/keys, used columns, transitive rules/reference populations, auth, lifetime, delete policies, maintained sources and scoped timeline/receipt/delivery metadata. Unrelated writes, arguments, tables and additive probe columns stay silent. Branch joins, expanded helpers, list accumulation, later loop iterations and original incoming write conditions retain their dependencies. Group changed dependency sets once across affected guards/operations. Stable leading `exists` atoms participate in implication; unsupported/unstable inputs retain warnings. Tightening notes preserve old first-failure code/message regions.
- **F1:** query/count and mutation/rule dependencies group by table. Dormant inventory and PUBFIX28 row/cell/index counts remain authoritative. Existing activation test 26 and mixed cases pass in the affected suite; REL3's safety visibility regression remains.
- **DT7:** previews show query/count table-population losses first, then exact retained dependents, then safety dependencies. They name the operator's decision and explicitly distinguish table populations from filtered/paged/per-viewer query results. Schema steps and storage samples follow user effects. The three categories have an exact golden preview and a no-new-loss control.
- **Backfills:** preview and cold/hot deploy receipts print `table.column ← value on N rows`, using successful candidate-active rows still physically missing a literal-default field after restoration. Explicit values, restored cells, optional-null interpretation, maintained fields and dormant rows are excluded. Default changes are counted when they change legacy absence interpretation. Optional-to-required null narrowing is tested as dormancy, not an invented fill.
- **Bridge recipe:** `guide deploy` puts the complete safety-preserving bridge sequence directly beside enum widening. Keep domain/audience/guard and dependent metadata, migrate truthfully, prove refusal and intended counts, then contract or pause. DAY3 owns saved-source/baseline layout; KIT2 owns proof/client recipes; SURF3 owns general help/lifecycle text. PREV adds its own `guide changes` entry for 0.4.30.
- **H9:** the additive v1→v2 probe test asserts exactly zero WARNINGs in both directions and no unchanged guard narration. It fails on the clean 0.4.29 executable with **3 WARNINGs versus 0**, as retained in `snapback4/reports/20261016-prev/h9-0.4.29.log`. Further positive/negative controls cover real changed dependencies and all review fixes.

## Commits

- `75da8fb43b` — dependency/user-effect implementation, backfill receipts, guide/changelog, H9/DT7 tests.
- `515c4b5a2c` — guard control-flow/maintained-source hardening and first review artifacts.
- `d10c1f7708` — complete guard/control/effect inputs, metadata/delete dependencies, refusal contracts, final guide positioning, received reviews, and review regressions.
- `e566847c12` — preserve independent helper guards beside authored proofs, scope prior writes individually, remove unused-binding/site/prose noise, and compact/qualify the guide.
- `814f6ed5f7` — collect aggregate projection/filter helper guards, with live refusal controls.
- `cdd7f25eb4` — conditional-update setup scopes and separate merge discovery/target bindings, with three Rust metadata/context controls and live update controls.
- `0f56c3da56` — bind write results to target, patch/row and read dependencies; live patch-only refusal regression.
- `7fe46ecc89` — shared carried result bindings and all consulted insert uniqueness definitions; live two-iteration and populated unique controls.
- `0db40b4475` — uniqueness for discarded insert effects; fixture waits for both readiness and URL output.
- `9f611119a8` — retained conditional-write old-field/default scope with a sparse-row activation control.
- `d316606b6c` — field/presence projection through write results, with additive unused-column silence.
- `20aee130b3` — snapshot-proven null-only reference silence in both directions, retained reference positives, amended §13, and fresh Codex READY.
- `1e01931006` — READY provenance, five-lane raw/quoted previews, all verification logs and manifest; source under test remains `20aee130b3`.
- `6a2dbc7fdb` — explicit column/index/rule preservation control; no production semantic delta.
- `c411a19dbf` — complete-source Muse READY, final readiness pointers and focused Darwin proof.

## Verification

- Setup: Snapback 4 frozen Bun install, CLI build, wasm build, client build. Wasm: 2,353,736 bytes raw / 716,714 gzip against 717,214 budget.
- Affected Node suites: release-activation, wave11-narration, wave12-clauses, wave13-previews, release-capabilities, release-react and test-platform-audit. **112 passed, 0 failed** on implementation `20aee130b3`, including all review controls. The new file is automatically included by the existing publication suite’s test-file glob.
- Darwin: **112 passed, 0 failed** on implementation `20aee130b3`, using checksum-verified Node 24.13.1 on the M5 Mac. Earlier 100- and 104-test checkpoints passed on Node 24, and 70 passed on Node 25. Used only `~/projects/snapback-ws-prev`, cloned from the authorized Mac source; no publication worktree used.
- Rust: ran full `cargo test --workspace` (all six workspace crates, including the requested five and difftest). CLI/core/device/difftest completed successfully; the run stopped at two introduced guide failures (159/150 card lines and an unregistered bridge example path). Compacted the card to 150 lines and registered the exact application example path; all 125 guide tests now pass. Full remaining language/simulation tests completed successfully with `--no-fail-fast`; all six workspace crates therefore have complete passing target coverage after the two guide repairs. The repaired guide target passed all 125 tests. Direct Cargo checks use CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0 and CARGO_PROFILE_TEST_DEBUG=0. The docs-budget helper’s internal Cargo call initially inherited its defaults; the final rerun with all three required variables passed, including its one self-containment test. Removed the 5.6 GiB incremental cache created by those initial helper calls. The full workspace run was launched after initial implementation; affected client/unit checks were repeated after review fixes.
- Final focused Rust checks passed: 4 dependency metadata/context/preservation tests on Linux and Darwin at `6a2dbc7fdb`, and 1 clause-comparison/Unknown test on Linux, no failures. Production semantic inputs are unchanged from `20aee130b3`.
- Root frozen Bun install + workspace hoist completed. Initial inventory check found missing fresh-tree generated artifacts. Ran `scripts/check-generated-artifacts`; it passed without tracked root changes. Final root inventories: PASS (365 package tests, 35 script tests, 31 demos, 487 publication leaves, 162 guide pages). Root guide: PASS, 22 checks, 0 failed/skipped/preconditions. Existing gap-review warnings remain informational.
- `./ref-check`: final PASS, 548 LLP docs, 0 errors and 0 unchecked.
- `node scripts/docs-budget.mjs` from `snapback4/`: PASS, README 320/320 lines. The root has no script of that name; the requested script belongs to the fenced product.

## Independent reviews and dispositions

The final §13 amendment and implementation received READY from fresh **Muse round 8** and **Codex round 20**. Verbatim responses and provenance are under `llp/reviews/3000.000.000-prev-*`; exact prompts and complete transcripts are archived under `snapback4/reports/20261016-prev/`. Earlier Muse round 6 did not locate H9/the golden by its scoped grep; the actual `wave13-previews.test.mjs` controls exist and pass in both 112-test platform runs. Round 6 was READY on the code contract with that test confirmation recorded here; round 8 independently confirms the complete supplied source and tests.

The earlier Codex READY at round 7 was followed by an additional precision audit. Rounds 1–19's actionable findings were repaired with positive and silence regressions: sparse defaults and population restoration; branch/list/maintained sources; effect read/control closure; argument types and first-failure refusal contracts; loops and original write bindings; authored data keys and unused lexical inputs; helpers inside calls/projections/filters/write conditions; merge target scope; assigned/carried/discarded write results and secondary uniqueness; old-row conditional defaults; projected result columns; and null-only optional references. Round 3's optional-to-required fill premise was checked against exact activation: optional null becomes a retained dormant row, so zero backfills is correct. The failed premise/control output is retained.

Muse round 4 requested explicit ordering/restoration/metadata/privilege boundaries. Round 5 approved those; round 6 approved the final snapshot-proof refinement. Muse attempt 1 exhausted plan quota and its fallback returned no review before termination; later attempts returned actual reviews. No key file was read or printed. The supplementary inline Muse round 7 returned NOT READY because its excerpts omitted wiring/effects/backfill bodies and explicit preservation evidence. Round 6 had inspected those complete files. A focused Rust control now proves null-population filtering preserves explicit column/index/rule inputs (4/4 focused tests pass), and round 8 reviewed the complete inline source/test set and returned READY with no material semantic defect. No runtime behavior changed for this evidence/control addition.

## Five copied farm lanes, before and after

Full before/after deploy and rollback output for lanes 006, 014, 016, 020 and 084 is retained, with coherent read-only SQLite backups and preserved relative release links. The originals were not modified. Deploy previews run after privately selecting v1, with saved v2 and explicit restoration. Counts and verbatim preview quotes follow; fewer warnings alone is not the acceptance criterion.

# PREV wave-13 copied-lane preview evidence

Final implementation: `20aee130b3`. Read-only originals: `~/sb4-loop/wave13/apps/`. Each private deployment copy preserves relative release symlinks; a read-only SQLite backup supplies a coherent store. Rollback selects release 1. Deploy previews first select v1 privately, then preview saved v2 with explicit restoration. The baseline executable is the 0.4.29 build retained before narration edits.

| Lane | Rollback WARNINGs before → after | Deploy WARNINGs before → after |
|---|---:|---:|
| 006 | 13 → 6 | 9 → 2 |
| 014 | 16 → 7 | 7 → 1 |
| 016 | 11 → 5 | 7 → 1 |
| 020 | 44 → 20 | 5 → 5 |
| 084 | 21 → 14 | 5 → 2 |

Counts alone are not the acceptance criterion. User-effect warnings replace repetitive per-operation dormancy warnings; real domain, predicate, refusal, missing-operation and safety changes remain. H9 separately proves zero warnings when consulted inputs stay unchanged.

## Lane 006

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) addMap.require; old: body/0: require exists admins[viewer] else NOT_ADMIN 'Only tournament admins manage the map pool.' | new: body/0: require exists admins[viewer] else NOT_ADMIN 'Only tournament admins manage the map pool.'
```

After (verbatim):

```text
  WARNING matches changed: 16 guards unproved across addNote, addTeammate, captainNotes.read, restartVeto, roster.delete, roster.insert, skipExpiredTurn, veto; verify their refusal cases before selecting release 1
```

## Lane 014

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) addLeg.require; old: body/0: require exists roles[viewer, role = 'captain'] else NOT_CAPTAIN | new: body/0: require exists roles[viewer, role = 'captain'] else NOT_CAPTAIN
```

After (verbatim):

```text
  WARNING queries/counts legsList, nextExchange read legs: active table population 36 → 35, 1 active row leaves; verify filtered results and progress denominators before selecting release 1 (dependency, not a query-result count)
  WARNING release 1's safety dependencies on legs: `assignLeg`, `logHandoff`, `logSplit` cannot see 1 dormant legs row (sample ids [01M51TG026BKN4AFJQYPFK9NMM]); verify refusal cases and preserve this gate in a bridge release or pause the workflow (guide deploy; dependency, not a predicate match)
```

## Lane 016

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) addCell.require; old: body/0: require exists leads[viewer] else NOT_LEAD; body/2 with wall = (murals[mural]) ! else NOT_FOUND: require (not wall.opened) else WALL_OPEN | new: body/0: require exists leads[viewer] else NOT_LEAD; body/2 with wall = (murals[mural]) ! else NOT_FOUND: require (not wall.opened) else WALL_OPEN
```

After (verbatim):

```text
  WARNING cells changed: 13 guards unproved across claimCell, openWall, photos.insert, photos.read, photos.update, reviewCell, submitCell; verify their refusal cases before selecting release 1
```

## Lane 020

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) closeRound.require; old: body/1 with q = (questions[question]) ! else NOT_FOUND: require (q.asker = viewer) else NOT_MANAGER 'Only the asker closes rounds.' | new: body/1 with q = (questions[question]) ! else NOT_FOUND: require (q.asker = viewer) else NOT_MANAGER 'Only the asker closes rounds.'
```

After (verbatim):

```text
  WARNING queries/counts attributed, board, myEstimate, summary read estimates: active table population 4 → 1, 3 active rows leave; verify filtered results and progress denominators before selecting release 1 (dependency, not a query-result count)
  WARNING dependent estimates: 3 active rows go dormant with parent tables questions; preserve these linked records in a bridge or accept their absence in release 1
  WARNING release 1's safety dependencies on estimates: `closeQuestion`, `submitEstimate` cannot see 3 dormant estimates rows (sample ids [01M51T7STHPECQ8SFR3R63NK2D, 01M51T7STRMPKJH07PA9VA8YB2, 01M51T7T2FBAJ1TRW7JTZE5A32]); verify refusal cases and preserve this gate in a bridge release or pause the workflow (guide deploy; dependency, not a predicate match)
```

## Lane 084

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) addBusiness.require; old: body/0: require (openMinute < closeMinute) else BAD_HOURS 'Closing time must be after opening time.'; body/1: require ((exists residents[viewer]) or (exists moderators[viewer])) else NOT_RESIDENT | new: body/0: require (openMinute < closeMinute) else BAD_HOURS 'Closing time must be after opening time.'; body/1: require ((exists residents[viewer]) or (exists moderators[viewer])) else NOT_RESIDENT
```

After (verbatim):

```text
  WARNING queries/counts directory, listing read businesses: active table population 3 → 2, 1 active row leaves; verify filtered results and progress denominators before selecting release 1 (dependency, not a query-result count)
  WARNING release 1's safety dependencies on businesses: `claimBusiness`, `editBusiness`, `issueCode`, `reviewProposal` cannot see 1 dormant businesses row (sample ids [01M51VJJXN8339A1QRVPYQ8XHR]); verify refusal cases and preserve this gate in a bridge release or pause the workflow (guide deploy; dependency, not a predicate match)
```


## Deferrals and decisions

No product item is deferred. Full Rust, Linux/Darwin, root checks and the final READY pair are complete. Evidence closeout is committed. No version bump, origin push, publication, unrelated worktree edits or sibling workstream implementation was performed. Only this root report is left uncommitted, as permitted; implementation, design/reviews and verification artifacts are committed.
