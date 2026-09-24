LLP 3000.013 integration, round 5 part e — 2026-09-24

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`.
Merged exactly the requested A and O commits, after reading A's external
rounds 9–14 reports and all six committed reports, and O's external rounds
0–3 reports and committed journal reports. No push or publication.

| Source | Merge | Conflicts and resolution |
|---|---|---|
| A `2f20aa92f` | `e792b65d5` | `--no-ff`. RFC revision history retains A and L changes. Journal retains every entry verbatim. Binder retains H's source-filter map and A's variants/predicate context. Certificate keeps H's window/expiry wording and A's per-variant registration. Reads card keeps F's refusal paragraphs and adds A's nullable/presence section and compiled example. Both WASM measurement histories remain. Census reconciled after the final guide, below. Workspace build passed before merging O. |
| O `a54a52ce3` | `c85ee309f` | `--no-ff`. Journal retains both sides. Codes retain A's optional-filter note and O's init refusal. Language card retains F's Refusals heading and O's existing-directory instructions. Scale tests retain A's variant/window expectations and O's delivery examples. Workspace build passed. |

L's `serve_lock.rs` and `serve_maintenance.rs` are byte-identical to the
part-d integration head `3780bfbc5`. The timeline automatic merge retains L's
maintenance behavior and A's nullable-safe `byReaderPage` index. O's upload
admission response retains L's engine lock. N's client attachment remains in
`local.ts`; E's session protections remain. No feature or test was dropped.
O's ancestry also imports the unchanged calibration #19 report tree under
`benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/`. Its existing blank
line at the end of `astra/lane-final-report.md` was not edited as integration work.

Imported implementation and evidence are described file by file in A's
[round 9](./20260924-intent-lane-a-041.md),
[round 10](./20260924-intent-lane-a-round10.md),
[round 11](./20260924-intent-lane-a-r11.md),
[round 12](./20260924-intent-lane-a-r12.md),
[round 13](./20260924-intent-lane-a-r13.md) and
[round 14](./20260924-intent-lane-a-r14.md) reports, and O's four dated
entries in `JOURNAL.md`. A adds nullable/complement planning, optional-filter
variants, keyed-existence fallback, empty-search browsing, cursor identity
and total ordering, and pure setup validation before recorded job sweeps.
O adds safe init conflict handling, bounded upload retries with copied bytes,
upload session lifetime fencing and receipt cleanup, expiry observations,
and cap-aware continuation advice.

Integration-specific files and changes:

| File, relative to `snapback4/` | Change |
|---|---|
| `packages/snapback4/src/local-sync.ts` | Move `AcquisitionMarker` and `SyncPage` interfaces here to keep `local.ts` below 1,500 lines. |
| `packages/snapback4/src/local.ts` | Import those types and preserve the public `AcquisitionMarker` re-export. Return the captured session refusal if receipt deletion is denied, retaining the tracked cleanup completion in `finally`. |
| `packages/snapback4/test/upload-lifetime.test.mjs` | Inject a denied cleanup response after actual receipt persistence; test both bearer rotation and close, and require upload fulfillment with the original refusal and close completion. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | State that cleanup is attempted, and that a storage refusal does not replace the session refusal. |
| `crates/snapback4-lang/tests/intent_variants_review.rs` | Add emit and update in a range's `end_exclusive`, in every position relative to valid sweeps. |
| `crates/snapback4-lang/tests/cursor_advice.rs` | Add a later `cap 100 by assetId`; first-declared `cap 10 by messageId` must still win over both cap 3 and cap 100. |
| `crates/snapback4-lang/src/bind/intent_variants.rs` | Capture the source-map expression before variant expansion, instead of normalizing it through the AST printer. |
| `crates/snapback4/tests/check_cost_source.rs` | Expect four constant board variants; add a whitespace-preserving variant witness. Keep residual-source quoting tests by negating their optional predicate so it remains residual. Existing grouped-read, multiline-literal, comment, stale-source and fallback-printer assertions survive. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pin defining facts for `E_INIT_CONFLICT`, `E_JOB_SWEEP`, `N_OPTIONAL_FILTER_LIMIT`; update the `N_NO_CURSOR` definition for O's intended advice. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pin the three new codes' recovery/boundary facts and O's narrower-group cursor advice without removing its previous recovery checks. |
| `crates/snapback4-device/tests/readauth/census.txt` | Only `card/reads/4:` becomes `card/reads/5:` because A inserted a compiled example. Verified every rule and eligibility value is byte-identical after that ordinal substitution. |
| `metrics/wasm-budget.json` | Record the integrated measurement and the 489,000-byte gzip ceiling, with the reason below. |
| `JOURNAL.md`, this report | Append this round's result and retain all imported entries. |

Reviewer witnesses and mutation evidence:

- The range-purity matrix now contains 72 cases, including emit and update
  in the end expression, each alone and before/between/after valid sweeps.
  Each unsupported job parks as `E_JOB_SWEEP` before any chunk, write or
  effect. Removing the `end_exclusive` purity check makes the test fail:
  an effectful endpoint followed by a valid sweep completes two chunks and
  two writes instead of parking. Pure setup still processes 65 rows with
  130 effects in the separate positive witness.
- Receipt cleanup denial tests start with a real stored receipt and hold
  deletion while closing. Both initially rejected with the injected storage
  error, reproducing O's defect. After the fix, rotation returns `E_AUTH`,
  close returns `E_CLOSED`, and both close promises finish. The receipt
  remains in the injected-refusal fixture, proving storage really denied
  deletion; no old-session success escapes and no upload uses a new bearer.
- Replacing first-cap selection with largest-cap selection fails the advice
  test, which sees `cap 100 by assetId` instead of the declared first group.
  Both temporary Rust mutations were restored byte-for-byte before final tests.
- H's exact-source regressions caught A's early normalized origin capture.
  The integration fix passes all nine source-certificate tests, including
  the new authored-whitespace test on a presence-expanded read.

Representative imported forms now compile and execute in the affected tests:

| Form | Example and result |
|---|---|
| Nullable/complement planning | `issues where .org = org and .due < now and .status != 'done' first 50 by .due after c`; null deadlines are excluded and small required enum complements use metered lanes. |
| Optional filters | `issues where .org = org and (status = null or .status = status) and (assignee = null or .assignee = assignee) last 50 by .at after c`; all four board variants, including both absent, have constant certificates. |
| Keyed existence | `issues where .org = org and exists issueLabels[.id, label] last 1 by .at after c`; correlated filtering runs instead of refusing, with conservative growth reporting. |
| Empty-search browse | `profiles where .owner = viewer matching q first 1 by .handle after c`; empty `q` browses, populated `q` searches, and both retain authorization. |
| Nullable tie cursors | Planned `by .at after c` retains an id tiebreak when nullable unique keys can tie; first/last pages cover every row. |
| Pure job setup | A sweep prefix computed by `sum([{ n: 1 }], .n)` runs under each chunk's meter; domain/body writes and emits park before work. |
| Existing-directory init | `snapback4 init --web` and `--expo` preserve an existing README, use `README.snapback.md`, and refuse conflicting files/package entries before writing. |
| Upload lifetime | `await client.upload(bytes)` retries only explicit admission retries within its bounded policy; rotation or close returns the session refusal even if cleanup is denied. |
| Cap advice | `attachments first 50 by .id` recommends the first declared group's actual key when a suitable cap exists, otherwise continuation. |

The complete Clique fixture remains unchanged and passes its three simulator
integration tests with no compilation diagnostic. `home`/Following, `global`,
`trending`, `userPosts`, `thread`, `people`, `insights`, `history` and `searchAll`
run. The nine derived views retain their read rules. Following exercises
delivery, pagination, repost shaping, removals and lifecycle. The digest's
unpaged predicate `count` plans both range endpoints without `by`, excludes
hidden/expired/tombstoned/out-of-window rows, streams 5,000 inputs, and runs
through automatic chunks, reopen and once-only re-execution. No failing form
or diagnostic remains in this part's target.

Affected verification after fixes (counts exclude repeat executions):

| Scope | Result |
|---|---|
| Workspace build after A, after O, and final tree | All passed |
| Frozen Bun install, SDK build and SDK typecheck | Passed |
| All language library/integration targets | 584 passed; 4 existing ignored cases. Initial run plus guide rerun; relevant planner targets rerun after the source-only fix. |
| CLI binary unit tests; `init`, `delivery_page`, `check`, `check_cost_source`, `scale`, `scale_intent`, `scale_variants`, `following_view`, `maintenance_chunks`, `timeline_adoption` | 232 passed, including 21 init tests and 9 exact-source tests |
| Device `intent_views`, `intent_variants`, `following_view`, `upload_receipts`, `readauth` | 107 passed |
| Simulator `intent_integration`, `page_admission`, `work_intent` | 30 passed |
| JS `upload-retry`, `upload-lifetime`, `blob-lifetime`, `periphery`, `typing-expiry`, `word-expansion` | **111 passed, 0 failed, 0 skipped**, 46.859 s |
| Docs budget and first-screen witness | Passed; README 299/300 physical lines |
| Root `./ref-check --verbose` | 505 LLP documents, 9,247 references, 0 errors, 0 unchecked |
| Changed source budget / whitespace / preserved journal entries | Passed; largest source is `local.ts`, 1,485 lines |

That is 953 passing Rust tests and 111 passing JS tests across the affected
targets, after failed-target repairs. Four existing language ignores remain:
`l26_a_constant_helper_called_in_a_read_loop_has_no_read_data`,
`l29_unconditional_reset_precision`,
`review_f15_helper_increment_over_read_rows_should_supply_cardinality_evidence`,
and `survey_retained_calibration_schemas`. The first three document known
analysis precision limits; the last needs retained calibration packets.
They are not counted as passes. No intermittent test failure occurred.

Failure classification: the initial two cleanup tests exposed the requested O
defect, now fixed. Four exact-source failures were integration regressions,
now fixed. The guide inventory failure exposed missing definition/action pins
for three imported codes and O's changed cursor advice; reviewed against the
implementation and fixed. The census was an example-ordinal expectation, not
an authorization change. All are ours to reconcile, not the old main baseline.
Wrong-directory SDK/budget commands and one nonexistent language target name
were corrected invocation errors; no assertion was loosened for them.

The WASM rebuild was necessary before upload tests could exercise the new
`forget_upload_facts` device operation. Rust 1.97.0 / wasm-bindgen 0.2.127,
without wasm-opt, measures **1,751,888 B raw / 488,046 B gzip**. This exceeds
A's inherited 488,000-byte ceiling by 46 bytes; the recorded ratchet is
**489,000 B**, leaving 954 bytes. Against A round 14's recorded artifact
1,751,333 / 487,832, the whole integrated A/N/O artifact adds 555 raw /
214 gzip bytes. That comparison uses the lane's recorded measurement, not a
separately rebuilt control, and makes no independent component attribution.
The device includes presence-aware reads/cursors and exact receipt deletion;
compiler/CLI changes and simulator driving are outside the web artifact.
Runtime examined, steps, heap and write ceilings are unchanged. The first
build correctly failed the old size gate; the recorded-budget rebuild passed.

Follow-up commits: `3d086c5d4` covers the requested A/O regressions and upload
fix; `e5f11c19a` covers source quotation and reviewed expectation updates.
The final qualification commit contains this report, the journal and size record.

`scripts/test.sh` was **not run**, as explicitly instructed for part e; there
is no new full-suite summary line. The complete round-5 suite and remaining
merges/cross-lane work await the final part. No remaining part-e defect, new
design decision, version change, push or publication. The only scheduling
adjustment was rebuilding WASM now because the affected upload tests need it.

Logs: `~/sb4-intent/integration-r5e-{build-a,build-o,build-final,lang,lang-final,
cli,source-final,scale-final,device,census-final,sim,js,wasm,wasm-final,
followups-positive,mutant-range-end,mutant-largest-cap,upload-before,
upload-after,docs-budget,ref-check-final}.log`.
