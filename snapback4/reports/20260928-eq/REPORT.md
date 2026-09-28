# Lane EQ — selected-index equality coverage

Date: 2026-09-28. Branch: `sb4-intent/eq-equality-prefix`. Starting commit: `a745b110f2187004abb1cec8380b33b6d1396108`. The first repository command was `git fetch origin && git merge origin/main`; it reported `Already up to date.` No push or publication.

The planner fix and process/wasm/React history witnesses pass. **Full §7.1 qualification is not claimed: the native Expo simulator witness remains unavailable.** This Linux host has no `xcrun`, no documented machine-fleet file and an empty Fleet inventory. A Mac target was requested while the other work continued. The process device and React browser results are reported separately, not substituted for Expo.

## Change

`bind/intent.rs` used to return before normalization whenever an index was already selected. It now preserves the selected plain index and extends its contiguous prefix with a single explicit `=` equality whose column is non-optional and whose value passes the existing binding-context safety proof. It preserves residual predicates, existing keys, direction, limit and cursor. Optional/fallible expressions, conflicting equalities, bare Boolean filters and gaps remain residual. A no-op retains the original predicate AST/source span. Computed and word indexes are outside this change. A guard also preserves the page type when extracting the last equality would otherwise turn an unpaged scan into a scalar unique lookup.

The compiler regression compares the full original builder with the changed fixture: the schema and every surviving operation's executable IR agree, including the history prefix. It exercises reversed equality operands, residual filtering, both directions, ties/cursors, existing positional/named constraints, optional/fallible/conflicting equalities, nonleading columns and the unique-lookup shape guard.

The new fixture under `experiments/p19-one-query/equality/` copies the builder, changes ordinary history to the equality spelling, removes `historyHeld`, and removes the archived selector from the copied receipt hook. `archived` remains a presentation fact from the independent progress query. The original P19 builder and historical results remain unchanged. The sync guide compiles and explains both equivalent spellings.

No core/device/client routing, authorization, disclosure, meter ceiling, wire format, index schema, package version or budget changes. The new prefix uses the existing horizon and `Left` coverage mechanisms. The original guarded progress still returns `NOT_MEMBER`, and retained text gives no server media authorization.

## §7.1 evidence

| Requirement | Evidence and result |
| --- | --- |
| Exact builder and paired plans | `history-plan.txt` and `bracket-plan.txt` both select `byHistory (conversation = conversation)`; compiler IR/schema equality covers the original program. |
| Full-scale store | `calibration-settled.log`: calibration's existing 10,000-message group on an isolated copy of the complete SQLite/WAL/assets. The original admin's `removeMember`/`addMember` mutations admit the test reader without changing the 50-member cap. No direct store edits. |
| Original mutations | Small and empty groups use `createGroup`, `send`, `sendMedia`, `removeMember`, `addMember`; a message sent after departure never appears in retained history. |
| Empty group | Complete empty after durable acquisition, retained complete empty after departure; unknown/loading before publication, including offline reopen of staging. Both device hosts. |
| 500-row floor | Independently enumerate 520 server rows. Both spellings return exactly the same acquired 500 IDs/order. Page 25 ends exactly on the full-key floor and is complete; page 26 is empty and incomplete, with no server request after departure. |
| Timestamp ties | The builder actually indexes `(conversation, ordinal, id)`. A separate full-schema variant indexes `(conversation, at, id)` with 10,000 seeded rows and a timestamp tie split by the acquisition floor. Both hosts pass, without changing the calibration schema. |
| Before/during/after publication | Unknown/loading before snapshot, with staged pages, after offline staged reopen, and before catch-up. Mounted first/floor/below-floor observations stay unpublished while terminal apply is held; wasm additionally holds its actual persistence save. Durable publication certifies the exact floor; a current member can request older rows through ordinary server fallback. |
| Departure and mounted observation | Both ordinary observations remain mounted while an actual leave sync response is held and released. Every data snapshot preserves retained IDs, without duplicates; no post-leave message arrives. The server returns empty history and `NOT_MEMBER` progress. |
| Residual predicates and order | Both bodies retain `not .tombstone` and ascending order. Test tombstones include an acquired row near the floor. Below-floor forward scans remain incomplete. |
| Remount/offline reopen/rejoin | Retained observations remount and reopen offline on both hosts. Reopen does not certify below-floor history. Rejoin returns newly authorized messages and withdraws retained-only status; never-acquired older history stays incomplete offline. |
| Held compatibility/media | Held control issues no query request, and server execution returns `E_QUERY_HELD`. Server media access is denied after membership removal. |
| React browser lifecycle | Chromium + real IndexedDB + copied receipt hook. Delay actual route/progress device answers through leave, preserving composer DOM identity, draft and focus. No lost/duplicated retained IDs. Remount, offline page reload and rejoin pass. |
| Native Expo | **Outstanding environmental qualification**, not a pass. See `native-environment.txt`. |

The two smaller boundary fixtures seed their 10,000-message populations. The full-store arm uses the original existing population. No claim that the synthetic seeding exercised the original send loop 10,000 times.

`evidence.json` identifies compressed, committed JSONL observations and their uncompressed SHA-256 hashes. They preserve public query answers, raw device observations and actual query paths. `history-react.jsonl.gz` preserves the real React snapshots. No retained-message loss or duplication occurred. The immutable-input check passed: original source, logs, SQLite and WAL match P19's recorded hashes. Only byte copies were opened by SQLite/Snapback; other lanes' worktrees were untouched.

## Verification and failure ledger

- Final compiler/guide run (`final-lang-guide.log`): **34 affected tests passed, 0 failed** across selected-prefix (5), order (3), aggregate safety (5), and familiar diagnostics/source/verified repairs (6 + 4 + 11). The **whole guide passed 92/92**. Final binary build passed (`build-corrected.log`).
- Prefix-extension follow-up (`prefix-extension.log`): **5/5 passed**, with an added assertion that extending either an existing named or positional prefix produces exactly the fully bracketed plan and preserves the residual predicate.
- Initial compiler regression: **ours**, one failing test. The harness named the original file `builder.q`, which changed its implicit job namespace and rejected bare schedule target `digest`. Using its original name `schema.q` fixes the fixture; the unchanged program then compiles. Initial failure retained in `planner-tests.log`.
- Strengthened compiler comparison: **ours**, one failing test (`affected-final.log`). Removing the held declaration shifted source locations in later operations, so exact IR equality correctly reported different diagnostic/write-target sites. Keeping two blank lines at that removed declaration preserves the original source coordinates and makes the comparison meaningful without stripping IR fields.
- Final-binary witness rerun: **ours**, one harness assertion in `history-react-final.log` (`process:acquired fallback`). A below-floor publication watch legitimately requested older server history while the next, already-covered query measured its global request window. Both paired raw answers had `unknown: false` and identical 20 rows. The harness now drains the actual publication observations before attributing the next query and records query arguments alongside request paths; the no-fallback assertion is retained.
- Full-suite Rust target `snapback4-lang::familiar_repairs`, test `nested_key_repairs_keep_conjuncts_bounds_and_order`: **ours**, introduced by treating a bare Boolean predicate as a selected-prefix equality. The nested self-equality repair became unavailable. A targeted retry preserving no-op AST/source spans alone still failed (`diagnostic-regression.log`). Restricting extraction to actual `=` predicates fixes it; all 26 selected-prefix and familiar-repair/source/verified-repair tests pass (`diagnostic-regression-corrected.log`). The full-suite run retains its original red; it is not rerun to erase the failure.
- `history-initial.log`: 2 passed; 0 failed (ordinal and timestamp, each on process and wasm).
- `history-floor.log`: strengthened boundary assertions, 2 passed; 0 failed.
- `history-full-store.log`: 1 passed; 0 failed.
- `history-full-store-floor.log`: strengthened full-store assertions, 1 passed; 0 failed.
- `browser-initial.log` and `browser-final.log`: each 1 passed; 0 failed. The final hook preserves the original archived presentation state and changes only the selected query.
- Final settled publication witness (`history-react-settled.log`): **3 passed, 0 failed**; full calibration-store witness (`calibration-settled.log`): **1 passed, 0 failed**. Both device hosts and the real React/IndexedDB hook are exercised.
- Input integrity: passed, `input-integrity.log`.
- Staged whitespace audit: **ours**, trailing blanks in seven captured text logs. Trimmed trailing whitespace and blank EOF only; failure text and exact summary lines are unchanged. Compressed observation payloads remain byte-exact against `evidence.json`.
- Final reference audit and whitespace check: passed (`ref-check-final.log`: 522 LLP docs, 9,752 refs, zero errors/unchecked). The affected LLP changes are confined to the equality-history decision and its qualification; the whole RFC stays Accepted and its other lanes are not claimed implemented.
- **Environmental:** native Expo witness could not be run on this Linux host. No substitute native UI pass is claimed. No tool was installed on a shared path; no tool installation was needed.

The full suite was invoked **once**, with `CARGO_BUILD_JOBS=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh`, and exited 1. Its exact summary is:

```text
== 1 failure(s) in 5060 s
   cargo test
```

The only failed target was `snapback4-lang::familiar_repairs`, with the one introduced test failure recorded above: **ours, corrected and verified by final affected tests**. There were no baseline test failures and no environmental test failures. All other suite phases passed, including build, wasm/budget, docs budget, release guard, package build/typecheck, both app typechecks, nine fixture tests, client tests and **79/79 client models**. The models retained their full 5,000 online-session, 5,000 local-session and 3,000 online-client seeded sequence counts.

The conservative unique-scan shape guard was added during the suite's cold workspace build; the diagnostic correction followed its Rust failure. Both have final affected-test coverage. The full suite is not rerun or represented as an additional final-tree run. Across development there were five failing test invocations from four distinct issues, all ours and all corrected: the namespace fixture, source-coordinate comparison, publication-watch request attribution, and the compiler's bare-Boolean extraction (reported once by the full suite and once by its first targeted retry). Environmental qualification gaps/skips are separate from these failures.

The client phase passed **3,901 tests, 0 failed, 10 skipped**. These are existing environment-gated skips, not passes: native Expo media needs macOS Foundation/AVFoundation (1); managed organization/invitation policy needs the pinned parent binary and private scratch settings (1); managed OIDC profile needs its private scratch setting (1); published 0.2.27 bounds reference needs `BOUNDS_BINARY` (1); F2 legacy-store refusal needs the 0.2.33 binary (1); the published capability-fence/control tests need the npm tarball cache (4); the legacy sync wire test needs the 0.2.32 binary (1). Exact names and reasons remain in `full-suite.log`. The process/wasm/React EQ test runs had no skips; the separate native Expo gap is recorded above.

## Wasm

Official `scripts/build-wasm.sh` baseline and suite rebuild: **2,019,815 B raw / 585,384 B gzip**, **0 B raw / 0 B gzip growth**, byte-identical SHA-256 `083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`. Unchanged budget: **586,193 B**, 809 B headroom. Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt, same worktree/toolchain; see `wasm.json` and the build logs. The compiler is outside the production web device dependency graph. No runtime wasm logic changed and no budget increase is needed.

## Orientation

Applied `llp-orient` read-only from the initialized `/home/ccheever/projects/snapback/vendor/llp/skills/llp-orient/SKILL.md` because this worktree's skill symlink was unpopulated. Scope: selected-index intent planning, history coverage/publication and builder fixture. Governing constraints: LLP 3000 §2/§7; LLP 3000.013 §2.1 (safe intent planning); LLP 3000.021 §3.1 (ordinary retained history); LLP 3000.016 §2.2 (publication/fallback); LLP 3000.028 §3.2/§7.1 (this commission). Current sync/reads guide and planner binding-context proof were consulted. No new architectural decision or NOT-DOING exception is needed. Hand-off: native Expo qualification remains; no broader corpus change or RFC-wide completion claim.
