# Metadata JSON projection and 0.0.20 — round3 grok review

**Date:** 2026-09-08
**Target:** `ce7f9b00b04095823e8a5a619c77fc90c840d615`
**Baseline:** `d19d9399ec07c0dd3b5ec14974259f382636dc6e`
**Reviewer:** fresh grok-4.6-build / xhigh session `01a0807d-bf98-7573-9e3c-feed8f7d8797`
**Method:** read-only exact-object inspection; no product execution

**CHANGES REQUIRED** for `ce7f9b00b04095823e8a5a619c77fc90c840d615` vs `d19d9399ec07c0dd3b5ec14974259f382636dc6e`.

The per-root JSON split, journal promotion, special names, sparse length, keys-only cache, 0.0.19 *upgrade* migration, abort/retry, and 0.0.20 version pins are internally consistent with LLP 1012 §4. The publication fail-closed claim is not: a journaled 0.0.20 store need not persist the only 0.0.19 admission canary.

I inspected frozen git objects only (no working tree, no builds/tests/probes, no network, no agents). Reported sqlite 39/39, outbox 2/2, and published-0.0.19 refusal are treated as reported, not reproduced.

---

## Confirmed introduced defect

### 1. Published 0.0.19 does not fail-closed on the ordinary 0.0.20 write path

LLP 1012 §4 says the published 0.0.19 reader refuses the new layout through unsupported-format admission, with no new schema/version tag. Baseline admission is only this check:

```468:470:snapback2/packages/snapback2/src/store/range-store.ts
  if (value.version !== 1 || typeof value.rows !== "object" || typeof value.answers !== "object") {
    throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "range store contains an unsupported format");
  }
```

0.0.19 `restoreMetadata` treats every bracket key as a two-tuple. A new length-1 root such as `["version"]` becomes `version[undefined] = 1`, i.e. `{ undefined: 1 }`, which would trip `version !== 1`. That canary only exists if `["version"]` is actually stored.

It is not stored on the production commit path:

- `PersistentRangeStore.commit` always passes a `SwapJournal` (`range-store.ts` ~783–788).
- `metadataChanges` projects only journaled fields (`metadata.ts` 32–36). `version` is never assigned in `range-store.ts`.
- First persist on an empty `ProjectionCache` only adds the constant `state: {}` header when `!owned.has('state')` (`metadata.ts` 33), not `["version"]`.
- `rows` / `answers` still come from their tables in `unprojectState`, so they stay objects.
- 0.0.19 `unprojectState` spreads `emptyState()` after stripping `factFormat`, so a missing `version` record becomes `version: 1` and **admission succeeds**.

What 0.0.19 then does with length-1 scalars is silent misparse, not refusal. `["clock"]` (written on every outbox/clock swap) becomes `{ undefined: n }`. Later `++state.clock` on that object is `NaN`. That is worse than fail-closed.

In-tree tests never restore the new layout with 0.0.19 `restoreMetadata`. They write 0.0.20 via `backend.replace(state)` *without* a journal (`sqlite.test.ts` `exerciseMetadataJsonReplacement`, proto/keyed/root-kind/opaque/migration fixtures). That full-projection path *does* emit `["version"]` (`Object.keys(state)` includes `version`). A fixture that full-replaces will refuse under 0.0.19; a real `commit()` store need not. Treat the reported downgrade refusal as that fixture/full-replace case, not as proof of the journaled path.

**Fix:** On first new-layout persist (the same `!owned.has('state')` branch, or whenever `["version"]` is not owned), project `version` as a length-1 root through `jsonValue`. After that, leave it unrewritten so unrelated clock/outbox journals stay bounded. Do not rely on seal/unseal/legacy full compare to plant the canary.

---

## What holds (not defects)

**JSON property names.** `jsonValue` stringifies `{ [actualKey]: value }` via `own()`, so `toJSON(key)` sees the real name. Tests: `metadata passes root and child property names…`.

**Sparse arrays / split length.** Root arrays store a constant `[]` shell plus `[field,"length"]`; holes become `null` on restore; index journals refresh length; shrink journals `length` and drop owned tail indices. Direct vs journaled tests and the 8192-slot bound cover this.

**Direct vs trusted journal / callable `toJSON`.** Root journals run `jsonValue` once on the field. Child journals only normalize named values. `SwapJournal` promotes when `path.length === 1` and `current.toJSON` is callable, or when installing a function at `toJSON`; deleting a serializer still sees the old function and promotes. A non-callable `toJSON` child stays in `changed.get(field)`. Direct callers must put the boundary in `*`; that is the documented trusted-journal contract, and the opaque-root test uses `SwapJournal`.

**Special own names.** Restore uses `defineProperty` for `__proto__`. Field `state` lives at `["state"]`; reserved header key `state` is constant `{}` and is skipped in cleanup (`id !== 'state'`). Bracket field `[future]` is `["[future]"]`. Tests cover proto, reserved `state`, and `[future]`.

**Constant per-root shells / changed-record bounds.** Journaled clock+outbox does not write `futureSparse` or `INTO state`. `store-review.test.ts` expects only `["clock"]` plus the outbox entry. Cache `committed()` updates key presence only; payload-baseline test still holds.

**0.0.19 stored layouts (upgrade).** Nonempty shared headers and unbracketed plain-root keys set `legacyMetadata`; the next write uses `compare("meta", metadata(state))` on the existing table/full-replace path (no schema/version tag). Abort does not call `committed()`; retry still sees the old layout. Bytes/outbox share the same transaction. Test: `published 0.0.19 metadata layouts migrate atomically…`.

**Unrelated rows/answers/outbox/bytes.** Table loops still skip unjournaled `rows`/`answers`. Metadata `main` excludes those names. Refusal tests keep prior outbox and bytes.

**0.0.20 pins.** `snapback2/Cargo.toml`, `snapback2/packages/snapback2/package.json` (including optional native deps), and `snapback2/bun.lock` are `0.0.20`. Crates use `version.workspace = true`.

**Carriers.** SQLite and IndexedDB share `ProjectionCache`; `committed()` runs only after COMMIT / `transactionDone`. File carrier still writes one JSON document (not the split DB layout); that is existing Node-harness shape, not the published 0.0.19 reader.

Author store blobs at `bd4fcc694` and tests at `99728f490` match this source; LLP 1012 §4 is the extra integrated paragraph.

---

## Material inherited-in-scope defects

None that this delta makes worse than the new fail-closed gap above.

---

## Hypotheses (not scored as defects)

- Hole-fill `for (index = 0; index < length; index++)` on a corrupt `length` of `2**32-1` could hang/OOM on open (`metadata.ts` restore tail). Valid `Array` length setter throws on non-uint32; max uint32 does not.
- Child journals on boxed `Number`/`Boolean` (no `toJSON`) would not promote; restore can replace a scalar shell with `{}` (`restoreMetadata` `typeof parent !== 'object'`). Production commit does not do this; tests root-journal boxed values.
- Reported 0.0.19 refusal is explained by full-replace fixtures that persist `["version"]`.

---

## Unrelated inherited observations

- `snapback2/AGENTS.md` still calls LLP 1012 “Review”; the spec header is Implemented. File was not changed in this range.
- File carrier `replace` ignores journals and writes `JSON.stringify(state)`; 0.0.19 file open is a different format than the SQLite/IndexedDB split.
- `SwapJournal` still uses `current[key] =` / undo assign for `__proto__` if that write goes through the proxy; tests journal `__proto__` with a trusted `Map` after `defineProperty`.

---

## Inspected (git objects only)

| Object | Role |
|---|---|
| `llp/1012-local-first-v1.spec.md` §4 (and the §4 diff) | contract |
| `snapback2/packages/snapback2/src/store/{metadata,projection,swap-journal,sqlite,indexeddb,file,canonical,range-store}.ts` | implementation + admission |
| `snapback2/packages/snapback2/tests/{sqlite.test,sqlite-exports,store-review}.ts` | tests |
| `snapback2/{Cargo.toml,bun.lock,packages/snapback2/package.json}` and crate `version.workspace` | 0.0.20 |
| `snapback2/AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md` | unchanged; NOT-DOING 0.0.x |
| Baseline `d19d9399` `metadata.ts` / `projection.ts` / `normalizeState` | 0.0.19 restore + admission |

`snapback2/AGENTS.md`, `rules/RULES.md`, and `rules/NOT-DOING.md` have no diff in this range.

## Did not execute

Builds, tests, sqlite/IndexedDB probes, a 0.0.19 package install, publishers, runtime-size measurement, or anything on the mutable worktree. Did not read `llp/reviews/`, run records, diaries, or other model conclusions.

## Root adjudication

Candidate rejected. The canonical run separately records49 Node failures,
concentrated in database cold reopen. Root accepts Grok’s missing first-write
version-marker finding; the same incomplete initial projection omits
`factFormat`, causing current coverage to be classified as legacy and reset.
The proposed remedy must initialize all metadata roots on first publication,
not merely add a downgrade canary. A direct full-replacement downgrade
witness does not qualify the production journaled first-write path.

Sol’s older plain-root bracket-name ambiguity is inherited and outside the
released production state namespace. Root and the implementer inspected the
historical producer, closed state/StoreSwap interfaces, public exports and
version-checkpoint field sets; app-controlled keys remain nested in known
maps. The [source scope record](../../benchmarks/runs/2026-09-08-release-cold-headroom/legacy-metadata-source-scope.md)
retains that evidence and its limits. LLP1012 clarifies this scope; no heuristic
decoder is added, because literal old names can be byte-identical to tuples.
The boxed-wrapper hypothesis is outside canonical production admission,
which JSON-normalizes state before journaling; trusted direct-backend callers
must identify the complete serialization boundary. No arbitrary raw-wrapper
plus child-journal guarantee is claimed.

Three repair rounds have been exhausted. No further code repair or publication
has occurred; the user has been asked about exactly one additional bounded
round while the separate cold019 benchmark continues. Raw CLI transcripts and
process receipts remain in the private coordinating `.llp/` ledger. Process
`ended` timestamps identify supervisor-observed completion; they are not
independent timing measurements for a process that exited before it was joined.
