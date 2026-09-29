# Failures and attribution

All failed verification attempts are retained; later green runs do not erase them.

| Attempt | Failure | Attribution | Resolution |
| --- | --- | --- | --- |
| Initial package typecheck (`typecheck.log.gz`) | TS2307 in `web-wasm.ts`, `web-worker-runtime.ts`, `web.ts`: generated wasm module absent | Environmental: clean checkout had not built its wasm outputs | Canonical `scripts/build-wasm.sh`, then package build and typecheck passed. |
| Initial affected tests (`affected-initial.log.gz`), 35/38 | `dev declares two workers...`: timeout | Ours: witness assumed `/effects/claim` returns `worker`; this endpoint returns only effects | Assert successful authenticated claim and inspect named service principals in the store. |
| Same attempt | `serve declares two workers...`: timeout | Ours: same witness assumption | Same repair. |
| Same attempt | `chat's real TypeScript invite worker is supervised by dev, restarts and stops with it`: TypeError reading `.length` from null | Ours: obsolete assertion required the intentionally removed token announcement | Assert no automatic token printout. |
| Second affected tests (`affected-round2.log.gz`), 62/64 | `dev declares two workers...`: log-prefix assertion | Ours: two redacted partial output streams could interleave within a line | Buffer redacted lines, with bounded long-line segments; emit each prefix/line under one output lock. |
| Same attempt | `serve declares two workers...`: same log-prefix assertion | Ours: same implementation issue | Same repair. Final named-worker tests 5/5. |
| First whole guide (`whole-guide.log.gz`), 95/98 | `every_card_introduces_the_feature_before_examples_and_reference_details` | Ours: inserted explanatory section ahead of the card's required first example | Keep the initial Quarry example, put supervision immediately after it. |
| Same attempt | `recovery::cancelled_effect_keeps_distinct_stored_step_keys` | Ours: changed a pinned legacy provider-key sentence | Retain that still-correct legacy sentence; explain the equal new key in the new section. Step key domains stay unchanged. |
| Same attempt | `client::published::published_file_references_resolve_against_package_contents` | Ours: new application paths were absent from the guard's exact app-file list; one slash-joined extension spelling looked like a path | Register the exact app input/output paths and spell extensions separately. Final guide 98/98. |
| Full `scripts/test.sh` client stage | `every delivery await is explicitly classified` in `delivery-fault-matrix.test.mjs` | Ours: worker/ledger await changes were not yet reflected in the conservative all-module boundary record | Reviewed reachability: these are server-effect awaits, outside device mutation delivery. Updated only `worker.ts` and new `worker-ledger.ts` entries, with rationale beside the census. Exact failed check rerun passes in `await-boundary-repaired.log.gz`; the original full-run failure remains recorded. |

During authoring, two Python edit invocations used repository-prefixed paths
while already inside `snapback4/`; each exited with FileNotFoundError before
editing anything. Both were rerun from the correct directory. An orientation
search used `packages/snapback4` at the repository root before identifying the
Snapback 4 fence; a `tail` invocation placed its flag incorrectly; one read of
`.git/config` encountered the worktree pointer file. These were ours, not
product-test failures. No files or credentials were exposed by these errors.

Full suite: one invocation, exit 1, exact summary `== 1 failure(s) in 1506 s`.
The await-inventory assertion above was its only failed test; all other stages,
including 79/79 model tests, passed. No baseline or environmental test failure
occurred in that run. The standing 60-second suite target remains a **baseline
process-budget miss** (the base journal already recorded 1,690 seconds); it is
not an additional failed stage in the script's summary. No budget was raised.
See REPORT.md and the unedited `test-sh.log.gz` with `test-sh.exit`.

Final staging check: `git diff --cached --check` rejected whitespace emitted
by the test runner in preserved raw logs (**ours: evidence packaging**, not a
product failure). Logs are now losslessly gzip-compressed, with decompression
checked byte-for-byte. Their contents were not trimmed or rewritten.
