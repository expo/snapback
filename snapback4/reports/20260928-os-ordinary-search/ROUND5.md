# Lane OS — round 5: generated oracle and identity/admission repairs

**NOT READY.** Astra's two reproductions are repaired, ascending and audience
mutation controls are effective, and the oracle found and drove two additional
identity repairs. The generated suite still fails live traversal guarantees
when ordering keys or the matching set change between pages. This is the
coherent subset permitted by the binding lane prompts, not completed round-5
acceptance. No push, publication, ceiling raise or shared tool installation.

Prior reports: [round 0](./ROUND0.md), [round 1](./ROUND1.md),
[round 2](./ROUND2.md), [round 3](./ROUND3.md), [round 4](./ROUND4.md).
All round-5 output is under `round5/`; compressed logs preserve original output.

First ran `git fetch origin && git merge origin/main`. Merge 1f8792149a1a81e1f5b31f9a18d037cb4e7d4fd8
joins OS 10f2be21c and main 5763da073. Both sides of the LLP, journal and
NOT-DOING conflicts survive, including OK and EQ integration. Corrected the
merge tool's joined Revised date. Read every binding prompt, report and relevant
journal entry; Astra's whole r34 review; Snapback 4's fence/rules, governing LLPs
and guide. Applied llp-orient read-only from the populated lane-a5 skill because
this worktree's skill symlink is unpopulated. Grok finished READY with a low
same-count-audience test gap; it is folded in and checked again before commit.

## Oracle first: what it found before product fixes

The real-host oracle and independent model were written first. The first valid
600-scenario run, before product fixes, flagged the same **165 seeds per host**:
91 identity-withdrawal assertions, 44 terminal whole-corpus assertions, 9 duplicate
assertions and 21 model/lifecycle assertions. These are assertion categories,
not 165 independent confirmed product bugs. Every seed is listed in
`round5/oracle-before.json`; every action trace is in `oracle-before.log.gz`.
The findings were reported in commentary before changing the implementation.
The two copied Astra repro files separately failed all four process/wasm cases
before the fixes (`astra-before.log.gz`).

The oracle uses seeded xorshift choices and authored row/membership maps, with
separate acquired images and lifetime changes. It never creates its expected
rows from returned search results. It exercises first/last, page sizes 2/3/5/9
(and 100 for meter cases), equal timestamps and cross-source U+E000/U+10000 IDs,
42 prefix words, and 8,194-row meter fixtures. Inter-page operations include sync
or no sync, joining/leaving, inserts, body/at edits, mutable-scope moves, expiry,
same-schema store replacement, actual dev-server generation adoption, reset,
reopen and link flaps. Final cut cases also interleave these operations.
Each host defaults to seeds 1–300; `SB4_SEARCH_SEEDS=28,105` isolates reproductions.
Every failed seed is logged before the aggregate assertion, with no xfail/skip.

It independently checks readable row images, page ordering, duplicates,
continuously matching IDs, terminal completeness, identity withdrawal/restart,
invocation counts and empty dead ends. Restart boundaries follow validated
identity/membership/link changes, never a mere `.at` edit. An admitted online
page must make exactly one server invocation; offline makes zero. A mutable
scope declines composition, so its ordinary fallback is checked against device
holdings and at most one invocation.

There are explicit limits: `complete` in the existing public contract describes
page coverage and can be true with `next`. The oracle applies the stronger
whole-current-corpus assertion at a **terminal** complete page, not every full
nonterminal page. Under the round-4 accepted cut behavior it permits an explicit
incomplete current subset or E_BOUND, and does not pretend all retained matches
were recovered. The mutable fallback likewise gets no combined-domain coverage
claim. These limits are not the unconditional traversal guarantees requested in
round 5; they are identified here rather than hidden by changing the public Read
contract or weakening a failing assertion.

Final generated result: **276 pass / 24 fail on each host**, the same failing
seeds and assertions on both: 3, 28, 46, 88, 105, 112, 113, 136, 140, 142, 161,
178, 181, 197, 199, 207, 211, 229, 237, 246, 250, 260, 267, 292. Process takes
133.509 s; wasm 99.585 s (233.094 s combined on this shared host). The instrument
finishes all 300 seeds after failures and stays red in the normal CI test glob.
`oracle-acceptance.json` lists every assertion and operation-coverage count;
`oracle-acceptance.log.gz` preserves every full trace. Seed 52 now passes after
reset repair. Six cut scenarios per host terminate with the allowed explicit
E_BOUND; the remaining cut scenarios exercise inter-page operations too.

## Repairs and regressions

- **Immutable scope admission.** Compiler and runtime composition reproof now
  require the read-rule scope field to be `id` or explicitly `immutable`.
  Server audience inference itself stays available. `check` emits
  N_SEARCH_MUTABLE_SCOPE naming the table/column and the one-step rewrite
  `add immutable room to table messages`. The original mutable-scope reproduction
  falls back without the two-source ID collision. A Rust regression separately
  checks inference, descriptor absence, the exact rewrite, immutable admission
  and runtime reproof after removing the immutable constraint. Search guide
  examples declare their scope immutable. The builder/social schema already
  declares `immutable conversation`; the chat starter uses immutable conversationId.
- **Captured response identity.** Query HTTP responses carry the generation of
  the exact reader that evaluated them. `searchPost` now propagates validated
  captured store/generation identity instead of only discarding a delivery
  manifest. Composition rejects an unmatched response, returns loading after
  one invocation and waits for normal sync/replanning. The cursor binds the
  validated identity. Both store replacement and actual generation adoption
  withdraw the old attempt, then restart with null source position after sync.
- **Oracle seed 160: offline cursor across store replacement.** Plain offline
  cursors contain no store or audience binding. Online composition now starts
  fresh from such a cursor, instead of adopting its source key. The named test
  on both hosts proves a newly inserted replacement-store head is returned.
  Existing offline server-cursor suffix behavior remains covered.
- **Oracle seed 52: repeated reset/reacquisition.** A generation's acquired flag
  and identical membership labels can return to their old values after reset.
  A persistent reset counter, advanced atomically by clear_rows, now contributes
  to both search fences. It survives reopening and changes even when reacquiring
  identical data. Both new named real-host tests failed before this change and
  pass afterward. Rust checks a second reset as well as reacquisition, and the
  existing publication reset-lifetime test still passes. This is one metadata
  counter, not a saved query or per-traversal ID set.
- **Ascending Unicode ties.** Named first-by-at traversals on both hosts cover
  65 IDs across current and retained sources. Replacing the comparator with
  descending-only `return cmp > 0` fails both named tests and seed 1 of the oracle.
- **Grok's audience test gap.** A real same-count room swap, without sync, must
  withdraw the continuation after one invocation. Replacing the digest preimage
  with String(scopes.length) fails both host regressions.
- **Second state response.** Only the opening state returns left/ceilings. The
  delivery validation returns its two fences and cumulative meter receipt.
  Rust asserts both omissions; the ledger remains shared and monotone.

The immutable-scope repair prevents Astra's composition collision. It does not
make the underlying mutable keyset evaluator duplicate-free under arbitrary
inter-page moves: seed 88 moves an already emitted retained row to a current
scope, changes its at, syncs, and the ordinary fallback emits it again. That
stronger request remains open with the other live-order cases below.

## Remaining generated failures

[Open issue](../../../issues/20260928-snapback4-live-search-traversal.md) records
minimal action sequences and the design constraints. Examples on both hosts:

- Seed 28 emits m00004 at 20, then its at becomes 279. An ascending later page
  emits that ID again. Other seeds repeat the same crossing in either direction.
- Seeds 105 and 237 move a continuously matching, readable ID ahead of a consumed
  key. It is omitted from the terminal traversal, without and with sync.
- Seed 3 inserts a new match before the consumed position; seed 142 removes and
  restores a body match after its position was traversed. Terminal complete does
  not mean that this changing whole corpus has been emitted.
- Seed 88 also demonstrates the mutable ordinary fallback limitation above.

The guide now states the live-keyset limitation. No disclosure, wrong per-page
order, invocation-count violation or new dead end was observed in the final
sweep; that finite result is not a universal proof. A bounded consistency design
is still required to satisfy the requested traversal-wide guarantees. Resetting
on every sync would reintroduce round 3's duplicate regression; an unbounded
seen-ID cursor or durable search session would violate the accepted contract.
The public Read contract was not reshaped by this lane.

## Acceptance matrix

| Requirement | Round-5 evidence/status |
| --- | --- |
| Generated instrument before fixes | 300 seeds per host before fixes; all flags and traces retained. Final 600-seed run remains red for documented live traversal cases. |
| No duplicate IDs / continuous matches exactly once | **Open.** Mutable at can cross a consumed key; ordinary mutable fallback also fails under a moving edit. |
| Authorized images / per-page order | No violation in final generated cases; independent row/image model and UTF-8 order. |
| Whole-traversal complete | **Open.** Contract is page coverage; terminal whole-current-corpus assertion finds changed-match cases. |
| Identity change withdraws/restarts | Store/generation named tests on both hosts, seed-160 plain cursor and seed-52 reacquisition repairs pass. |
| Mutable-scope composition | Astra process/wasm repro passes after descriptor exclusion. Rust tests admission/rewrite/reproof. Generic mutable-order guarantee remains open. |
| Ascending and Unicode ties | Both named 65-ID traversals pass; descending-only mutation fails named tests and generated seed 1. |
| Same-count audience change | Both real-host cases pass; count-only digest mutation fails. |
| One invocation / no empty cut dead end | Admitted generated pages and existing word/meter/drain regressions pass; explicit E_BOUND is permitted when no source can prove progress. |
| Retained first page / consumed source prefixes | Prior 65-ID traversals and ledger tests pass again. |
| Existing membership/edit/expiry/link/reset/reopen/rejoin races | All affected process/wasm cases pass; generated traversal caveats above remain. |
| Mounted React | Existing current/departed/offline/rejoin witness passes. Expo remains unwitnessed separately. |
| Builder u0500 / coffee / searchChat floor matrix | Historical round-1 501-page / 10,014-ID walks, current/departed/floor/link/rejoin, guarded NOT_MEMBER and builder drain remain historical; full copied store not rerun. |
| System, optional-index, scope-first and standalone controls | All existing affected Rust controls pass. |
| Whole guide | 93 pass, including immutable-scope and live-pagination text. |
| Wasm | Final 592,562 B gzip, 6,369 B over unchanged cap; supervisor decides budget. |

The deliberate round-0 change remains: an admitted bare membership word search
returns the compact membership page instead of the old empty incomplete server
answer. Explicit predicates, guards, held/system queries and declined plans keep
their established semantics. No hidden-row cursor key, extra server invocation,
application merge, meter reset or public Read field was added.

## Qualification, negative controls and the full suite

Final affected checks: **75 JavaScript cases** (including process, wasm and
mounted React), **73 Rust cases** (52 server/search, 12 device merge, 4 meter,
4 search state, 1 reset-publication) and **93 whole-guide cases** pass. Client
build/typecheck and wasm family/absence attribution pass. Final whitespace and touched-source caps pass; ref-check reports 522 LLP docs,
9,802 refs, zero errors and zero unchecked. Logs retain those checks.

Negative controls, all restored:

| Mutation | Result |
| --- | --- |
| Comparator always descending | Both named ascending cases fail; oracle seed 1 fails on both hosts. |
| Audience digest hashes only scope count | Both same-count swap cases fail. |
| Accept response without validated identity | Both store and both generation tests fail. |
| Original raw cursor adoption | Both named seed-160 cases fail in an isolated copied package. |
| Original reset identity | Both named seed-52 cases fail before the counter fix. |
| Original mutable-scope composition | Both copied Astra cross-scope tests fail before admission fix. |

`mutations.json` and the individual logs preserve the negative results. Early
filtered oracle test titles said “300 seeds” even when an override supplied two;
ORACLE_SUMMARY records the actual count, and current titles use that count.

Ran **scripts/test.sh exactly once**. Exact summary:

```text
== 2 failure(s) in 1684 s
   wasm build
   client tests
```

Every failing step/case:

1. **wasm build — ours, expected.** That suite build measured 2,037,952 raw /
   592,291 gzip B, 6,098 B over the unchanged budget. Final reset-fix artifact
   measurement below is newer; this historical line is not rewritten.
2. **client tests — ours, product/model contract gap.** The only failing cases
   were `ordinary search generated oracle process: 300 seeds` and its wasm
   counterpart. Each logged 25 failing seeds:
   3, 28, 46, 52, 88, 105, 112, 113, 136, 140, 142, 161, 178, 181, 197, 199,
   207, 211, 229, 237, 246, 250, 260, 267, 292. Seed 52 is repaired afterward;
   the remaining live traversal cases stay red. The main client runner reports
   3,957 tests: 3,945 pass, 2 fail, 10 existing skips. All seven acquisition/server
   shards pass (56 additional tests). The separate client models pass all 79.

Cargo build/tests, docs budget, release guard, package build/typecheck, chat check,
chat/Expo typechecks and all 9 fixture wrapper tests pass. No baseline or
infrastructure failure was identified. The suite began before the reset-counter
repair and final cut-case interleavings; affected Rust, all 75 focused JS cases,
the whole guide and the full 600-seed instrument were rerun afterward. Per the
one-run instruction, the whole suite was not rerun and is not claimed green.

## Wasm and wire attribution

Rust 1.97.0, wasm-bindgen 0.2.127, GNU gzip -9 with file input, no wasm-opt:

| Artifact | Raw B | Gzip B |
| --- | ---: | ---: |
| Round 4 | 2,039,944 | 592,440 |
| Main merged, before round-5 changes | 2,038,022 | 592,246 |
| Remove repeated left/ceilings | 2,037,952 | 592,291 |
| Final, including reset counter/fences | **2,038,528** | **592,562** |

The requested metadata omission saves **70 raw wasm bytes** and **173 wire bytes
per validation response** in the two-scope fixture (286 B instead of the 459 B
payload with those fields). It increases gzip by 45 B; no gzip saving is claimed.
The new reset-counter write/check/hash input costs a further 576 raw / 271 gzip B.
Net against round 4: **−1,416 raw / +122 gzip B**. Against merged main: +506 raw /
+316 gzip B. Final overage is **6,369 B (1.09%)** above 586,193 B. No budget change.
The earlier composition descriptor/state/digests, ledger resume and retained
filter still account for the existing excess; the unused plan echo remains gone.
Admission and HTTP/SDK identity changes add no device wasm feature family.

SHA-256: `b527ef012a469c73a5c1a191aa5cc098646146048a239901ebf986f61834e200`.
`wasm-size.json`, `state-wire-size.json` and canonical build/attribution logs bind
these measurements. Source local.ts remains at its 1,500-line cap.

## Every failure and classification

All observed failures are retained in the logs; `run-ledger.json` indexes command
summaries and named test failures. None is relabeled as passing evidence.

- **Ours, product:** the four copied Astra reproductions failed before repair.
  Initial and intermediate oracle flags include real identity, live duplicate
  and omission defects. Before reset repair, both final-model hosts had the
  same 25 flags; the named reacquisition tests separately failed 2/2. Remaining
  generated failures are listed by every seed in `oracle-acceptance.json`.
- **Ours, oracle setup:** an invalid inline immutable declaration caused
  E_QUARRY_SYNTAX; the first membership insert rule then caused E_SYNC. Both
  fixtures were corrected before the valid pre-product-fix run.
- **Ours, oracle model:** intermediate runs mishandled reset while offline,
  ordinary fallback domains, replacement already synchronized on reconnection,
  and an expiry delivered before departure in the same sync. Tracking every
  unacquired replacement body was also wrong: only observed lifetime deletion
  survives departure. Corrected the independent acquisition model, then reran
  all seeds. A text edit failed to insert model.write after formatting, causing
  model.write-is-not-a-function failures in two retained logs; fixed the class.
  None of these development flags is counted as a new disclosure finding.
- **Ours, test fixture:** generation probes queried /schema without the persona
  header and timed out. This caused both new named failures in the first affected
  JS run and generation-seed failures in oracle-after. Authorized probes fix them;
  the actual watched program adoption and identity withdrawal tests now pass.
- **Ours, implementation:** initial TypeScript build failed exact optional
  property typing for searchIdentity. The optional type now explicitly permits
  undefined. Initial guide run was 92 pass / 1 fail because diagnostic definition
  pins omitted N_SEARCH_MUTABLE_SCOPE; final guide is 93/0.
- **Ours, expected negative controls:** all deliberately restored defects in the
  table above fail their tests; every mutation is restored before final checks.
- **Ours, expected budget:** canonical pre/post/final wasm builds and the one
  full suite fail the unchanged cap. This is lane excess, not a main-baseline red.
- **Ours, mutation harness:** the isolated raw-cursor package initially lacked
  its #fetch import map and could not load. Copying the package manifest fixed
  the harness; both intended assertions then failed. Original dist was untouched.
- **Ours, operational:** initial heredocs used a doubled snapback4 path from the
  snapback4 cwd and wrote nothing; some guessed source/skill/log paths did not
  exist. The merge exited for expected conflicts, resolved with both histories.
  No evidence store, other lane or shared installation was modified.
- **Baseline:** no failed qualification case identified. **Environmental:** no
  failed qualification case identified. Existing compile warnings remain warnings.

Reproduce with the ordinary/membership/search_merge simulator targets, device
search_merge and search::tests plus publication_round6, core meter::tests and
lang --test guide. JS targets are ordinary-search, ordinary-search-ledger,
review-probes, cross-scope-review and identity-review; run the generated oracle
separately at its default 300 seeds per host. Cargo qualification uses 8 build
jobs/test threads, dev/test debug=0, incremental=0 and
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT. Node 24.13.1 / Bun 1.3.14.
No new tools were installed. Commit includes
Co-Authored-By: GPT-6 Astra <noreply@openai.com>.
