# REVIEW REPORT

**Verdict: NEEDS_CHANGES**

Frozen candidate `fca223284a3a20cc9aa557ff75e87259d9d94337` (direct base `36feaacc9c5bf2ccede2623653252e67c0152f26`, 26 paths; cumulative R8 base `e1c6e2b79a9e13ceb363f647f52807218aa2b57a`, includes `4e927`). Packet `manifest.json` SHA-256 `59a600fe535fd21e095276f5b29fd2c41cab5f804805bd30298b76d89541309e` verified. No prior/peer review or author narrative was used. This is a correctness/ownership verdict on the frozen client/evaluator execution graph. It is not a landing, size, phone, or publication clearance.

The known equal-body raw counterexample is not waived. The measured `74243` gzip / `227321` minified five-root runtime remains an explicit gate **FAIL** (`8243` over the `66000` gzip ceiling). Latest resident / full-system qualification is pending and was not re-run.

---

## Finding 1 — Severity: ownership / representation (blocking)

- **File:** `snapback2/packages/snapback2/src/store/range-store.ts:1262` (install), with `snapback2/packages/snapback2/src/offline-protocol.ts:247-259` (new image), `snapback2/packages/snapback2/src/store/fact-integrity.ts:99-107` (digest-keyed prepare), `snapback2/packages/snapback2/src/twin-store.ts:155-166` (effective skip)
- **Status:** open
- **Inherited vs introduced:** **Introduced** by this representation work (direct `36fea` → `fca223`). `36fea` always `clone(row)` into the current slot (JSON, no branded current identity). This candidate adds typed `RowImage` current and preserves the *incoming prepared* object (`{ ...row }` when branded) instead of reusing the *existing current* object when the body is unchanged.
- **Contract:** exactly one immutable typed or opaque current image per current slot; unmodified effective rows must share that actual current image across built carrier/client arms. Overlay finals own changed bodies. Historical keys are body-free.

### What happens

Checked admission always allocates a new `RowImage` from the envelope wire:

```247:259:snapback2/packages/snapback2/src/offline-protocol.ts
export function prepareClosureReceipt(...): EvaluatorClosureReceipt {
  ...
  return { schema_hash: decoded.schemaHash, rows: decoded.rows.map(row => ({ table: row.table,id: row.id,
    row: prepareWireRow(schema,row.table,row.row,actualSchemaHash) })), ...tagReceipt(...) };
}
```

`OfflineRuntime` attaches those objects as `preparedDeliveryRows`. `PersistentRangeStore.commit` copies the wrappers onto the normalized delivery (`range-store.ts:780-785`). Current-slot install then always writes that incoming row when `rowSeq` is not newer:

```1262:1263:snapback2/packages/snapback2/src/store/range-store.ts
        state.rows[storageKey] = RowImage.is(row.row) ? { ...row } : clone(row);
        state.rowSeq[storageKey] = delivery.seq;
```

There is a same-seq canonical conflict check (`1256-1258`) and a *newer* current skip (`1260`). There is **no** equal-digest reuse of the already-installed current `RowImage`.

`FactTransaction.prepare` keys swap-local images by `table\0digest` and will accept a second physical row of equal canonical body (`fact-integrity.ts:99-107`). Preflight `register(delivery.rows)` runs **before** `versions()` seeds the live current (`range-store.ts:1156` then `1189`). Equal-body later FULL therefore intern-hits the *incoming* prepared image, not the existing current. Independently, install assigns `delivery.rows[offset]`, not `PreparedImage.row`.

Twin hydration uses `preparedChanges` (same branded objects, no retag). `TwinStore.row()` then:

```155:166:snapback2/packages/snapback2/src/twin-store.ts
    const prior = this.store.byId(table,id);
    const value = effective && prepareWireRow(...);
    const changed = prior !== value && canonicalJson(imageWire(prior) ?? null) !== canonicalJson(imageWire(value) ?? null);
    ...
    if (!changed) return false;
```

Canonical-equal means the ClientStore keeps the previous image. Carrier current is the new object. Keys are rebound onto the existing `factImages` `ImageKeys` (`carrier-index.ts:59-63`), so keys share and digests match.

### Repro / evidence

Packet `evidence/equal-image-witness/` is the source-bound diagnostic (not an ownership pass):

| Field | Value |
|---|---|
| nativeAttribution | actual native26c9 initial frame; synthetic equal-body seq/readTime successor through checked admission |
| initialShared | true |
| afterShared | **false** |
| currentChanged | true |
| effectiveUnchanged | true |
| canonicalEqual | true |
| keysShared | true |
| rows / factSlots | 11 / 106 |
| probe exit | 0 (observations only) |
| productSourceChanged | false |

Probe (`probe.mjs`): `OfflineRuntime` + `PersistentRangeStore` json carrier; commit `halo.first`; hydrate; clone frame with `seq++`, `readTime++`, new validator, `data.now` updated (body otherwise equal); commit; hydrate; compare `runtime.store.state.rows[key].row` vs `held.byId`. Launch: Node 22.23.2, ~2.33s, 15s outer diagnostic deadline. Result SHA `297322b22ee3c62730da635d8ea486bd8f1eea272a668ea7c9d6d79052190746`.

This reviewer did not re-execute that probe (no build/native/heavy rerun authorized; the frozen result plus the install path above are sufficient).

### Impact

- Ownership: two live typed current/effective bodies for one slot after equal-body newer FULL. Violates “one current image per slot” and “unmodified effective shares actual current.”
- Query/wire: not shown. Canonical equal, keys shared, `106` slots unchanged. Diagnostic explicitly records no public data/refusal/accounting failure.
- Memory: the extra body remains reachable from the carrier current slot and from Twin only until the next canonical change (Twin skips put). Not a global intern leak.
- Tests that **do** assert identity: initial share (`tests/twin.test.ts:1187`); refused same-seq explicit-null keeps the same ClientStore image (`tests/store-review.test.ts:1433`). Neither covers equal-body later FULL. No `afterShared` assertion exists in product tests.

### Fix

Slot-local reuse, not a strong intern registry and not a raw+typed mirror:

1. When installing a delivery row at the current slot, if `state.rows[storageKey]` already holds a `RowImage` whose `factAssertion` / digest equals the incoming body (same table/id), **keep that object**. Still advance `rowSeq`. Rebind `ImageKeys` onto the kept image if the incoming prepared keys are the canonical fact-image keys.
2. If you consult `PreparedImage`, seed the live current into `FactTransaction.prepare` **before** registering delivery rows, and assign `image.row` (the reused current) rather than the incoming wrapper.
3. Overlay field/full replacements that change canonical bytes must still allocate a new image (`TwinStore.row` already does this via `imageWire` + `prepareWireRow`).
4. Cold/opaque wire remains untyped until `[preparedChanges]`; that path already returns the same object when the slot is already branded (`RowImage.prepare` identity).
5. Add a product regression with the recorded witness shape: `afterShared === true`, `currentChanged === false` (or current === previous current), `keysShared === true`, `canonicalEqual === true`, slots unchanged. Keep the diagnostic probe as a non-pass observation until that assertion exists.

Do not add `Symbol.for` brands, a process-wide intern map, or a second typed copy beside the wire persist form.

---

## Finding 2 — Severity: suggestion (non-blocking)

- **File:** `snapback2/packages/snapback2/src/offline.ts:877-886`
- **Status:** open
- **Inherited vs introduced:** comment inherited/stale; behavior change is **introduced** in this direct delta (`offline.ts` `useLocal`).

The comment still says the twin answer is used when it is “at least as exact as the held one.” The code is:

```885:886:snapback2/packages/snapback2/src/offline.ts
  const exactHeld = held !== undefined && (held.state === "complete" || held.state === "capped");
  const useLocal = local !== undefined && !held?.retained;
```

The old `partial && data !== undefined && exactHeld` exception is gone. That is the required public projection of local partial + held halo versus stale stored capped membership, and it is the right behavior. Update the comment so it does not re-introduce the stale exactness test. Forced/hydrating/retry/subscription all call `answerOffline` → `offlineView`; `tests/offline-store.test.ts:1360-1410` covers those entrypoints for stored denied/partial/complete/capped shapes. Halo-versus-capped exactness is asserted on `twin.evaluate` (`store-review.test.ts:1318-1345`, `1382-1406`).

---

## Size (separate from correctness)

Fixed measured five-root runtime (`evidence/measurement/final-byte-attribution.json`, supervisor verification):

| | value |
|---|---|
| minified | 227321 |
| gzip (Node gzipSync level 9) | **74243** |
| ceiling / target | 66000 / 64000 |
| overage | **8243** gzip (10243 over target) |
| parent `36fea` | 223602 / 73023 (7023 over) |
| direct delta | +3719 minified / +1220 gzip |
| gate | exit 1 FAIL |
| largest new attribution | `row-image.ts` 2098 minified bytesInOutput |

This review **cannot** waive the budget or treat module-count / enumerable-graph reduction as memory or gzip savings. Attribution bytes are not additive gzip. No consolidation is proposed: any later cut needs a source-backed removal with semantic cost, not an invented closure.

Historical gzip failures (`36fea` 73023, `cb578` 72709, `47a772` 555, `4fb7` 2367, `02a5` 72229, `4e927` 72199) remain failed. This candidate is not a size landing.

---

## Whole-graph coverage (what was checked)

Read packet `source/` (not a moving worktree). Compared `direct-delta.patch` (26 paths) and `cumulative-r8-delta.patch` (R8 from `e1c6`, including `4e927` files). `4e927` is **not** treated as a trusted qualification of search/native.

### Representation / identity

- `RowImage` / `ImageKeys`: private `#schema/#table/#omitted/#keys/#digest`, prototype `Object.prototype`, freeze, brand via private fields not `instanceof` / `Symbol.for`. `prepare` isolates untrusted input (`clone`) and reconstructs across schema via `tagged()` (omissions preserved). Map does not materialize optionals; Row optionals materialize `Null` for execution; `wire`/`tagged` restore sparse omission vs explicit null. Digest uses `imageCanonical` after `imageWire`.
- One nominal module: `image-runtime.ts` + `build.mjs` shared-image-runtime plugin. Public packaging audit: one row-image/error/Unicode-data module per public arm. Measurement five-root entry inlines the same sources (`final-entry.ts` / attribution). Test `twin.test.ts:1184-1193` checks separately built client + file carrier share `RowImage`/`ImageKeys`/`EvalError` and reject shallow-frozen forgeries.
- Persist boundaries use `imageState` / `imageRecord` before JSON (`range-store.replace`, projection, sqlite `beforeCommit`, indexeddb `beforeReplace`). File carrier has no `preparedProjection` and therefore receives already-wired `jsonState(imageState(state))`. Live slots stay branded; disk/json is sparse wire. Not a raw+typed current mirror.
- `[preparedChanges]` types cold/changed rows in place with `factImages` keys; `RowImage.prepare` returns the same object when already branded. Twin `isolate()` clones wrappers but keeps `RowImage`/`ImageKeys`. Swap journal `raw`/`wrap` do not proxy branded leaves.
- Historical `factImages` store `{ refs, keys? }` only (`extent-facts.ts:33`). `test-indexed.ts` asserts body-free proof reclamation. `PreparedImage.row` is swap-local and discarded.
- Intern: `HeldIndex.prepared` is a WeakMap on `ImageKeys` parts identity; `remove` drops reverse-map entries and intern when `refs` hits 0. Not a strong global intern. `CoverageIndex` does not retain the caller row pool (`clone` of range metadata; `issuedKeys` consumed during `set`).
- Overlay: field/full contributions build a new body via `imageWire` + `prepareWireRow`; Twin puts only when canonical changes. Overlay owns changed bodies.

### Coverage / extents / delayed FULL

- Issuing keys: `TwinStore.answer` prefers `factImages` keys from the answer’s `rowProofs`; ordinary pre-schema fallback requires `rowSeq === answer.nextSeq` (explicit FULL seq, never conditional seq) (`twin-store.ts:198-208`).
- Halo: missing halo is nulled if not in the admitted pool; `CoverageIndex.stop` converts exhausted→limit when the page is exact without an exhausted count (`coverage.ts:207-212`). Runner records `range.stop = store.rangeStop(...)` (`runner.ts` cumulative). Limit+halo overlay test keeps capped until native Exhausted (`store-review.test.ts:1318-1345`).
- Delayed FULL: later `clock.read` holds current bodies; intervening FULL replaces `clock.fixed` issuing keys; evaluate becomes partial with current `at` values unchanged; exact replay is a no-op; cold matches (`store-review.test.ts:1382-1406`).
- `CoverageIndex.set` skip-if-equal (direct) compares absences/verdicts/range identity/expected/lost/extent/last after `issuedKeys` ran. Row movement still updates via `changed()`.
- Same-seq body conflict, batch vs separate arrival, move-out vs same-seq contradiction, scoped extent vs global primary absence: covered by store-review timed/extent tests (`592+`, `704+`, `898+`, `1068+`, `1228+`). First source-refusal order: `1252+`.
- Typed full bounds prevalidation on empty index: `1272+`. Per-owner absence dedup / distinct owner counts: coverage absences are owner-sets; fact slots are not combined with live preparation.

### Private format 5 / slots

- `FACT_SLOT_LIMIT = 524288`, `FACT_FORMAT = 5`. `imageSlots` / `extentSlots` / `proofSlots` / missing-marker (`needsFactProofs`) charged. Sharing `ImageKeys` objects does not subtract charges. `checkFactSlots` after `integrity.finish`. No combined live-preparation + factSlots gate. Legacy missing `factFormat` preserved (`projection.ts:83-85`, tests `928+`, `957+`).
- Two cold/open/recovery cycles, outbox, concurrency, marker saturation: tests `508+`, `537+`. Review did not re-run those tests.

### Unicode / search

- Contract `u17-nfc-scf-nfc-wsp-p`. NFC, simple fold, NFC. `searchQueryToken` counts tokens before dedup and rejects a second word; empty → `null`. Null field sources emit no tokens (`unicode.ts:233-252`). `searchWordWork` charges Words builtin (cumulative `runner.ts`). 4N / 8-component index shape rejected in `HeldIndex` constructor. Q from issuing scan `source_max` (`search-key.ts:49-64`, `coverage.prepareRange`). No truncation/hash-collision shortcuts in the typed path.
- Native packet `26c9fd5e…` is reference only. No native rebuild. Native initial vs synthetic successors are distinguished in tests and in the equal-image probe. A reachable admitted immutable contradiction would be material even if native would not emit it; the equal-body successor is synthetic and admitted, and the defect is ownership of equal bodies, not a digest contradiction.

### Public / offline projection

- `answerOffline` evaluates unless `held.retained`. `offlineView` now prefers any local answer except retained view-once. Forced offline, hydrating token restore, retry, and subscribe all use that function (`client.ts` query/subscribe/`onError`). Ordinary/auth/cursor/readable delivered-history and partial-membership behavior is otherwise preserved in the tests listed above. Source-unavailable derived Q stays fail-closed (`prepareRange` / `SearchInputError` → `E_INPUT`).
- Old private-format refusal preserves outbox/seal (`store-review.test.ts:928+`). Ordinary conditional intersecting timed guards without immutable proof requests one authenticated FULL (`423+`, `561+`). Clock: seq first, then strictly newer equal-seq clock; equal-clock exact replay / older clock stale (`383+`, `492+`).

### Caps / file size

- No source file over 1500 lines. Closest: `client.ts` 1499, `range-store.ts` 1476, `offline-store.test.ts` 1472, `twin.test.ts` 1462, `store-review.test.ts` 1442. No new runtime generator/gate/registry. Unicode tables remain the existing generated capture.

### What tests exercise (boundaries, not implementation names)

Product tests cover: sparse omitted vs explicit null and atomic same-seq refusal; delayed FULL interior key replacement; Limit+halo vs Exhausted; issuing-key custody after movement; identity share on **initial** hydrate and on **refused** same-seq; overlay/purged history; directory/reclamation; verdict disagreement; per-owner absences; empty-index bound validation; public forced/hydrating/retry/subscription stored-state projection. They do **not** assert equal-body later FULL current/effective identity. That is the known raw gap.

---

## Uncertainties (not findings)

- Did not re-run store/twin/public/cap/movement/fullsuite, gzip, resident, or native. Linux EPYC scoped passes in the packet are evidence of those runs, not re-verified here, and do not erase prior Mac/other-source failures.
- `CoverageIndex.quality` treats `lost.size <= (halo ? 1 : 0)` as still exact for Limit. Tests document one-id loss (`r9` or `halo`) as capped and two-id loss as partial. The rule does not distinguish first vs last member. Not flagged as a defect given those tests.
- `HeldIndex` intern is identity-based on `ImageKeys` parts arrays. Without key sharing, intern misses (extra allocation, not a leak). Equal-body witness has `keysShared: true`.
- File carrier `open` runs `unprojectState(projectState(JSON.parse(...)))` on already-wired bytes. Harmless; live branding still happens in `[preparedChanges]`.
- Public Client tests of halo-versus-capped go through `offlineView` rather than a dedicated Client×halo matrix; the function is shared.
- Cumulative `client.ts` resume path now `throw refusal` after recording `resetRefusal` instead of falling through to `throw error`. Looks like typed-refusal surfacing; not re-probed.
- No claim that historical `02a5`/`4fb`/`47a7` Twin memory numbers describe this graph.

---

## Checks actually performed

- Read `../packet/context.md` in full.
- Verified `manifest.json` SHA-256 `59a600fe535fd21e095276f5b29fd2c41cab5f804805bd30298b76d89541309e`.
- Read AGENTS / RULES / NOT-DOING, LLP 1000, LLP 1012 indexed-held-search, root contracts.
- Read frozen `source/` execution-graph modules listed in direct and cumulative path lists (row-image, store, index-store, coverage, runner/unicode as needed, image-runtime, offline-protocol, offline, twin, twin-store, twin-hydrate, range-store, fact-integrity, carrier-index, fact-index, extent-index, extent-facts, projection, sqlite, indexeddb, file, swap-journal, byte-cache, asset-policy, canonical, client query/subscribe/offlineView, build.mjs, tests cited above).
- Read `direct-delta.patch` and `cumulative-r8-delta.patch` (not only changed lines).
- Read equal-image witness, measurement attribution, byte-delta, public-packaging-audit, typed-refusal oracle note, sparse-derivative custody, r3-raw-probe run metadata (inputs/outputs as evidence, no prior verdict).
- Line counts on key sources (all ≤ 1500).
- No source edits, no dependency install, no build, no native, no remote, no size/cap/movement/fullsuite rerun, no subagents, no sibling/prior reviews, no moving worktree, no descendant author/benchmark lanes.

---

## Explicit non-claims

This review is not a landing waiver, size waiver, phone qualification, publication clearance, or native-search qualification. `74243` gzip FAIL remains. Equal-body `afterShared: false` remains a blocking ownership gap. Latest resident and full-system qualification remain pending.
