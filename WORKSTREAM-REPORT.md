# Integration 21 — release evolution, SEC6 and 0.4.37

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
0.4.36 was pushed as explicitly requested in Step 0. **0.4.37 is committed
locally and has not been pushed, published or tagged.** Publication worktrees
and `target/publication/` were not used.

## Changes and commits

| Item | Result | Commit |
| --- | --- | --- |
| Step 0 | Merge incoming release/activation/ledger, neutral store-handle and scale work; keep both journal histories; qualify and land 0.4.36. | Initial merge `c42ea4e226`, S10 merge `b422e1210e`, evidence `2448deea23`, final main merge and successful push `b71c73fc79` |
| EVOL | Adoption fingerprint/destination fixes; truthful previews; loosened bridges; identity-preserving table/asset renames; indexed and file-derived backfills. | Merge `87e2de3314` |
| SEC6 | Creation/write-intent and typed-result privacy campaigns; deploy FIX/REVIEW/evidence reporting; complete supplied-session validation and private snapshots. | Merge `d642d75c89` |
| Version | Same ten-file version-bump surface as the 0.4.36 bump `d8deda73dd`. | `f547a9f50e`, `snapback4 0.4.37: release evolution and creation privacy checks` |
| Bridge composition | Honor explicitly renamed parent references while retaining the independent-identity refusal; emit renamed newer-only tables once; remap retained child types/rule probes and continued sync arms. Five focused regressions include guarded/unsafe creation and privacy intent. | `25630e51f6`, `cc370731b9`, `4b824a6fe6` |
| Store-handle reconciliation | New preview code uses `AnyStore` and neutral reports; the merged visibility test also uses the neutral handle. No production ratchet allowance was raised. | Merge resolutions; `eae7324784` |
| Wasm | Set whole-device measurement plus exactly 500 B, with reason in budget, commit and journal. | `216c54d3e4` |
| Mac fixture | Fix parallel temporary-directory name collisions with a process counter. No product code, test bound or assertion changed. Incident closed with the repair. | `0042644172` |
| Documentation | One coherent 0.4.37 `guide changes` entry; LLP 3000.037 §20.6 extends wave-21 day-two calibration and explains upgrade behavior. | SEC6 merge and `25630e51f6`; final evidence/report commit |

On every report conflict the integration-side report was retained. Generated
censuses, diagnostics and guide/inventory projections were regenerated rather
than hand-merged. Final authoring census: 872 entries, unchanged; the await-boundary
census also regenerated unchanged. Guide budgets were not raised.

Existing apps keep their authored policies. Stores retain rows, identities,
users, dormant populations and migration custody. Release-store format 8 requires
the newer runtime for later release switching. Regenerate declarations and rebuild
clients for the new capability fences. A generated bridge is a new source release
requiring application/policy review; it does not rewrite an immutable old release,
merge already independent table histories or make a frozen old UI expose new tables.

## Verification

Step 0 completed the exact five-crate Rust command after the incoming source
repairs: 7,179 reported passing executions, zero failures, 47 ignores across 446
result summaries. Six release/activation client files passed 64 tests. Root setup,
generated artifacts, inventories, guide (22/0/0) and ref-check all passed. The last
incoming commits before the push changed benchmark controls/records only; affected
Python checks passed and product source trees matched the tested merge.

| Final check | Result |
| --- | --- |
| Complete Linux five-crate Rust command, after the last fix | Passed in full: 7,216 reported passing executions, zero failures, 47 ignores in 448 result summaries |
| Full Linux client pool, one pass | 425/425 files; 7,772 passing tests, zero failures, 56 platform skips |
| Full-count seeded client models | 81 passed, zero failures |
| Fixture wrapper / SDK TypeScript | 9 passed; typecheck passed |
| Difftest `run`, 20,000 seeds/cases | 1,222,111 executions; zero signatures |
| Devices, seeds 0–999 | 27,922 executions; zero signatures |
| Lean, 20,000 | Exactly the reproduced 0.4.36 baseline: 130 disagreements in four signatures (3/35/67/25); 3,173 unsupported cases are not passes |
| Fresh prepared pack / Linux installed-consumer qualification | Passed, proot route; all standard cases plus 19 evolution/dormancy cases and SEC6 session/multi-write/result cases |
| Wasm, strict family/absence audits | Passed: **2,405,869 raw / 734,904 gzip / 553,602 Brotli B**; budget **735,404 B**, exactly measurement + 500 B |
| Packed/source/dist wasm identity | All SHA-256 `87116107086fb3fb85814517fcf33204f574df340e2dad0b11395d3b96e7924e` |
| Docs budget | Passed; README 319/320 physical lines |
| Root frozen install, workspace hoist and generated artifacts | Passed with the prescribed setup; no checks skipped |
| Post-fixture diagnostics / guide regeneration / inventories / guide | Passed; guide 22 passed, zero failures/skips/preconditions; 121 inherited warnings |
| Ref-check | Passed after final records: 564 documents, 12,277 references, zero errors/unchecked |
| Postgres feature, all-target compiler check | Passed; this is not a live Postgres migration qualification |

The first complete current-product Rust invocation hit only the ticketed
`stalled_resolver_sigterm_is_bounded_journalled_and_drained` readiness assertion.
The unchanged case passed alone. The final full repeat used eight test threads
and includes the subsequent test-only Mac fixture repair. The successful repeat is bound to source `0042644172`; counts include nested child reports rather than distinct test identities.
Earlier compile failures and intentionally stopped invocations are retained as
attempts, not counted as successful complete runs.

The final inventory recheck found root `node_modules` missing after the earlier
successful root pass. Repeating frozen install, workspace hoist and generated-
artifact setup restored the preconditions; the complete inventory retry passed.
No tracked product file changed. The failed precondition attempt is retained
separately in the evidence manifest.

### Schemas, stores and real upgrades

- All 350 unique apps / 358 Quarry files from wave 15 and waves 16, 18–21 passed
  on both the 0.4.36 control and the merged production binary: zero false refusals;
  original sources remained unchanged. All existing compiler and SEC5 note-code
  counts are unchanged. SEC6 adds 4,231 `N_COLUMN_RESULT_EXPOSURE` and 646
  `N_INSERT_WRITE_INTENT` advisory question instances, not vulnerability counts.
  The complete before/after table is in `snapback4/reports/integration21/schema-note-code-delta.md`.
- Coherent copies of 29 wave-21 stores, including immutable asset bytes, ran two
  rollback/forward cycles per binary. Active/dormant row-identity unions were
  retained. The same four legitimate strict historical-source refusals occur
  on both binaries: edited outputs in 026 and missing original required fields
  in 044. All eight dormant bridges previewed and activated with zero hidden or
  newer-only source populations. These are schema counts before read rules.
- Real 0.4.35 and 0.4.36 executables created stores and Expo apps, then their own
  `npx snapback4 upgrade 0.4.37` acquired the exact qualified candidate packs.
  Both upgrades retained rows/ids, service credentials and genuine old full and
  narrowed read sessions; new writes succeeded and production dev doors stayed
  closed. Expo typechecks and exports passed before and after. Real browser
  screens read the backend before/after with the same persisted origin/session.
  0.4.35 came from local registry 4873; unpublished 0.4.36 used the exact retained
  qualified Integration 20 tarballs through an owned temporary proxy.

### Mac and Exact

Mac Studio `macstudio-charlie-apt101-a`, own scratch `~/sb4-ws-integ21` only:
core library, affected language/security/guide targets, CLI units plus affected
previews/security/ratchets, and simulator crate passed. The 53 platform/affected
client files passed 1,062 tests with 14 Linux-only skips. The directory-collision
case passed alone after its repair, then the full parallel device target passed
63 unit and 88 read-authority tests. Source-hash validation covers the original
237 changed paths plus the one test-only repair file.

The exact Linux-prepared common client was used with a fresh native framework
and native Expo pack. The Expo **Own Release** witness passed prime, cold offline
launch and restart, with `proofKind: application-release` and exit 0. Installed
Xcode/SDK are **27.1**, with iOS runtime 27.0; Xcode 27.0 was unavailable. The generic
fresh todo witness had zero rows and checked complete offline acquisition/query;
it did not exercise asset UI. The fixture's `file:` dependencies were correctly
refused by the bounded adapter; serving the same tarballs over an owned loopback
HTTP endpoint made them ordinary supported dependency inputs. Its functional
Darwin CLI pack used the merged debug CLI and is not a publication qualification.
The owned simulator was deleted and both owned server ports refused connections.
The owned wake process was stopped after validating its command and birth time; the owned SSH master was closed.

Fresh Exact2 `origin/main` clone `1cb27f606b40c60b7f0ea8fe6dedf7b5eb8cad19`
under `~/sb4-loop/prewave21/exact2`, including EX10 `contract migrate`:

```sh
# Fresh synced app, above its backend:
bun /home/ccheever/sb4-loop/prewave21/exact2/scripts/exact.mjs new app --snapback --port 27137
# In synced/app:
bun exact.mjs snapback
bun exact.mjs test web
# Fresh online app, after writing its online-only backend schema above it:
bun /home/ccheever/sb4-loop/prewave21/exact2/scripts/exact.mjs new app --snapback --port 27138 --online
# In online/app:
bun exact.mjs snapback
bun exact.mjs test web
```

Both `snapback` commands passed; synced web tests **2/0**, online **1/0**.
The merged production binary and exact prepared client were used. Only candidate
dependency/lock overrides were made in the fresh Exact clone; its device lock was
regenerated offline after redirecting the three kernel crates. The online starter
requires a preauthored schema, as its guide says. Failed setup scaffolds/logs were
preserved separately; no Exact implementation fix was needed. Exact command argv,
working directories, source/binary/client digests and test counts are retained in
the tracked qualification JSON. Owned backend processes were stopped.

## Review, evidence and boundaries

The final fresh Codex gpt-6.1-sol/high and Muse Spark 1.3 Contributor/high reviews
both returned READY on the final five-case bridge delta. Verbatim artifacts,
briefs, negative rounds and provenance are under
`llp/reviews/3000.000.000.002-integration21-*`. No RFC was accepted on its author's
behalf. The affected LLP audit found the implementation consistent with EVOL §8,
SEC6 §15, S10a's neutral-handle constraints and the wasm budget rules.

Packed qualification is bound to product source `4b824a6fe6`. Later
`0042644172` changes only a `cfg(test)` fixture and incident/review records;
production wasm bytes are unchanged. The complete final Rust repeat includes it.
The final evidence/report commits do not change runtime semantics.

Safe compact evidence and file digests live in
`snapback4/reports/integration21/qualification-0.4.37.json` and
`evidence-files.json`. Full raw logs, scripts and the Mac video/receipts remain
under `~/sb4-loop/integration21/`; credential-bearing temporary app/session files
were not copied into the repository. Earlier harness setup/typing/entry-point
mistakes were repaired before the successful real-upgrade checks.

No requested implementation item is deferred. `scripts/test.sh` was not run, as
instructed: the complete source suites ran independently and the installed pack
used `--consumer-only`, deliberately yielding `publicationQualified: false`.
No npm publication, 0.4.37 push, universal security proof or new bakeoff rating is
claimed. Temporal intent and frozen old UI assumptions retain their documented
limits.
