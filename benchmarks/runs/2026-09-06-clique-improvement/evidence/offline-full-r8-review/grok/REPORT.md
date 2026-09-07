# NEEDS_CHANGES

Independent grok review of the full R8 client/twin delta
`e1c6e2b79a9e13ceb363f647f52807218aa2b57a` → `47a7f491a7d7f3b3abd976f2767bf2856a5baf68`,
including `4e927c26`, receipt-ownership `02a5b980`, carrier preparation `4fb998f2`,
and the inherited coverage repairs at `47a7f491`. `4e927c26` is not treated as a
reviewed base.

This is a correctness verdict for the frozen packet source. It is **not** a
landing, publication, phone, size, movement, or resident-memory clearance.

## Finding 1 — P2

**Incomplete denied/partial public projection on the actual offline QueryResult path.**

The R8 delta teaches `OfflineRuntime.accept` to omit `data` on denied and to
emit `next` only for `complete`/`capped`. `wireQuery` independently refuses
`next` on denied/partial. Protocol-1 envelopes, however, **require** a `next`
field on every full delivery, including denied/partial
(`offline-protocol.ts:136-138,156`). `commitMany` then copies that field onto
the stored answer (`offline.ts:575`). `PersistentRangeStore.answer` keeps it in
the visible HeldAnswer (`range-store.ts:679-686`).

`offlineView` still spreads that held record:

```882:916:packet/source/snapback2/packages/snapback2/src/offline.ts
export function offlineView<Result>(held: HeldAnswer<Result> | undefined, local?: LocalAnswer): any {
  // ...
  if (!useLocal) {
    if (!held) return { state: "hydrating", live: false, connection: "offline" };
    const {
      op: _op, args: _args, receipt: _receipt, validator: _validator,
      readTime: _readTime, clockPlanHash: _clockPlanHash, needsFactProofs: _needsFactProofs,
      deliveredAt, ...answer
    } = held;
    return { ...answer, live: false, connection: "offline", stale: { since: deliveredAt } };
  }
```

That object is the public `QueryResult` whenever `client.query` uses
`answerOffline` rather than `accept`+`wireQuery`:

- hydrating session with a token (`client.ts:217-221`)
- incomplete startup with a held principal (`client.ts:223-226`)
- `forcedOffline` (`client.ts:229-231`)
- retryable transport fallback after three attempts (`client.ts:265-267`)
- live/subscription offline frames that call `answerOffline`

A denied protocol envelope with `next: null` (legal) or `next: "<cursor>"`
(legal at decode, omitted by `accept`) therefore reappears on the public
offline result. `Object.hasOwn(result, "next")` is true. A client that pages
when `next` is present will restart or continue a denied/partial query.
Denied `data` also survives this path; `accept` already drops it
(`offline.ts:459,477`).

`twin.evaluate` itself is clean: `E_REQUIRE` denied answers omit `next`/`data`
(`twin.ts:142`), and the `partial()` helper omits `next` (`twin.ts:108-117`).
The hole is only the **held-answer** branch of `offlineView`, which is taken
when local evaluation is missing (no program yet, hydrate fence, sealed /
superseded) or when `held.retained` forces the stored answer.

**Repro (source-bound, no execution here):**

1. Persist a protocol-1 `state: "denied"` (or `"partial"`) envelope. Decode
   requires `next`. The range store keeps it.
2. Read the same operation through `answerOffline` (`startOffline: true`, or
   query while `authState` is `hydrating` with a token and a held principal).
3. Observe `next` (and denied `data` if present) on the public result.
4. Contrast: the same held answer fed through `accept` of `{state,seq,validator}`
   then `wireQuery` omits those fields; a raw `{state:"denied", next:null}`
   without `protocol` is refused by `wireQuery`.

The new control `conditional public query states preserve denial/partial shape
and complete/capped cursors warm and cold` (`offline-store.test.ts:1322`) drives
`client.query` through a live fetch into `accept`+`wireQuery`. It does not
exercise `answerOffline`. The trailing `must not carry next` case is the
non-protocol decoder, not the held-answer projector. Tests therefore mirror the
repaired online path and miss the public offline entrypoints named above.

**Fix:** When `offlineView` projects a held answer, apply the same filters
`accept` already uses: omit `data` if `state === "denied"`; emit `next` only
for `complete`/`capped`. Optionally validate the result with the same shape
rules as `wireQuery`. Add a source-bound control that stores a protocol-1
denied/partial envelope and reads it through `answerOffline` (forced offline
and hydrating), asserting `!Object.hasOwn(result, "next")` and omitted denied
`data`, while `store.answer` may still retain private `next`.

**Attribution:** inherited projector in e1c6 `offlineView` (byte-identical
spread). R8 **introduced** the `accept` filters for conditional `unchanged`
(`offline.ts:459-460`; e1c6 still copied `held.next` whenever defined) and
added the online tests. The repair was not applied to the offline public path
that this same delta still routes through `answerOffline`. Incomplete
introduced repair of an inherited projection hole.

No P1 store/extent/coverage contradiction was identified in the frozen
sources.

## Resource bars — failed / pending (not a correctness waiver)

These remain explicit. Correctness `NEEDS_CHANGES` does not imply they would
pass after the projection fix, and a later correctness READY would still not
imply landing.

| Bar | Frozen evidence | Status |
| --- | --- | --- |
| Complete five-root gzip | `r8-coverage-atomicity-final-measure.log`: 222224 minified / **72555 gzip**, ceiling 66000, target 64000, **6555 over**. Bundle inputs list the same 48 physical sources + `<stdin>`. | **FAIL** |
| Prior stage sizes | 4e927 72199; 02a5 72229 (+30); 4fb 72367 (+138). All failed. | FAIL (historical) |
| Original movement 10s | R8 `store-r8-final-movement.log`: 10 pass / 1 cancel, 10026.4675ms. Carrier `r8-transaction-preparation-movement-original10s.log`: 22 pass / 1 cancel, 10026.907ms on the **pre-refusal-order** candidate, not final 4fb/47a7 source. | **FAIL**; keep graph attribution |
| 120s exploration | 43/43 at 23.819s. Not original qualification. | not a pass |
| Resident / 10k paginated format5 | No current realistic 10k ordinary paginated-format5 resident result. Historical primary 10k row-only/privateformat2/empty-range RSS+383.8MB, heap+93.3MB, ArrayBuffers+42.8MB is a different boundary. 100k index-only ~291MB is separate; do not sum. Fresh resident fixture preparation is external/parallel after freeze and is not reviewed executable evidence. | **pending** |
| Cap 524286 | Pass was a byte-identical test-setup allocation repair only. No untouched-test or product-performance claim. | not a product pass |
| Direct Bun indexed | No per-file deadline. Any captured Node 10000ms adapter was new, not historical original. Final public 4/4 used original 10000ms. | as recorded |
| Ownership/preparation probes | Reachability/count and serialized-state observations, not total resident/latency proof. Carrier seven checkpoint strings and 114 slots matched in a bounded 3-image/8-frame witness. | not resident proof |

Existing drain/main epoch-adoption changes are deliberately not in this frozen
lane.

## What the full e1c6→47a7 delta does get right

Reviewed against session-delegated contracts (Unicode 17 NFC(simplefold(NFC)),
independent certified Q, 4N, 524288 combined slots, private format 5, ordinary
and timed closed extents, v5 identities
`i53-codepoint-bytes-unicode-search-text-refinements-v5` /
`bounded-spike-rust-search-text-refinements-4`) and native 26c9
(`packet/native/source`, owner SHA
`4d0f8f0176921b56305e9969da0fcb2dd5ecedae1f65d983f537e613d0c6e46e`).

**Closed-extent custody.** Scoped nonmembership is distinct from global
primary absence/tombstone. `FactTransaction.close` / `check` refuse
same-sequence images inside a closed extent even when the ID was never held.
Later compatible outside images are accepted; a later movement cannot erase an
earlier applicable contradiction. Ordinary complete ranges share that all-ID
protection. Halo IDs sit in `present`; Limit first/last are min/max of pooled
member suffixes, not reconstructed from moved current rows. Typed prefix /
bounds / Limit endpoints use issuing-pool evidence (`CarrierIndex.prepare` +
`heldSuffix`).

**No all-history scan.** Incoming matching uses exact-sequence partitioned
postings (`FactIndex`, namespace seq vs live `-1`) and prefix/token/interval
buckets (`ExtentIndex.overlapping`). Reverse maps are per meaning / mask
cause. `TwinStore.row` replays only that row's FIFO overlay contributions.

**Format 5 and old-format refusal.** Numeric `rowFacts` values are primary
absences including zero; tuples are positive seq/digest. Missing marker on
ordinary no-clock stores infers format 5 and keeps history; formats 0/2/3/4
and timed/legacy-guard snapshots reset coverage atomically while preserving
outbox/seal (`range-store.ts:501-502,616-624`;
`store-review.test.ts:928-955`). `projectState` omits `factFormat` from
`emptyState` defaults so a missing marker is not silently relabeled
(`projection.ts:84-85`). Failed format reset leaves durable bytes untouched.

**Clocks.** Seq-first, then strictly newer `readTime` at equal seq and matching
plan hash. Older clock is stale; equal-clock different fingerprint refuses.
Clock-only omission is not revocation; watermark/overlay-miss accounting
ignores clock-only swaps. Guards still constrain incoming durable assertions.
Ordinary-before-timed missing proofs request one authenticated FULL
(`FullRevalidationRequired`); repeated exhausted recovery refuses in the
atomic swap via `factLimitReset` identity (`offline.ts:831-838`,
`range-store.ts:838-840`). No whole-snapshot `resetClock` reread.

**Receipt ownership and coverage replacement (02a5 + 47a7).** ClientStore no
longer retains a full ClosureReceipt map. Per-owner absence identities are
`Set`-deduped after `wireJson` validation, before old-owner removal
(`coverage.ts:110-113`). Verdict duplicate multiplicities and allow/deny
disagreement counts are unchanged. `rehydrate` prevalidates rows, pool/halo,
issuing Q, verdicts, and absence values; journals row application; withholds
directory objects until final facts/rows; rolls back the old facts root on
failure (`store.ts:75-101`). Nested rehydrate during a prediction journal
throws first. Last-owner GC reclaims directory collections; the reachability
witness does not keep a second full receipt body.

**Transaction preparation (4fb).** One `PreparedImage` per distinct body;
`register` still prepares-and-registers each row in order (restores E_SCHEMA
on the first image). Delivery frames are created in original preflight order.
Ordinary absence/verdict payload validation stays lazy, including skipped
stale ordinary frames. No prepared image/frame is stored on the carrier root.

**Words / Unicode.** Null → `[]`. Optional null fields produce no index words.
Single-token validation counts occurrences before dedup (`searchQueryToken`).
Words charges shared `searchWordWork` (`runner.ts:456-460`). Native
`unicode_words` uses scalar count as the bound; twin uses UTF-16
`source.length` as `sourceMax`. Output/null semantics match 26c9; scratch
bytes are not claimed identical (see Uncertainties).

**Resume / denied online path / current authority.**
`ensureAuthority` throws the published `E_AUTH_SUPERSEDED`
(`client.ts:1442-1454`). Abort keeps `AbortError` without a delivery refusal.
Online `accept`+`wireQuery` omitted-next shape is tested.

**Slot accounting.** 524288 combined logical slots: guards, proof refs,
missing-proof markers, image/extent records and their index/word/bound
payloads, active and inactive scoped masks. Runtime index memory is extra
resident cost, not a byte-per-slot claim. 1M steps / 4MiB closure / 8MiB
execution heap / 1MiB output and Exact 2 deferral are unchanged.

**v5 / native 26c9.** Twin `normalizeArgType` rejects present Arg
`format: null` (not handle/url). Native `deserialize_text_format` rejects
non-handle/url including JSON null. Constraint `format: null` is omitted.
ColumnType.Text has only `max`; extra fields are an identity-fence refusal on
the twin hasher, not silent drop. Identities fence trusted custody.

## Uncertainties

- **Words scratch vs native.** Native `unicode_words` adds `source.len()`
  (UTF-8) and `HashSet`/`Vec` capacities; twin `searchWordWork` uses
  `2*(source.length + text.length + outputUnits) + 96*words.size + 128`.
  Certificate `derived_scratch_bytes` is native-priced. No astral Words
  metering comparison was executed here. Output tokens for the frozen
  `search.tokenize` fixture are not in doubt.
- **ColumnType JSON `format: null`.** Native serde ignores unknown
  ColumnType.Text fields; twin `pick`/`known` throws `E_SCHEMA`. Conservative
  (refuses rather than hashing two shapes equal). Compiler 26c9 schemas do
  not emit that field. Not treated as an admitted contradiction.
- **`factImageId` is `table + body digest`.** Distinct row IDs with identical
  canonical bodies (id omitted from `row`) would collide in
  `FactTransaction.prepare`. Native/tagged rows include `id`. No public
  admitted path shown.
- **CoverageIndex Exhausted + lost members.** `quality` still marks Exhausted
  pages exact when members moved but `evicted_ids` is empty
  (`coverage.ts:166`). Completeness is span/endpoint based; range-store
  extents own all-ID admission. Inherited from e1c6. Not scored as a durable
  fact bug.
- No product tests, native rebuild, or probes were run in this review.

## Checks performed

Source-only. No subagents. No sibling/prior reviewer reports (`astra/`
unread). No product or snapshot edits. No size/movement/cap/full-suite/native
rebuild/heavy population/memory/remote checks.

- Read `packet/context.md`, AGENTS/RULES/NOT-DOING, LLP 1000/1001/1012
  indexed-held-search, contracts, native 26c9 ArgType/Words/ColumnType,
  full current store/evaluator/client sources named by the delta, and the
  e1c6 counterparts for `coverage.ts` / `offline.ts` accept+offlineView.
- Read stage handoffs and logs as evidence, not as a second review.
- SHA-256 of frozen packet bytes (match stage receipts where those files were
  the stage output):

| File | sha256 |
| --- | --- |
| `evaluator/src/coverage.ts` | `0144dc627632cce23acc838b7951aa87c6e6b56425b3cc9dcd4255ac772d1e02` |
| `evaluator/src/store.ts` | `1b85895fdbee4ea5d15347d3794ee938241fc7e3e8582dcabf76aefa085929d9` |
| `evaluator/src/test-indexed.ts` | `7cc3705f7773a71427e5d1f36a242e56b2124d4e4b5413d2c36cd1d3b1b51767` |
| `snapback2/src/offline.ts` | `40cd03c9f6a0edb2f76ab3225c4e13f0321f7eaaa9561ff8ab0d354ac642ded9` |
| `store/range-store.ts` | `920c489a931713c538b700f02e059ac72e38caf3f2f4ea98b3df618db3f00a56` |
| `store/fact-integrity.ts` | `877f9fe773d3173a5ebab58dd1683187227a706b35b8ccbd77945f09c72be9cc` |
| `store/carrier-index.ts` | `55a086697e62e398945509eb47e4af8b127772f7fc6a810f4ca1037542e84a6a` |
| `store/projection.ts` | `a1b0d838be15637150772607e5b0a70da46245270736ca2405337de54a057b7e` |
| `snapback2/src/client.ts` | `731a9969526357d53a18b9e3adec23bb74b0064076d7255c33469f876e995a3f` |
| `packet/manifest.json` | `2347dc10a76ebec5d5475aab63517e123d58810b1d93aee1f7ad997d586f7201` |
| `packet/delta.patch` | `3d6f06ff3a144c3f4730d78590f1546904e994cac88ca24016a8d20bffc99aae` |
| `packet/context.md` | `791c63fa55cbcc05fac526c4e63527e8b163fc9581d79d7da71bed48986d6006` |

## Provenance

- Packet base `e1c6e2b79a9e13ceb363f647f52807218aa2b57a`, commit
  `47a7f491a7d7f3b3abd976f2767bf2856a5baf68`, created
  2026-09-06T23:58:41.718266+00:00. `packet/source` is that commit;
  `packet/before` is e1c6; `delta.patch` is the exact Git delta;
  `changed-paths.txt` is the 23-path full delta.
- Native bind: commit `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`, owner
  executable SHA `4d0f8f0176921b56305e9969da0fcb2dd5ecedae1f65d983f537e613d0c6e46e`
  (`packet/native/artifact-inventory.json` `snapback2-owner`).
- Stage checkpoints: coverage-atomicity source checkpoint SHA
  `9c1f65575bb8c2ec6ead153af8d91d27336875fa835d4259899e6e95e7fa218c`;
  4fb source checkpoint `603da9e75e4a14255632924dad866217324e99ca7e7259c78670cb29740ba8b4`;
  02a5 `1964f61c12d4c3c347d93bebcb09c2a19900b788e1ee0b456b5edbb5f1786cd2`.
- Muse ultra was unavailable per Root; no substitute is claimed.
- This reviewer is one of two mutually blind native-family reviewers. No peer
  report was read.

## Structural notes (not a size waiver)

`range-store.ts` is 1435 caps-compatible lines. `applyCoverage` already owns
admission; further extraction of frame/image types would have to keep
preflight order, lazy ordinary validation, journal COW, and
`CarrierIndex` lifetime identical or it will reintroduce the 4fb
refusal-order regression. Deduplicating `offlineView` against `accept`'s
denied/partial filters is the cheap correctness consolidation (Finding 1);
it is not a gzip strategy. No speculative ceiling increase.
