# Integration 15 — Snapback 4 0.4.31

Complete on `sb4-loop`; no push or publication. Base `4ef9f77fb3` (0.4.30).
All seven current requested branch tips are integrated. `sb4-w14-live` is
excluded; live-parent authority continues separately for 0.4.32.

## Commits and integration

| Workstream | Merge | Result |
|---|---|---|
| REG | `154f5e3b0f` | Persona-only fixture loading/dev catalog; Expo floor/upgrade; missing-export advice. |
| DAY4 | `00081c70ad` | Full proof ownership, explicit day-two opt-in, custom/adapt custody and directional rollback advice. |
| PROD | `e84766710d` | Independent production adapt module; explicit roster/first-writer plan, real-account and release-aware screen recipes. |
| KIT3 | `07d9d4e36a` | Explicit async form claims, reason enum, fresh-text returns, dev clock/reporting and bounded overdue reads. |
| RULES4 | `3a80814cbb` | Private refusal layers, conservative mixed-gate advice and executable bounded authorization recipes. |
| LANG3 | `f5e63f9203` | Held-parent completeness, enum/sort facts, private readable P18 cases and precise note categories. |
| SURF4 | `67c9b95849` | Captured host imports/package scopes, startup/shutdown, help/parser parity and truthful printed surfaces. |
| 0.4.30 publication records | `61060eeeb1` | Integrates `7508c4ef2a`; preserves both journal entries. |

Version bump: **`8d068a7577` — `snapback4 0.4.31: reliable upgrades, proofs,
production adaptation and precise diagnostics`**. Its exact ten-file scope
matches `1f6b75ff27`'s 0.4.30 bump.

`201ec02ca3` writes one coherent 0.4.31 guide-changes entry, including runtime,
existing-store/app behavior, Expo acquisition/floor, fixture credentials/catalog,
clock reporting/each-boundary/deadline reads, day-two opt-in, production adapt,
new notes/refusals and captured authority. `0130e0f041` adds LLP 3000.037 §18;
the final evidence commit updates its revision and final-schema reconciliation.

Conflicts preserve both intents: production dispatch beside day-two adaptation;
`startDev` has **personas and async now()**; todo screens retain denied/empty
states and scoped proof results; diagnostic categories and private rule layers
coexist; all new help flags and every consumer slice are retained. Overlapping
LLP material is preserved under subheadings with repaired anchors. Root report
conflicts keep the integration side. Generated records were regenerated rather
than hand-merged.

Additional integration corrections:

- `ecc0f2c305`: qualify RULES4's guide blocks against the exact prepared packs;
  preserve DAY4/PROD/client proof records in qualifier output.
- `263f8b0d2e`, `516a73cb31`: canonical proof digests and delivery-await census,
  fixture/module/mock updates; API/guide/message corrections across the small
  integration commits. Structured error-code assertions remain intact.
- `077fc71f81`: serialize two 130-socket overload cases so their parent respects
  macOS's ordinary 256-descriptor limit; all saturation/recovery assertions stay.
- `dc6f2b9de9`: worker error formatting contains E_EFFECT_LEASE exactly once,
  while the wire message remains unprefixed. Four focused real-wire cases pass.
- `19fbc756c0`: stop wire-fixture hosts before deleting directories. Mac exposed
  ENOTEMPTY in the earlier after-hook, which skipped the stop hook and left a
  server/pipe alive. Raw TAP/process sample retained; both wire cases pass on
  Linux and Mac. No timeout, workload or assertion was weakened.

## Final verification

All Cargo invocations use `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0`; build jobs are six. Every shell command is bounded
by timeout. No full `scripts/test.sh` invocation, publication directory or
publication worktree was used.

| Check | Final result |
|---|---|
| Linux exact five-crate command, complete after last fix | PASS exit 0; 402 targets, 6467 passed, 0 failed, 45 ordinary ignores. |
| Mac same complete five-crate command | PASS exit 0; 402 targets, 6502 passed, 0 failed, 45 ordinary ignores. |
| Linux full client pool, one pass | PASS 411/411 files; 7660 passed, 0 failed, 56 ordinary platform/environment skips (7716 total). |
| Full-default seeded client models | PASS 81/81, no skips; 5000/3000 sequence settings unchanged. |
| Fixture wrapper | PASS 9/9. All three client invocation stages exit 0. |
| Mac changed/platform-sensitive client scope | PASS 96/96 files; 1669 passed, 0 failed, 17 platform skips. |
| Native difftest | PASS 20,000 cases, seed 0, six workers; no disagreement. |
| Device difftest | PASS 1000 cases, seeds 0–999, both memory/SQLite; no disagreement. |
| Lean differential control | 20,000 cases: exactly 130 baseline mismatches, no new signature; pinned oracle built successfully. |
| Fresh packed consumers | PASS `qualify-linux.mjs --consumer-only` at `bbf8dfaae4`, including every new H9 case. |
| 100 final-schema check survey | PASS 100/100, 358 notes, both Quarry-only and full source/metadata copies. |
| 0.4.30 store/Expo upgrade | PASS real registry installation, adoption/open, upgrade, exact rows/store-id/file preservation, Expo floor repair, typecheck and web export. |
| Exact synced and bare-identity online apps | PASS fresh clone, generation/types, two web-test repetitions per app: 8 authored tests. |
| Mac native Expo peer floor | PASS Xcode 27.0, Expo 57.0.22/core 57.0.23, installed Release offline/restart witnesses. |
| Docs budget | PASS 317/320 README lines and named self-contained screen test. |
| Root inventories | PASS inventories of 365 package tests, 35 script tests, 31 demos/catalog entries, 487 publication leaves. |
| Root guide | PASS 22 checks; 0 failed, 0 skipped, 0 preconditions; 162 pages/1937 snippets. |
| References | PASS 551 LLP docs, 12,000 refs, 0 errors/unchecked. |

The native command is:

```sh
cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4 --no-fail-fast
```

Linux's final full command starts after `19fbc756c0`. Mac uses eight libtest
threads; no test content, count or deadline changes. Its two intermittent cases
pass alone **and** in the complete repeat. Their investigation tickets remain
open; passing repetitions do not identify a cause. The first runs and controlled
cancellations are retained separately, never relabelled green. The final one-pass
client invocation uses the rebuilt merged CLI for every helper, including legacy
helpers which read target/debug directly.

## Packed and platform evidence

Fresh `publish.mjs --prepare-client --prepare-directory target/integ15-pack3`
then `qualify-linux.mjs --consumer-only` with its client and Expo packs, output
`target/integ15-qualification2`, exit 0. Includes verbatim guide loadFixtures on
persona-only and identity apps, all three Expo acquisition paths (including the
actual previous published starter), five DAY4 custom/removed/legacy/opt-in/template
cases, production adapt/real accounts, KIT3 contracts and RULES4 exact-pack guide
blocks. All 12 frontend proofs, six starter proofs and clean Alpine consumers pass.
This mode emits **publicationQualified=false**; the full native/client suites above
are separate. No publication qualification receipt or npm publication is claimed.

The packed snapshot is `bbf8dfaae4`; later changes are the two test-only fixes
above and evidence/docs. Production source and prepared artifact bytes are
unchanged. Pack integrities and static Linux binary digest are preserved in
`packed-consumer.json` and component records.

Mac used only `ccheever@macstudio-charlie-apt101-a`, scratch `~/sb4-ws-integ15`,
private Node 24.13.1/browser, Xcode 27.0. The black M5 was never used. The native
floor framework was built for iOS device and simulator; actual installed versions
are recorded in `mac-native-floor.json`. Native witness source `0130e0f041` has the
same core/device/client/Expo production source as the final tree. Scratch reference
app Babel/signing setup failures are retained along with the successful normally
signed Release run. Owned simulator shut down/deleted. Generated witness metric
append was preserved verbatim before restoring that file for a fast-forward;
there was no hand merge of generated metrics.

## Upgrade, Exact and schema controls

The upgrade begins with the requested
`npm install --save-exact snapback4@0.4.30 snapback4-expo@0.4.30 --registry
http://127.0.0.1:4873/`. A real row is written before upgrade. Candidate delivery
uses a temporary read-only registry overlay, not publishing. Acquire the .31
helper, then run `npx snapback4 upgrade --to 0.4.31`: valid Expo 57.0.30 stays;
a deliberately lowered 57.0.20 manifest moves to 57.0.22/core 57.0.23. Exact
row data, ids, store id and authored App/client/schema hashes remain unchanged.
Check, typecheck, export and final row read pass; exact commands/results retained.

Exact is a fresh `https://github.com/ccheever/exact2` origin/main clone at
`85cc746b56437e8897720538cd9d8f9dbbb8cfc8`, `~/sb4-loop/prewave15/exact2`.
`bun scripts/exact.mjs setup` installs tools; only scratch Cargo manifest/lock
paths bind its core/lang/device to this merged .31 tree. Final projects
`synced-final` (personas) and `online-guest-final` (bare `use identity`, await
`guest()` before reads) install pack3. Each runs `bun exact.mjs snapback`,
Contract type generation and `bun exact.mjs test web --backend <url>` twice.
`exact-final-commands.json`, driver, manifest/lock patch and numbered logs record
exactly what ran, including backend launch details in the evidence README.

Both 100-schema surveys use read-only copies of wave14/apps/*/snapback;
original source hashes are unchanged and identical between the .30 and merged
checks. Current local-registry .30 control reports **371** notes; merged **358**.
Every LANG3 final code count (357) matches, plus RULES4's N_REQUIRE_REFUSED in
079. RULES4's earlier 373/374 record differs by one note each at 063 and 065;
its absent source hashes do not establish the cause. The current controls do not
reproduce those two notes. Delta: conditional completeness −2, immutable patch −5,
hidden lookup −3, never-complete −1, unchecked reference −1, unreadable probe −2,
require-refused +1; all other code counts stay unchanged.

| Code | Count |
|---|---:|
| `N_CASCADE_DORMANT` | 4 |
| `N_CONDITIONAL_COMPLETE` | 8 |
| `N_DELETE_NEEDS_READ` | 3 |
| `N_DELETE_RESTRICTED` | 2 |
| `N_EPHEMERAL_SERVER` | 1 |
| `N_IMMUTABLE_PATCH` | 11 |
| `N_LOOKUP_HIDDEN` | 4 |
| `N_MAINTAINED_COLUMN_DISCLOSURE` | 2 |
| `N_MAINTAIN_AUTHORIZATION` | 2 |
| `N_MAINTAIN_DELTA` | 7 |
| `N_MAINTAIN_SYNCED` | 1 |
| `N_NEVER_COMPLETE` | 20 |
| `N_NO_CURSOR` | 193 |
| `N_NO_HORIZON` | 14 |
| `N_NO_PRODUCTION_WRITER` | 53 |
| `N_PATCH_CLEARS` | 1 |
| `N_REQUIRE_REFUSED` | 1 |
| `N_SPARSE_FILTER` | 19 |
| `N_SYNC_ORDER` | 2 |
| `N_UNREADABLE_PROBE` | 8 |
| `N_WIDE_MERGE` | 2 |

Authoring census regenerated: **497 mutations, same 94 private eligible sites**.
Delivery-await census regenerated: three proof files updated, **213 delivery sites
and their fault recipes unchanged**. Proof digests regenerated canonically;
root diagnostics/symbol registry and guide manifest regenerated and inventories
checked. Root setup actually completed frozen Bun install, workspace hoist and
check-generated-artifacts; no missing-artifact precondition was skipped.

Lean's baseline has 16,697 agreements, 3,173 unsupported cases and 130 mismatches:
3 E_RULE/NOT_FOUND, 25 prelude, 67 next and 35 continuation. All oracle counts
and signatures exactly match RULES4's independently reproduced `4ef9f77fb3`
control. This is a baseline limitation, not a green Lean equivalence claim.

## Wasm and delivery

Clean locked Linux measurement at `61060eeeb1`, recorded in `bbf8dfaae4`:
**2,372,829 B raw / 723,275 B gzip / 545,364 B Brotli**. Strict family and
absence audits pass; dirty=false, over=0. Budget **723,775 B = gzip + exactly
500 B**, reason recorded in wasm-budget.json/JOURNAL. Whole artifact versus
0.4.30: +392 B raw/+115 B gzip; no runtime ceiling increase or independent
feature attribution. Brotli quality 11 uses Node zlib because the CLI is absent.

Durable evidence index: `snapback4/reports/20261017-integration15/README.md`.
Raw lane reports, final commands, source/artifact digests, JSON results and
compressed raw logs are retained there; scratch apps/packs remain reviewable.

No requested check is deferred. Full scripts/test.sh, push/publication and the
live workstream are intentionally excluded as instructed. Ordinary test ignores
and platform skips retain their reasons. No credentials were copied; no other
worktree was modified; target/publication and publication worktrees were not touched.


---

# SEC workstream — conservative implementation committed and qualified

Branch `sb4-b16-sec`, base `ccb9f752d1`. No push, publication or version bump.
The inherited integration report above is not this lane's qualification claim.
**The requested zero-security-holes end-game is not established.** Unsupported
proof/exposure boundaries remain explicit; the delivered verifier never calls
those paths proved. Open scope is recorded in
`issues/20261018-sb4-security-proof-and-adversarial-qualification-gaps.md`.

## Changes and commits

| Item | Change | Commits | Evidence / remaining scope |
| --- | --- | --- | --- |
| Design | LLP 3000.036.004; fresh Muse + Codex review rounds, both READY for design revisions 3/5 and implementation round 5 | f538708bd9, 1b33562487, 6cdeef3c1a | Verbatim reviews/provenance under llp/reviews; reviewed verifier hashes still match. |
| Invariants | Independent schema declarations; bounded exhaustive ternary implication; separate Lean soundness/completeness lemmas; proved/refuted/unproved results; replayed counterexamples | f1bdc51e2d, 685364545e | 16 security + 2 bakeoff regressions pass; complex path reductions remain unproved. |
| Exposure | audit/check --audit text + JSON; conditional role/row/column access, operations, inherited grants and writers; broad signed-in-read and missing-intent advice | f1bdc51e2d, 2ba00705fc | CLI/check and packed tests pass; conditional roster labels do not claim universal grants. |
| Generated tests | Default test explores isolated schema/fixture principals, role snapshots and authored operations; replayed declared-policy violations fail acceptance | f1bdc51e2d, 685364545e | 150 schemas/2,024 operations/32,384 actual attempts; HTTP/device/sequence and asset-ledger gaps are named, not certified. |
| Bakeoff fixes | Role/grant lifetime, argument grant, global created self-promotion, optional/empty/omitted evidence, sweep deadline and existence-oracle advice; non-whitespace text minima shared by row/argument/device validation | 6c81b07d78, f1bdc51e2d | Regression coverage and Mac checks pass. Existence handling follows bakeoff S8's warning/uniform-code recipe, with no runtime rewriting of authored codes. |
| Guide/starters | Security card, README/start discovery, 0.4.32 guide changes without a version bump; todo/social/production/chat privacy declarations; authoring census +1 never mutation, same 94 private eligible sites | f1bdc51e2d, 2ba00705fc | All changed forms run through actual installed tarballs on Linux and Mac; guide 125/125, census 88/88. |

## Qualification

- Design and implementation: both fresh reviewer families READY. No fabricated
  review; Muse's prescribed wrapper used its quota fallback without exposing keys.
- Six original high-finding schemas produce actual engine counterexamples;
  five repaired authority rule sets pass the same generated challenges.
  The 015 witness is typed trusted seed ingress, not a repaired ordinary custody
  workflow. The strict 045 interpretation remains explicit.
- All 50 wave-16 and 100 wave-15 original schemas compile with zero diagnostics.
  They declare zero invariants, so this is compatibility/exploration, not spec
  certification. All original/copy hashes and per-schema results are retained.
- Main difftest: 20,000 seeds / 1,220,035 executions, zero disagreement signatures.
  Device seeds 0–999: 27,922 executions, zero signatures. Lean: 20,000 cases,
  16,697 agreements, 3,173 unsupported, 130 disagreements in exactly the four
  retained integration15 classes/counts; no new signatures or full-equivalence claim.
- Lean check passes: 80 theorem audits, 116 examples, seven oracle fixtures;
  no sorry or added nonstandard axioms. The Rust translation/whole exposure
  reductions are not claimed formally proved by those independent lemmas.
- Full Rust workspace scope ran. The original command hit its 60-minute guard
  in clique; its three unfinished active tests, all 41 remaining simulation
  targets and all workspace doc tests passed on bounded continuation. Initial
  help/output/census/guide failures were corrected and affected targets rerun.
  Latest guide 125/125, readauth 88/88, check 105/105; security 16+2 pass.
  CLI had an earlier complete 471-test pass; the last run passed 470 and hit an
  unmodified shutdown assertion, which passed in isolation. Its raw failure and
  ticket `issues/20261018-sb4-refusal-shutdown-test-flake.md` remain visible.
- Full client pool: 412/412 files, 7 initially failed files, 7,671 tests and
  56 normal skips. Producer/setup and all eight affected rerun files pass
  168/168 tests. The two full-count models separately pass 81/81 tests.
- Fresh-pack qualify-linux --consumer-only passed Ubuntu and Alpine, all host
  frontend/starter/production/rule/client proofs, at 6cdeef3c1a. No forbidden
  test.sh invocation or publication receipt. Later chat/prose/census changes
  passed their affected installed-pack checks at 2ba00705fc. Exact tested bytes
  are retained; no exact-final-HEAD publication claim is made.
- Mac Studio only, own ~/sb4-ws-sec: verifier 16+2, text minima, CLI build,
  installed guide and every changed starter including both chat variants pass.
- Clean wasm measurement at 685364545e: 2,372,893 B raw / 723,411 B gzip /
  545,200 B Brotli. Budget 723,911 = measurement + exactly 500 B; +136 B gzip
  versus base, with rationale. Families/absence audits pass, dirty=false, over=0.
- Root frozen Bun install, workspace hoist and generated-artifact setup passed.
  Root inventories pass (365 package tests/35 scripts/31 demos/487 publication
  leaves); root guide 22/22 with 121 inherited warnings; ref-check 552 LLPs /
  12,011 refs, zero errors/unchecked. Docs budget 319/320 physical lines.

## Deferrals and claim limits

Whole restrictive read proofs still name unmodeled wire activity, refusal/
collision outcomes, derived aggregates/maintenance, raw probes, owner-field/
referential paths, temporal behavior, opaque jobs/native workers and device
freshness. A disconnected device cannot know a later server revocation.
Generated engine tests do not qualify unauthenticated HTTP, genuine revoked-device
histories, arbitrary operation sequences, all named-seat/enum combinations or
complete file/video/fixture ledgers. General aggregate/time proofs and a repaired
015 custody workflow remain open. Explicit unproved output is the conservative
boundary, not a claim that all commissioned end-game paths are implemented.

## Evidence and cleanup

`snapback4/reports/20261018-sec/README.md` and `qualification.json` index raw
compressed logs, all corpus/differential JSON, six witnesses, exact tested packs,
Linux consumer evidence and Mac records. Source snapshots and later deltas are
identified explicitly. No source outside this worktree or designated Mac scratch
was modified. Original wave directories stayed read-only. Removed 1,636 dead-run
SQLite sidecars and the dead generation lock; target now has zero SQLite scratch
files. Removed 28 rebuildable qualification node_modules directories for shared
disk space. Preserved source/proof metadata and package bytes; no keys copied.


---

# SEC2 workstream — implemented; scoped qualification and open obligations

Worktree `/home/ccheever/projects/sb4-b16-sec2`, branch `sb4-b16-sec2`, base `c4f7f08b4a`. Initial status/log inspected; requested `git merge --no-ff origin/main` was already up to date. No push, version bump, publication, other worktree writes, or test.sh invocation. Every shell command was timeout-bounded; all Cargo calls set all three required profile variables. Mac work stayed in Mac Studio `~/sb4-ws-sec2`.

## Per-item implementation

1. Aggregates/derived observations: separate point/scan/count/sum/exists and maintained contributor obligations. Bare exact typed group keys support contributor-audience proofs; ambiguous/recorded/reference/computed keys and downstream chains remain unproved. Paired independently valid present/absent worlds expose admitted logical data and authored rule/constraint collision/refusal differences. Resource, unstable-policy, implicit-entropy and invalid-world outcomes cannot refute privacy. Commits `362fd29898`, `c86d306d70`, `35051cff3f`, `5d30c5554b`, `f61a376031`, `4fc8d2a828`.
2. Time: exact nullable server half-open not-before/expiry admission, independent of physical sweep, plus actual unswept boundary reads. General temporal writes, schedules and history induction remain explicit unproved obligations. Initial implementation `362fd29898`; governed by LLP 3000.036.004 §10.
3. Adversarial campaigns: actual two-mutation histories + post-history reads from focused fixtures; all declared persona/service seats; Cartesian bool/required/nullable enum alternatives (bounded512, unvisited combinations named); real foreign file/image and non-image-as-photo ledgers. Actual production HTTP unsigned/forged calls, plus guest/password authenticate→refresh→old denied→logout-all→both retired tokens denied at every authored q/m and schema/changes/sync/probe/refresh. Tests distinguish server admission from disconnected-device storage. Commits `362fd29898`, `2a086f204f`, `4424bef458`, `35d581ae08`, `f8f9743ae7`, `f432e74d7e`, `3d79eecb9e`, `5f9a09b3c9`, `a0a8890fc0`, `a08f5b94ba`.
4. Precise scope/advice: raw probes, owned-field bypass, referential/capture paths and opaque/native writers stay explicitly unproved with author repair guidance. Ordinary update proofs now judge BOTH old and next and collapse only id/explicitly immutable local old fields. Direct proof discharge preserves authored-operation assertions/owned-field searches. Witnesses record actual committed next/old/changed patch and decline no-op/implicit-only writes. Commits `fa0c0f6948`, `481952cccd`, `f36659c3d5`, `2c5624f7ea`, `217b60de96`, `2f6288c99f`, `f2f7ab8937`, `4fc8d2a828`.
5. 015: real photo-backed place/transfer/adoption records handoff atomically, validates current parties and ordinary confirmations. Test creates all pet/custody state through authored operations, never trusted seed. It is not an all-ingress theorem. Commit `362fd29898`.
6. Adoption: one aggregate missing-intent note per project check (no hidden permanent dismissal), ignored reviewable `security-invariants.q.draft`, never auto-accepted/compiled. README/start make rules+independent invariants one task; existing starter declarations retained and packed-tested. Audit ends with uncovered conditional role/row/effect/owner-field exposures. Commit `362fd29898`; README319/320.

STAGE owns provisioning/startServe/password-only dev doors; RULES5 owns live-parent semantics; FRONT owns general diagnostic presentation. This lane’s temporary app host is a private test adapter, not a duplicate product staging API.

## Review

All received reviews retained verbatim with content hashes/provenance. General SEC2 fragment round5: Codex+Muse READY. Later proof/witness correction round7: both READY. Final credential/framing/image campaign round13 at a08f5b94ba: both READY. Prior NOT READY findings were fixed, including immutable-image visibility, lost operation assertions/maintained-column observers, faithful witnesses, complete HTTP framing, live rotation identity and Darwin loaded-vnode custody. Round14 both READY for compiled-operation/intent-only service-seat discovery. Round15 both READY for exact deterministic seeded-world validation-rejection reuse; test-only canonical-name correction documented separately. See `llp/reviews/3000.036.004-sec2-final-review-manifest.json`.

## Proof of progress

Two independent fresh installed-doc-only builders used copies of the same ten wave16 apps: 005/007/008/009/010 controls and 019/020/021/045/048 confirmed findings. No author saw the other family, repository source, original wave directories or finding labels. Fresh continuations saw only their own retained work and the installed docs; verbatim reports, prompts, session metadata and source/evidence archives are under `snapback4/reports/20261018-sec2/builders/`.

| Builder | Final declarations | Proved / refuted / unproved | Findings and false refusals |
| --- | ---: | --- | --- |
| Codex | 102 | 31 / 3 / 68 | Initially reproduced12 distinct spec/workflow findings in the five finding apps. Original101 authored cases had11 failures; repaired101+5 additional cases pass, as do12 new boundary cases. Zero observed false runtime refusals in those cases. Three retained refutations are two over-strong both-image declarations and one all-snapshot integrity violation from a trusted seed, not three demonstrated reachable public leaks. |
| Muse | 181 | 68 / 0 / 113 | Initial170 declarations caught two policy refutations (007 roles.read;045 repairNotes.read); final includes five enforcement repairs and three documented scope/completeness corrections. Zero observed false runtime refusals, but no supplied ordinary business fixture. Earlier40-minute session timeout, two009 timeouts and incomplete default test rows preserved. |

Primary production-package replay measures30 snapshots/60 commands: Codex final10; Muse initial10 and final10. All commands finish within180s; no timeout, max122.460s overall and119.961s for Muse final009. Codex final has six expected nonzero commands for its three retained literal-policy refutations; Muse final all20 exit0. The replay executable SHA matches `linux/consumer.json` exactly. These are primary-agent measurements, not retroactively attributed independent author results. Original Codex misleading-witness evidence remains; its fresh final review confirms zero current false refutations. Findings across families overlap and are not summed; unproved/uncovered counts are not confirmed leaks.
Original probe brief/harness rerun on all five repaired production copies (two ordinary password users/role, ports26900–26949): all five DONE, 0 high/medium/low confirmed, 0 tampered source paths. Earlier rounds found and then repaired retained role/ownership access (including placed proof assets), late claim/verification before auction sweep, manager unfinished-round/future-shift exposure. All rounds, final repaired Quarry source hashes and sanitized findings are retained in `snapback4/reports/20261018-sec2/probes/`. No session/service credentials retained. Initial serve-setup failures were infrastructure attempts, not zero-finding probe passes. Runtime core/serve semantics did not change during later campaign-only hardening.

## Qualification

- Affected language suites: security16, observers11, history3, custody1, wave16 bad/fixed2 PASS. Final full guide125 and observers11 PASS after test-only generated-draft path registration. Test-only fixture cleanup removes an invariant when a test deliberately removes its table (`4109fe2078`), never product enforcement.
- HTTP framing/rotation unit tests2 PASS on Linux; Mac Studio3 tests PASS including running-child pathname replacement and loaded-vnode refusal. Final Mac affected observer11/wave162 PASS; earlier security16/history3/custody1 pass retained. Mac CLI build and packed security/all changed starter test PASS. Scratch only `~/sb4-ws-sec2`.
- Actual packed security guide/card, malicious broad-read refutation, todos/social/web/chat web+expo/production, both guest/password live revocations and emitted DRAFT marker PASS after test-only change (`/tmp/sec2-final-packed-draft.log`,96.7s). No changed snippet is merely compiled without execution.
- Full five-crate Rust command finished normally:421 target summaries,6,509 passed,5 failed,45 ignored; four failed targets retained verbatim. One init host launch failed after Cargo replaced its running executable path (image custody fixed, exact w8b rerun PASS); two observer failures used the older pre-fix compiled target (final full11 PASS); guide path registry and removed-table/invariant fixture fixed in4109fe2078. Full affected reruns PASS: CLI473+5ignored, init51, guide125, observers11, clique254+1ignored. Raw original red remains rather than claiming a single green full-suite run.
- Full client pool:412/412 ordinary files,7,671 tests (7,610 pass,4 fail,1 cancel,56 skip); five failed files. Both full models81/81 PASS; fixture pool9/9 PASS. Event-slot producer/setup fixed and both dependent files pass; full server-e2e9 PASS after executable replacement correction; maintenance failing case PASS on exact replay. Social original30s guard now PASS in19.2s, from exact invalid-world negative-cache optimization (`e513cda65b`, no raised timeout). Complete four-file replay before cache had73 pass/1 cancel; that remaining case then passed in isolation. No full-pool exact-final-HEAD green claim.
- Native difftest20k:1,220,035 executions, zero signatures. Devices0–999:27,922 executions, zero signatures. Lean20k: exactly130 disagreements in four retained baseline signatures3/35/67/25; no new signatures. lake build/check PASS80 theorem audits,116 examples,7 oracle fixtures. No new lemmas/sorry/axioms.
- Original150-schema survey PASS150/150, zero diagnostics/violations/boundary failures,33,173 actual attempts. Every original declares0 invariants: zero false compile refusals and finite exploration, not spec certification. Hashes and full per-app results retained.
- Wasm raw2,372,893/gzip723,411 within unchanged723,911 budget; wasm SHA `4c55ff02925dc4a99b78f400bee4c8abc354b0d713468de24a786514834e238f`. README docs budget319/320 PASS.
- Fresh `publish.mjs --prepare-client` and `qualify-linux --consumer-only` PASS at `3b89b6300e`, exact prepared client SRI and binary hash in `prepared-client-final.json` and `linux/consumer.json`. Ubuntu+Alpine, six starters, frontend, production, regression and rule/client recipes pass. `suite.status=not-run`, `publicationQualified=false`, no publication receipt. Earlier consumer attempt correctly rejected changing source and remains archived. Later4109fe2078 is test-only; later commits contain reports/reviews, not a new runtime qualification claim. Consumer proot omits `/proc`, so its roundtrip does not qualify the default HTTP test campaign in a proc-less environment; packed HTTP campaign passes on ordinary Linux and Mac hosts.
- Root frozen Bun install, workspace hoist and generated-artifacts setup PASS after restoring cleaned-up root dependencies. Inventories PASS365 package tests/35 scripts/31 demos/487 publication leaves; guide PASS22/22, zero failures/skips,121 inherited warnings. Final ref-check PASS552docs/12,021refs. Earlier dependency-precondition guide failure remains in logs; the ready rerun passes. `qualification-final.json` indexes final outcomes.

## Artifact and performance notes

The social starter check dropped28.12→16.77s with byte-identical security JSON. Cache applies only to the same deterministic seeded-world final-exists validation rejection, not operations, policies, successful executions or resource outcomes; round15 both READY and per-observer unsupported regression passes. Literal candidates precede the original unchanged bounded enum alternatives; no original samples discarded. Named service seats now include compiled operation IR and invariant-only seats;10actors×18 nullable enum combinations covered in the regression.

Exact packs remain at `/tmp/sec2-final-prepared/` (consumer qualification), `/tmp/sec2-final-test-packs/` (packed draft test), and `/tmp/sec2-linux-final/` (musl platform); their hashes/SRIs are durably recorded. Logs, declarations, source hashes, reviews, production replay and finite probe evidence are committed under the SEC2 report directory. No session/service keys, app databases or deployment stores are copied into the repository.

## Residual obligations / scope decisions

The zero-hole acceptance ticket remains OPEN. General temporal write/schedule induction, arbitrary longer sequences, disconnected-device histories, complete video/populated fixture ledgers, captured/maintenance fixture histories, raw/referential/opaque observer reductions and whole wire activity remain unproved/not-covered. The implementation never clears those blockers on finite passing tests. The five zero-finding live probes are scoped measured progress, not a universal zero-hole guarantee.

Cleanup: removed1,636 closed SQLite files/sidecars (1,638,494,968bytes) from this lane’s target after the broad suite. After final affected reruns,0 SQLite/db scratch files remain under target and0 were retained open; designated Mac target also0. JSON cleanup receipts preserve paths/counts. No broad deletion of other worktrees or unrelated processes.

Final handoff: implementation is committed through3b89b6300e; test-only fixture correction4109fe2078; final blind review artifacts d10ec8a7d3; independent builder/consumer/cleanup evidence4ecebf9b64. The remaining report commit adds only completed check outcomes and this handoff. No push or version bump. All originally failing affected Rust targets pass full reruns; all original failed client cases have passing replays, while raw suite failures and exact claim limits stay visible. Universal zero-hole acceptance remains Open for the obligations listed above.
