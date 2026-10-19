# DORM — target 0.4.35

Worktree `/home/ccheever/projects/sb4-b19-dorm`, branch `sb4-b19-dorm`. Initial status and `git log sb4-loop..HEAD` were empty. No push, publication or version bump. Work was confined to this worktree; original wave19 evidence was read-only.

## Changes and commits

| Item | Result | Principal commits | Affected evidence |
|---|---|---|---|
| 1. 0.4.34 regressions | Preview before-images survive read-through temp-store changes. Retained source selection ignores compiler packaging reports while request integrity covers all bytes. Refused candidate cleanup is regression-tested. | `9801227c4a` | Release transition tests; actual023 copied store check/rollback/forward; all11 cross-compiler retained-source replays. |
| 2. Representable old views | Explicit `down` evaluates a metered current source snapshot, saves exact physical preimages and per-cell receipts, preserves native legacy text, recomputes repeated down images, and refuses conflicting older edits. Unrepresentable rows stay dormant. | `ba3ac5ed14`, `d529cb8989` |75 migration tests plus final admission test, packed/development dormant helper, actual020 authenticated HTTP proof. |
| 3. Honest checks | Rollback leads with actual hidden old-table records, separates empty/defaulted cells (new versus retained empty) and newer-only rows, and names a reverse projection/bridge repair. Deploy warns about future new-table/domain/removed-field risks and previews actual reverse effects. | `13d3c05180`, `d529cb8989` | Visibility2/2 and foresight2/2 unit tests, release preview/activation clients, copied-store read-only checks. |
| 4. Forward correctness | Declared backfills catch up rows written while older source was live. Exact native cells survive; disjoint older edits survive and overlapping edits refuse. | `ba3ac5ed14`, `d529cb8989` | Conditional backfill cycle tests and two packed/public-HTTP old-write cycles requiring a label. |
| 5. Inspection | Read-only `sql --dormant` / `--all-releases` expose retained table/column names, separate images and explicit state/source/provided-column metadata under one snapshot. Internal tables stay unavailable. | `43cc1e6303`, `d529cb8989` | Logical SQL, internal-namespace refusal, null/absent provenance assertions and dormant count replay. |
| 6. Read-through rollback | Predicate-only changes with unchanged capture/reference structure preserve original captured authority/lifetime; missing capture inputs remain dormant instead of being recaptured into a wider grant. | `ba3ac5ed14`, `d529cb8989` | Core capture preservation after parent change, hot packed/public-HTTP narrow/check/rollback case. |
| 7. Migration primitives | Identical-type scalar `newName: Type renamed from oldName` carries old/native rows both ways. Protected kinds reject before activation. `newArg: Type alias oldArg` maps values on server/devices, rejects duplicate spellings, preserves defaults, and updates generated types/availability/compatibility advice. | `50e5e10196`, `ba3ac5ed14`, `49c1801b02`, `9b9b3e78d5` | Language13/13; package typecheck; release capabilities9/9; alias HTTP/device helper; column rename historical/native/two old-write cycles. |

`049fb003f8` records the governing design amendment and six blind review rounds; `d529cb8989` includes the final protected-rename confirmation, runnable guide changes and replay/differential evidence. `df956bfc67` and `2037d0b240` record the credential-free real-user replay helper/results. `a9fd8169bb` preserves existing typed wire diagnostic guides through the shared alias decoder; unchanged wire traces and duplicate-name refusals are asserted on Linux and Mac. `9b9b3e78d5` preserves the four-argument generated descriptor for operations without aliases, keeps the globally alias-aware availability helper, updates only that intentional helper in the list-bound golden, and executes a saved generated v1 client closure against v2 alias metadata.

## Design and scope decisions

Read Snapback 4 AGENTS/NOT-DOING/JOURNAL, the governing retained-release/backfill/operation-contract/reference LLPs and current deploy guide. Read wave19 bakeoff-day2 in full and skimmed wave18 bakeoff. Scope/constraints were assembled with llp-orient; orchestration and review skills were applied.

LLP 3000.000.000 §19 and its backfill child amendment specify the semantics. Round 6 received READY from Muse `muse-spark-1.3-contributor` high and fresh Codex `gpt-6.1-sol` high on the same immutable snapshot. Targeted round 7 early-protected-rename clarification also received both READY verdicts. All outputs are verbatim with snapshot/output SHA provenance under `llp/reviews/3000.000.000-dorm-r*`. Readiness is not author acceptance or a publication receipt.

- Down may explicitly synthesize over nullable old cells, including intentional null; the exact original physical null/absence is retained, never inferred or lost. Previous down results remain receipt-owned and cannot masquerade as original legacy preimages.
- P verification compares physical presence and value, not default interpretation. Type-incompatible projected values retain their receipts while dormant so forward can restore native values before destination narrowing.
- Scalar rename is the reviewed closed boundary. Reference/asset/collection/engine-owned moves reject before either direction can activate; no new lifetime binding is invented. Preserve operation/result wrappers where old result shapes are needed. Aliases require advertised runtime capability; regenerate/rebuild engines when adopting them. Integration note: new `Program` initializers need the default `arg_aliases` field; release schema/storage use the reviewed v4/v7 capability/format fences.
- Existing same-UID operator authorization governs source rollback to broader older rules. No new acknowledgment flow was introduced. Counts are schema populations before read rules, not per-viewer promises.
- Consumer-only Linux qualification is used because the user forbids full `scripts/test.sh`; full product Rust tests are run separately. This mode cannot issue a publication qualification receipt.

## Verification

Setup PASS: Snapback 4 frozen install, CLI build, wasm build and package build. Repo-root frozen install, workspace hoist and generated-artifact bootstrap PASS. Final root inventories PASS (365 package tests, 35 script tests, 31 demos, 487 publication leaves); guide PASS (22 checks, 162 pages, 1937 snippets), with existing freshness warnings. Final ref-check PASS (556 LLP docs, 12100 refs, 0 errors). Docs budget PASS 319/320 lines and its exact named test 1/1.

Affected Linux clients: eight files, 63 tests green by 62 initial passes plus the corrected alias-file rerun 1/1. The sole initial red was a helper reading a mutation refusal's query-style envelope; product returned E_INPUT correctly. Package typecheck PASS. Final web device 2,387,155 B raw / 727,383 B gzip <= 727,513 existing budget; no budget increase (130 B gzip headroom remains).

Differential campaigns: native seeds0–19999 PASS 20,000/no signatures; device seeds0–999 PASS 1,000/no signatures; Lean 20,000 completed, exit 1 for 130 findings in four existing open classes (3 code, 35 continuation-next, 67 next, 25 prelude-code), no new class. Lean model build PASS. Full reports/coverage/unsupported counts are under `snapback4/reports/20261019-dorm/`; unsupported is not counted as a pass.

The full five-crate campaign completed all 430 test binaries: 6,827 passed, 2 language-output fixture failures, 45 ignored (exit 101). All CLI/core/device/sim tests passed. After correction in `9b9b3e78d5`, the complete language crate passed at `9f49a1faa6`: 2,292 passed, 0 failed, 14 ignored across 170 test-result binaries (exit 0). Both former failures passed: ephemeral compatibility 1/1 and list lower bounds 14/14. Emitter compatibility 16/16 and operation evolution 13/13 passed in the same run. No failed target remains. The original full-run result is preserved rather than relabeled green.

Mac PASS, exclusively in the assigned Studio workspace: standalone CLI/package builds, 7/7 affected CLI tests, 77/77 migration/capture tests, and 13/13 clients. The final diagnostic follow-up passed wire-first/aliases 2/2. The emitter follow-up passed 44/44 Rust output tests and the alias client 1/1; the final hermetic helper passed another 1/1. Source hashes were verified, and cleanup found no owned scratch or active build/CLI process. Linux focused wire 1/1, operation evolution 13/13, production wire/alias clients 2/2 and the Lean-required difftest crate suite also passed.

Final fresh packed consumer qualification PASS (exit 0) at `9f49a1faa6c4e1be13064846507eaa96ec3be2bc`: DORM/release transitions, day-two/day-four/day-five, production recipes, proof kit, client recipes, security, migration, staging and rule recipes; 12 generated frontend proofs; 6 host starter proofs; Ubuntu 24.04 and Alpine. Both changed guide fences ran as written. Client, Expo and Linux tarball SRI and the retained executable SHA256 were independently verified. This is `consumer-only` evidence with `publicationQualified: false`, not a publication receipt; the forbidden full `scripts/test.sh` was never run. Required Rust/client checks were run separately.

Compact evidence is in [`snapback4/reports/20261019-dorm/`](snapback4/reports/20261019-dorm/), especially `five-crates-summary.json`, `language-summary.json`, `linux-consumer-summary.json`, `root-checks.json` and the Mac/cleanup JSONs. Full packed evidence and exact tarballs remain outside source under `/home/ccheever/sb4-loop/dorm-qualified-linux-v4` and `dorm-fresh-pack-v4`.

## Day-two copied-store and real-user results

All 11 unchanged-source copies passed private check, rollback and retained-source forward twice with exact interpreted authoritative values restored. Original evidence was not written. Replay binary SHA256: `16b5e79772021242db29620149ebebd98cba2e92ad72258ac7b8425a5d43c56f`. Later wire-diagnostic/emitter corrections are covered by the final packed compiler; they do not change these migration semantics.

| Lane | Dormant rows after rollback | Interpretation |
|---|---:|---|
|006|54|Newer-only table rows.|
|008|9|Zero observations cannot fit the old positive-count type.|
|020|31|Newer-only rows; old-table reasons separately tested below.|
|023|143|Newer-only rows; original preview/restoration regressions no longer crash.|
|035|100|Newer-only rows.|
|037|86|Newer-only rows; application-managed label limitation below.|
|039|52|Newer-only rows.|
|040|58|Newer-only rows.|
|043|149|Newer-only rows.|
|047|82|Newer-only rows.|
|049|63|Newer-only rows.|
|Total|827|Dormant is retained, not deleted.|

Actual user HTTP results, each for two cycles:

- 008 manager:84 records/9 zeros →75/0 after rollback →84/9 on forward. Culturist:69/8 →61/0 →69/8. No fabricated positive counts.
- 020 original officer v1 view:31 extensions,12 null reasons,19 text; owner24/11/13. After explicit down adoption, officer31/0/31 and owner24/0/24. All twelve previously empty reason records have text; forward retains31 v2 extensions.

Original 037 still has three absent side-table labels because it declares an application fanout mutation rather than a historical backfill. DORM does not infer or replay arbitrary mutations. The required-column primitive is proven with older-source writes in the packed migration case; adopting that declarative migration (and COLR where a narrower column audience is required) is the application repair. Column confidentiality is owned by COLR; security/check campaigns by SEC4, staging/dev ergonomics by DX4, read planning by QRY. No cross-lane implementation was imported.

## Audit, failures and cleanup

Initial compile failures from mechanically added Program fields were repaired; they are not passing tests. A pre-freeze full build was deliberately interrupted while still compiling so the final migration restoration edge could be fixed; the final run uses 24 build jobs. The first docs-budget attempt timed out waiting on that lock; the fresh final attempt passed. A redundant optimized native rerun was stopped after the original 20k campaign had already passed; its log is outside source and is not evidence.

Mac setup initially lacked two benchmark include_str fixtures, then a broad CLI harness run had 463 pass/27 process-startup failures/5 ignored before building the standalone CLI. These attempts are not qualification. Final affected reruns build the CLI first, use Node 24.13.1/Bun 1.4.2, and run only in `ccheever@macstudio-charlie-apt101-a:~/sb4-ws-dorm`.

Every issued shell command was bounded with timeout. Replay and packed helpers clean owned scratch on success/refusal. Linux cleanup removed 25.9 GB of build output and 1,636 SQLite sidecars after confirming no active target process; the target directory is absent. Mac cleanup removed only the assigned 1.96 GB target, with no owned scratch or active build/CLI process. Exact tested executables and SHA256 metadata remain outside source; their paths and digests are in `linux-cleanup.json` and `mac-cleanup.json`. Final consumer cleanup removed 23 build directories (6.63 GB), preserving root proof JSONs and exact tarballs. Earlier failed/completed candidate build trees were also removed. Mac additionally removed 19 exact stale directories from an earlier failed run after confirming their recorded PIDs were dead.

`git diff --check` is clean for the final evidence changes. Across the branch, the only whitespace reports are trailing blank lines in verbatim Muse review outputs/wrappers (rounds 4–6); those raw bytes and provenance hashes are preserved. Round 6/7 snapshot/output hashes were independently rechecked and match. The remaining `vendor/ibex` checkout difference (4c34c831aa to a882911e70) was not staged or committed.

Packed failure history is retained. The first candidate at `d529cb8989` passed dormant/release/day-two/day-four/day-five/production proofs, including the changed guide snippets, then exposed a wire trace regression: malformed Time linked `programs` instead of `types`. `a9fd8169bb` restored structured diagnostic classification without changing the expected trace; its complete consumer qualification passed. The independent Rust campaign then caught the two generated-output fixtures corrected in `9b9b3e78d5`.

The next packed candidate exposed an ambient TypeScript dependency in the new saved-v1-client assertion. `9f49a1faa6` uses Node 24 built-in type stripping. Before final repacking, the complete dormant/alias proof passed in the exact minimal packed consumer with TypeScript absent and the binary override unset. The Mac helper rerun and complete final Linux consumer qualification passed. Failed/interrupted candidates are not complete passes.

To keep evidence attributable, the follow-up language build began after the original campaign had completed every language test binary and moved to simulation; remaining simulation executables were untouched. Root inventories/guide/ref-check were rerun after the emitter correction and passed; docs-budget passed from `snapback4/` (a preceding wrong-directory invocation did not run it). No additional test cycle was started after final affected checks passed.

Final cleanup receipts record Linux/Mac target removal, retained tested binaries, and removal of completed consumer build trees. Original stores were read-only. No push or version bump; the remaining unrelated `vendor/ibex` checkout difference was not staged or committed.
