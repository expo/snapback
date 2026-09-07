READY

Independent scoped review of main-v2 Quarry diagnostic port `b8f9cd6af15887b4cb4644bbb18a7a394730b5cf` against parent `44faf7bee1c70329e35b398749239ca31475495f`. No blocking defect was found in this diagnostic delta. Adjacent independent cases, collision/fanout controls, registered diagnostic callbacks, and types-final closures support the port. Author REPORT.md is treated as factual input only.

## Material findings

No `CHANGES_REQUIRED` item. The port keeps recovered independent frontend statements as diagnostic-only virtual sources, stops before effect lowering / program IR / API / inspection artifacts, restores failed-statement emission and binding state, and uses compiler-local WeakMap cause facts for repair advice.

Preservation checked against parent and against this review's accepted project envelopes:

- IR/schema: `ir.ts` SHA256 `9426f7262e82fcafcb86fab7608448a4019fd3c0fac83f01a9fddd2e7a8edd51` is identical on both snapshots. Evaluator `packages/evaluator/src/types.ts` remains `543630d671ce824cf015a10c5b6b2929e85cb54b0e9af745373362be25fa5c12`.
- `Index.columns`: accepted main-eight programs emit the same index column lists on parent and candidate (memberships `byId`/`byConversationPrincipal`/`byConversationRole`/`byGroup`; reactions `byId`/`byMessage`).
- Table binding: generated modules still import `<table> as <table>$table`. Collision policy for helper/effect/orderedPair names is unchanged and still fatal (no `diagnosticSources`).
- Bounded-list fanout: `quarry-fanout-checks.ts` is byte-identical (`ba2d457a48dd5eea3d17afe009d3893064845d04608dfdade2b50b99cfea9be9`). Direct, bound, and shaped cap forms compare equal except `ms`.

Diagnostic recovery and fatal boundaries, including independent adjacent cases:

- Independent errors survive recoverable failures (type mismatch before unresolved `if`; match some-unknown with none-branch type mismatch; null insert plus later unknown).
- Failed projects expose only `{ok, diagnostics, ms}` and write no `.snapback` artifacts.
- Boolean type mismatch does not prescribe absence elimination (`number` and `null` destinations get `true or false`, not `! else CODE`).
- Failed bindings/aliases stay lexical; initializer/domain is checked before a fresh bind clears failure (merge prefix using an outer failed name after a successful domain reports the original unknown and `missingAfter`, not a prefix type error or `unknown name item`).
- Loop/match/capture shadowing restores outer facts (registered lexical cases plus the match none-branch case).
- Merge domain is emitted and checked in the outer environment before prefix analysis, then reused once (lawful guard/allocation-once callbacks).
- Rollback restores emitted text and environment; type-cause facts are recorded later on the diagnostic objects of the recovered virtual source, not on rolled-back statements.
- Parser/schema/generated-helper collisions remain fatal: `compileInline` for those three boundaries has no `diagnosticSources`/`schema`/`modules`.

The persistent diagnostic registry is 401 lines, SHA256 `0f730ebd8374be948f84b40617b24abbf96ff5ec9efe889bbb9e12c95cf504bc`, byte-identical to reviewed `1a60` except this packet's three capture-import lines in the work callback wrapper. It is registered from `quarry-program-checks.ts` via `registerQuarryDiagnosticChecks(test)` at the start of `registerQuarryProgramChecks`. Assertions were assessed against this port (virtual diagnostic sources, recovered type sites, cause-based rewrites), not assumed from old source qualification. The admitted 51st callback is the separately labeled fatal parser/schema/helper check in `diagnostic-selected.ts`.

## Exact reproductions and parent attribution

Independent `review-cases-0.json` (same files on parent and candidate). Probe assertions: `expectedOk=false`, refusal keys only, no `.snapback`. Diagnostic content:

1. `number-to-boolean-not-absence` — `update todos[todoId] { done: 1 }`
   - Parent: `E_OPAQUE` at `snapback/todos.q:9:3`, rewrite `add ! else CODE to assert the possibly absent Quarry value before using it here` (message contains `boolean | undefined`).
   - Candidate: same code/site/message, rewrite `update todos[todoId] { done: 1 }\n-- use true or false for this boolean value`. Absence flag false.
   - Parent still exhibits the original17 class of advice; candidate does not.

2. `type-mismatch-before-unresolved-if`
   - Parent: only `E_QUARRY_UNKNOWN missingCondition` at `3:6`.
   - Candidate: `E_OPAQUE` string-to-boolean at `2:3` with `true or false`; `missingCondition`; `missingAfter` at `5:10`. Not `missingInside`.

3. `outer-failed-merge-prefix-after-ok-domain`
   - Parent: only `unknown name missingValue` at `2:10`.
   - Candidate: `missingValue` plus `missingAfter` at `5:10`. No merge prefix type error, no extra `unknown name item`.

4. `match-some-unknown-none-type-mismatch`
   - Parent: only `missingThen` at `4:14`.
   - Candidate: `missingThen`; `E_OPAQUE` at `6:7` with `true or false`; `missingAfter` at `7:10`.

5. `null-insert-and-independent-unknown`
   - Parent: only `missingAfter` at `3:10` (null insert is a later TS diagnostic, so parent never typechecks it).
   - Candidate: `Type 'null' is not assignable to type 'boolean'` at `2:3` with `true or false` (not `! else CODE`), plus `missingAfter`.

`review-cases-1.json` (main-eight collision/fanout) is equal except `ms` on every paired envelope, including full `project` / `apiDts` / `sources` / `quarry` on the four accepted programs and identical fatal collision messages on the four refusals.

Callback shards on this port: offsets `0` count `12` and `39` count `12` of the frozen 51-name registry. All 24 asserted `ok: true`, including lawful merge once-emission, 20/50 omitted-failure bounds, and the 51st fatal boundary callback.

types-final.mjs on candidate: TypeScript 5.9.2, `configFilePath` `.../packages/compiler/tsconfig.json` (main-relative import resolution). Production 56 files, 1 external root; affected 73 files, 13 external roots, including `quarry-diagnostic-checks.ts`. Both `diagnostics` and `controlDiagnostics` are empty arrays. Historical author type-helper failures remain failed in `input/author-results/results/*-types/` and `*-types-fixed/` (exit 1); they were not normalized.

Author closed ledgers reused without rerun: original3, remaining 27 callbacks, package builds, worker cases, parent types-final, and the two failed type-helper rounds.

## Command / result ledger

Pinned tools in workload and actual child argv: Node `/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f/node-v22.23.2-linux-x64/bin/node` SHA256 `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327`; Bun `.../bun-v1.3.12-linux-x64/bin/bun` SHA256 `92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa`. Remote directory `/home/ccheever/clique-reviews/compiler-dx-v2-r1-b8f9/grok`. Packet SHA256 after independent cases `55c44e21e30a500220c066ee96eca21aff483454282aac3e48adcc02acbfefbd`.

Inbox hashes: initial admission `e03a82b98c673c02ed6b027e146d12e1450bdb6ed81fd1d528e497683c9edd0c`; after Root collection-clarification `1fa753b865a1c42629dc52cfbbd03bc8f0b020cb97e2c43ee9dfbef5d2a33c84`. Every dispatch used full-read + `inbox-ack.sha256` + READY reread. Semantic children blocked on stdin until matching acknowledgement.

Setup (nonsemantic): parent 403 source entries / candidate 405; 24010 dependency copies each; evaluator types and `bun.lock` hashes as above. Copied `results/build-*/generated.json` are author generated-input custody manifests, not new build receipts.

| Label | Kind | Child pid | Child s | Child exit | Transport pid | Transport s | Transport exit | Inbox ack |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| remote-mkdir | upload | — | — | — | 11237 | 2.560 | 0 | e03a82… |
| remote-upload | upload | — | — | — | 12134 | 30.821 | 0 | e03a82… |
| setup | setup | 160260 | 7.985 | 0 | 14295 | 10.686 | 0 | e03a82… |
| review-parent-0 | project 5 | 160509 | 0.365 | 0 | 15078 | 3.997 | 0 | e03a82… |
| review-candidate-0 | project 5 | 160700 | 0.516 | 0 | 15396 | 4.035 | 0 | e03a82… |
| review-parent-1 | project 8 | 161436 | 0.465 | 0 | 21891 | 3.995 | 0 | e03a82… |
| review-candidate-1 | project 8 | 161517 | 0.465 | 0 | 22621 | 4.051 | 0 | e03a82… |
| review-callbacks-0 | callbacks 0+12 | 161593 | 0.716 | 0 | 23543 | 4.462 | 0 | e03a82… |
| collect-cases-0 | collect | — | — | — | 16394 | 45.018 | 124 | e03a82… |
| observe-cases-0 | observe | — | — | — | 18646 | 2.379 | 0 | e03a82… |
| collect-json-0 | collect | — | — | — | 19314 | 2.335 | 2 | e03a82… |
| collect-json-0b | collect | — | — | — | 20151 | 2.519 | 0 | e03a82… |
| observe-failed-scp | observe | — | — | — | 28907 | 2.203 | 0 | 1fa753… |
| collect-completed | collect | — | — | — | 30310 | 2.902 | 0 | 1fa753… |
| review-callbacks-1 | callbacks 39+12 | 162952 | 0.716 | 0 | 31951 | 4.210 | 0 | 1fa753… |
| review-production-types | types | 163036 | 2.872 | 0 | 32720 | 6.465 | 0 | 1fa753… |
| review-affected-types | types | 163496 | 3.323 | 0 | 33406 | 6.766 | 0 | 1fa753… |
| collect-final | collect | — | — | — | 34707 | 2.522 | 0 | 1fa753… |
| observe-final-pids | observe | — | — | — | 36048 | 2.291 | 0 | 1fa753… |

Allowance used: 1 setup; 4 project shards (5+5+8+8 invocations, 13 paired cases); 2 callback shards (24 callbacks); 2 type closures. No failed-shard reserve. No product/source/input mutation. Child stderr SHA256 is empty (`e3b0c442…`) on every completed semantic child.

`collect-cases-0` timed out at 45s (`exit -9`) on recursive `scp -r` of two remote trees. `collect-json-0` failed because remote `tar` received unexpanded globs (`Cannot stat: No such file or directory`). Both receipts are retained. Correction used `cd` to the remote project root, `find` of explicit completed prefixes, then `tar -T -` (no glob). Local pid 16394 is gone (`ProcessLookupError`). Recorded remote child pids 160260, 160509, 160700, 161436, 161517, 161593, 162952, 163036, 163496 are `GONE` under `/proc`. `ps -u ccheever` showed no leftover `compiler-dx-v2-r1-b8f9` / `scp` / `tar` lines at the two observation points.

## Unchanged-input custody

`input/` was not written. `input/source.diff` SHA256 `1cd9955b17b60c1e2647caae185f281c92b04fa3081b576a6edbd88ee5ad7bea` (59911 bytes). Archives `main-source.tar` `f0eb4e4bcf2d2ab135e3ada4f89b493689f92d25c078bff57146d04eddb30126`, `candidate-source.tar` `1b00306cc6b56cca30f7de0672e8418fb00c7d3881751b7f7dba938d90d104db`. Dependency manifest `eb983cc39681ea870adabdb6db29558b04c0f3bf34d6eaee0f9a02d6298b0bf9`. Work mutation limited to `review-cases-0.json` SHA256 `d91197ed34a5b5aea575bdf2b728ca574a05b9d1b2ea9fe7da4485bb740dd2e3`, its helper hash in private `workload-ready.json`, inbox-ack files, transport/collected leaves, and this report. `project-probe-review.ts` still only widens the count guard to 1..12.

Governing docs read: candidate `AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000, LLP 1002 §3 diagnostic prose, LLP 1004 (including `<table>$table`), packaged `guide/quarry.md` merge/page text. Compiler graphs: parent vs candidate `program.ts` / `index.ts` / `project.ts` / new `type-diagnostic-cause.ts` / new `quarry-diagnostic-checks.ts`.

## Limitations

Compiler-only execution is not native/runtime/certificate qualification. Native callbacks, `rustCheck`, Rust build, package rebuild, all 51 callbacks, worker, and parent types-final were not rerun here; author closures for those remain the record. Independent project cases do not re-assert `emittedCounts` (that lives in the callback registry). Cleanup observations are `/proc/<pid>` plus `ps -u ccheever` filtered to this remote directory and `scp`/`tar`; they are not a full-system process census and do not prove absence of unrelated user processes or leftover sockets. Mixed partial files from the timed-out recursive scp under `work/collected/projects/` are not used as evidence; separated `work/collected/json-0/` and `work/collected/completed/` / `final/` leaves are.

Optional: `remapDiagnostic(..., false)` on the recovered frontend-refusal path is a no-op for already-remapped `.q` sites because `virtualByFile` is keyed by generated `.ts` paths. Tests do not require a second cause lookup. Not a defect in this delta.
