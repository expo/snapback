# Lane OS — round 6: combined live keyset pages

All 300 generated seeds pass on each host under the decided keyset contract.
The newly exposed combined-boundary defect and SDK duplicate rendering are
repaired. The unchanged wasm cap remains the expected failing qualification.
No push, publication, budget raise or shared-path installation. Prior reports:
[round 0](./ROUND0.md), [round 1](./ROUND1.md), [round 2](./ROUND2.md),
[round 3](./ROUND3.md), [round 4](./ROUND4.md), [round 5](./ROUND5.md).
Round-6 commands, raw logs and measurements live in `round6/` (logs compressed
with gzip after completion; log names below omit the `.gz` suffix).

First fetched and merged origin/main fb7c0790b in merge b44e5b66b. The conflict
resolution preserves both LLP revision histories and journal tails, and combines
EQ's cursor descriptor validator with OS's inferred-index translation. The
native build found one additional integration initializer: OS's synthetic
membership Scan needed EQ's new `cursor_pins: 0`. No extraction is claimed on
that scan. The EQ regression suite passes alongside OS's affected tests.

Read all binding prompts, reports/journal entries, Grok r34 (READY with one
Low), Snapback 4's fence/rules and governing LLP/guide context. Applied the
read-only llp-orient skill from the populated lane-a5 copy, because the local
symlink is unpopulated. See `round6/ORIENTATION.md`. Round 5 already added
Grok's same-count room swap and killed the count-only digest mutation; both
real-host regressions pass here again.

## Decision and implementation

LLP 3000.028 §3.3 records the supervisor's ruling: each request evaluates the
next `(order key, id)` rows in the currently visible combined domain. The server
sees its current scopes; the retained lane sees acquired retained images.
Traversal is not a snapshot. Order/match edits and insertions before the consumed
position can repeat or skip changed rows; stable order, match, scope and
readability still imply exactly-once. The search card states that in three
builder-facing sentences, including `immutable at` advice. Reactive page ranges
and durable search sessions remain outside the contract.

The refined oracle uncovered a real composition defect beyond the 24 old
failures. **Seed 159:** descending limit 2 first emits at=110 and at=100. The
server consumed only 110. Inserting `new0` at=107 then incorrectly put it into
page two, before the combined consumed key at=100. A deterministic retained-
dominant version with both insertion and an order edit failed on **both hosts,
both directions** before the fix (`global-boundary-before.log`).

The combined cursor now carries the last consumed combined key in `after`.
Both lanes seek that key on the next request. The existing source positions
continue recording actual source consumption; fetched response `next` values
never advance them. Every unconsumed hit after the combined boundary remains
eligible and is recomputed/charged. Old combined cursors lacking the boundary
restart. Only emitted/consumed permitted keys enter the cursor; arguments,
identity, membership, delivery fences, one invocation and the shared meter
remain intact. Cursor storage/serialization charges include the extra key and
the 4,096-byte limit is unchanged. No Rust evaluator or authority change.

The shared `Pages` resource used by `usePage` now keys row objects by string ID,
keeping their first display position and newest observed image. A later page's
edited repeat replaces the older image; an earlier page refreshed afterward
wins in turn. Metadata-only revalidation of an old data array cannot overwrite
a newer image. Dropped suffixes cannot resurrect rows. Scalar/projection arrays
without IDs retain list semantics. Search and history tests exercise each case,
and the existing React lifecycle, retention/deadline and incomplete-page tests
remain green. Expo uses the same resource; no separate native Expo run is claimed.

The deliberate round-0 behavior change remains: admitted bare membership search
returns the compact server page instead of the old empty incomplete answer.
Explicit membership predicates, guards, system/held operations and declined
plans retain their established meaning.

## Oracle and differential

The independent model uses authored server rows, membership state and separately
acquired device images. It computes each expected page before consuming it;
query outputs never supply expected rows or keys. `KeysetModel` orders the
visible domain by UTF-8 `(at, id)`, excludes the consumed prefix, checks exact
row-image/page equality, and tracks stable-row counts across the traversal.
Terminal completeness is checked against the remaining keyset domain. Every
previous identity, disclosure, order, one-invocation and no-dead-end assertion
remains. Reset detection no longer infers success from a returned first row.

All original 300 mixed schedules per host keep their operation/random schedule,
first/last order, limits, Unicode ties, mutable-scope fallback, word/meter cuts,
sync/no-sync, body/at/move/expiry, membership, replacement/generation,
reset/reopen and link transitions. Every old failure is replayed and listed in
`round6/old-seed-verdicts.json`. The accepted cut behavior stays explicit:
unresumable retained discovery yields a metered incomplete current subset or
E_BOUND, not invented retained coverage. Such online pages must equal the
current server keyset page; ordinary device cut pages still check authorization,
order, stable duplicates, invocation count and progress. Uncut mutable fallback
pages now also require exact device-domain page equality and stable completeness.

An additional **22 current-only schedules per host** keep all scopes current
and run `createClient` server-only search beside composed search under the same
writes, edits, sync, reset/reopen and identity changes. They compare every ready
page's complete row images, completeness and continuation presence through the
end, using independent server cursors. Identity withdrawal/replanning establishes
a new traversal for both. The original mixed schedules retain membership/link
operations. No retained source means no result difference is permitted.

The first 600-seed refined sweep (`oracle-before.log`) found the same four flags
per host: 159 is the product boundary bug; 33/66/209 were newly exposed model
errors after identity adoption. Successful sync after replacement/generation
must discard old retained images even if the next query uses mutable ordinary
fallback and makes no server call. The model now does so. A later sweep
(`oracle-final.log`, development evidence despite its filename) found eight
model reset errors: 11, 22, 55, 99, 198, 220, 231, 242. Plain mutable fallback
cursors do not have the composed membership/reset epoch; the model was
incorrectly restarting them. The final model preserves their keyset position
and keeps exact page comparison. No product assertion was skipped.

Final acceptance: **300/300 mixed seeds on process and 300/300 on wasm**,
plus **22/22 current-only differential schedules per host** with **194 identical
pages per host**. Process 145.231 s; wasm 109.104 s; 254.335 s combined.
No failed seeds, no xfails, no skipped generated cases. Six cut scenarios per
host terminate with the previously accepted explicit E_BOUND; all remaining
schedules terminate normally. `oracle-acceptance.json` records all counts and
operation coverage; `oracle-acceptance.log` records each passing seed.

Every one of the 24 old failures now passes on both hosts:

| Old seed | Process / wasm | Reason under the decided contract |
| --- | --- | --- |
| 3 | PASS / PASS | New match new1 inserted before the consumed position. |
| 28 | PASS / PASS | m00004 moves from at=20 to 279 and may repeat. |
| 46 | PASS / PASS | m00010 moves before the consumed position (at=143). |
| 88 | PASS / PASS | Mutable-scope fallback moves m00003 to live and at=76; its repeated ID is not stable. |
| 105 | PASS / PASS | U+10000-prefixed 00022 moves from 110 to 77, before the consumed position. |
| 112 | PASS / PASS | U+10000-prefixed 00001 changes at to 97 and may repeat. |
| 113 | PASS / PASS | New match new4 inserted before the consumed position. |
| 136 | PASS / PASS | New match new3 inserted before the consumed position. |
| 140 | PASS / PASS | New match new4 inserted before the consumed position. |
| 142 | PASS / PASS | U+E000-prefixed 00014 stops matching, then matches again after its position was consumed. |
| 161 | PASS / PASS | m00024 changes at to 24, then 282; its repeated ID is not stable. |
| 178 | PASS / PASS | New match new1 inserted before the consumed position. |
| 181 | PASS / PASS | U+10000-prefixed 00022 changes at to 72 and may repeat. |
| 197 | PASS / PASS | New match new3 inserted before the consumed position. |
| 199 | PASS / PASS | New match new1 inserted before the consumed position. |
| 207 | PASS / PASS | m00016 changes at to 281 and may repeat. |
| 211 | PASS / PASS | New match new3 inserted before the consumed position. |
| 229 | PASS / PASS | m00006 changes at to 253 and may repeat. |
| 237 | PASS / PASS | m00024 moves from at=120 to 7, before the consumed position, with sync. |
| 246 | PASS / PASS | m00004 changes at to 166 and may repeat. |
| 250 | PASS / PASS | m00016 changes at to 117 and may repeat. |
| 260 | PASS / PASS | New match new3 inserted before the consumed position. |
| 267 | PASS / PASS | New match new2 inserted before the consumed position. |
| 292 | PASS / PASS | U+10000-prefixed 00022 changes at to 22 and may repeat. |


## Acceptance matrix

| Requirement | Round-6 evidence |
| --- | --- |
| Supervisor decision | LLP 3000.028 §3.3 and compiled search card; `immutable at` advice. |
| Every generated seed / page equality | 300/300 per host plus 22 current-only schedules each; all exact-page comparisons pass. |
| Stable rows exactly once / terminal keyset completeness | Model checks per-page equality and stable counts through terminal pages, including uncut mutable fallback. |
| No retained scopes differential | 22 additional full schedules per host; exact server/composed pages and continuation presence. |
| Identity, no disclosure, order, one invocation, no dead end | Generated invariants plus all prior named real-host and ledger cases pass. |
| Combined boundary under new/edited heads | Seed 159 plus first/last process/wasm named cases; all four named cases failed before repair. |
| Retained dominates / unconsumed hits | Existing 65-ID traversal, Unicode ties, reopened coordinator and bounded cut-stream tests pass. |
| Real server drain | 4,077-scope opening/drain plus direct-refusal control; 249-scope/32-word two-page drain passes with exact consumed prefix and one call per page. |
| Shared ledger | Previous decoder/comparison/cut receipt cases pass; new boundary's cursor bytes are charged. |
| Same-count room swap | Round-5 regression passes again on process and wasm. |
| SDK accumulated search/history | One newest image per ID, revalidation metadata, refreshed earlier page and suffix-drop regressions. |
| Mounted React | Real browser/wasm current/departed/offline/rejoin witness and general React suite pass. Native Expo remains historical gap. |
| Rust / guide / EQ integration | 73 OS Rust, 17 EQ and 93 guide tests pass. |
| Builder u0500 / coffee / searchChat floor matrix | Round-1 501-page / 10,014-ID walks and floor/guarded NOT_MEMBER evidence remain historical; full copied store not rerun. |
| Wasm | 592,722 B gzip, 6,529 B over unchanged budget; supervisor owns the raise. |
| Full suite, one invocation | `== 1 failure(s) in 1775 s`; only `wasm build`, ours/expected. No baseline or environmental failures. |

## Server envelope and wasm attribution

Seeking the combined boundary adds ordinary cursor work where the old server
source position could be null. At the old **4,077-scope** drain fixture, the
second request now refuses E_SEARCH_OPEN at the existing heap ceiling; a direct
server-only query with the identical cursor refuses identically. The SDK must
preserve that refusal and cannot refill automatically. The original first-page
drain test remains, with this differential refusal check. A second real fixture
with **249 scopes, 248 of them carrying 32 prefix words**, opens and drain-cuts
on both requests. It checks exact combined-prefix IDs and advances only through
fully consumed server rows. The separate SDK cut traversal still reaches every
ID exactly once. No meter was relaxed to retain the old accidental null-cursor
cost.

Canonical toolchain: Rust 1.97.0, wasm-bindgen 0.2.127, GNU file-input gzip -9,
no wasm-opt. `wasm-size.json` records hash and toolchain; canonical build and
family/absence logs are retained.

| Artifact | Raw B | Gzip B |
| --- | ---: | ---: |
| Round 5 | 2,038,528 | 592,562 |
| Final merged round 6 | **2,039,451** | **592,722** |
| Delta | +923 | +160 |

Round-6 fixes are in SDK TypeScript and tests. The only post-merge Rust edit is
a server-only Scan initializer; it adds no device feature. The +923 raw/+160
gzip change comes from the EQ integration's cursor representation/validation
and resulting code layout. Existing OS device growth remains attributable to
the composition descriptor, state/delivery/identity digests, shared ledger
resumption, retained-only filter, dispatch and reset counter, as measured in
rounds 3–5. These shared compressed bytes are not additive symbol shares.
The old unused plan echo and repeated left/ceilings remain absent. Canonical
serde family and server-only/Unicode-table absence checks pass.

SHA-256: `e1691a03acdce0cb323cd8c5da25baea26bb5a6c514e2265a08c8ebf88b672d0`.
Unchanged cap **586,193 B**, final excess **6,529 B (1.11%)**. No cap raise.

## Qualification and failures

Affected JavaScript: **134 passed, zero failed/skipped**, including process,
wasm, mounted React, page accumulation and all general React cases
(`affected-js-acceptance.log`). Affected Rust: **73 passed**, including device
merge, search-state, meter and reset-publication controls. Whole guide **93**
and EQ selected-prefix/cursor regressions **17** pass (`whole-guide-eq.log`).
Client build/typecheck and wasm attribution pass.

Ran `bash scripts/test.sh` **once**, with the environment recorded in
`round6/environment.json`; exit **1**. Its exact final summary is:

```text
== 1 failure(s) in 1775 s
   wasm build
```

**Every full-suite failure:** `wasm build` — **ours, expected**, the unchanged
586,193 B cap rejects the final 592,722 B artifact by 6,529 B. **Baseline: zero.
Environmental: zero.** No other stage failed. Native build, documentation budget,
release guard, package typecheck/build, chat check and both app typechecks pass.
Rust passes **4,235** tests with **33 ignored**; client tests pass **4,012**
(3,956 in the main run plus 56 in the acquisition/server shards), **10 skipped**;
fixture wrappers pass **9**; final client models pass **79**, zero skipped.
The full-suite oracle again passes **300/300 per host**, plus the same **22
current-only schedules / 194 identical pages per host**. Its process/wasm oracle
times are 97.734/77.545 s. `full-suite.log` preserves every stage and result;
`full-suite-summary.json` records the counts, exact summary and sole failure.

Every development failure is retained and classified:

- **Ours, integration:** first native build omitted EQ's `cursor_pins` field in
  OS's synthetic Scan; fixed to zero. Later native/Rust qualification passes.
- **Ours, product:** four new first/last × process/wasm boundary regressions
  fail before the combined-key fix; generated seed 159 independently fails
  on both hosts in the first refined sweep.
- **Ours, model:** three stale acquired-image flags and eight plain mutable-
  cursor reset flags listed above, repaired without removing page equality.
- **Ours, expected inherited wasm budget:** canonical build creates the artifact
  but exits 1 for 6,529 B over. Budget remains the supervisor's.
- **Ours, fixture expectations:** the first affected run expected a null server
  cursor after retained dominance; the second exposed the authoritative
  E_SEARCH_OPEN from the corrected seek. The retained 4,077-scope case now
  compares that refusal with direct server execution. Initial extra stress
  fixture at 246 scopes did not drain (8,127 examined); 249 scopes do. Its first
  assertion incorrectly treated a fully consumed three-hit server page as
  partially consumed; final assertion verifies every returned server hit was
  consumed before its next key is used. Affected final checks pass.
- **Ours, operational:** some guessed file/skill paths were absent; one edit
  used a doubled snapback4 path and wrote nothing before correction. One reset
  test filter ran zero cases; corrected `--lib publication_round6` runs/passes
  the actual case. These are not counted as test passes. Expected merge conflict
  exit was resolved before editing the task.
- No baseline or environmental failure in affected checks or the full suite.

Reproduce from `snapback4/` after native/wasm/client builds: the default
`node --test packages/snapback4/test/ordinary-search-oracle.test.mjs` runs all
300 mixed seeds and the extra differential schedules on each host.
`SB4_SEARCH_SEEDS=159` isolates the discovered composition bug. OS Rust targets
are sim ordinary_search/membership_search/search_merge, device search_merge,
search::tests and publication_round6, and core meter::tests. JS focused files
are ordinary-search, ordinary-search-ledger, review-probes, identity-review,
cross-scope-review, retention-pages and react. Cargo uses eight jobs/threads,
dev/test debug=0, incremental=0 and packaged SQLite flags. Logs retain full
outputs. Local commits carry `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
