# Twin lane independent review — frozen v4

**Verdict: NEEDS_CHANGES**

Reviewed only `0fa68e928e9ff59c3bc5bc2edada49f96ecec6ef` against `1f9b4b95c54ba7a5a9d0ece41e9463b29078cfa4` in this worktree. 54-file delta; every checkpoint hash matched on disk. No other lane source, no peer reviews, no coding changes.

---

## Material findings

### 1. Complete-runtime gzip exceeds the frozen 66,000 ceiling (known, not waived)

Independently verified against `lanes/search-twin/clock-byte-attribution.json`:

| Field | Value |
|---|---|
| minified | 204645 |
| gzip | **66457** (457 over 66000) |
| bundle SHA-256 | `f4439dd4af53b77171a30c27fe04e3af70123fbaf10618673d2b04e36d1db425` |
| artifact SHA-256 | `e2b168ba339aea9630443a3fac49852123861fe1872132bbe2bc1e913e049b2a` |

`build.mjs --measure-twin` measures the five frozen root groups (`twin`+`serverArguments`/`reduceQueryState`, `PersistentRangeStore`, `OfflineRuntime`/`offlineView`, projection namespace, receipt-protocol namespace). Required search/clock modules are in the metafile. This is a recorded landing/release blocker. v5 consolidation is out of scope here.

Inherited 34k local clause is **not** treated as a new author prohibition.

### 2. Clock-only selection still infers uniform-extent eviction

**Contract:** Astra §5 / root contract: a `readTime` change must not infer revocation from omitted result slots; eviction stays on explicit absences, tombstones, and checked uniform-extent holes of the *same* typed extent. Different temporal bounds must not prove a hole in the previous extent.

**What the code does:** clock-only same-seq frames skip *slot* inference (`hidden = []` at `range-store.ts:1131`) and skip watermark/retirement (`clockOnly` at `900–904`, `967–968`). They still push the new receipt into `freshRanges` (`1182`) and run `inFreshExtent` (`1191–1197`) with **no** `clockOnly` filter.

**Reproduction** (probe outside source: `/tmp/twin-review-probe/clock-only-extent.mjs`):

```text
bun /tmp/twin-review-probe/clock-only-extent.mjs
```

Same-seq, newer clock, **identical** Exhausted range identity (`prefix/after/before/gt/gte/lt/lte` unchanged), rowIds `[one,two]` → `[one]`, plus an independent `anchor` holding `two`:

| Observation | Result |
|---|---|
| `clockOnly` | true |
| `coverage().evicted` | `["two"]` |
| pool after | `["one"]` only |
| `anchor` data | `[null]` |

Independently held body `two` is purged at seq 10 and recorded in `state.negative`, so it cannot reappear at that durable sequence.

The existing store-review case `"execution clocks order answers while immutable durable facts survive collection"` (`store-review.test.ts:368–370`) uses **empty** receipts, so it never hits this path.

**Same IR with temporal bounds is protected.** A second probe with `clock.read`-shaped `lt: readTime` (`/tmp/twin-review-probe/clock-only-temporal-bound.mjs`) did **not** evict: `rangeKey` includes `lt`, so the extents do not match. The bundled `clock.read` IR (`test-search-v4-fixtures.json` `clock.range.lt = Input::ReadTime`) therefore avoids this hole. The contract is not limited to that shape. Any timed query whose receipt bounds do not change with `readTime` still revokes through inferred extent holes.

**Required repair:** do not run `inFreshExtent` eviction for `clockOnly` answer keys. Keep explicit absences/tombstones.

---

## Missing qualification (stated, not conjectured)

| Artifact | Status |
|---|---|
| `revisions/inbox-restore/native-clock/row-window/{root-frozen-verification.json, persist-frozen.mjs.inputs.json, persistent-result-1788704878530.json}` and `run-20260906T141848Z` | **Not present** under `/Users/ccheever/clique-improvement`. Native warm/cold row-window witness is not reviewable here. |
| `lanes/search-twin/indexed-clock-checkpoint.log` | **Missing** (checkpoint records SHA `aebdf418…`). This reviewer ran `bun snapback2/packages/evaluator/src/test-indexed.ts` at the frozen commit: **pass** in ~1.1s, including the later “timed local h1 continuation pins one signed execution clock” line that the r3 evaluator log does not contain. |
| `lanes/search-twin/build-r4-checkpoint.log` | **Missing.** Recorded SHA is the empty-file digest `e3b0c442…`. Not a build transcript. |
| `lanes/search-twin/measure-clock-candidate.log` | **Missing.** Size is still bound by the hash-matched `clock-byte-attribution.json` / `.log`. |
| Local Node 10s `store-review.test.ts` | Failed as recorded: `store-clock-candidate.log` 31 pass / **1 cancel** at 10000ms (`ERR_TEST_FAILURE` on the file). |
| M5 original 10s store probe | **Present and passing:** `store-checkpoint-v4-m5-10s.log` **38/38 in 2644ms**, 0 fail, 0 cancel. This is a 10s pass on M5, not assumed. |
| 120s store run | `store-clock-checkpoint-120s.log` 38/38 in 12.070s — not a 10s pass. |
| Evaluator 249-case full entry | `evaluator-r3-full-entry-tenth.log` SHA-matches; 225 modeled + 24 server-only. It is an **earlier** `test.ts` transcript (`test.ts` now imports `test-indexed.ts`; current indexed output has an extra clock/h1 line). Not re-bound to this HEAD. |
| Owned 10s battery | `owned-clock-checkpoint.log` 211 pass / 4 fail as recorded; `sqlite-r4-checkpoint.log` 15/15 after fixture repair. Non-SQLite remainder treated as unchanged pass, not new cases. |

Phone / 8 MiB resident-store qualification is **not** in evidence. Node heap numbers below are not a phone claim.

---

## What was reviewed and holds

**Identities.** `CURRENT_VALUE_MODEL_VERSION = i53-codepoint-bytes-unicode-search-text-min-v4`, evaluator `bounded-spike-rust-search-text-min-3`. Text min absent/zero omitted in canonical JSON; positive min enforced recursively on arguments before body (`value-runtime.ts` `validateInputs` / `fanoutForLongList`; columns stay max-only). Historical v3 certificates are refused by `decodeHeldProgram`.

**Wire.** `Index.components` Column vs `WordPrefixes`; scan/receipt prefixes are `Scalar` / `WordPrefix` wrappers; halo is `RowRef`; `n2_suffix` is ordinary suffix only (`cursorSuffix` refuses derived); Q comes from the issuing scan’s `source_max` (`coverage.ts` `prepareRange`). Derived receipts without matching trusted program/site/shape throw. Ordinary historical receipts still admit schema-checked ordinary coverage.

**Unicode / key equality.** Coverage, drained-prefix, directory, local `h1` bindings, and carrier `contains` all go through prepared meaning (`logicalKey` / `preparePrefix` / `localBinding`), not raw descriptor JSON. Equivalent spellings (`Café` / `CAFE\u0301`) bind as one search argument unless the same path is also an ordinary key.

**Incremental indexes.** Warm twin consumes `StoreChanges` record deltas (`twin-store.ts`); `test-indexed.ts` asserts one cold snapshot and that `ClientStore.rows()` is not used for seeks. `coverage()` remains for resume/watermark/retirement — disclosed existing scan, not represented as history-independent.

**Readable directory.** Delivered-history stays searchable with partial membership (`readable: ['messages']` + `held_search`). Until-revoked unknown authority is `missing-authority` with no computed result. Deny absences exclude without missing-authority. Directory overflow is capped. Empty search does not resolve to the trie root.

**Postings / dictionary.** Compact u32 AVL handles; ancestor postings; deepest-first release; empty-store chunk reuse. 3000 posting + 4096 dictionary mutations pass in `test-indexed.ts`.

**Local `h1`.** Identity/binding/incarnation/revision/page-suffix fences; timed pages pin signed `readTime`; `serverArguments` strips only the declared cursor on query, SSE, reconnect, and resume (`client.ts:238`, `375–394`, `1167–1171`). Overlay retirement ignores `h1.` links (`overlay-retirement.ts:30–41`). Cold reopen is a new incarnation and restarts paging.

**Raw vs checked custody.** Fingerprint uses `receiptEvidence ?? receipt`; checked `receipt` is installed only after issuing-program admission. Identical raw replay can promote coverage without changing the fingerprint (`store-review.test.ts` first test).

**Clock policy (except finding 2).** Optional `readTime` on protocol 1; signed safe integer, no `-0`; bound into validator when present; seq excluded. Seq-first; equal-seq strictly newer clock; equal-clock payload conflict; older clock stale. Whole-swap timed preflight before ordinary conditionals (`1043–1052`, `510–538`). Missing immutable proofs → one authenticated full revalidation, no reset loop; failure keeps prior seq. Clock-only does not advance watermark or overlay-miss. `FACT_SLOT_LIMIT = 524288`. Exhaustion resets coverage once, keeps outbox, refuses a repeated saturated rebuild.

**Assets.** View-once still goes through `RowAssets` / `nullOnceMedia`; bytes leave with the leasing row in the same swap.

**Rollback.** `SwapJournal` copy-on-write; failed preflight leaves `factGuards` empty (`store-review.test.ts:522`); failed carrier `replace` does not publish (`test-indexed.ts` `failCommit`).

**Memory (Node, not phone).** Compact dictionary vs prior large-string index: 100-distinct 62.4MiB → 12.2MiB; 1000-distinct 618MiB → 115MiB. Index-only 100k: **290,873,924** retained heap+buffers. Carrier 100k mirror after 524288 cap: **213,457,616** heap delta / **85,736,668** JSON; 300,000 slots. Original 262144 refusal retained. These are not summed and are not an 8 MiB resident-store claim.

---

## Residual (not used as extra blockers)

- Eligible `held_search` sets `execution.held` whenever the descriptor is registered (`runner.ts:617–627`), so twin `evaluate` reports `held`/`capped` even if receipts would prove complete (`twin.ts:130–134`). That under-claims completeness; it does not over-claim it. Direct (non-merge) search still returns `fresh`/`complete` when an ordinary source scope is drained (`test-indexed.ts:82–86`).
- `Trace.scope_touches` is declared and never written in this delta. Local directory refresh uses `touchRows` instead. Native `ScopeTouch` is engine-lane work.
- `client.ts` is exactly 1500 lines (caps ceiling). Not a functional defect.
- Warm search does not walk `coverage()`; full-carrier retirement/resume still may. That split is disclosed.

---

## Qualification snapshot (this checkpoint)

| Check | Result |
|---|---|
| 54 source files vs `source-checkpoint-r4.json` | Independent SHA/bytes/lines match |
| Twin 10s | 28/28 in 6734ms (`twin-clock-candidate.log`) |
| Store local 10s | 31 pass / 1 cancel |
| Store M5 10s | **38/38 in 2644ms** |
| Store 120s | 38/38 in 12.070s (not 10s) |
| Same-swap clock-first | 4/4 |
| SQLite r4 | 15/15 |
| Owned 10s | 211 pass / 4 SQLite fixture fails, then sqlite-r4 repair |
| `test-indexed.ts` at this HEAD | Pass (this review) |
| Size | 66457 gzip, 457 over |

---

**NEEDS_CHANGES** for the known 66,000 gzip miss **and** for clock-only same-bound extent eviction of independently held rows. Do not land or publish this checkpoint. The temporal-bound `clock.read` shape is not a substitute for skipping inferred eviction on `clockOnly` frames.