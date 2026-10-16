# DAY4 workstream report — 0.4.31

Branch `sb4-w14-day4`; base `4ef9f77fb3` (0.4.30). No version bump or push. Integration owns 0.4.31. Implementation, reviews and consumer qualification are complete. Source is committed in small steps; final evidence is committed with this report.

## Product changes

| Item | Result | Tests/evidence |
| --- | --- | --- |
| R3, P14 | Digest registry retains shipped .28/.29/.30/current frontend variants and day-two templates. Advice requires known bytes or a remaining missing-file reference. Custom proof arguments/assertions remain owned by the app. .28/.29 deployment-only proofs warn explicitly. No-write advice is limited to the recognized default frontend, excluding chat/social write starters. | DAY3; digest registry unit; H9 custom/removed controls; 50-lane census |
| R4 | Recognize .29 generated flat-file npm arguments as managed. Adapt creates missing saved directories from current `snapback/*.q` and contemporary fixtures (including sweep configuration), preserves original module names and all old files, and rewrites managed npm arguments. Existing saved directories stay immutable. | DAY3; packed H9 legacy assertion compares `versions/v1/schema.q` with current schema and checks npm args; baseline fails the schema comparison |
| P20 check/adapt | Custom frontend static-dist hosting without visible build and `npx snapback4 dev` receive explicitly heuristic notices. REG owns the proof-host missing-dist error. | DAY3; census notices for 044/058/078; unsafe npx regression. Current 090 already builds and 096 already uses startDev, so no warning for those repaired evidence files. |
| DT4 | `testSource` returns `casesRun`/`casesSkipped`, rejects zero executed business cases unless `{fixtureOnly:true}`, and includes stdout tails in failures. Machine summary is restricted to saved-source calls. Check inspects saved rows/cases/sweeps against their saved schema, including authored required fields, engine-owned input custody, query names, enum/text/int/list constraints, intentional E_INPUT cases and dynamic aliases. | DAY4 Rust 6/6; affected Node proof tests; root check residency regression |
| New apps | Web/Expo day-two scaffolding is opt-in via `--day2`; adapt can opt in and records deletion opt-out on apply. Missing referenced scaffolds remain repairable. Expo online combination gets an explanation and valid usage. The day-two template accepts a fresh explicit deployment and preserves it. | DAY3/initialization tests; packed web+expo opt-in; emitted template runs both `npm run day2:proof -- ./deploy` and full explicit-source form with real persisted-row assertions |
| P24, DT5 | Guard dependency collection records only consulted fields, including filter bindings, aggregate projection metadata, optional row fallback and selected shape fields. Whole-row consumers still consult every field. Forward domain widening is monotone, preserving required/optional interpretation and defaults. Helper-hidden probes remain unproved. Ordered trailing requirements prove tightening/loosening with refusal contracts preserved; display retains Boolean grouping. | release dependencies 9/9; clause comparison 2/2; wave13+wave14 preview Node 48/48 on Linux and Mac |
| DT6 | Rollback explains safety guards/confidentiality the old release lacks, changed populations/quotas, and bridge advice. Resolved target prints before preview/activation, using stderr under JSON. Admission and retention remain unchanged. | wave14 real-CLI deployment/rollback acceptance tests on Linux/Mac |

Guide/API and generated starter changes accompany implementation. Both changes are in the 0.4.31 guide-changes entry. Generated proof qualification fills the intentional BUSINESS_ASSERTION placeholder with authenticated persisted-row assertions; it executes the emitted template rather than a handwritten substitute.

## Commits

- `8932f95890` — starter custody, opt-in, current-source capture, saved counts and initial fixture inspection.
- `b04061c111` — consulted domains and rollback effects.
- `326a5eafd8` — complete adaptation commands, sweep capture, fixture ownership.
- `390e68d44c` — schema-bound saved arguments and installed-consumer qualification.
- `2d1a32562f` — blind review records, census and baseline controls.
- `7a0cbe078e` — final dependency/refusal/projection proof corrections and READY review links.
- `57289a23c6` — ordinary residency output excludes the saved-source summary on its early-return path.
- `ac6bae7492` — numeric flag publication/help qualification and regression, changelog explicitly names init.
- Final evidence/report commit: this report and `snapback4/reports/20261016-wave14-day4/validation/` (documentation/evidence only after the qualified source commit).

## Reviews and design

Governing amendments: LLP 3000.011.003.000.000 §11 and LLP 3000.000.000 §14. Both completed five rounds, with **Muse READY and fresh Codex READY on the same final revision**. Each round was mutually blind. Actual verbatim verdicts, command/model/effort and file hashes live under `llp/reviews/*-day4-rN.*`; compressed raw transcripts and immutable source packets live in `snapback4/reports/20261016-wave14-day4/`. Muse subscription quota was exhausted; the supplied wrapper successfully used its API fallback. No key was read or printed.

Narrow final delta reviews included full immutable source and exact diffs; no prior findings or other reviewer verdicts were shown. The later ordinary-residency correction restricts the existing saved-source-only summary to the second early-return path, matching the reviewed protocol; it changes no source-call summary behavior.

## Validation

- Setup: frozen Snapback 4 Bun install, CLI, wasm and client build. Wasm gzip 723,160 B ≤723,660 B.
- Linux client final six-file run: **78 passed, 0 failed**. Release final focused run: **48/48**; dependency **9/9**, clause comparison **2/2**. DAY4 static fixture suite **6/6**.
- Mac Studio scratch `~/sb4-ws-day4`: DAY3 **20/20**, DAY4 **6/6**, init_dx3 **7/7**, dependency **9/9**, six Node files **78/78**, final changed preview rerun **48/48**. Private Node 24.13.1 and private Playwright headless browser; no black M5. A scratch-only witness lookup override chose the private browser via CHROME; product source and assertions were unchanged. Initial missing browser/global Chrome close failures were resolved by that isolated environment. Ordinary-residency regression after the final fix: **1/1**.
- Full five-crate no-fail-fast Cargo invocation reached its **3,600 s bound (exit 124)** after **223 completed test binaries / 3,786 passed cases**, completing CLI/core/device execution and entering language tests. It exposed five failures in three CLI targets from earlier compiled revisions; final affected targets passed: **check 103/103, DAY3 20/20, init_dx3 7/7**. Core/device doctests passed. Remaining language/simulator coverage **passed in a separate full run (exit 0)**: 200 test binaries, **2814 passed cases, 0 failures** (including doctests). Thus all five crates are covered across bounded runs; this is not a claim that the original one-hour command returned green. Never ran scripts/test.sh.
- H9 baseline controls: 0.4.30 fails custom-proof advice, removed-scaffold advice, and stale legacy saved-schema comparisons. Candidate custom/removed/legacy/optin/template pass (template executes both deployment argument forms). Raw controls retained in report directory.
- Census: **50 lanes × 2 verbs × before/after = 200 executions**, **83 advice-line deltas**. `advice-delta.md` lists each line and reason; JSON carries exits; full stdout/stderr archived. Original evidence untouched.
- `./ref-check`: passed, **550 LLP docs, 11,364 refs, 0 errors**. `docs-budget`: passed, **317/320** README lines and named self-contained-screen test **1/1**. `git diff --check`: passed.
- Root frozen Bun install and `ensure-workspace-hoist.mjs`: passed. `check-inventories` fails inherited missing generated competitive-checkpoint `startReply` schema and todo-v2 Contract `setCompleted`/`runtime-links` files. `check-guide`: **19 passed, 0 content failures, 3 generated-artifact preconditions**, exits nonzero. These Snapback 1 files are outside DAY4.
- Fresh `publish.mjs --prepare-client` + `qualify-linux --consumer-only`: **passed at final source `ac6bae7492`**. First preparation correctly refused a source change; first qualification exposed the help scanner truncating --day2 to --day. Fixed numeric token parsing and complete-name boundary, tested 3/3 on Linux and Mac, generated help check passes. Repacked client-day4-final-r3; qualification retry uses only those final bytes. **Final consumer qualification passed (exit 0)**: shared day-two proof, all five DAY4 H9 modes, both deployment-directory recipes, **12 generated frontend attempts** with listener audits, starter proofs, and clean Ubuntu/Alpine consumer checks. Consumer evidence records source `ac6bae7492` and publicationQualified:false; no publication receipt was created. Final receipt/digests are preserved in the validation artifacts.

## Decisions and integration pointers

The lane 100 census notice identifies score 11 outside its saved 1..10 argument domain. Its broad `expect: denied` accepts input errors, so the notice describes structural disagreement rather than predicting a failed test. Explicit `expect: E_INPUT` cases are exempt; the scanner never claims to prove business intent.

No runtime admission, storage adoption, retention or sync changes. Read-only fixture inspection proves structural agreement, not business expectations. Metadata opt-out is written only on apply. Explicit --day2 opts in again. Legacy flat sources are retained without being copied into new directory snapshots.

PROD owns `init --adapt --production`: merge its dispatch/allowed flags with DAY4's `--day2` and fourth adapt argument. REG owns proof-host missing-dist narration. KIT3 owns broader helper/runner changes; SURF4 owns general CLI/help discovery; DAY4 also made the minimal numeric-flag token/boundary fix in scripts/check-verb-help.mjs needed to qualify its new --day2 flag. No other local worktrees or `~/projects/snapback` were touched.

Consumer-only qualification avoids the explicitly prohibited scripts/test.sh. It cannot issue a publication-qualified receipt; the requested five-crate Rust and affected client checks run separately. Candidate package versions remain 0.4.30; these are branch qualification bytes for 0.4.31 integration, not published artifacts.

## Deferrals

Inherited repository-root generated-artifact prerequisites remain outside DAY4. All requested product changes are implemented, reviewed, tested and committed. No DAY4 product work is deferred. The original one-hour command timed out; all remaining crates and doctests finished in the separate passing runs recorded above.

## Reproduction commands

Cargo invocations used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0` in the same command. Every shell command had a timeout. Main commands from `snapback4/`:

```sh
timeout 3600 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --no-fail-fast -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4 -p snapback4-sim
timeout 1800 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4 --test check --test day3 --test init_dx3
timeout 1800 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --no-fail-fast -p snapback4-lang -p snapback4-sim
timeout 1800 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/publish.mjs --prepare-client --prepare-directory target/publication/client-day4-final-r3
timeout 3600 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/qualify-linux.mjs --consumer-only --client target/publication/client-day4-final-r3/snapback4-0.4.30.tgz --expo target/publication/client-day4-final-r3/snapback4-expo-0.4.30.tgz --out target/publication/qualification-day4-final-r2
```

Affected Node files: `day3-proofs`, `day4-proofs`, `proof`, `proof-contract`, `wave13-previews`, `wave14-release-preview` under `packages/snapback4/test/`. Mac runs used the same files and Rust tests in the isolated scratch, bounded by Python subprocess timeouts and an outer SSH timeout. Root checks were `bun install --frozen-lockfile`, `node scripts/ensure-workspace-hoist.mjs`, `node scripts/check-inventories.mjs`, `node scripts/check-guide.mjs`, and `./ref-check`; the Snapback 4 docs check was `node scripts/docs-budget.mjs` with the Cargo environment above.

Validation index: `snapback4/reports/20261016-wave14-day4/validation/results.json` and `log-provenance.json`. Raw logs are compressed alongside the copied preparation/consumer proof JSON. Qualified client integrity and static binary SHA-256 are recorded in those copied receipts; prepared tarballs remain under ignored `snapback4/target/publication/client-day4-final-r3/` and `qualification-day4-final-r2/`.
