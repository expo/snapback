READY

# R29 compiler review: loop-reaching nominal origins

Family: grok. Exclusive local cwd: `/Users/ccheever/clique-improvement/reviews/compiler-loop-reaching-origins-r29/grok`. Exclusive remote work: `/home/ccheever/clique-reviews/compiler-loop-reaching-origins-r29-ef88-d72bbb8fba/grok`.

Frozen candidate `ef88cac15a948418d1f6d620713065ab9b57e40f` against actual parent `9995d41a45b61bbebb79b6b239a6b7bddaf6e4ec`. Requested model from launch receipt: `grok-4.6` (launch `actualModelIdentity` was null). Supervisor retains native CLI identity and the authoritative terminal.

This admission authorized review, not integration, publication, or cumulative clearance. No product edits, no sibling-family access, no native/Rust/build/server/package/benchmark/competitor work, no M5 contact. Original input bytes were not modified (`input.tar.gz` SHA256 `fa51b95c556cb7e307f3fa4571d37761e99f47cb0f361c3459569d1eddbd0545` before and after). Manifest SHA256 `d72bbb8fba4ba3d4c0c5ca5c8dfe8779c270fe1fc041e1a777792c343af1faa9`.

## Verdict

The candidate accounts for loop-back reaching origins before affected reads and captures. It does not restore the parent’s blanket historical union of loop writes, and it does not refuse the lawful loops in this finite battery.

Parent `9995d41` accepts a checked-private no-cast pre-loop foreign-to-local overwrite followed by a later-iteration foreign write. The held-row witness `loop_returns_foreign_row` compiles and, with local then foreign reads, returns the foreign row (`length` 91), `next` `id-1`, and no writes. That is unsound: the first-iteration read can observe a foreign `Ref` that a later iteration assigned. The candidate refuses that program with `E_ARGS_TYPE` (`read key component 1 may reference rights, but lefts.byId.id requires a reference to lefts`) at `snapback/probe.ts:7:31`.

The same pairing preserves lawful programs that definitely reset before every read, that `continue` without turning a skipped reset into a backedge to a later read on the same path, that evaluate RHS allocation and errors once per iteration, and that nest a definite reset. Direct ambiguous keys, same-table/generic/null R28 overwrite controls, nested selected-member tuple positions, and the retained outside-loop early-return refusal stay as they were. No new public grammar, no schema fallback, no evaluator truthiness change, no native change.

## Scope of the delta

Eleven changed paths (nine production, persistent cases, LLP 1002). Compiler archive parent 227 files vs candidate 229 files. Exact parent→candidate production paths:

- new `snapback2/packages/compiler/src/lower/loop-origins.ts`
- new `snapback2/packages/compiler/src/lower/nominal-targets.ts`
- `compiler.ts`, `lower/branch-bindings.ts`, `lower/environment.ts`, `lower/loop-mutations.ts`, `lower/operation-context.ts`, `lower/provenance.ts`, `lower/read-targets.ts`
- persistent cases `captured-nominal-cases.ts`
- docs `llp/1002-dev-loop.spec.md` (in the release/docs delta; not inside `candidate-compiler.tar`)

`candidate-compiler.tar` SHA256 `1462591d772402cbc1b5e7f980fdc25f35261bcf2628a770c225f4736c5ad060` is byte-identical to the committed `release-compiler.tar` compiler files (`00345e086cce520f6287ab012841a3d32c45f6994f21d6afc85b54aa01dbe430` as archive; compiler members match). Release extra members are `llp/1002-dev-loop.spec.md` and `snapback2/packages/snapback2/guide/quarry.md`.

Mechanism, from the candidate sources (not from author narrative):

- Before checking a loop body, `planLoopOrigins` joins initial assigned origins with fallthrough and `continue` backedges. `break` and `return` are recorded as exits, not backedges. Static `max==0` contributes no body/exit union; `max==1` does not put backedges on entry; larger domains do.
- The iteration binding is freshly initialized from the domain on each entry and is excluded from inherited assigned-loop cells (`runtimeName !== iterationBinding`). Body assignments to that binding affect only subsequent reads in that iteration.
- A definite body write still replaces the values reaching the following read (`recordAssignmentOrigin` writes a singleton origin, not a cyclic union).
- Loop-entry cells are a finite graph of negative facts (`provenanceAmbiguity` with `<unknown origin>`). `nominal-targets.ts` visits each cell/path once and never re-executes operands. Those restrictions grant no presence, shape, row, bound, numeric, direct-read, or destination authority.
- Planning uses a cloned environment with isolated diagnostics, `accessOrdinal`, `temp`, `sourceSites` shallow copy, recursion, and collection-mutation counts. Actual compile of 13 programs accepted on both sides produced byte-identical `project.ir.json` and `api.d.ts`. `full.json` differed only in `ms` on the inspected pair `loop_returns_local_row_control` (47.91 vs 58.39); nested `project` and `apiDts` were equal.

## Independent pairing (36 complete projects)

Ran `bun probe.ts paired-cases.json {base|candidate} …` on the pinned EPYC tools after handshake. Parent tree is `sources/base` from `parent-compiler.tar`. Candidate tree is `sources/candidate` from `candidate-compiler.tar`.

| Transition | Count | Names |
|---|---|---|
| accept → refuse | 9 | `loop_returns_foreign_row`, `loop_read_before_later_foreign`, `loop_nested_capture_before_later_foreign`, `loop_both_branches_later_foreign`, `loop_continue_later_foreign`, `nested_loop_reads_later_outer_foreign`, `loop_unknown_initial_control`, `conditional_foreign_backedge`, `capture_before_body_reset` |
| refuse → accept | 5 | `body_definite_overwrite_kills_foreign`, `continue_path_skips_reset_and_read`, `RHS_allocation_each_iteration_once`, `RHS_error_precedes_read`, `nested_definite_reset_before_read` |
| accepted both | 13 | `loop_returns_local_row_control`, `loop_break_no_second_iteration`, `loop_definite_local_before_read`, `loop_local_and_generic_only`, `loop_post_overwrite_clears`, `deep_double_selection_local`, `deep_tuple_lawful_positions`, `deep_both_overwrite`, `deep_ordered_local_override`, `deep_null_control`, `nonboolean_or_valid_id_null`, `pre_loop_capture_snapshot`, `return_path_has_no_backedge` |
| refused both | 9 | `branch_early_return_foreign_path`, `break_exit_foreign_after_loop`, `direct_definite_still_ambiguous`, `deep_double_selection_foreign`, `deep_tuple_foreign_second`, `deep_tuple_foreign_first`, `deep_capture_pre_overwrite`, `deep_direct_no_authority`, `nested_boolean_shortcircuit_foreign` |

All nine accept-to-refuse diagnostics are `E_ARGS_TYPE` on a read-key component that may reference `rights` while `lefts.byId` requires `lefts` (or the dual for `byOwnerId.owner`). That is the loop-back foreign origin becoming visible at a later-iteration or captured read.

The five refuse-to-accept cases are lawful: a definite local write reaches the read on every live iteration; a `continue` that skips the read does not make a later same-iteration read see the continue assignment; RHS `newId`/div-zero run once per iteration in authored order; nested loops that reset before the inner read stay local.

Refused-both includes the retained outside-loop early-return (`branch_early_return_foreign_path`), direct ambiguous keys, and nested selected-member foreign paths. Those were not treated as this review’s repair target.

### Parent witness (unsound accept)

`loop_returns_foreign_row` on parent, child `parent-0c` pid 23121, 0.767s, exit 0:

- `selected`: `foreign-key`
- `row.length`: 91
- `next`: `id-1`
- `writes`: `[]`
- point keys: `local-key` then `foreign-key` (two reads, held-row receipt)

Candidate refuses the same source (`snapback/probe.ts:7:31`). Companion `loop_returns_local_row_control` is accepted on both with identical IR `7ca26af94d067d41ff2bd59d883a2ad9f89f50972f2d4fcbe2a3435f921fd314` and API `3f17209a217f312768bf5380b79cb8e225ec2611971d06789259d1576cac875d`.

### Accepted-both IR/API

All 13 accepted pairs: `project.ir.json` byte-equal, `api.d.ts` byte-equal. 12 of 13 have byte-equal `results.json`. The remaining one is `nonboolean_or_valid_id_null`: both runs still `Error: E_TYPE: expected bool`; stacks differ (source-path frames under `projects/base/…` vs `projects/candidate/…`). Unsupported non-boolean `||` is unchanged.

## Iteration-binding controls (reserve)

Three sources on actual parent and on candidate:

| name | parent | candidate |
|---|---|---|
| `iteration_binding_is_reinitialized` | accept | accept |
| `iteration_binding_shadow_preserves_outer` | accept | accept |
| `iteration_binding_current_foreign_refuses` | refuse `E_ARGS_TYPE` at `snapback/probe.ts:3:103` | refuse `E_ARGS_TYPE` at `snapback/probe.ts:3:103` |

Draft archive `loop-origins.ts` SHA256 `79e7e58c26fc653da0c04a1c5d5ceb4c28e4006bf6348fe8694c92d6064bbb1b` did not exclude the iteration runtime identity; release/candidate `ae10f7c4ea8b1f8dcfcfa41f97c716dd5cb8a73d42b221ee58a1790b03c109ce` does. This review did not rerun draft. The committed candidate matches parent on these three, which is the corrected-release posture.

Three persistent iteration callbacks on candidate all `ok: true`. Child stdout SHA256 `77270f92dcda4cab2364f2e70669918d5cbf773c1ea9403350dcfe5ea2bfbe13`.

## Release-semantic reuse (inspected, not assumed)

`release-semantic-reuse.json` claims: original 36 paired projects ran on **draft**; 72 callbacks ran on **final**; committed **release** ran three iteration controls, three callbacks, and final types. It asserts that excluding the fresh iteration binding does not apply to original sources that do not assign that binding.

Exact archive facts:

- `draft` vs `final` production: only `captured-nominal-cases.ts` changed. `loop-origins.ts` identical (`79e7e58c…`).
- `final` vs `release` production: `loop-origins.ts` (`79e7e58c…` → `ae10f7c4…`), `loop-mutations.ts`, `compiler.ts`, `captured-nominal-cases.ts`, `llp/1002-dev-loop.spec.md`.
- `release` compiler members = `candidate-compiler.tar`.
- All 36 original paired sources use `for (const u of …)` / nested `v` and do **not** assign the iteration binding in the body.

So the iteration-binding exclusion is inapplicable to those 36 sources. This review does **not** treat the historical draft/final observations as if they ran on release. Independent parent/candidate pairing above is the verdict evidence. The 72 insert-provenance callbacks were re-run on candidate (release-equivalent compiler) and all passed; that is a new candidate run, not a claim that the original 72 executed on release.

## Callbacks (72 on candidate)

Corrected `checks-selected.ts` SHA256 `da8dd50502a119c60f54f16fb3508eff5398415271039d9ff5f3a7f9602b3827` (original long-regex runner retained as `checks-selected.original.ts` `3a3abe53…`). Selection JSON SHA256 `f0f4f27fe26716a3d76fbc2bce68fafd0acfc931c2182ea1bbcbc07df87757de`.

All six shards of 12 exited 0, all selected tests `ok: true`, including R28 overwrite/nested-member names and all 36 `loop reaching` persistent cases. Child stdout SHA256s:

| offset | stdoutSha256 |
|---|---|
| 0 | `0b896b2304f14adf1fb8a4eadaa6df16d3da6478b1ff28692f139c56e4b0e59c` |
| 12 | `bcf7e8187bbf65c5ece3caf6fa0c586689ea4d061ba81eac9552db6f8840a66a` |
| 24 | `47168da262c4e7b9c13f52a50ea37106534d7ecbeaef3297beb85e5e4edf7250` |
| 36 | `05c0ed4479fa8a4b5495abd936ddf87b19c76a6972b02c7e40ecda52d4be6e06` |
| 48 | `31dd55d3ee9c735734bfda8da601a11741cce8d000c6ef774705c5379a9a1ee6` |
| 60 | `98660bef0e28805ac60207f8f8b92278a27d14499f1e960dfc7338263dfdd7c3` |

## Types

TypeScript 5.9.2. Production program (`compiler.ts` / `project.ts` / `worker.ts` roots): 90 files, 0 diagnostics, 0 control diagnostics, child exit 0 (`production-types-candidate`).

Affected callable program (`test-types.mjs`): 114 files, **seven** inherited evaluator diagnostics, seven matching control diagnostics, child **exit 1**. Paths are `packages/evaluator/src/runner.ts` and `packages/evaluator/src/store.ts` (not `packages/packages`). Starts: 21267, 25838, 5002, 12558, 14960, 17379, 20109. Codes 2345/2345/2345/2345/2345/2322/2345. This is not package-green.

Protected hashes verified on the remote trees:

- `packages/evaluator/src/types.ts` `afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618`
- generated Unicode `packages/evaluator/dist/unicode-tables.ts` `9eccdccd99e9b936a40dcbf8ae63c55d980086df1ae71f92019f9ab040f6a521`
- prepared effects `packages/snapback2/dist/effects-lib.d.ts` `13dd9d1f06641596a4c6ac1c080b3f45f083485baa55a4a378d5b8eba68b311d`
- compiler `effects-lib.d.ts` `c5cf931f7c095f832ca081b644bc06e4c60e4030f647e9fe85fe76931c49c4c0` (distinct)

320 dependency files. Node 22.23.2 SHA256 `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327`. Bun 1.3.12 SHA256 `92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa`. PATH tool dirs + `/usr/bin:/bin`. IR contract `snapback2/crates/snapback2-core/ir-contract.json` `d09c63f52622b9b8fb2762b94b17b4e2c8882e9feecf0737d24470ec2bde0252`.

## Handshake and first failures (preserved)

Byte-identical helpers from `approved-handshake-templates/` (`transport.py` `1747bd12…`, `run-remote.py` `b6caab42…`, `dispatch.py` `9da20ae5…`). Remote wrapper printed `DISPATCH_READY:<inbox sha>`, local transport rehashed the current inbox, and stdin ack was sent only when `ready == currentSha256 == inbox-ack`. A pre-SSH boolean was not used.

First capacity child `fresh-capacity` (transport pid 17171): handshake `ready`/`currentSha256`/`acknowledged` true for inbox `acf1046e1f48edeb9dd67ab81af18feec14ebbc6f4ba15d69d04a0645dc45b8b`; remote child pid 9185; tools matched; 96 CPUs.

Preserved first failures (not rerun as success):

1. `upload-run-remote`: scp `dest open …/grok/: Failure` because the exclusive remote directory did not yet exist. Then `mkdir -p` of only that family path.
2. `parent-0` (transport pid 52096, remote pid 11834, 0.065s, exit 1): `Cannot find module '../../../crates/snapback2-core/ir-contract.json' from …/packages/compiler/src/ir.ts`. Handshake had already succeeded; no compile occurred.
3. `parent-0b` (remote pid 13256, 0.215s, exit 1): same contract missing from the **shared evaluator** real path after a symlink relocation. Handshake succeeded; no compile occurred.

Supervisor note at 17:56:19 required inspecting all relocated support imports before another project attempt. Evaluator was then copied into each `sources/<tag>/snapback2/packages/` tree (not symlinked out of the package layout), `ir-contract.json` restored at the resolved `../../../crates/…` locations for both compiler and evaluator, and the effective tree rehashed. `import-verify` then imported `project.ts`, `ir.ts`, `store.ts`, `value-runtime.ts`, and `search-key.ts` for base and candidate (all ok). `parent-0c` was the first complete-project compile.

Inbox was fully re-read on change (`acf1046e…` then `1390d2b9f8a1ea386ac8300faa9a4c819224e1fb9c8a75835970252a77619f43`). Office Python 3.9 lacks `tarfile.filter=`, `hashlib.file_digest`, and `tomllib`; local scripts did not use those APIs.

Deadlines stayed 30s children / 45s transports. No semantic child was rerun for collection.

## Workload accounting

Ceilings 96 complete-project / 84 callback / 4 type. Used:

- Complete-project: 36 parent + 36 candidate paired, plus 3+3 iteration (reserve). Two import failures produced zero compiles.
- Callbacks: 72 insert-provenance on candidate, plus 3 iteration (reserve).
- Type closures: 2 (production 90-file clean; affected 114-file exit 1).

No adjacent optional-reference/null or sorted-any expansion. Current-private/public scope and the retained outside-loop early-return refusal were kept separate.

## Reproductions

Pinned remote cwd `/home/ccheever/clique-reviews/compiler-loop-reaching-origins-r29-ef88-d72bbb8fba/grok`. Local dispatch:

```text
python3 dispatch.py <label> bun probe.ts paired-cases.json base paired-0 \
  loop_returns_foreign_row loop_returns_local_row_control ...
python3 dispatch.py <label> bun probe.ts paired-cases.json candidate paired-0 ...
python3 dispatch.py <label> bun checks-selected.ts sources/candidate insert <offset> 12 callback-selection.json <run>
python3 dispatch.py <label> node production-types.mjs sources/candidate
python3 dispatch.py <label> node test-types.mjs sources/candidate
```

Handshake required: `inbox-ack.sha256` equals SHA256 of the current `supervisor-inbox.md`; remote prints `DISPATCH_READY:<that sha>`; transport rehashes inbox and writes the sha to stdin before `Popen`.

Example complete parent shard: local transport pid 75406, remote child pid 23121, PATH as above, `version:base` input hash `413552cecdb0da7aa6cb73872635fc52ab10d6e0129be91ccce8a9de73215d5e`, inbox ack `1390d2b9…`, elapsed 0.767s, exit 0, deadline 30s.

## Custody

Local `collected/owned-outputs.tar` SHA256 `dd5e6694451beac5c405fac7fb29d6e0c9a5c32ba7958b927b54a7f2c8462436` (3031040 bytes). Manifest SHA256 `742c826ab5c84b1c26a41654f3d0983eae30fd1fef8f3c01afdf482d4c995f9a`, 742 files, excluding itself. Contains `results/`, `artifacts/`, `projects/` (IR/API/full/results), and source manifests. Local `transport/` receipts remain in the family cwd. Full local artifact custody includes those trees, not only result stdout.

## Limits of this review

- Did not rerun the historical draft compiler on the original 36; draft/final/release were compared as Git/tar bytes and selected names.
- Did not execute native IR, Rust, or package registration.
- Did not treat evaluator inherited reds as candidate regressions.
- Did not expand optional-reference/null, sorted-any, or public-grammar work.
- Native author R29 outer shell exit remains unknown and is not inferred zero.

No repair stage.
