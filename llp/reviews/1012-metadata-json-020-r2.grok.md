# Metadata JSON projection and 0.0.20 — round2 grok review

**Date:** 2026-09-08
**Target:** `a826919984a91358aeeb6d2f8418b4684dc49da6`
**Baseline:** `d19d9399ec07c0dd3b5ec14974259f382636dc6e`
**Reviewer:** fresh grok-4.6-build / xhigh session `01a08044-91f4-7ff3-8e65-c8a11e6f5144`
**Method:** read-only exact-object inspection; no product execution

**READY** for frozen source `a826919984a91358aeeb6d2f8418b4684dc49da6` versus baseline `d19d9399ec07c0dd3b5ec14974259f382636dc6e`.

No confirmed product, test, version, or LLP 1012 §4 defects in that exact delta. The source implements the stated JSON-split invariants for native JSON metadata without adding extra product requirements.

## What this delta does

The candidate is the baseline plus seven commits. Merge-base is the baseline itself. Product/test blobs in this candidate match cherry-pick `cbad134ee` and author `dbe155bc` exactly (`metadata.ts` `7ed8bd2c`, `projection.ts` `b0e17b61`, `sqlite.test.ts` `2c425064`). The tip commit only states the §4 paragraph. Version metadata on this branch is already `0.0.20`; author’s standalone commit still had `0.0.19`.

`projectMetadata` now JSON-canonicalizes values before the split (`jsonValue` at `metadata.ts:15-17`). Object roots omit undefined children; array slots persist as null; array length is a split child so the header stays `[]`. Restore reapplies children with `own()` so `__proto__` stays an own property, then fills holes (`metadata.ts:82-101`). Journaled clock/outbox updates rewrite that header without walking untouched array children (`metadata.ts:31-49`, `50-58`). `ProjectionCache.put` now removes an owned key whose `JSON.stringify` is `undefined` instead of calling `JSON.parse(undefined)` (`projection.ts:41-43`). Cargo/npm/Bun versions move `0.0.19` → `0.0.20` only.

## Confirmed defects

None in the requested product/test/version/constraint surface.

## Assessment of the requested concerns

**Object omission.** `jsonValue` treats a failed stringify as absent for objects and as `null` for array items (`metadata.ts:15-17`). Journaled missing/undefined object children go to `removed` (`metadata.ts:73-75`). Direct replacement still diffs owned keys in `compare` (`projection.ts:47-50`, `63-64`). Tests assert `remove` is gone after both paths (`sqlite.test.ts:446`).

**Root vs child normalization.** Full replace and `*` roots stringify once and reuse `rootJson` (`metadata.ts:31-35`, `54-55`). Child journals iterate only named keys (`metadata.ts:58`). That matches LLP 1012 §4: “Full or explicitly changed roots normalize once; child journals visit only their named values.”

**Sparse arrays, length, growth, shrink.** Header stores `[]`, not `Array(n).fill(null)` (`metadata.ts:38`). Length is `JSON.stringify([field,'length'])` (`metadata.ts:39-41`, `61-62`). Index writes refresh length without a root journal entry (`metadata.ts:59-62`). Shrink deletes owned numeric keys `>=` the new length (`metadata.ts:66-71`). Restore sets `parent.length` then fills holes (`metadata.ts:91`, `97-99`). Direct and journaled tests cover trailing holes, all-hole arrays, growth including implicit growth after a length-only record, and shrink (`sqlite.test.ts:392-464`).

**Special own JSON names.** `own()` uses `defineProperty` for `__proto__` (`metadata.ts:7-9`). Restore uses the same helper (`metadata.ts:94-95`). The coercion test checks own `__proto__` at root, child, and nested child, and that prototypes stay `Object.prototype` (`sqlite.test.ts:518-534`).

**Direct vs journaled.** Direct is `changed === undefined` → full `metadata(state)` plus `compare`. Journaled is `metadataChanges` plus named keys only. Both carriers are exercised, including abort then retry (`sqlite.test.ts:392-478`).

**Changed-record bound (clock/outbox beside an untouched array).** For journaled `*` that does not include the array, the header still writes `[]` and does not re-put length if already owned (`metadata.ts:34-41`). Child fields come only from the journal (`metadata.ts:50-58`). The sparse-header test writes `Array(8192)`, then journals only `clock` and `outbox.routine`, and asserts the `state` row stays under 4096 bytes with no `metadata` write whose key contains `futureSparse` (`sqlite.test.ts:480-505`). SQLite `replace` prepares the delta before the transaction and calls `committed()` only after success (`sqlite.ts:105-131`). IndexedDB prepares before the readwrite transaction (`indexeddb.ts:169-171`).

**Key-only committed ownership.** `ProjectionCache` still stores keys only; `MetadataKeys` is unchanged (`projection.ts:21-26`, `metadata.ts:104-120`). Abort tests compare `projection.keys.meta` before and after refusal (`sqlite.test.ts:431-437`).

**Old persisted split layouts.** Unsplit keys (`key !== "state"` and not starting with `[`) keep `legacyMetadata` and take the full `compare` path, then clear the flag after commit (`projection.ts:29`, `63-71`). Split children without a length record restore as they did before: length is max assigned index + 1; trailing holes stay lost. A later header rewrite can add a length child when `!owned.has(length)` (`metadata.ts:41`). That is dual-read of current on-disk shapes, not a compatibility shim.

**Refusal, retry, cold restore, unrelated bytes/outbox.** The helper aborts with `beforeCommit` / `beforeReplace`, checks ownership and prior state, then retries (`sqlite.test.ts:432-456`). Old byte `old-byte` survives abort; `new-byte` does not. Outbox equality is asserted. The clock test also checks `outbox.routine` after reopen.

**Versions.** `snapback2/Cargo.toml` workspace `0.0.20`; all four `Cargo.lock` packages; `packages/snapback2/package.json` plus optional `snapback2-darwin-arm64` / `snapback2-linux-x64`; matching `bun.lock`. Member crates keep `version.workspace = true`. No other lock churn.

**LLP 1012 §4.** The new paragraph at lines 322-332 matches this source: JSON form before split, `[]` headers, length as a child, `__proto__` as own data, prepare-before-publish, abort preserves keys/metadata/bytes/outbox, cache holds key presence. `@ref LLP 1012#4-the-range-store` on `metadata.ts:1` and `sqlite.test.ts:471` points at that heading.

## Hypotheses (not scored as defects)

1. **Restore is one-pass and order-sensitive for inconsistent keys.** `restoreMetadata` applies any numeric index `< 2**32-1`, then later `length` truncates (`metadata.ts:90-94`). IndexedDB `getAll()` is key-ordered; `"length"` sorts after numeric index strings, so length lands last. SQLite `SELECT` has no `ORDER BY` (`sqlite.ts:85-86`). For consistent snapshots (no stored index `>=` length) either order still restores. This would matter only for corrupt mixed keys.

2. **Full root persist of `Array(n)` still writes `n` null children.** `jsonValue` densifies holes before `Object.keys` (`metadata.ts:15-17`, `58`). LLP 1012 §4 requires a constant-size header and that unrelated clock/outbox updates not serialize array payload. It does not require compact storage of a full-root sparse array. The clock test measures the later journaled write, not the initial replace.

3. **Untouched non-JSON live roots during a header rewrite.** Clock/outbox rewrites classify untouched containers with live `typeof` / `Array.isArray` (`metadata.ts:34-38`) so they do not stringify an 8192-slot array. `Date`, boxed primitives, and `toJSON` objects that are **not** in `*` can still be stored as `{}` in that header. Baseline already classified `typeof === 'object'` that way. Direct/`*` paths now coerce via `jsonValue`, which is why the Date/`toJSON` test can pass (`sqlite.test.ts:509-548`). Production metadata is native JSON (`row-image.ts` image-state comment; `emptyState` / `sqliteState` fields are numbers, strings, plain objects, null). PersistentRangeStore also `jsonState`s on open.

4. **`JSON.stringify` returning `undefined` now deletes an owned row/answer/outbox/meta key** (`projection.ts:41-43`) instead of throwing in `JSON.parse`. For this metadata work that is the JSON-omission path. I did not find a production value that stringifies to `undefined` on those maps.

## Inherited / unrelated

- Same `typeof === 'object'` header classification for untouched values as baseline `metadata.ts`.
- File carrier still full-rewrites via `projectState`; not in this delta; §4’s bound is SQLite/IndexedDB.
- IndexedDB cases use `FakeIndexedDb`, as before.
- Ancestry also touches issue ticket text, a closed-ticket path in LLP 1010, `metrics/loop.jsonl`, and `benchmarks/runs/2026-09-08-release-cold-headroom/`. Those are outside the product/test/version/§4 claim. Benchmark bodies were not read.

## Inspected vs not executed

**Inspected (git objects only):** `a826919` vs `d19d939` name-status; product diffs for `metadata.ts`, `projection.ts`, `sqlite.test.ts`; version diffs for `Cargo.toml`, `Cargo.lock`, `package.json`, `bun.lock`; LLP 1012 §4 on both commits; `@ref` callees `sqlite.ts`, `indexeddb.ts`, `range-store.ts` (`preparedProjection` replace, `emptyState`), `canonical.ts` `jsonState`, `swap-journal.ts` `ChangedRecords`, `row-image.ts` `imageState`; blob identity with `dbe155bc` / `cbad134ee`; Snapback2 `AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`.

**Not executed / not read:** builds, tests, probes, Node 22/24 runs, canonical suite, runtime size, publisher; working tree; `llp/reviews/`, `.llp/`, benchmark run-record bodies; builder apps, diaries, transcripts, self-scores; other models; network/SSH/worktrees/clones. Author-reported 10/10 focused, 27/27 sqlite, 2/2 outbox on Node 22.23.2 is treated as reported, not reproduced. Root’s Node 24 / full-suite / size / publisher qualification remains pending as stated.

## Root adjudication

Overall candidate rejected for publication. Root accepts Sol’s key-sensitive
`toJSON` and unchanged coerced-root header findings. Grok’s READY verdict and
its narrower native-JSON interpretation are retained, but the candidate’s
explicit coercion support makes the sequential-write counterexample in scope.
The third revision must preserve named normalization and durable root shape
without retaining another payload baseline or walking untouched metadata.
