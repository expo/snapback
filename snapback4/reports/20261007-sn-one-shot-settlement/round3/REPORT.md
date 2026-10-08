# SN round 3: merge FL and DK before review

2026-10-08. Merge parents: SN round 2 `5aa91a4ab3` and fetched main
`07f4c495ea87b944bfe63efe5a958347dcb13807`, including FL `2797247960` and
DK `07f4c495ea`. Work stayed in the assigned lane-sn worktree on eb1000.
Nothing pushed or published; no other worktree or process was modified.

## Merge resolution

`git fetch origin && git merge origin/main` produced exactly three conflicts:

- `packages/snapback4/src/client.ts`: retained both the SN dependency/proof
  import and DK's `bindSessionRefusal` import. DK's retained cause flows through
  the existing `auth()` terminal source; SN's generation/store facts, event
  waiter and field-aware publication checks remain unchanged.
- `packages/snapback4/src/local.ts`: retained SN's `LocalNetwork`, dependency
  and `QueryCustody` imports, plus DK's refusal binding. Kept `notifyFollowing`;
  `bindFollowing` already lives in SN's network helper and is unused here.
  DK's current-credential cause flows through `unavailable()` and the existing
  exhaustive terminal selector. SN's FIFO identity-adoption guard, dispatch-store
  receipt binding, online custody wait and predicted/offline behavior remain.
- `JOURNAL.md`: concatenated the two appended histories. An exact comparison
  against both merge-index parents verified every pre-existing entry byte-for-byte.

The automatic app/app-client/app-online-arm merge retains DK's raw reason lookup,
signed-out facade and terminal reasons alongside SN's shared attempt/wait and
final publication approval. No public contract or compiler summary changed.
FL's test-process custody and dry-run fixes are retained.

Related declarations in `local.ts` were consolidated without changing execution:
refresh promises, persistence/ending promises, refusal state and cleanup hooks.
The merged file is **1,498 lines**. Every changed source file is below 1,500;
`client.ts` is 1,339, `app.ts` 873, `app-client.ts` 335,
`app-online-arm.ts` 70 and `session-refusal.ts` 7.

The governing constraints remain LLP 3000.023 §11 (one budget, exhaustive
terminal sources, dependency and identity proofs) and LLP 3000.007 §20.2
(current-credential refusal preservation, without widening authority). No design
change or further LLP revision is needed for these additive merge resolutions.

## Build and wasm

After resolving conflicts, ran `bun install --frozen-lockfile` in `snapback4/`
and `bash ~/sb4-intent/check-sdk-deps.sh`: the checker printed **deps-ok**
([log](deps.log)). Rebuilt the native binary, locked wasm and client declarations;
TypeScript typecheck passed. Rust used `CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.

The locked Binaryen 132 build measures **2,135,614 B raw / 645,498 B gzip**, with
SHA-256 `8b135c0752c0ee27fd8d43616f902d0e1cc3a88ca7463096ee0747a06bfc6dd4`:
identical to round 2. The unchanged **645,998 B** cap leaves **500 B** above Linux,
covering the requested allowance for an observed macOS difference up to 435 B.
No macOS build or measurement is claimed. Gzip measurement uses the named file,
as `build-wasm.sh` does. [Build](build.log), [wasm build](wasm-build.log),
[measurement](wasm.json), [client build](client-build.log), [typecheck](typecheck.log).

## Verification

Client batches use the repository's owned-process runner, six concurrent files
for the SN batches. The full app-session model runs in its separate serial slot
after Rust and all ordinary client files. Commands and exit statuses are retained
in [client results](clients-results.json), [Rust results](rust-results.json) and
[model results](model-results.json).

| Check | Result | Evidence |
| --- | --- | --- |
| All one-shot/dependency/publication-session/live-margin/sync-after-call files | 373 passed | [settlement](settlement.log) |
| Exact 18-file Astra affected batch, including wasm budget | 576 passed, 2 skipped | [affected](affected.log) |
| Exact 12-file custody batch | 205 passed | [custody](custody.log) |
| DK session reasons plus app/app-state restoration | 33 + 92 passed | [session reasons](session-reasons.log) |
| FL test-command-group/test-processes/test-signals | 69 passed | [process custody](test-process-custody.log) |
| Compiler query-settlement and guide | 5 + 113 passed | [compiler/guide](compiler-guide.log) |
| `serve::` | 194 passed, 4 ignored | [server](serve.log) |
| Original reviewer scripts | 22 passed, 3 superseded assertions | [reproductions](review-reproductions.log) |
| App-session model, normal 5,000 sequences per tier | 52 passed | [model](app-session-model.log) |
| Root `./ref-check --verbose` | 531 docs, 10,562 refs; zero errors/unchecked | [references](ref-check.log) |

The two affected skips remain the opt-in Following shaped measurement and the
unavailable published 0.2.32 binary (`SNAPBACK4_LEGACY_BIN`). Server ignores are
the four existing fixture tests. No failing assertion is counted as a pass.
The wasm-budget file passed both tests. The merge and file-size audit is recorded
in [merge-checks.json](merge-checks.json).

The unchanged round-0 scripts remain outside the repository in
`/tmp/sn-round2-reproductions`, with only their original checkout import prefix
substituted. Round 2 documented three assertions superseded by round 1's complete
prediction exception; their intended hazards have permanent corrected regression
tests in the one-shot suite. This round reruns both forms and reports them separately.

The original mock test requires a pending complete prediction to block, which
round 1 explicitly restored as a permitted answer. Both original replacement
cases likewise expect a replacement image instead of the complete prediction
returned before replacement discovery. The merged tree has exactly round 2's
results and failure locations. Its permanent regressions use a concurrent mock
admission and non-predictable writes to force discovery/overlap, and passed on
wasm/process plus the applicable facades. See the
[round-2 disposition](../round2/REPORT.md) for the preserved controls.
Grok supplied no separate executable reproduction; every file in its recorded
client/compiler/server command selection ran in the batches above.
