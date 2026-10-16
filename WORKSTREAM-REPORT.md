# Integration 14 — ready for LANG2

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
Started clean at `59fb4ead1b`; fetched and fast-forwarded origin/main. All
five authorized lanes are integrated. LANG2 remains unmerged pending the
coordinator's instruction. Versions remain 0.4.29: the 0.4.30 bump belongs
after LANG2. No push or publication was performed. No publication worktree or
`target/publication/` was accessed. All generated packs use `/tmp/integ14/`.

## Integrated changes and decisions

Read every lane's WORKSTREAM-REPORT in its own worktree before merging, then
merged DAY3, PREV, RULES3, SURF3, KIT2 in that order with `--no-ff`:

| Lane | Merge | Result |
| --- | --- | --- |
| DAY3 | cd57caff41 | Saved-source deployment, starter/port contracts, F2 offline expiry-orphan repair |
| PREV | 60f06e411f | Saved release previews, backfill narration and bounded preview noise |
| RULES3 | 629bedd6e2 | Authorization recipes, clearer refusal recovery and fixture-drift diagnostics |
| SURF3 | e2451c9b08 | P11 mint-context order, fixture agreement, CLI/help surfaces |
| KIT2 | 8a8a1c0102 | Proof-helper contracts, client readiness and application lifetime |

Parallel publisher's 0.4.29 record `6faa0fb9cd` was merged as `a840cb5024`.
Final fetch found no additional origin/main commits. Report conflicts kept the
integration side. Other conflicts preserved both lanes' behavior; generated
files were regenerated instead of combining conflicting generated text.

Composed saved-version and bridge guide paths; expiry-repair and rule-recipe
pointers; SURF3 CLI metadata plus DAY3 doctor repair; extracted saved-fixture
selection plus per-query sweep personas (working sweep matrices are skipped
when falling back to a saved fixture). Renumbered colliding appended LLP
sections: KIT2 proof §10 and application §6.11, updating live references but
preserving raw lane reviews.

Broad checks found and fixed these integration mismatches:

- Strip native-device imports from zero-sync Expo starters while retaining
  SecureStore session persistence; preserve DAY3 defaults and SURF3 port wording.
- Validate generated frontend proof ports before starting builds.
- Update publication test fixtures for DAY3's module and browser mocks for
  KIT2's init scripts; align old saved-directory assertions and isolate the
  descriptor restart assertion to its actual host diagnostic.
- Expose `useAppReady` through the guide alias index (found by the Mac run).
- Update wave9's online-only Expo expectations and keep browser test logs in
  ignored target directories.
- Add `publish.mjs --prepare-directory PATH` for isolated client preparation;
  ordinary publication defaults remain intact. Extend packed H9 execution to
  PREV noise budgets, KIT2 helper contracts and SURF3 fixture agreement.

Applied llp-orient. Governing documents include LLP3000, release activation
3000.000.000 and release-spanning clients 3000.000.000.000, mint context
3000.000.001, proof kit 3000.011.003.000.000, starters3000.011.003.000,
authorization3000.036.002, application lifetime3000.013 and reference actions
3000.039. No new RFC or authority change was authored. Existing lane reviews
remain intact. One coherent partial 0.4.30 changes entry and LLP3000.037 §17
now describe these five lanes; LANG2-specific prose is explicitly pending.

## Verification

All Cargo commands used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0`. Product setup installed frozen dependencies,
built native, wasm and the client. Never ran the full `scripts/test.sh`.

### Linux native and clients

PASS: complete five-crate `cargo test -p snapback4-core -p snapback4-lang
-p snapback4-device -p snapback4-sim -p snapback4 --no-fail-fast`, exit0,
including all integration targets and doc-tests. This final run followed the
last Rust/product fix (`37ac4b8730`); the subsequent wave9 change only adjusts
JavaScript test expectations. No failed tests in this run.

PASS: one complete final client pass with global SNAPBACK4_BIN bound to the
merged debug binary:405 pooled/serial files plus the two full model files,
407 total. The pool reports 7,649 tests: 7,593 passed, 56 explicitly skipped,
zero failed/cancelled. Models add 81/81 passed at their full case counts.
Combined: 7,674 passed, 56 skipped, zero failures.

Initial broad runs exposed the integration issues listed above. The final
runs follow the fixes; intentionally interrupted intermediate runs are not
claimed as passing runs. The ticketed cleanup/resolver flake did not recur.

### Differential checks and generated inventories

- Native `run --seed 0 --cases 20000 --workers 8`: 20,000 compile cases,
  1,220,035 executions, zero disagreements, generator errors or unexpected
  binder refusals.
- `run-devices --seed 0 --cases 1000 --workers 8`: seeds0–999,
  27,922 executions, zero disagreements.
- `lake build` then `run-lean --seed 0 --cases 20000 --workers 8`:
  16,827 supported/3,173 unsupported; 130 disagreements entirely within the
  four retained signatures: code E_RULE/NOT_FOUND(3), prelude code(25),
  next/no-next(67), continuation-next/no-next(35). The nonzero exit is retained;
  there are no new signatures or oracle/allowlist changes.
- Rebuilt delivery-await census from the AST and authoring census from
  CENSUS_ITEM output (798 entries; identical after regeneration).
- Root frozen Bun install, `scripts/ensure-workspace-hoist.mjs` and
  `scripts/check-generated-artifacts` PASS, including the previously absent
  Snapback1 generated artifacts. Diagnostics registry, manifest and chained
  inventories regenerated without tracked root drift.
- Final root check-inventories PASS:365 package tests,35 script tests,31 demos,
  487 publication leaves,162 guide pages/1,937 snippets. Final check-guide
  PASS 22/22, zero skips/precondition failures (121 existing informational gap
  warnings). A later missing root dependency directory required repeating the
  frozen install/hoist before that final guide run; its earlier red is retained.
- `./ref-check` PASS:550 LLPs,11,958 references, zero errors/unchecked.
- Final `node scripts/docs-budget.mjs` PASS, README 317/320 physical lines
  and the self-contained account-screen test passes.

### Packed Linux consumers

Fresh preparation from product revision `37ac4b8730800202425f55d2b4ff53304ae45609`:

```sh
node scripts/publish.mjs --prepare-client --prepare-directory /tmp/integ14/client-prelang-final
node scripts/qualify-linux.mjs --consumer-only --client /tmp/integ14/client-prelang-final/snapback4-0.4.29.tgz --expo /tmp/integ14/client-prelang-final/snapback4-expo-0.4.29.tgz --out /tmp/integ14/linux-prelang-final
```

PASS on Ubuntu24.04 and Alpine through proot, with every merged H9 case:
DAY3 compatibility deployment and ports, PREV noise budget, KIT2 helper
contracts and SURF3 fixture agreement. All12 generated frontend proofs and
six starter proofs pass. Client pack SHA256:
`e8dc6589362ad6183f8842ef5b9864b423114f1d57437f8dcea11326c1371912`.

`--consumer-only` intentionally leaves the qualifier's built-in full source
suite unrun because that path invokes the prohibited full `scripts/test.sh`.
Source suites were run directly as above. This is consumer evidence, with
`publicationQualified:false`, not a publication receipt. Manifests are still
0.4.29 until LANG2 lands; final0.4.30 version-bound packing remains pending.

### Read-only 100-schema survey

All 100 final wave13 schemas pass on the merged binary, with 298 notes/search
findings and no refusals. Each source schema's hash is unchanged. Private
copies include fixtures, versions and toolchain context. App087 initially
matched RULES3's missing-toolchain red; linking the existing merged-tree
`snapback4/node_modules` into its private copy made it pass too.

| Code | Count |
| --- | ---: |
| N_CONDITIONAL_COMPLETE | 11 |
| N_DELETE_NEEDS_READ | 1 |
| N_DELETE_RESTRICTED | 1 |
| N_EPHEMERAL_SERVER | 2 |
| N_LOOKUP_HIDDEN | 5 |
| N_MAINTAIN_AUTHORIZATION | 2 |
| N_MAINTAIN_DELTA | 7 |
| N_NEVER_COMPLETE | 19 |
| N_NO_CURSOR | 144 |
| N_NO_HORIZON | 12 |
| N_NO_PRODUCTION_WRITER | 50 |
| N_PATCH_CLEARS | 2 |
| N_SEARCH_SHAPE | 1 |
| N_SEARCH_UNSCOPED | 1 |
| N_SEARCH_WORDS | 2 |
| N_SPARSE_FILTER | 16 |
| N_SYNC_ORDER | 5 |
| N_UNREADABLE_PROBE | 13 |
| N_VACUOUS_RULE | 1 |
| N_WIDE_MERGE | 3 |

On RULES3's comparable 99 schemas, every code count matches except all 21
N_FIXTURE_ARGUMENT_DRIFT are eliminated:317 → 296 notes. Hydrated087 adds one
N_NEVER_COMPLETE and one N_NO_PRODUCTION_WRITER, giving 298 across all 100.
LANG2 comparison must follow its authorized merge. Binary SHA256:
`0989d347e49e0bb0b1c026ae7d38c8a0b7061b0778274644e20dba464429af78`.

### Upgrade rehearsal

Installed the actual old release using `npm install --save-exact
snapback4@0.4.29 --registry http://127.0.0.1:4873/ --ignore-scripts` in a private
temporary project. That binary wrote two note rows minted at the same fixed
millisecond and a parent with two children. Explicit offline SQL removal of
the parent/indexes emulates the older orphan corruption;0.4.29 itself no
longer creates this condition. Preserved pristine store backups.

The merged binary adopted a copy: old IDs stayed unchanged, a new default
backfilled both note rows, doctor reported E_EXPIRY_ORPHAN, explicit repair
removed two orphan children and repeat repair removed zero. New same-ms rows
have consecutive ordered entropy; final count four notes/no children, doctor
healthy. Exact old IDs, new IDs and store SHA are in upgrade-prelang.json.
Final version-bound0.4.30 adoption remains pending the bump.

### Mac

Used `ssh ccheever@charlies-macbook-pro-m5max-black`, scratch clone
`~/projects/snapback-integ14` only, with bundled Git objects. Node24.13.1 was
downloaded and checksum-verified. Set `ulimit -n 65536` and PATH including
Bun, Cargo and the existing Elan install; all Cargo invocations used the
three required environment settings.

The initial complete five-crate run exposed seven failures across DAY3,
starters, lifecycle, overload and builder guidance. After the fixes, every
failed target was rerun in full:day3(12),init(50),lifecycle(29),overload(2),
builder_guidance(5),guide(125):223 passed. The complete difftest target passes
94/94 with the real built Lean oracle (an initial missing-oracle setup red is
retained). Total317 passing tests in those corrected full targets. The other
initial five-crate targets passed. No claim of a second complete Mac
five-crate run is made.

The platform-sensitive/client pool ran52 files in one pass:899passed,
14 explicit skips, zero failures. The later test-only wave9 correction also
passes 11/11 on Mac:53 distinct files,910 passed,14 skips total. Mac checkout
ends at `3fcad43718974bc4d8f16651f5bcc237731d73e3`, clean; native SHA256
`a71bc8c892b3915c4e92746ea07285f9be87522080a2653f8ec10a3c1614a03c`.

### Exact

Fresh app `/home/ccheever/sb4-loop/prewave14/hello` generated with
`bun /home/ccheever/sb4-loop/prewave14/exact2/scripts/exact.mjs new ./hello
--snapback --port 26040`. Private Exact source copy came from
`~/sb4-loop/exact2`; the original checkout is unchanged. In the private copy,
three Cargo dependency paths were redirected from the pinned0.4.29 snapshot
to this merged tree. Tracked build-source files omitted by the initial copy
were restored before qualification. Private Bun1.4.2 install used the local
registry after frozen public/local optional-package setup failed.

Installed the merged client tgz in prewave14. With SNAPBACK4_BIN pointing to
the merged debug binary, cached Playwright Chromium via CHROME and required
Cargo flags, ran `bun exact.mjs snapback`, then the merged binary's
`dev --memory --no-watch --port 26040` and `bun exact.mjs test web` from hello.
PASS 2/2 including offline/reconnect. The driver stopped its owned server.
Full commands, source paths and log are retained in exact-local-build.json
and exact-37ac-prelang.log.gz. Final0.4.30 pins/build rerun remain pending.

## Wasm

Clean pre-LANG2 measure:2,355,193 B raw,717,515 B gzip,542,232 B Brotli.
Budget718,015 B = gzip+exactly500 B, recorded with reason in wasm-budget.json.
Gzip increase over0.4.29 is801 B. Strict family/absence audits pass; no runtime
ceiling changed. Measured at6393a786b8; later changes do not affect device/core
wasm inputs. Used real gzip and Node Brotli quality11 wrapper because the
brotli executable is absent. Remeasure after LANG2 and the version change.

## Commits through this checkpoint's evidence preparation

```
46881c12b6 Integration 14: retain packed, Mac, Exact and reconciled survey evidence
3fcad43718 Integration 14: align legacy Expo assertions with online-only starters
37ac4b8730 Integration 14: expose readiness hook guide and complete saved-version assertions
27d98e0e43 Integration 14: distinguish proof persistence from native CLI flags
162b26da6c Integration 14: retain lane reports and pre-LANG2 oracle, survey and upgrade evidence
afb56fd112 Integration 14: align references with composed amendment sections
dcfa4cca7b Integration 14: date the wave 13 research update
a840cb5024 Integration 14: retain parallel 0.4.29 publication record
3cf57ec92d Integration 14: checkpoint integration decisions and pre-LANG2 evidence
a86e81188a Integration 14: scope descriptor restart assertion to host diagnostics
b34c9a6ef8 Integration 14: consolidate release notes and record wave 13 before LANG2
304c7bf6b1 Integration 14: validate proof ports before builds and compose qualification fixtures
9cec89f636 Integration 14: record clean pre-LANG2 wasm measurement
a3e5fddd82 Integration 14: preserve zero-sync Expo and printed port contracts
6393a786b8 Integration 14: compose proof census and packed H9 checks; allow 718015 B wasm
8a8a1c0102 Integration 14: merge KIT2 proof contracts and client readiness
e2451c9b08 Integration 14: merge SURF3 fixtures, mint order and CLI surfaces
629bedd6e2 Integration 14: merge RULES3 authorization recipes and refusal diagnostics
60f06e411f Integration 14: merge PREV release previews and backfill narration
cd57caff41 Integration 14: merge DAY3 saved-source, starter and expiry fixes
```

Commit identity is Charlie Cheever <ccheever@firewoodagent.com>. No push.
Raw earlier reds and final evidence live under
`snapback4/reports/20261016-integration14/`; transient scripts, private stores,
consumer packs and full logs remain under `/tmp/integ14/`.

## Coordinator handoff: ready for LANG2

Do not merge LANG2 before the coordinator resumes this integration. Remaining
work depends on that merge:compose P17/P18 diagnostics and refusal semantics,
finish the coherent0.4.30 changes entry (capability markers, existing-store and
client/native-device rebuild implications) and LLP3000.037 §17; bump exactly
the paths changed by c113020b4a in its own `snapback4 0.4.30: ...` commit;
repeat the full Cargo run, three difftests,100-schema reconciliation and wasm
measurement. Repeat affected Mac/packed/Exact/upgrade checks against the final
version, finish report and commit. Do not push.
