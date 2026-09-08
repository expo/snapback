# Metadata JSON projection and 0.0.20 — Grok review

**Date:** 2026-09-08
**Target:** `170ebacd5411bef1345845a4f141c71c57634a52`
**Baseline:** `d19d9399ec07c0dd3b5ec14974259f382636dc6e`
**Reviewer:** fresh Grok 4.6 / xhigh CLI session `01a0801b-5061-7553-9a8f-4eedd70d7b46`
**Method:** mutually blind read-only review of frozen git objects; no product execution
**Raw response SHA-256:** `4443f1768931b992b124e85c1ff55131ab98a2a677734dd02098c984ea9fa5a7`

The actual review follows, with only its progress preamble omitted. Execution
claims in the review are explicitly author-reported. Root separately ran the
combined canonical suite and full-engine production qualification.

# READY

Frozen source `170ebacd5411bef1345845a4f141c71c57634a52` vs baseline `d19d9399ec07c0dd3b5ec14974259f382636dc6e` is a sound repair of the two generic metadata JSON projection defects, plus an honest 0.0.20 prep wrapper. I found no confirmed correctness defect in that exact tree.

The combined delta is two commits: `f13413762` / `51e54b785` (same parent, **same tree** `4ee5377d`) is the code repair; `170ebacd` adds LLP/issue/audit text and the four version/lock files. Product blobs for `metadata.ts`, `projection.ts`, and `sqlite.test.ts` are identical across those three SHAs.

## What the repair does

Baseline `projectMetadata` stored object/array children raw and used `header[field] = []` for every array (`metadata.ts` at `d19d9399`). Two failures follow:

1. An already-owned child set to `undefined` is still `put`. `ProjectionCache.prepare` then does `JSON.parse(JSON.stringify(undefined))` → `"undefined" is not valid JSON`. The pre-fix TAP at `before-fix.tap` shows exactly that on both carriers, for both direct and journaled replacement, before `beforeCommit`/`beforeReplace` can run.
2. Trailing / all-hole arrays lose length on cold restore: header was `[]`, `Object.keys` omits holes, restore never recovers `length`.

The candidate matches LLP 1012 §4: JSON-normalize before split; omit undefined object children; persist array holes as `null`; keep array length across reopen; prepare before publication; abort does not advance key ownership.

## Confirmed defects

None in this source.

Traced paths that hold:

**Object omission.** `jsonValue` treats `JSON.stringify(undefined)` as absent for objects and as `null` for array items (`metadata.ts` 11–14, 73–75). Journaled `futureObject.remove = undefined` removes `["futureObject","remove"]` without rewriting the header. Direct compare drops the key because it is missing from the new projection.

**Array nulls.** `futureArray[1] = undefined` is stored as `null`, not deleted. That matches `JSON.parse(JSON.stringify(...))`.

**Length, growth, shrink.** Full/root replacement writes `Array(n).fill(null)` into the `state` header (38). Journaled index/length writes also put `["field","length"]` (59–62). Shrink removes only owned index keys with `Number(item) >= newLength` (66–70). Restore applies children, then fills holes so a length-only growth does not need child records (96–99). Journaled `growingArray[3]` without a `*` root still refreshes length (59–62, 68–75 in the test).

**Direct vs journaled work bounds.** Child-only journals do not walk unrelated metadata and do not rewrite `state` (`writeHeader = !changed || roots.size > 0`, 31). `*` roots are filtered with `main` (`rows`/`answers`/`outbox`), so an outbox-only swap does not rebuild metadata children. Clock as a scalar `*` still rewrites one header, which is what the existing write-count controls assert (`store-review.test.ts` 352–378: one outbox INSERT plus the scalar clock header; IndexedDB `outbox` put + `meta` `state` put).

**Key-only ownership.** `ProjectionCache` still stores keys, not payloads. `committed()` runs only after SQLite COMMIT / IndexedDB `transactionDone` (`sqlite.ts` 101–131, `indexeddb.ts` 165–189). Prepare does not mutate `this.keys`. The new tests snapshot `projection.keys.meta` across abort.

**Refusal / retry / cold restore / bytes.** SQLite throws inside the transaction via `beforeCommit`; IndexedDB throws in `beforeReplace` before the readwrite transaction opens. Either way `committed()` is skipped. Tests check old bytes kept, new bytes absent, then retry, then cold `open` equals `JSON.parse(JSON.stringify(next))`.

**Unrelated outbox.** Journaled `changed` has no `outbox`/`*` outbox root, so `prepare` does not `compare` outbox. Direct mode with `changed === undefined` is a full publication and will rewrite outbox **rows** with identical data; that is existing unjournaled-replace behavior, not a metadata side write.

**Old layouts.** `legacyMetadata` still forces a full `metadata()` compare when any meta key is not `state` and does not start with `[` (`projection.ts` 29, 63). Split layout with the old empty-array header is not “legacy”: dense arrays still rehydrate from index children; trailing holes were never on disk. New writes persist length in the header and/or a length child. No migration of already-lost holes is required.

**`put()` backstop (`projection.ts` 41–45).** Owned keys whose `JSON.stringify` is `undefined` are removed instead of parsed. That is the throw site in the pre-fix TAP. `imageRecord` always returns an object, so this is not an outbox/row payload change for normal values.

**Versions.** The four files are lockstep `0.0.19` → `0.0.20`: `snapback2/Cargo.toml`, `Cargo.lock` (four workspace packages, checksums unchanged), `bun.lock`, `packages/snapback2/package.json` (including optional native packages). Crate tomls use `version.workspace = true`. No leftover `0.0.19` under `snapback2/`.

**LLP / issue / audit.** §4 states the JSON split contract. The issue keeps the ticket open, names old evidence at `d19d9399e` / `43e06fa90`, names repair candidate `51e54b785` (tree-identical to this code), states qualification is pending, and keeps resource numbers as **pre-repair** (83,227 gzip under 84,000, 80,000 target missed by 3,227; suite 83.921s vs 60s). The audit is pinned at `d19d9399e` and does not claim the new controls already passed.

`@ref LLP 1012#4-the-range-store` matches `## 4. The range store`. Pre-existing `@ref LLP 1012#indexed-held-search` still matches `### Indexed held search`.

## Hypotheses (not confirmed defects)

- Journaled `*` **object → trailing-hole array** is not in the new tests (the pre-fix patch used `['*', {'trailingArray','allHoleArray'}]`; the landed journaled map uses `length` on arrays that are already arrays). Direct replacement covers that shape via `compare()`. `metadataChanges` root replacement traces cleanly (normalize, header skeleton, replace children, drop owned keys not in `present`). Existing reset test already covers journaled `*` object → scalar/null/absent (`sqlite.test.ts` 552–560). I would not block on this.
- Restore hole-fill is `O(length)` for a length-only growth. Production `PersistedRangeState` has no large top-level arrays; this looks theoretical.
- Sibling `*` header rewrite copies live non-root object/array shapes without `jsonValue`. Production commits go through `SwapJournal` + `jsonState`. Incomplete hand-built journals could leak live array length into the header. Not the production path.

## Inherited / unrelated

- File carrier still writes whole `jsonState`; it does not use split metadata. Out of this delta.
- `JSON.stringify` of `bigint` / circular metadata still throws. Pre-existing.
- Resource/resident/phone/scale-curve gaps stay on the cumulative ticket. Not this repair.
- Offline bar items in `NOT-DOING.md` are unchanged.

## Inspected, not executed

Read-only `git show` / `git diff` / `git grep` on `170ebacd` and `d19d9399`. Also read `snapback2/AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1012 §4 from the candidate, `@ref` targets, callers (`sqlite.ts`, `indexeddb.ts`, `swap-journal.ts`, `canonical.ts`, `range-store.ts` replace/commit, `sqlite-state.ts`), existing projection/reset tests, and the two outbox write-count tests in `store-review.test.ts`. Allowed pre-fix artifacts: `before-fix.tap`, `before-fix-command.txt`, `before-fix-tests.patch`.

Did **not** build, run tests, spawn agents, write files, use network/SSH, create worktrees, or read peer-review files (`review.grok.*`, `review.sol.*`). Author-reported execution is taken as reported: focused controls 6/6, full `sqlite.test.ts` 23/23, outbox write-count 2/2, original 10000ms limit; the failed diagnostic used 120000ms. Root still qualifies the combined candidate.

No material source change is required.

## Root adjudication

Retained this reviewer’s READY verdict. The independently received
[Sol review](1012-metadata-json-020.sol.md) identified two concrete defects that
root accepted: unchanged-array header work and own `__proto__` restoration.
The overall candidate is therefore rejected for publication and requires a
revision. This READY review does not override those findings. Resource
headroom remains on the existing cumulative ticket.
