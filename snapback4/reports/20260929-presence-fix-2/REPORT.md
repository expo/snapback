# Existence correction, round 2

All eight named items are complete. The exact blocking suite passed with zero
failures; the documented B2 covariance-first narrowing fallback applies.

Worktree: `/Users/ccheever/projects/snapback-dm-20260927`; branch `sb4/presence`.
Started from `16bab018a5c5009c4c0d8f91d1209156760a6814`. No later main commits
were merged. All work stayed here: no push, stash, other worktree, other
machine or spawned agent. Cargo commands exported `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_PROFILE_DEV_DEBUG=0`. Node was explicitly
selected with `/Users/ccheever/.volta/tools/image/node/24.18.0/bin` first on PATH;
`environment.txt` and `full-suite-node.txt` record `v24.18.0`.

The blind review and supplied evidence were read first. LLP 3000.031 remains
the spine at its original filename. Prior reports and journal entries remain
historical records. `commits.txt` records the item-sized implementation and
qualification-repair commits; no earlier commit was amended.

1. **B1 — shared pending predicate.** `local.ts` supplies one `pendingRead`
   callback to both `evaluateLocal` and `localWatch`, backed by
   `LocalReads.pending`: active admissions OR unknown/intersecting predictions.
   One-shot reads still fetch the queue and recheck their incarnation;
   `queuedPredictions` is shared with the observed cache. Cold reads retain
   their synchronous control-plane path and checkpoint. No new await or
   delivery I/O was added.
   `read-admission-insert.test.mjs` preserves Astra's successful-insertion
   reproduction on native and wasm: query and observe both publish partial
   while admission is held, then present after release. Before fix: 0 pass /
   2 fail (`b1-before.log`, absent versus partial). After fix: 242 pass / 0 fail
   across the admission, decision-table, routing, remembered-answer and Worker
   control files (`b1-final.log`). Removing admission from the common predicate
   restores the two failures.

2. **B2 — covariant generic readers.** Named `Present<out T>`, `Partial<out T>`
   and `Absent<out T>` interfaces replace deferred conditional union arms.
   Every arm retains `data: T`; present intersects with `{} | undefined`,
   absent with `null | []`, and partial leaves T unchanged. Metadata is in the
   interfaces so TypeScript compares the generic arms covariantly.
   Astra's `consumer.ts` is permanent under `test/fixtures/read-types/` and now
   compiles. `read-types.test.mjs` also proves generic `T extends U` widening,
   nullable/unknown widening, a concrete `Row & []` to `Row | null` witness,
   `isReady` preserving T, point present narrowing,
   and array T on all arms. The negative ready literal without the discriminant
   must produce TS2322. Before fix the generic consumer produced TS2345;
   all four final type checks pass.

   **Explicit B2 fallback:** a structural `Row` can have an empty-array subtype
   `Row & []`. Universal covariance plus sound empty-array reads therefore
   cannot promise literal null for every `Read<Row | null>` absent arm. It is
   `null | (Row & [])`; use `read.data === null` when literal null is needed.
   Present still narrows to Row, partial remains Row | null, and isReady keeps
   T. Non-null arrays retain T with an extra T & [] refinement under absent.
   Scalar impossible intersections may remain expressible at the type level.
   LLP §3 states this precise limit; no unsound null-only claim remains.

3. **B3 — nullable arrays.** Absent data for `Read<Row[] | null>` is
   `(Row[] | null) & (null | [])`: assignable to null | [], rejected as null
   alone. Astra's `nullable-consumer.ts` is permanent and its erroneous
   assignment must produce TS2322; it compiled before the correction.
   `read-nullable-array.test.mjs` runs a real Quarry conditional, checks the
   emitted `Query<{ flag: boolean }, Rows["rows"][] | null>`, and verifies
   absent [] / absent null / present nonempty array. Runtime classification
   already had the correct empty-value semantics and is unchanged; the
   consumer test is what fails without this type fix.
   The supplied evidence directory omitted the named runtime test source;
   its generated API, failure log and review description were present. The
   permanent runtime case reconstructs that evidence rather than claiming a
   verbatim copy. Combined type/runtime/compiled-document checks: 13 pass /
   0 fail (`types-runtime-final.log`).

4. **Name — existence.** The field/helper, internal classifier and publication
   helpers, hooks/page imports, mocks, tests, social and web starters, chat and
   Expo consumers, client/offline cards, and CLIENT-AND-OPERATIONS now use
   existence. No compatibility alias remains. The synchronous module is
   `read-existence.ts`; the await inventory only renames its zero-await entry.
   The type/runtime/compiled-document rename run passed 30 checks, including
   all 33 compiled documentation blocks (`rename-tests.log`). The guide's
   `existence_card_and_starters_teach_the_sdk_words` requires the new helper
   and field and rejects the former read word in the cards/starters; reverting
   the rename fails it and the compilation checks. Actual connected-state
   presence and its refresh mechanism keep their meaning and names. The LLP
   title/body changed; its Revised line names the collision and former word.

5. **Discovery.** Aliases route “what does a missing row mean” and “loading or
   absent” directly to client; “unknown membership offline” to
   offline-interactions. `existence` also opens client. Three named guide
   regressions assert each requested query. All three failed before aliases
   (9 pass / 3 fail for that guide scope); the complete guide then passed
   105/105. `connection_presence_keeps_its_card` asserts that `guide presence`
   still opens connected[p], not the client card.

6. **Wording.** Both cards qualify the membership sentence with “unless a
   pending prediction blocks absence” and the loading sentence with
   “acquisition or later withdrawal”. The mutation's authority check remains
   in the recipe. `membership_wording_covers_pending_predictions_and_withdrawals`
   checks both qualifications on both cards and fails on the old wording.
   Final client card: 1,196 words, below the unchanged 1,200-word ceiling.

7. **Fixtures.** Normalized through `readyRead`, rather than hand-classified:
   the `ready` factories in answers-stay-review and answers-stay-bound, the
   ready datum in answers-stay-round2, and the empty/generation data in
   mixed-evidence-oracle.test.mjs. Wire responses remain wire responses.
   Four focused checks passed (`fixtures.log`); the two ready-fixture tests
   and the round2/oracle assertions explicitly require existence, so restoring
   the former bare constructors fails them. The full suite also runs these
   families with their original counts.

8. **LLP.** §1.1 says no continuation (null or omitted), records the rename and
   shared admission predicate; §1.3 qualifies membership; §3 records B2's
   covariance solution and exact narrowing fallback; §4 adds acceptance cells
   for one-shot admission, nullable arrays, generic readers and discovery.
   Existing omitted-cursor decision/page tests exercise the documented runtime
   rule; the admission, type and generated-array tests cover the new table
   cells. Ref-check validates the references and metadata. No document was
   renumbered, moved or accepted on the author's behalf. Reverting prose alone
   does not fail a behavioral test; the executable negative controls are the
   corresponding admission/type/array/discovery tests listed above.

Verification:

```sh
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0
cd snapback4 && env -u FORCE_COLOR CARGO_INCREMENTAL=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

- Blocking-suite result: **`== 0 failure(s) in 5348 s`**, exit 0. This fifth
  complete run qualifies product/test commit `6812b3b5e4dd7aa94f14cb220c114f05c8e8b716`.
  All Rust targets, build/typechecks, fixture checks and 79 final model checks
  passed. The client pool passed
  4,786 checks with 0 failures, 0 cancellations and 9 existing opt-in skips.
  Those skips require pinned historical/managed binaries, tarball caches or
  private identity scratch settings that were not supplied; the task regressions ran.
  `optional-skips.txt` records each skip and its requested input.
- Qualification setup repair: the first full run hit a Vite replay-page
  startup race (`window.replay is not a function`), before a read assertion.
  Disabled HMR for that fixed-history harness; its 66 checks then passed.
  Read/loading/mount assertions and all counts/timeouts remain unchanged.
  `full-suite-first.log` preserves the failure; `full-suite.log` is the
  latest complete rerun. See the failure ledger for the 13 successful
  isolated attempts and the diagnostic.
- Second qualification repair: the next full run found a counted refusal
  split by raw lifecycle diagnostics during shutdown. The console now formats
  its complete line before write_all, preserving the lifecycle signal-safe
  writer. A deterministic interleaving test fails before the repair and all
  four console aggregation tests pass after it. The real refusal/shutdown
  suite also passes all 21 checks, including the failed SIGINT case
  (`dev-refusals-after.log`). Counts, windows, queue limits,
  shutdown acknowledgement and quiet-empty behavior are unchanged; LLP §1.2
  and the journal record the repair. `full-suite-second.log` preserves that
  failure. A further complete rerun qualifies the repaired source.
- Third run: `== 1 failure(s) in 6300 s`; client 4,783 pass / 3 fail /
  9 skipped, models 79 pass / 0 fail. Both local-close tests exceeded their
  existing 500 ms deadline; a trace localized a reproduced miss to 807 ms in
  native process close, after all device calls had finished. The HMAC route
  case timed out waiting for its host to listen, before making a request.
  Exact-case repeats passed, with further trace outcomes preserved in the
  ledger. No client close behavior, deadline or fixture readiness limit was
  changed. `full-suite-third.log` preserves the run; the fifth complete
  qualification passed on the same product/test commit.
- Fourth run: `== 1 failure(s) in 6941 s`; all Rust targets and 79 final
  model checks passed. The client pool had 4,785 pass / 0 fail / 1 cancelled /
  9 skipped. The native 300-history mixed-evidence test crossed its existing
  240-second timeout; its continuation logged 43 mismatches after cancellation,
  while the wasm batch logged zero. The failed run and those observations are
  preserved in `full-suite-fourth.log`. The isolated repeat passed all 300
  native histories in 144267.468542 ms with zero mismatches, recorded individually
  in `mixed-native-repeat-process.json`. The 240-second timeout and all counts
  remain unchanged; the fifth complete suite passed on the same source,
  including both 300-history mixed-evidence batches.
- Wasm: `wasm 2040781 B raw, 592916 B gzip (budget 593719: ok)`.
  Budget unchanged; 803 B gzip headroom. Zero raw/gzip delta and byte-identical
  to the starting/merge artifact, SHA-256
  `7bd5b13fcdbd8a496f6f2710fb252c588ee51eed32626d040a7e0e114ff548a9`.
  `wasm-final.txt` confirms the same bytes after the final full-suite build.
  No movement to attribute. Canonical measure-wasm family/server-only absence
  checks pass; `wasm-measure.log` and the appended metrics line record
  raw 2040781, gzip 592916, brotli 449288, budget 593719, over 0.
- Final `./ref-check --verbose`: `ref-check: ok — 524 LLP docs, 9894 refs in 29168 files, 0 errors, 0 unchecked`.
- Append-only journal entry: `snapback4/JOURNAL.md`, “2026-09-29 — Existence: blind-review corrections and discovery”.
- Qualified product/test commit: `6812b3b5e4dd7aa94f14cb220c114f05c8e8b716`.
  Subsequent changes are this report/evidence, the wasm metric and append-only
  journal records; product and test code remain exactly as qualified.

Development/negative-control failures and their resolutions are in
[FAILURES.md](./FAILURES.md); scoped governing constraints are in
[CONTEXT.md](./CONTEXT.md). No test count, timeout, gate, source-disclosure
assertion or wasm ceiling was relaxed.

Left out: exact null-only point-absence narrowing, using the explicitly
permitted B2 fallback above; the unavailable runtime reproduction was
reconstructed from supplied evidence. No requested defect remains intentionally
unfixed. The intermittent local-close, host-start and mixed-evidence deadline
misses are preserved above and in the ledger; no deadline was enlarged and
no test count was reduced to obtain qualification. No push, publication or
new agent review was performed, as requested.
