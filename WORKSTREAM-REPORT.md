# Integration 20 — Snapback 4 0.4.36

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
**Committed locally; not pushed or published.** Publication worktrees and
`target/publication/` were untouched. Commands were bounded by timeouts; Cargo
received `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
The prohibited full `scripts/test.sh` was not run.

## Integration and version

Started clean at f0eed70bb3 and fast-forwarded main to 86303f71df, retaining the
main census/test-only-module correction. Merged the requested lanes in order:

- DX5: **825ec1d055** (`--no-ff`).
- SEC5: **d0551b2f37** (`--no-ff`).
- Current main S8 store/device boundaries through 8beeb79c52: **353c270de8**.
- Later main Postgres experiment lock refresh 1c3e742784: **115822bc36**.
- Current main P1 foundation/evidence changes through 1c838356f2: **a3d79a312f**.

Final verification snapshot: **49ff4203ce**, including the last known-evidence fixture repair. Main is continuously active; no quiet-main or exact-HEAD qualification requirement was introduced.

Kept integration's WORKSTREAM-REPORT on its conflicts, unioned append-only
journal entries, and kept one coherent 0.4.36 `guide changes` section. Generated
records were regenerated, not manually merged. The later isolated experiment
lock was refreshed by Cargo for 0.4.36 (5c64561f93); offline locked metadata
validation passed. It changes no CLI/device workspace semantic input.

Dedicated bump: **d8deda73dd**, `snapback4 0.4.36: specification intent, staging
diagnostics and lighter starters`. It uses precisely the ten files changed by
9ec63002ee's 0.4.35 bump. Research: 6220e43d95 extends LLP 3000.037 §20 with
waves 20 and 21 on 0.4.35 and the 0.4.36 response; the wave-21 aggregator was
rerun. 943e9b4a3e refreshes its Revised header.

## Per-item result

- **DX5 clock:** `advance()` returns `{now,fired,held}`, with numeric `now()`
  preserved. HTTP/CLI/helper reports explain fired schedules, saved-boundary
  holds and recovery, including incomplete maintenance. S8's typed clock/
  metadata ports preserve the same keys and admission policy.
- **DX5 source advice:** hidden/required/same-table lookups and private unique
  conflicts name the authored rule/clause and safe rewrite without exposing
  stored rows. The integration ranks both codes as review advice, not merely
  performance advice (d144095106). Existing specific advice retains precedence.
- **Upgrade path:** old installed 0.4.33/0.4.35 `npx snapback4 upgrade` paths
  deliver warnings, preserve pending captured advice, and keep JSON stdout
  clean. The guide gives `JSON.parse(stdout).rows`, plus `more`/`limit`.
- **Starter weight:** ReadState and its API indexes are present; Metro/native
  smoke support lives in the package; starter proofs and Playwright custody
  remain explicit. Edited application screens/proofs remain owned by the app.
  Integration fixes the README's packaged smoke import, the shim fixture's
  new dependency, exact diagnostic expectations and explicit React peer in
  the packed proof. Registered starter digests and invariant declarations pass.
- **SEC5 intent and notes:** drafts ask independent product-spec questions;
  restatement review names admitted roles and conditions. Broad roster OR,
  lifecycle/private-column, self-claim and caller-clock notes work without
  invariants, with scoped quiet controls and transitive clock anchors.
- **SEC5 concrete evidence:** bounded check replays actual generated fixtures
  through authored reads. Column-world normalization preserves creator coupling,
  ordinary values and shared verified asset ledgers. The integration fixes
  creator candidate ordering to try admitted roster principals first while
  retaining outsiders, all guards and existing budgets (da83e95c83).
- **SEC5 output:** check combines distinct compiler/security advice coherently;
  audit leads with fixes/reviews and keeps full evidence in JSON/--all.
- **Test fixture repair:** synchronous CLI inspections blocked live-host socket
  processing under load. Two fixtures now await the public command helper
  (75982178c7), preserving assertions and bounds. The historical guide test asks
  for --full (7276aba83f). No runtime ceiling or security boundary was relaxed.
- **Incoming-main evidence policy:** merged shared metadata/receipt validation and explicit unknown preservation evidence. Null/absent evidence keeps the prior read while refreshing; known lists retain bounded withdrawal. Old fixtures conflated these states. 05b7e9b7be and 49ff4203ce supply known evidence (actual authored mutation results where available), preserves every withdrawal/queue/retention bound, and regenerates literal HTTP examples using KIT3_UPDATE_WIRE/KIT4_UPDATE_WIRE.

## Verification

### Linux

The exact requested five-crate command completed **exit 0** at final runtime/test source **49ff4203ce**, after the last fixture fix: **431 parent target summaries, 7,153 passed / 0 failed / 47 standard ignores**. Nested child-probe summaries are excluded. Cargo used twelve build jobs and eight libtest threads. The full unfiltered log and parsed targets are retained in [rust-tests.json](snapback4/reports/integration20/rust-tests.json). The follow-on docs-budget check also passes.

```sh
cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4 --no-fail-fast
```

- Full client pool in one pass at **49ff4203ce**: **425/425 files**, **7,769 passed / 0 failed / 56 platform skips** (7,825 records). Full-count seeded models: **2/2 files, 81/81 passed**, no skips. Fixture-wrapper tests also pass **9/9**. There is no selected-rerun-only green claim.
- Release difftest: `run --seed 0 --cases 20000`, `run-devices --seed 0 --cases
  1000`, and `run-lean --seed 0 --cases 20000`. Core/device disagreements: zero.
  Lean has the identical **130** baseline mismatches reproduced on exact
  f0eed70bb3: code E_RULE~NOT_FOUND 3; continuation-next 35; next 67; prelude-code
  E_RULE~NOT_FOUND 25. **No new signatures**; Lean is not described as zero-red.
- Fresh `publish.mjs --prepare-client --prepare-directory <owned scratch>`
  pack and `qualify-linux.mjs --consumer-only` **PASS** at 49ff4203ce, including
  all new DX5/SEC5 cases, six starter toolchains, frontend/negative proofs,
  upgrades, migrations, staging, security, Ubuntu and Alpine/proot.
  Consumer-only avoids forbidden test.sh; full Rust/client components are
  separate. The receipt correctly says `publicationQualified:false`; no
  publication/promotion receipt is claimed.
- Root frozen Bun install, workspace hoist and check-generated-artifacts PASS.
  Diagnostics registry and guide manifest regenerated; inventories PASS:
  365 package tests, 35 script tests, 31 demos, 487 publication leaves,
  162 pages/1,937 snippets. Guide: **22 passed, 0 failed/skipped/preconditions**
  (121 inherited warnings). Final reference check: **564 LLPs, 12,242 refs, 0 errors/unchecked**.
- Docs budget PASS: README 319/320 lines and executable guide fences. Codec
  census 27/27 PASS. RULES4 authoring census regenerated from the fresh
  executable and compared exactly: unchanged membership. Delivery await census
  regenerated (one clock timestamp projection, no new fault site).
- Both release guards PASS: raw test-support refuses release host compilation;
  debug web-device-check refuses the wasm profile.

### Wasm

**2,404,980 B raw / 733,906 B gzip / 552,883 B Brotli. Budget 734,406 B = gzip
+ exactly 500 B.** Strict serde-family and server-only absence audits pass.
Final clean remeasurement after P1 is recorded at c620cad340 with that budget (f34441c148); it is byte-identical in all three wasm sizes. The
current-main boundary merge changes the earlier integration artifact by +58 B
raw / +4 B gzip; the reason is in the budget and journal. No per-feature
attribution, Mac wasm measurement or runtime-ceiling increase is claimed.

### Real schemas and upgrades

350 schemas: wave 15's 100 plus 50 each from waves 16/18/19/20/21. Exact base
f0eed70bb3 and the integrated binary both have **zero refusals**; original source
hashes are unchanged. Full per-code before/after counts are in [survey.json](snapback4/reports/integration20/survey.json).
Security deltas: caller time 0→74, self-claim 0→2, role-wide read 11→133,
broad read 363→365, restatement 761→810; all other security counts unchanged.
Lookup source advice 26→1,533; hidden unique 0→91. Notes remain advisory questions,
not exploit counts or a claim of zero specification noise. S8 and the later P1 integration leave
all these counts unchanged. The final survey uses the qualified 49ff4203ce production binary; every source hash still matches the exact-base survey.

Real old installed CLIs from **public 0.4.33** and **local-registry 0.4.35**
(`http://127.0.0.1:4873/`, acquisition integrities retained) upgrade authored Expo
apps and persistent dev/production stores through their own old `npx` path.
Both PASS again on the final prepared packs; pre-upgrade native --version is explicitly **snapback4 0.4.33** and **snapback4 0.4.35**. Results: rows and ids preserved, expected visible/pending warnings and pure
JSON, Expo typecheck/web export, retained production service token and new
production write; production dev doors remain 403. New packed warnings cover
ordinary, quiet and JSON+quiet old-CLI forms too.

### Exact

Fresh Exact2 origin/main clone at **eb12e487f33a7e3a07c5fee8682c3e99db8f1df0**,
with EX10 contract migrate, under `~/sb4-loop/prewave20/exact2`. Local test
input overrides: its SDK's core/device/lang Cargo dependencies point at this
merged source; offline lock regenerated. Its existing Snapback dev dependency
is replaced by the prepared 0.4.36 pack, with no duplicate dependency. Backend
parents resolve that same installed pack. Actual package 0.4.36 and device stamp
are verified in [exact.json](snapback4/reports/integration20/exact.json). The final banner and resolved test input name the installed 0.4.36 pack. That client and Expo tarball are byte-identical to the fresh final 49ff4203ce pack.

Commands below ran with Bun 1.4.2 on PATH, CHROME pointing at installed
Chromium 1234, SNAPBACK4_BIN pointing at this tree's qualified production binary (`snapback4/target/x86_64-unknown-linux-musl/production/snapback4`), and all three
Cargo environment settings. Every invocation had an outer timeout; log
redirections are omitted here.

```sh
# Exact2 clone
bun scripts/exact.mjs setup --check
bun scripts/exact.mjs new ../synced-foundation-proof/app --snapback --port 26909
# First write ../online-foundation-final/snapback/schema.q with online-only notes.
bun scripts/exact.mjs new ../online-foundation-final/app --snapback --online --port 26908
# In ../synced-foundation-proof/app
bun exact.mjs snapback
bun exact.mjs test web
# In ../online-foundation-final/app
bun exact.mjs snapback
bun exact.mjs test web
```

Fresh synced app: wire PASS; web **2 passed/0 failed** (cross-persona post and
offline delivery). Fresh online app: wire PASS; web **2 passed/0 failed**,
including a real mutation; final CLI data inspection confirms all three writes from the three proof runs, with distinct ids.
The online contract adds the write assertion to the generated open-operations
case. Cargo's test build replaced the debug CLI with different bytes; final Exact and survey receipts are repeated against the same production binary used by packed qualification and upgrades. Earlier debug proofs remain historical. Earlier setup attempts and their corrections are recorded: explicit
Chromium, online schema precondition, regenerated SDK lock after S8, and a
scratch Bun duplicate dev/dependency pin that initially selected 0.4.33 types.
A separate scratch synced app with an already existing backend generated a generic greeting; that result was rejected as insufficient. The counted synced app was generated without that precondition and proves real cross-persona and offline behavior. Final proofs use the verified 0.4.36 installed pack and qualified 49ff4203ce production binary. Both owned final servers were stopped; apps/SDK remain recoverable.

### Mac Studio

Only the assigned Mac Studio and `~/sb4-ws-integ20` were used. Actual selected
toolchain: **Xcode 27.1 Build 27A9275**, SDK 27.1, iOS simulator runtime 27.0
(the host had advanced from the prompt's Xcode 27.0). No global Xcode setting
was changed. Intermittent SSH returned within the one-hour allowance.

- Current-main core lib/revocation history: **619 passed, 0 failed, 4 standard
  ignores**; CLI bin **499 passed, 0 failed, 5 ignores**; revocation soundness
  **5/5**. Full device tests had already passed on the integrated source before
  P1; no device code changed in P1.
- Repeated all lane-selected Rust targets after P1 and the generated-guide fix:
  core disclosure **18/18**; all **17 language targets, 359 passed/0 failed/2
  standard ignores**; all **7 CLI targets, 110/110**.
- Complete platform/lane client pool: **40/40 files**, **764 passed, 0 failed,
  14 platform skips** (778 records). It includes every one of the 27 files with
  explicit platform/darwin checks. First seven-file wire/fixture follow-up:
  **132/132**; final five-file known/unknown follow-up: **139/139**.
- Fresh merged-core xcframework and the installed prepared client: Expo
  `witness ios --build . --smoke --udid BDF123A8-5E01-42BC-92F6-9BFECB63747E
  --port 26903 --artifacts ../native-artifacts-foundation-final` **PASS**, proof
  kind **application-release**, CLI 0.4.36. The native witness's client tarball
  is byte-identical to the final 49ff4203ce prepared client; the framework was
  built from the merged core. Complete native build records, smoke receipt,
  video and screenshots remain in owned scratch; compact provenance is committed.
- All **338 changed extant crates/packages/scripts/apps/manifests/fence files**
  match final Linux source hashes. The final four JS fixture edits change no
  compiled Rust/client input. Exact execution snapshots are distinguished in
  [mac/completed-proofs.json](snapback4/reports/integration20/mac/completed-proofs.json).

The first historical 39-file attempt lacked a shared stages.mjs helper in the
scratch source. Copying the exact helper fixed the focused test and complete
repeat; the later full 40-file pass supersedes that setup failure. Only this
task's simulator was shut down/deleted after receipt collection. Its temporary
caffeinate and partial transfer were removed. The black MacBook and publication
worktrees were never used.

## Review, provenance and limits

Fresh Codex gpt-6.1-sol/high and Muse Spark 1.3 Contributor/high both returned
**READY** on four scopes: the integrated 37a707c158 product, incoming-main P1
foundation changes through f34441c148, the 05b7e9b7be generated-guide/fixture correction, and the remaining fixture correction at 49ff4203ce.
Verbatim reviews, stderr, exact briefs/invocations, provenance and focal source
hashes are under `llp/reviews/integration20/`. Existing lane amendment reviews
are retained. Reviewers did not treat running tests as verified success. No
proposal was accepted on the author's behalf. 107e37d1dd applies the exact reviewed documentation reconciliation; f8904e5ee0 records the later integration reviews. Both families also returned READY on a documentation-only reconciliation of LLP 3000.023 §12 with the already incoming P1-MR null/absent-evidence policy. It corrects stale descriptions and adds no further policy decision. The entire tracked Snapback4 subtree (**72,362 files**, excluding only this integration's evidence directory) matches qualified 49ff4203ce exactly. `source-equivalence.json` records its descriptor. Later commits contain the reviewed root RFC reconciliation and review/evidence metadata.

Failed attempts are not counted as successes. Pre-bump/superseded full Rust
and client attempts were interrupted when source/version/main changed. A
route-saturation unit failed once under overlapping default-concurrency runs,
then passed alone and in the complete integrated repeat; its observation is
tracked in issues/20261021-snapback4-route-saturation-test-load.md without
weakening bounds. Initial packed React-peer and test-fixture gaps were fixed.
A strace 6.8 malformed fragment was correctly rejected; the final consumer run
uses an owned strace 6.17 for later proofs, with strict decoder/assertions kept.
Earlier successful audits record 6.8 individually. The compatibility follow-up
is issues/20261021-snapback4-strace68-interleaved-fragments.md.
After incoming P1 main, the first packed run correctly rejected stale literal wire examples, and the first client run exposed stale known/unknown fixtures; the fixtures were repaired in 05b7e9b7be and 49ff4203ce. The first completed repeat after 05b7e9b7be had four red files/42 cases (421 files passed), all missing known preservation evidence. The earlier progress counter matched the wrong failure marker; final summaries are authoritative. The same packed run completed its consumer cases but its final source guard correctly rejected generated test logs. Final qualification waited for complete client/model success and preserves closed logs externally; the strict source guard is unchanged. Unfinished Rust repeats that began before later fixture/doc repairs were explicitly stopped and are not counted as green runs. The final complete command started after 49ff4203ce. An extra upgrade repetition exposed double-header handling in the scratch-only npm proxy during an upstream body failure; it now buffers the body before sending headers and preserves failed-attempt logs. No product bound changed.

Evidence is committed under `snapback4/reports/integration20/`; full scratch,
baseline binaries, acquired packs and recovery state remain in
`~/sb4-loop/integration20/` and `~/sb4-loop/prewave20/`. Closed fixture logs were
preserved outside source; only owned superseded build/transfer artifacts were
removed to manage shared disk. Both final Exact backend groups were stopped. The Mac owned simulator, wake lock and partial transfer were removed. Generated command logs are preserved outside source. Prepared packs, source, baseline binaries, full raw logs and recovery apps are retained; no other worktree cleanup was performed.

No requested verification is omitted. The forbidden full scripts/test.sh, push and publication were not performed. Public npm acquisition of 0.4.35 remained unavailable during the successful upgrade cases, so the expressly permitted local registry supplied it. Existing conditional security-note noise/unsupported temporal intent and the four Lean signatures remain measured limitations, not new engine failures or universal security claims.
