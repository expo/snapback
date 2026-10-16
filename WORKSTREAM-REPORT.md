# DAY3 workstream report — 0.4.30

Worktree: `/home/ccheever/projects/sb4-w13-day3`, branch `sb4-w13-day3`.
Base: `59fb4ead1b` (0.4.29). Initial status clean, no existing lane commits.
No version bump or origin push. Implementation, reviews and qualification are complete.

## Scope and governing context

Read Snapback 4 AGENTS, NOT-DOING, JOURNAL tail, RULES, LLP 3000 and design brief,
release-spanning client LLP 3000.000.000.000 §3, proof-kit LLP
3000.011.003.000.000 §§2–3/8, starter LLP 3000.011.003.000 §§9/13, and reference
actions LLP 3000.039 §§3–6/8. `llp-orient` context: saved builds must preserve
working sources/types and ordinary activation; fixtures remain strict when
explicitly selected; dangling references are legal; cleanup uses existing action
closure/transaction/partition evidence; app-owned starter files stay owned by app.
Amendments extend existing governing documents; no new LLP number.

Read wave-13 Publish gate, prioritized fixes, ledger, H9, DT1/DT4/DT5, NA3 and
frontend evidence. Evidence lanes and prewave stores are read-only.

## #5 — R1/R7 compatibility and saved source

Commit `f159aaba74`: resolve original project compatibility config/baseline while
writing private candidate contracts; missing baseline names absolute path and
resolution provenance; directories preserve original module names/schema-first
ordering; merged enum/value domains deduplicate. Shared layout:
`versions/v1/schema.q`, other original-name modules, `versions/v1/fixtures/`.
Single complete saved files remain supported.

Validation: emit_compatibility 6/6 passed; proof_source unit regressions passed;
client proof suite 14/14 passed, including relative baseline + saved directory
through deploy/serve/hot forward/rollback/forward without working source changes.

## #6 — P14/P15 fixtures and inherited scaffolds

Commits `c51295c1b9`, `b626e5f700`, `edff44f043`, `315994ded9`: contemporary
fixture selection, strict explicit saved-source override (including exact stale
starter samples), named fallback table/case skips, inherited script notice and
script-diff preview, marked business assertion, and frontend-owned build.
Original module names are preserved. Adaptation and repeated init never fill
existing saved directories from current source/fixtures. Exact historical
0.4.28/0.4.29 default/chat/social proof variants preserve their assertions when
upgraded. `28825a4233`/`dfe96d28e7` split the test verb below the source-file
budget; `3a5a2ac8e1`/`7ec6e6466b` align the existing README/census assertions.
Commits `a6b27121e6`/`a5b42688ec` also repair inherited proofs through the
actual Social Expo Router entry point, preserving routes and profile assertions.
New DAY3 CLI regressions: all 12 passed on Mac; Linux's initial 10 and both
subsequent regressions passed. Proof client suite: 17/17 passed before the final
added owner-lock test, which then passed in the four-test proof suite.
SURF3 owns deploy help synopsis; KIT2 owns broader proof helper and UI prose.

## #13 — R6 starter ports and Expo

Commits `c51295c1b9` and `b626e5f700`: init environment pair is a baked
scaffold default after explicit flags; a later pair is a runtime launcher/config
override. Bare dev keeps its documented --port/default semantics. This restores
the existing starter LLP's selection precedence and avoids reading application
client source to infer ports. README tells users to use npm launchers and apply
adaptation after preview. Expo init precedes adapter install/peer resolution.
Commit `bc48b11a17` fixes the remaining chat quick starts and the Social
localhost URL. A six-template regression checks every UI README against its
written backend port and npm launcher. Zero-sync Expo emits the online client
for persona, password and guest modes; managed adaptation reverses that choice
when sync is introduced. Linux and Mac starter/client tests pass.

## F2 — existing expiry orphans

Decision: use the explicit recovery alternative authorized in the brief.
0.4.28 erased unsynced parents without guaranteed per-identity expiry provenance;
physically missing targets are indistinguishable from deliberately dangling
references, which remain legal. Automatic pruning would delete valid data.
LLP 3000.039 §13 specifies doctor E_EXPIRY_ORPHAN inspection plus the offline
operator-selected `doctor --repair-expiry-orphan table:id` command. It takes the
existing owner lock, opens the active stored schema (no source adoption), rechecks
absence and applies ordinary current actions atomically; restrict blockers refuse.
The 0.4.29 changelog is corrected. Commits `6ab5819628`, `7f4e209591` and
`dc2ecfe9d1`; core expiry-recovery regressions 3/3 passed, including physical
read-through preflight before writes. CLI finding/repair on broken working
source, repeat idempotence and live owner-lock exclusion pass.
The actual prewave P1 upgrade database was inspected through an isolated copy
at `/tmp/day3-prewave-expiry-copy-fuqvk3pd`. Repair of missing `claims` identity
`01M4Z5RZC26NB802TCQPNSJMQ5` removed two orphan children (six to four rows),
repeat repair wrote zero rows, and the finding disappeared. Original DB/WAL
hashes were unchanged. Logs: `/tmp/day3-prewave-copy-inspection.log` and
`/tmp/day3-prewave-copy-repair.json`.

## H9 — packed qualification

Commit `d9f8eadfd1` adds packed compatibility day-two and printed/written
Expo-port cases. Both negative controls ran against the read-only installed
0.4.29 under `~/sb4-loop/prewave13/day2/node_modules`: compatibility failed with
`baseline sources need their original UTF-8 .q file names`; Expo failed because
its printed assigned port differed from the `4400` client fallback. Logs:
`/tmp/day3-0.4.29-day2.log`, `/tmp/day3-0.4.29-ports.log`. The same day-two probe
passed on the current local binary/package during independent review. Fresh
packed qualification passed at `bc48b11a17`: H9's two cases, twelve generated
frontend runs (six starters twice, each without dist), six starter scenarios,
and installed-consumer/toolchain proofs in Ubuntu 24.04 and Alpine via proot.
Evidence is `snapback4/target/day3-linux-qualification/consumer.json`, with
`day2-proof.json`, `frontend-proofs.json`, `starter-proofs.json`, and
`proofs.json` alongside it. Full source
checks were run directly; qualify-linux used --consumer-only because the brief
prohibits scripts/test.sh, which ordinary qualification invokes internally.
This yields consumer evidence, not a publication qualification receipt.

## Reviews and qualification

Fresh Codex reviews r1/r2 were NOT READY; their findings are fixed and recorded.
Fresh gpt-6.1-sol high r3 is READY; verbatim review/brief/provenance are in
`llp/reviews/3000.011.003.000.000-day3-r*.{sol,brief}.md` and provenance JSON.
Muse r1 used plan-quota fallback and was cancelled after a fresh usable review
arrived; r2 returned exit 0 without a review and was never counted as approval.
The structured r3 retry returned READY. Its verbatim artifact and provenance
are saved alongside Sol r3. Muse disclosed amendment-vs-code inspection rather
than a base diff (it reported not locating the ref, though the ref exists).
Both required model families are READY; no author acceptance is asserted.
Fresh mutually blind Router-only delta reviews also returned READY from both
families; their briefs, verbatim results and provenance are saved under
`llp/reviews/3000.011.003.000.000-day3-router.*`.
The full Linux five-crate no-fail-fast Cargo battery completed, including
doctests: 402 completed targets, 6,227 passed, 9 failed, 45 ignored. Its original
exit code remains 101 (four failed targets: CLI unit/check/init and language
guide). All nine failures were corrected and covered by passing reruns:
the two diagnostic CLI checks, the two init assertions, and the entire guide
file (125/125 on both Linux and Mac). The raw red run is preserved rather than
represented as an entirely green fresh battery. No second full battery was run;
all other completed tests passed and the semantic inputs to them did not change.
The successfully qualified pack is bound to `bc48b11a17`, version
unchanged at 0.4.29 as commissioned; client SRI is
`sha512-LboW+YnwJrJC9uQxkl1pNho1rhs8ayuxB6BHREMCb3Aaxspigryyzr6nSNBxuxHJaZ+hzPcXD6NVYndeCu0D/w==`.
Prepared via `publish.mjs --prepare-client`; earlier preparations were preserved
or refused when source advanced during review, never reused as changed bytes.
No npm publication or origin push occurred.

After that completed qualification, the full Rust run exposed three additional
guide checks: expiry recovery had expanded the introductory paragraph; the new
code lacked reviewed definition/action pins; and the shipped-file guard needed
the exact new application-owned saved-version paths. These are prose/test-census
corrections only, with no change to the exercised runtime behavior, client code,
starter generation or qualification scripts. The qualified artifact remains
bound to its recorded commit; no claim is made that it contains this later
guide-text correction.
Commit `db64fb0e72` contains these guide fixes; the complete corrected guide
test file passes 125/125 on Linux (`/tmp/day3-guide-corrected.log`) and on Mac
(`/tmp/day3-mac-guide-final.log` on the scratch machine). Commit `33cccaf1de`
records all review briefs, verbatim reviews, provenance and LLP review dispositions.

Linux affected client files: 122 tests, 116 passed / 5 stale-expectation failures /
1 existing skip on the first run. After updating old range assertions and the
online client comment, the complete affected wave10 file passed 9/9. Other files
were green; the extra four-test DAY3 proof file independently passed, including
live-owner repair refusal. The initial proof kit suite passed 14/14.
Mac scratch `~/projects/snapback-ws-day3`: `init` 50/50, `init_dx3` 7/7, final DAY3 CLI
12/12 passed, expiry recovery 3/3, proof helpers 18/18. The complete same
ten affected client files then passed 121 with 1 existing skip (122 total).
No publication checkout was used or modified. Source was delivered by incremental
Git bundles into the authorized scratch clone, not pushed to origin.

The initial full Linux snapshot found the new diagnostic lacked a dedicated
why route and two old init assertions still expected the previous launch/fixture
shape. Fixes are committed: both why/renderer regressions pass, account-screen
self-containment passes, and the current Mac full init file is green. Both Linux
focused init reruns passed. Snapback 4 docs-budget passes 320/320 lines plus
its named one-test self-containment check. Final ref-check passes: 548 LLPs,
11,313 references, no errors/unchecked references.


## Repository-root checks (after required install + hoist)

`./ref-check`: passed (548 LLPs, 11,312 references at the first run).
`node scripts/check-inventories.mjs`: failed guide-manifest because fresh-tree
ignored generated Snapback 1/Contract demo leaves are absent, including
`demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`
and `demos/todo-v2/snapback/generated/contract/{setCompleted.mutation,runtime-links}.ts`.
`node scripts/check-guide.mjs`: 19 checks passed, 0 failed, 3 preconditions;
missing ignored generated leaves/artifact bootstrap prevent the overall pass.
These are repository-root preconditions; this lane changes no root guide,
manifest, diagnostics registry, Snapback 1 code or Contract generators. The
requested commands were run; root setup was `bun install --frozen-lockfile` and
`node scripts/ensure-workspace-hoist.mjs`. Logs are `/tmp/day3-inventories.log`
and `/tmp/day3-guide.log`. Snapback 4's docs budget remains 320/320 lines; its
self-containment check was updated to require the actual npm backend launcher.

## Reproduction commands and evidence

All Cargo invocations inherited `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`. Setup ran the requested
product frozen install, native build, wasm build and client build. Root frozen
install and workspace hoist ran separately. No `scripts/test.sh` invocation.

- Full five-crate command: `cargo test --no-fail-fast -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4`.
  Log: `/tmp/day3-full-cargo-final.log`. Nine initial-snapshot failures were
  diagnosed and corrected: four CLI assertions and five guide assertions.
  The corrected full guide file passes 125/125; focused CLI green logs are `/tmp/day3-code-renderer-rerun.log`,
  `/tmp/day3-code-why-rerun.log`, `/tmp/day3-init-census-rerun.log`, and
  `/tmp/day3-init-readme-rerun.log`.
- Affected client files: proof, day3-proofs, init-typecheck, init-recipe,
  wave11-init, wave10-starters, social-starter, publish-linux, generated-modules,
  recorded-compatibility. Linux logs: `/tmp/day3-affected-client-final.log` and
  `/tmp/day3-wave10-client-rerun.log`; complete green Mac log:
  `/tmp/day3-mac-affected-clients-final.log` on the Mac scratch machine.
- Final Mac DAY3: `/tmp/day3-mac-day3-final.log` (12/12).
- `publish.mjs --prepare-client`: `/tmp/day3-prepare-client7.log`, with
  `target/publication/client-0.4.29/prepare.json` binding the pack to
  `bc48b11a1759422b44d88d199acd32bb67f8fe0b`.
- Packed `qualify-linux.mjs --consumer-only --client <fresh tgz> --expo <fresh tgz> --out target/day3-linux-qualification`:
  `/tmp/day3-qualify-linux-complete.log`. This mode deliberately emits
  `publicationQualified: false`; the coordinator must use the normal publication
  path for the release.
- Reference audit: `/tmp/day3-ref-check-final.log`; docs budget:
  `/tmp/day3-docs-budget-passed.log` (README 320/320; named self-containment test passed).

No remaining implementation work is intentionally deferred in DAY3. Other-lane
text ownership is left as a pointer; missing root-generated prerequisites and
publication/version integration remain coordinator work.
