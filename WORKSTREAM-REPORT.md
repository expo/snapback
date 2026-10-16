# Integration 14 — 0.4.30

All seven wave-13 lanes are integrated on `sb4-loop` in
`/home/ccheever/projects/snapback-sb4loop`. Version 0.4.30 is committed.
No origin push or publication was performed. No publication target or
publication worktree was accessed. Packs and scratch stores stay under
`/tmp/integ14/`; Mac work uses only `~/projects/snapback-integ14`.

## Merges and release commit

Started clean at 59fb4ead1b; fetched and fast-forwarded origin/main. Read each
lane report in its own worktree before merging with `--no-ff`. Root report
conflicts retained the integration side. Final fetch found no new main commits.

| Lane | Merge | Integrated behavior |
| --- | --- | --- |
| DAY3 | cd57caff41 | Saved-source compatibility, contemporary fixtures, ports, explicit expiry-orphan recovery |
| PREV | 60f06e411f | Consulted-guard previews, population/backfill counts and bounded preview noise |
| RULES3 | 629bedd6e2 | Authorization recipes, refusal layers and private update-image evidence |
| SURF3 | e2451c9b08 | P11 mint-context order, fixture agreement and CLI/session surfaces |
| KIT2 | 8a8a1c0102 | Proof-helper contracts, readiness gates and draft lifetime |
| LANG2 (ec995bbcfb) | bb3ba3a6a1 | Precise P18 diagnostics, reachable action caps, bounded walks, refinements and branch-pages-v5 |
| EXPOPIN (a809a0d22f) | 7d61cad480 | Expo 57 maintenance pins and matched Xcode 27.0/27.1 JSI cache repair |

Parallel 0.4.29 publication record 6faa0fb9cd was merged as a840cb5024.
LANG2 and EXPOPIN followed the coordinator's updated order.

Bump commit: **1f6b75ff27 — snapback4 0.4.30: bounded reads, precise patches,
reliable proofs and Expo builds**. It changes exactly the ten paths and
23 version lines used by c113020b4a: workspace Cargo/locks, Bun lock, following
fixture lock, four package manifests and the two release fixture pins.
The later fd92ae68c3 makes the identity-mutation fixture work across patch tens.

## Composition and fixes

- Kept DAY3's extracted test verb, saved-fixture selection and strict fallback,
  SURF3's per-query sweep personas and LANG2's verbose fixture presentation.
  Preserved both saved-v1/v2 and bridge guide paths, all new codes and doctor repair.
- Retained P11 ordering only within one live mint context. No old ids are
  rewritten and no cross-context/process/restart/commit order is promised.
- Kept RULES3 authorization/refusal behavior with LANG2's three-way immutable
  analysis. The timed-peer recipe intentionally keeps its hidden-target upsert:
  splitting on a readable lookup cannot distinguish an existing hidden row.
  Its documented runtime-equality note is pinned narrowly in all four recipe
  checks; other notes remain failures. Fixes 69594bd951 and cd04adf0b5.
- Renumbered colliding amendments: RULES3 is 3000.036.002 §11, LANG2 stays §10;
  DAY3 expiry recovery stays 3000.039 §13, delete reachability is §14. Earlier
  KIT2 proof/application sections became §10/§6.11. Updated live references;
  raw independent review artifacts remain verbatim. Their inherited trailing-space/EOF warnings are preserved with the original responses.
- Composed Expo starters: zero-sync strips native-device imports but retains
  SecureStore; init-time ports remain baked/printed and runtime-overridable.
  Kept EXPOPIN's new toolchain pins and DAY3's backend launcher instruction.
  Frontend proof ports validate before builds. Integration fixes 6393a786b8,
  a3e5fddd82 and 304c7bf6b1 preserve the combined contracts.
- Updated publication test fixtures, browser init-script mocks, saved-directory
  assertions, descriptor-warning scope and online-only Expo assertions. Exposed
  useAppReady in guide discovery; test logs use ignored target directories.
- Added `publish.mjs --prepare-directory PATH` for isolated client preparation.
  Extended installed H9 checks for PREV noise, KIT2 helper contracts, SURF3
  fixture agreement and DAY3 saved compatibility/Expo ports. Corrected the
  integration-only expected Expo pin to 57.0.30 in 3bac5812d4.
- Mac caught a scheduled-handler test assumption. `ctx.mutate` permits pending
  and replayed receipts without historical result (published SERVER.md).
  Fixture 9280037490 retries the same write id with declared retry 3 / backoff 1s,
  still requires sent and proves one correctly owned row using current server
  truth. Fresh results retain their owner assertion. No SDK/runtime code or
  product deadline changed; this fixture passed alone on Linux and Mac before
  complete pool reruns.

One coherent 0.4.30 `guide changes` entry covers client runtime/draft/session
semantics, P11, P18, F2, P17, branch-pages-v5, rebuilds and Expo/Xcode. LLP
3000.037 §17 records the farm findings, all seven lanes and the final census.
Applied llp-orient; no new RFC or authority change was authored. The lane
review records are retained with their provenance; mechanical composition is
not a new author acceptance or publication claim.

## Verification

Every Cargo command used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0`. Product frozen install/native/wasm/client setup ran.
Never ran the prohibited full `scripts/test.sh`.

### Linux native, clients and model

- PASS: complete `cargo test -p snapback4-core -p snapback4-lang
  -p snapback4-device -p snapback4-sim -p snapback4 --no-fail-fast`, exit 0.
  6381 tests passed, 45 ignored, zero failed.
  Final full run follows the last Rust/test correction cd04adf0b5; subsequent
  service-seat fixture change is JavaScript only and has no Cargo input delta.
  Final log: final/cargo-full-4.log.gz. Interrupted earlier runs are retained,
  not relabeled passes. Both ticketed cleanup/resolver tests pass.
- PASS: final full client pool in one pass: 405 pooled/serial files,
  7,649 tests; 7,593 passed, 56 intentional skips, zero failures/cancellations.
  Full model counts add 81/81 passed across two files. Total 407 files,
  **7,674 passed, 56 skipped, zero failed**. No seed/count overrides.
  Final log: final/clients-full-6.log.gz. A preceding complete pass also passed
  before the scheduled-fixture correction. Complete repaired server-e2e 9/9
  passed separately on both OSes.
- The client native binary is an immutable copy under
  `snapback4/target/integ14-final/snapback4`, preserving ancestor lookup for JS
  helpers. It is the same merged 0.4.30 binary used for the final survey/upgrade.
  Pack preparation finished before the final pools, keeping wasm bytes fixed.
  Earlier setup runs exposed concurrent wasm replacement and a copy outside
  the checkout's helper layout; their failures/cancellations remain recorded.
- Lean check.sh PASS: 78 theorems audited with only permitted axioms,
  116/116 examples and 7 oracle fixtures, on Linux and Mac.

### Differential campaigns

- `run --seed 0 --cases 20000 --workers 8`: 20,000 compile cases,
  1,220,035 executions, zero disagreements/unexpected refusals/generator errors.
- `run-devices --seed 0 --cases 1000 --workers 8`: seeds 0–999,
  27,922 executions, zero disagreements.
- `run-lean --seed 0 --cases 20000 --workers 8`: 16,827 supported,
  3,173 unsupported, 130 disagreements in exactly four retained signatures:
  E_RULE/NOT_FOUND(3), prelude code(25), next/no-next(67), continuation-next(35).
  Its exit 1 is retained; no new signature, oracle or allowlist change.
- Full difftest crate and explicit LANG2 factory pass, including the 100 new
  cases (64 P18 + 36 LANG2). Excluded local observations remain exclusions;
  they are not counted as successful device predictions.

### Installed packed Linux qualification

Fresh client/Expo preparation:

```sh
node scripts/publish.mjs --prepare-client --prepare-directory /tmp/integ14/final/client-pack-3
npm_config_cache=/tmp/integ14/final/npm-cache npm_config_prefer_online=true node scripts/qualify-linux.mjs --consumer-only --client /tmp/integ14/final/client-pack-3/snapback4-0.4.30.tgz --expo /tmp/integ14/final/client-pack-3/snapback4-expo-0.4.30.tgz --out /tmp/integ14/final/linux-qualification-final-4
```

PASS: Ubuntu 24.04 and Alpine proot consumers, all 12 frontend proofs and 6 starter
proofs. Every installed H9 case passes: compatibility deploy/saved fixtures,
Expo ports, preview-noise budget, helper contracts and fixture agreement.
Fresh private npm metadata resolves the inherited ETARGET for @expo/cli 57.0.31;
no shared cache was deleted or toolchain downgraded.

Preparation source 69594bd951; qualification source cd04adf0b5. Later source
changes are tests/repository qualification prose only; published/native-runtime
inputs are unchanged. Consumer evidence explicitly says suite:not-run and
publicationQualified:false. Source suites ran directly above; no importable
publication receipt is claimed. Native ELF is static and installed SHA verified.

### 100-schema survey and reconciliation

All 100 final wave13 schemas pass with **zero refusals**, 315 note/search
findings and 29 N_IMMUTABLE_PATCH notes in 18 lanes. Original q-source hashes
remain unchanged. App 087's original toolchain precondition was resolved only
inside its private copy using existing merged-tree dependencies.

| Code | Count |
| --- | ---: |
| N_CONDITIONAL_COMPLETE | 8 |
| N_DELETE_NEEDS_READ | 1 |
| N_DELETE_RESTRICTED | 1 |
| N_EPHEMERAL_SERVER | 2 |
| N_IMMUTABLE_PATCH | 29 |
| N_LOOKUP_HIDDEN | 5 |
| N_MAINTAIN_AUTHORIZATION | 2 |
| N_MAINTAIN_DELTA | 7 |
| N_NEVER_COMPLETE | 15 |
| N_NO_CURSOR | 139 |
| N_NO_HORIZON | 12 |
| N_NO_PRODUCTION_WRITER | 50 |
| N_PATCH_CLEARS | 2 |
| N_SEARCH_SHAPE | 1 |
| N_SEARCH_UNSCOPED | 1 |
| N_SEARCH_WORDS | 2 |
| N_SPARSE_FILTER | 17 |
| N_SYNC_ORDER | 5 |
| N_UNREADABLE_PROBE | 13 |
| N_VACUOUS_RULE | 1 |
| N_WIDE_MERGE | 2 |

Every per-lane language-note count matches LANG2 after SURF3 removes all 21
fixture-drift notes. Four search findings are counted separately. RULES3's
99 comparable schemas baseline is 317; hydrated 087 adds 2, giving 319 for 100.
LANG2 adds 17 net notes, SURF3 removes 21: 319 + 17 − 21 = 315. No newly refused lane.
Machine records include per-lane codes, source hashes and exact binary SHA.

### Existing-store upgrade

PASS using the actual npm 0.4.29 installation from http://127.0.0.1:4873/.
Its store has a same-millisecond pair, a parent/two children and extra rows.
Private offline parent/index removal emulates the older orphan corruption;
0.4.29 itself no longer creates that condition. The pristine backup is retained.

0.4.30 preserves every old id, backfills the new blue default, reports the
orphan without automatic deletion, repairs exactly 2 children, then 0 on repeat.
New same-ms ids order within their mint context. Final store: 4 notes, 0 children;
doctor healthy. Commands/results and old-store digest are retained in
final/upgrade-commands.json and final/upgrade-summary.json.

### Mac

Used only `ccheever@charlies-macbook-pro-m5max-black:~/projects/snapback-integ14`,
Node 24.13.1, ulimit 65536 and the required Cargo settings. The initial full
six-crate run (including difftest) completed with only four old-source
recipe/guide targets red. Every other target passed. After fixes, all four
complete targets pass: guide 125, wave12 recipes 13, lang wave13 rules 3, CLI rules 9:
**150 passed, zero failed**. This is the affected-scope closeout; the initial
full run's nonzero exit is retained.

PASS: final 61-file platform/client scope in one pass, 970 passed, 14 explicit skips, zero failures.
Provider reconciliation and production-background policy passed alone before
the complete-scope rerun; the scheduled-handler fixture passed 9/9 alone too.
No deadlines, product ceilings or assertions were waived. Initial red pools,
the maintenance diagnostic snapshot and corrected outcomes are all retained.
The final pool pins both native binary environment variables to an immutable
copy inside the scratch checkout, preserving helper lookup and worker lifetime.

### Fresh Exact

PASS: fresh `~/sb4-loop/prewave14/hello0430` from a private copy of
`~/sb4-loop/exact2`; original Exact checkout remains untouched. Generated with
`bun <privateExact>/scripts/exact.mjs new ./hello0430 --snapback --port 26040`.
Three private Cargo dependency paths/versions point to merged 0.4.30; the old
lock was updated offline after the locked build refused it. Installed the
actual merged client pack in the parent. With explicit SNAPBACK4_BIN,
Playwright CHROME, Bun 1.4.2 and Cargo settings, `bun exact.mjs snapback` and
`bun exact.mjs test web` pass 2/2 including offline/reconnect. The driver stopped
its owned backend. Actual client and device manifest say 0.4.30 with
branch-pages-v5; Exact's static printed 0.4.29 banner is not the selected runtime.
Exact commands, source paths and manifest are retained in final/exact-local-build.json.

### Regeneration and root checks

- Delivery-await census regenerated from AST; authoring census regenerated,
  798 entries and byte-identical. Strict wasm family/absence censuses pass.
- Root frozen Bun install + workspace hoist + check-generated-artifacts PASS;
  missing Snapback 1 prerequisites materialized. Diagnostics registry, guide
  manifest and chained inventories regenerated without tracked root drift.
- Root inventories PASS: 365 package tests, 35 script tests, 31 demos,
  487 publication leaves, 162 pages/1,937 snippets.
- Root guide PASS 22/22, zero skips/precondition failures; 121 existing informational
  gap warnings. Docs budget PASS 317/320 plus the self-contained screen test.
- ./ref-check PASS: 550 LLPs,11,970 references, zero errors/unchecked.

## Wasm

Clean Linux 0.4.30 artifact: **2,372,437 B raw / 723,160 B gzip / 545,213 B Brotli**.
Budget **723,660 B = gzip + exactly 500 B**; whole-artifact gzip growth 6,446 B
from 0.4.29. Reason, journal and clean measurement are committed. No runtime
resource ceiling or independent per-feature byte attribution changed. Subsequent
changes do not affect device/core wasm inputs; final pool bytes match the
measured artifact. Mac build: 2,372,683 B raw / 722,961 B gzip, within Linux budget.

## Evidence and limits

Durable evidence: `snapback4/reports/20261016-integration14/final/`; the parent
directory retains the pre-LANG2 checkpoint and verbatim lane reports. Every
attempt is distinguished from final passing runs. Temporary packs, stores,
scripts and caches remain under `/tmp/integ14/`. The manifest records artifact
integrities, source revisions and commands. No credentials were copied.

All requested scopes are complete. Default ignored/platform-specific cases and
Lean's retained signatures remain explicitly counted. The full scripts/test.sh
was not run per instruction; consumer-only qualification supplies no publication
receipt. EXPOPIN's actual Xcode 27.0/27.1 iOS Release controls are retained lane
evidence, not a newly claimed Integration 14 iOS Release or physical-device run.
No push or publication was performed. Commits use Charlie Cheever
<ccheever@firewoodagent.com>.
