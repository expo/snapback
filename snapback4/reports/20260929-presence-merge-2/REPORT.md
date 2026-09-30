# Presence: second merge of main

Source merge: `f45697974ce19f5c505c03af813249f153009253`, on `sb4/presence`,
merging `origin/main` at `4226fc9733a40e68d4996ee0bee234df463b1bba` into
`61cce6cbcb521e7d16211b538eccdfe0593ed310`. All implementation and verification used
`/Users/ccheever/projects/snapback-dm-20260927`. Nothing was pushed or published;
no stash, other worktree, other machine or spawned agent was used.

Read SR (`38abb89b8e`), LL (`cea3b70436`, including `3c28529bd8` and
`fded7fa9f3`), WD (`4226fc9733`) and KR (`a2e3876b60`) commit messages and journal
entries before resolving. The publication-fence changes in `77bbb5c4ff` remain.
Applied llp-orient: LLP 3000's fence, LLP 3000.031 §1.1/§1.3's discriminant and
membership contract, LLP 3000.023 §10's landed queue/live-cut/retention rules,
and LLP 3000.028 §8's custody and route rules govern the merge. LLP 3000.031
revision 5 names SR as the landed composer decision and records LL preservation.

## Every conflict

Paths below are relative to `snapback4/`. All twelve conflicts were resolved.

| Conflicted file | Kind | Resolution |
| --- | --- | --- |
| `JOURNAL.md` | Textual | Textual union with append-only custody: preserve the original branch file as an exact byte prefix, append all main additions, then append this merge's entry. Verified each final SR/LL/WD/KR entry is present verbatim. |
| `crates/snapback4-lang/src/guide/client.md` | Semantic/prose | Semantic/prose union: retain the existence rules table and narrowing recipe; use SR's fresh/non-revalidating Send rule; retain main's queue timing, per-row/list cost distinction, admission and Expo guidance. Refer to main's reads/sync cards for measurements. Final card: 1,198 words, 114 lines, under 1,200/130 ceilings. |
| `crates/snapback4/src/verbs/init/social/Conversation.tsx` | Semantic | Keep main's proposal recovery, route destinations, restore dependencies, membership hints and seen behavior. Express current membership and Send gating through existence; retain the branch's room/history/once-view status rendering. No route-resolution logic changed. |
| `crates/snapback4/src/verbs/init/social/README.md` | Semantic/prose | Keep main's durable custody and current-content distinction, state the no-horizon membership proof and exact fresh/non-revalidating absence exception. Preserve DM documentation; align the partial-results wording with existence. |
| `packages/snapback4/src/client.ts` | Textual | Textual import union: main's matching-owner deadline helper and the branch's ready-answer classifier. Keep all main publication fences. |
| `packages/snapback4/src/local-query.ts` | Semantic | Union imports and result metadata: main's cancellation/deadline-withdrawn paths plus existence dependency metadata. All fallback, remembered, composed and local final candidates classify their own answer. |
| `packages/snapback4/src/local-reads.ts` | Semantic | Keep main's held-only parking, refusal bypass, sync resumption and selective remembered-answer clearing. Add the branch's queue/admission predicate and reclassification. Admission notification is factored here to preserve the 1,500-line local.ts cap. |
| `packages/snapback4/src/local.ts` | Semantic | Keep main's queue, abort signal, search scheduling and all publication guards. Merge the shared pending predicate into main's moved queue reader and recompute at ordinary/presence/sync publication. Retain early-call safety: admission state is accessed only for an admission. |
| `packages/snapback4/src/read-observation.ts` | Semantic | Keep main's deferred change-pending episode timing, including beginning an episode on an already revalidating answer. Combine with existence recomputation while preserving identity and episode; replacements classify new data, and loading/refusal removes the ready arm. |
| `packages/snapback4/test/delivery-await-boundary.json` | Generated text | Regenerate from merged source using existing `awaitBoundary()`. Keep main's new deadline module; retain the branch's pending await and classifier module. Delivery fault matrix passed. |
| `packages/snapback4/test/readme-examples.test.mjs` | Semantic/tests | Union generated API declarations; retain main's per-row examples and the branch's membership operation. Update the executable composer table and VM fixture for fresh/revalidating/stale absence. |
| `packages/snapback4/test/social-browser.test.mjs` | Semantic/tests | Keep main's draft, refusal, membership-hint and DM-route assertions; keep existence's loading/partial assertions. Add real stale-absence custody followed by refusal at sync. |

The semantic conflict with no literal union was the branch's unconditional
absent-membership Send block. Main's landed freshness/revalidation rule wins;
existence supplies its completeness/pending proof, and the offline exception is
stated separately in the guides and LLP. All other conflicts have a clean union.
Main's newer queue/deadline architecture wins where it moved the branch's hooks;
existence is added at those publication points rather than restoring old scheduling.

Ordinary automatic merges retain WD's shared-map construction, duplicate-key
semantics and build script unchanged. Main's DM route and proposal algorithms
are unchanged. New SR `Direct.tsx` and `Profile.Person` status displays formerly
called the removed `ReadState`; their display-only expressions now use existence.
No new route decision or creation condition was introduced. KR assertions and
publication-fence tests retain their landed behavior.

## Composer rule

| Membership answer | Send/custody |
| --- | --- |
| `denied` | Disabled; keep draft. |
| `absent`, fresh, not revalidating | Disabled; keep draft. |
| `absent`, stale/offline | Enabled; queue durably, server authorizes or refuses at sync. |
| `partial` | Enabled. |
| `loading` | Enabled. |
| `absent`, revalidating (even fresh) | Enabled. |

`present` permits Send. The existing in-flight submission guard remains.
This table concerns durable custody; seen and protected-content access keep
their own current-answer safeguards. An absent discriminant already requires
complete/no-cut/no-continuation and no blocking local admission/prediction.

The client card, offline-interactions card, social card, social README and
LLP 3000.031 §1.3 say the same rule. The browser test demonstrates both a stale
absence followed by successful sync after re-invitation, and stale absence
followed by server refusal without re-invitation, with saved text/Edit/Dismiss.

## LL regressions

`live-propagation.test.mjs` covers process and wasm publication of a held read
changing from absent to present and from present to absent after the notified cut
applies. It preserves zero evaluations while held parking, new evaluation at
publication, disjoint-footprint wakeups and the existing one-second withdrawal.
The new held child-removal cases add the present-to-absent direction; subscriber
snapshots verify replacements never keep the prior value's word. Retained empty
answers may become partial while pending facts are unknown.

`live-propagation-fallback.test.mjs` adds `emptyTransition` and
`presentTransition` on both devices. A time-dependent formerly local query now
needs an online profile fact; while sync is held, its whole server fallback
publishes absent after present, or present after absent. The pending replica cut
remains. Existing ordinary and already-parked terminal-refusal scenarios now
explicitly require no existence property, while direct reads agree with the
observed refusal. All 38 live-propagation checks pass.

## Validation

Qualification checkpoint: `8c0a3dd10f`, adding only the per-row React fixture
teardown correction and its journal note to the source merge. The first full
attempt passed Rust and reached 3,200 client passes, then hung after the five
per-row React cases passed because a previously opened native child was lost
by its single-handle bridge. That run was interrupted (exit 130). The fixture
now owns every opening and routes calls by handle, with a forced process-host
reload before the unchanged 1,000-row assertions. Its focused rerun: **5 passed,
0 failed**, normal exit in 13.970 s. See `full-suite-attempt1-note.md`.

Node **v24.18.0** was explicitly selected from
`/Users/ccheever/.volta/tools/image/node/24.18.0/bin`.
Exported `CARGO_INCREMENTAL=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0`
for every build/test/measurement. Toolchain: Rust/Cargo 1.97.0,
wasm-bindgen 0.2.127, Binaryen 132.

- Affected client invocation: **487 passed**, zero failures, cancellations or skips.
  Includes existence/presence, LL, social browser/starter, README execution,
  KR keep-device and the delivery fault matrix.
- Whole guide: **105 passed; 0 failed**.
- `dev_refusals`: **21 passed; 0 failed**.
- Package build and typecheck passed. Source files respect their line limits.
- Complete suite: **`== 0 failure(s) in 4928 s`**, exit **0**.
  Rust passed (809 s); client tests: **5,280 passed, 0 failed, 0 cancelled,
  9 skipped** (3,893 s); final models: **79 passed, 0 failed, 0 cancelled,
  0 skipped** (199 s). Both session models retained their 5,000 seeded sequences.
  The nine optional external-fixture skips and 33 existing Rust ignored cases
  are listed in `suite-skips.md`; no skip/ignore was introduced.
- Affected-scope corpus audit found no unresolved drift; see `scope-audit.md`.
- Final `./ref-check --verbose`: **0 errors, 0 unchecked**.

```text
ref-check: ok — 525 LLP docs, 9955 refs in 29817 files, 0 errors, 0 unchecked
```

Exact required full command:

```sh
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0
cd snapback4 && env -u FORCE_COLOR CARGO_INCREMENTAL=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

`qualified-inputs.json` records tracked product/test inputs at the final qualification
checkpoint. After the full run, all **1,686** recorded inputs matched byte-for-byte;
`qualification-verification.json` records that result, journal prefix custody,
budget equality and the exact selected wasm hash. No tests, counts, deadlines,
meters or budget were relaxed.

## Wasm

Budget in force: `snapback4/metrics/wasm-budget.json`, **593,719 B gzip**,
unchanged from main. WD did not lower it in this landing.

| Matched build, same worktree/toolchain | Main raw B | Merged raw B | Main gzip B | Merged gzip B | Delta | Headroom |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `build-wasm.sh`, selected Binaryen folding | 1,954,659 | 1,954,659 | 581,329 | 581,329 | 0 raw / 0 gzip | 12,390 B |
| Without Binaryen | 1,980,531 | 1,980,531 | 584,177 | 584,177 | 0 raw / 0 gzip | 9,542 B |

Exact selected line:

```text
wasm 1954659 B raw, 581329 B gzip (budget 593719: ok)
```

For the control, only the six differing main device/core source files were
installed temporarily in this same worktree, backed up and restored byte-for-byte;
there was no other checkout or branch switch. Both main and merged artifacts
were freshly rebuilt. Main's recorded Linux figures (584,341 B without Binaryen,
581,808 B optimized) are historical, not this matched local control.

The unoptimized artifacts differ only at two 32-bit source-line records in the
data section: `authorized_point.rs` lines 235/241 become 241/247. Every other
section, including code, is byte-identical. Raw/gzip size is unchanged; full
artifact SHA-256 differs. `wasm-comparison.json` and `wasm-data-delta.json`
record the hashes, section census and exact offsets.

This branch's starting artifact was 2,040,781 B raw / 592,916 B gzip. The selected
merged artifact saves **86,122 B raw / 11,587 B gzip**. No device growth is
attributable to existence; WD's savings remain.

`measure-wasm.sh` also passed the family/server-only-symbol checks and appended
its metric: **1,980,531 B raw / 584,177 B gzip / 444,177 B brotli**, budget 593,719,
over 0. That script evaluates `-Os` but does not use WD's optional folding pass;
its result is the unoptimized row above. The first receipt named the starting
commit and `dirty:true`, because the source merge was not yet committed when
it began. The final confirming receipt is bound to **`8c0a3dd10f`, `dirty:false`**
at `2026-09-29T23:50:35Z`, with the identical sizes and **`over:0`**.

```json
{"sha":"8c0a3dd10f","dirty":false,"wasm":{"raw":1980531,"gzip":584177,"brotli":444177},"wasmOpt":false,"budget":593719,"over":0}
```

## Preliminary failures and corrections

- Initial LL run: 30/38 passed; eight new snapshot assertions wrongly required
  retained empty reads to stay absent while pending facts refresh. The corrected
  assertion permits partial only for retained empty snapshots; settled replacements
  must prove the expected discriminant. Existing LL assertions were unchanged.
- Initial guide run: 104/105 passed; restore the explicit SDK-delivery/screen-seen
  sentence removed during shortening. Final 105/105 passed.
- First broad affected invocation was interrupted after a newly factored admission
  helper accessed `answers` before initialization on non-admission startup calls.
  Restore the original admission-only guard before accessing state. The focused
  startup repeat and all 487 final affected checks passed. The interrupted log
  is retained and is not qualification evidence.
- A whole-merge whitespace scan reported whitespace in main's imported historical
  logs/review text. Those records were preserved. The changed product/test/doc
  source check is clean.

## Journal

Append-only entry: `snapback4/JOURNAL.md`,
**2026-09-29 — Presence merge 2: preserve SR, LL, WD and KR**.
The [exact entry, including final qualification](/Users/ccheever/projects/snapback-dm-20260927/snapback4/reports/20260929-presence-merge-2/journal-entry.md) is exported as `journal-entry.md`.
The original journal bytes remain an exact prefix, and all four landed lane
entries remain verbatim.

## Evidence

Completed logs are stored losslessly as `.log.gz`. The canonical complete log
is `full-suite.log.gz`; the first interrupted attempt is retained separately.
The merge, fixture correction and final evidence are commits on `sb4/presence`.
The final evidence commit changes only reports, the appended journal and the
wasm measurement receipt; qualified product/test inputs remain unchanged.

[Evidence directory](/Users/ccheever/projects/snapback-dm-20260927/snapback4/reports/20260929-presence-merge-2/)
contains the exact logs, hash manifests, matched wasm comparison, inherited
skip ledger, affected-scope audit and exported journal entry.
