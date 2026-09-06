READY

Focused independent review of `02a5b980b705d4cfacea6d06dd04e0d9ae654e6d` atop `4e927c26df5b1cec4f2ce885f9521474586b54a3`. Scope is exactly the three changed files (`coverage.ts`, `store.ts`, `test-indexed.ts`). This is not a size-pass, not a total-memory claim, and not overall landing or release readiness.

The delta does the job it names: `ClientStore` no longer keeps a second full `ClosureReceipt` row pool; `CoverageIndex` already had compact per-owner absence/verdict identities and now exposes them for invalidation; `setReceipt` installs final counts before any `ReadableDirectory` refresh; `rehydrate` invalidates every previous owner's authority after the replacement seed is in place. Followed callees (`held-directory.ts`, `runner.ts` `readAuthority`/`evaluateRule`, `index-store.ts` `position`, `twin-store.ts` `setReceipt`) rather than the diff alone.

## Findings

No newly introduced blocking defect in this three-file delta.

## What changed, and why it is sound

**Deleted `ClientStore.receipts`.** Before this commit, every `setReceipt` retained the whole `ClosureReceipt`, including `rows` and therefore message bodies / media-bearing row objects, for as long as that owner remained. `CoverageIndex` already extracted the only facts later reads need: expected ordinary index keys, range identity, absence point keys, and verdict count keys. The extra map was obsolete proof ownership.

**Reuse of compact owner metadata.** `CoverageIndex.set` still validates the incoming receipt (boolean verdicts, `prepareRange` issuing-site match, expected-key extraction from the *receipt* pool) before removing the previous owner. It then mutates counts and returns `[old]` on delete or `[old, new]` on install. `touchProofs` runs only after that return, so a `ReadableDirectory.refresh` that immediately re-enters `store.verdict` / `hasAbsence` sees final counts, not an empty gap between decrement and increment. That is the invariant the new directory test hooks.

Invalidation no longer walks retained `ClosureReceipt` objects. Absence keys are `JSON.stringify([table, index, key])` (already the `hasAbsence` map key). Verdict keys are `JSON.stringify([rule_hash, pinned_inputs_digest, principal, auth_epoch])`; `touchProofs` takes `parse[1]`, which is the same `pinned_inputs_digest` `ReadableDirectory` indexes as `sha256(dependency)`. Evaluator `Value` tags (`Null` / `{Id|String|Int|Bytes: ...}`) JSON-roundtrip; `Bytes` is a string, not a typed array. This is equivalent to the old `receipt.absences` / `receipt.verdicts` walk for every wire value the engine actually emits.

**Standalone rehydrate.** The old path replaced `CoverageIndex`, then `setReceipt('seed')`. That touched only the previous *seed* receipt still sitting in `this.receipts`. A later non-seed owner’s coverage disappeared from `facts` while its directory entry stayed allowed. The new path snapshots `authorityOwners()` (compact absences/verdicts for every owner), installs the replacement seed first, then touches the snapshot. Directories therefore observe the post-seed verdict/absence set, including the case where a non-seed owner was the only remaining allow.

Constructor / `setReceipt('seed')` replacement without `rehydrate` still keeps other owners. That is a different API. Twin production traffic uses per-answer `setReceipt(key)` in `twin-store.ts`, not `rehydrate`; `rehydrate` is the corpus/standalone snapshot replace (`evaluator.ts`).

## Checklist (focused delta)

| Concern | Result |
|---|---|
| Final counts visible during immediate directory refresh | Covered. `facts.set` finishes before `touchProofs`. Test wraps `refresh` and requires every observation to be the installed denial, not `null`. |
| Absence / verdict disagreement and duplicate counts | Unchanged count table `[deny, allow]`; `verdict()` still returns `null` when both sides are nonzero. Existing 20/80/2000-owner tests remain in the file (conflict, duplicate true+false, non-boolean rejected with prior state kept). |
| Exact issuing membership / halo pool | `setReceipt` still refuses a range member or halo that is not in *that receipt’s* `rows` (store-held rows do not count). Halo table must equal the range table. Derived prefix still needs its issuing scan (`prepareRange`). |
| Validation before replacement (`setReceipt`) | Pool/halo checks run before `facts.set`. `facts.set` maps verdicts and `prepareRange` before decrementing the old owner. Failed admission leaves counts and directories untouched. |
| Partial / negative / unknown authorization | Directory `check` is still `readAuthority`: allow / deny / `null`. Exists on an unreadable probe uses `store.verdict`; readable membership uses lookup + `hasAbsence`. New tests drive allow, deny, unknown, and absence-point replacement. |
| Seed vs non-seed replacement/removal | `setReceipt(owner)` still names the owner. `rehydrate` drops every owner’s coverage and reinstalls only `seed`, now also invalidating non-seed authority. |
| Directory reclamation | Unchanged `refresh` deletes empty scopes and unlinks dependencies/digests. New tests assert the five private maps are empty after the last row leaves. |
| GC / purge / delivered-history | Reachability witness: after current-row `remove`, the unique body string and `{Row}` wrappers are not reachable from the store; expected ordinary keys (`{Id: 'owned-a'}` etc.) remain by design; restoring those ids restores exact coverage; `setReceipt(owner)` then drops absence/verdict. Delivered-history readable-table path is unchanged and still in the file. |
| Standalone `ClientStore` | New tests construct `ClientStore` directly (no Twin/carrier). |
| FIFO overlays / rollback | `applyMutation` journal is untouched. Existing rollback in the 2000-owner block still asserts the row and verdict survive `E_REQUIRE`. Twin FIFO overlay tests earlier in the same file are unchanged. |
| Generic backend isolation | `ClientStore.receipts` was never the durable answer store. `twin-store.ts` still calls `setReceipt` per answer and per `negative:${key}` overlay. `range-store` / IndexedDB / FactIndex / ExtentIndex are unchanged; their tests after the new blocks still run. |

Ordinary expected index keys are legitimate coverage, not a leak. `HeldIndex.position` returns ordinary columns (derived word slot stripped). `CoverageIndex` records the same column projection at `set` time from the receipt pool, then drops the pool. Word-index body text is not copied into `expected`.

## Tests vs claims

The new regressions substantiate the ownership and invalidation claims they name.

1. **Directory replacement / failed admission** (`test-indexed.ts` ~840–888). Install allow, replace with deny while observing `refresh`, restore allow, then five `E_INPUT` malformation cases (member not in receipt pool, halo not in pool, halo table mismatch, derived range without issuing site, non-boolean verdict). Each throw notifies no directory and leaves the previous allow. Clearing the owner notifies `null`. Absence-point replacement on the readable-membership schema invalidates the removed point.

2. **Standalone rehydrate** (~905–922). Seed with a verdict, `rehydrate` without verdicts → unknown. Install a later owner, `rehydrate` without verdicts → later owner must not keep the directory allowed. Empty-row `rehydrate` reclaims directory maps.

3. **Retention witness** (~890–951). Deterministic own-property / Map / Set walk; explicitly not GC scheduling, RSS, heap, or phone. Parent failed this exact assertion (`true !== false` on “no obsolete full receipt payload survives current-row removal”). Final source passes it.

Historical evidence matches that split:

- Parent + new retention test: fail (`r8-receipt-ownership-regression-before-test.log`).
- Compact-invalidation candidate without rehydrate repair: directory tests pass, retention passes, rehydrate not yet present (`r8-receipt-ownership-candidate-test.log`).
- Rehydrate-before: later-owner directory stayed `{ missing: false, scopes: [[{Id:'room'}]] }` (`r8-receipt-ownership-rehydrate-before-test.log`).
- Final source, direct assertion style: all three new logs plus the rest of the indexed file (`r8-receipt-ownership-bun-final-test.log`; captured Node `r8-receipt-ownership-final-direct-test.log`, 6177.984 ms under a **new** external 10 s adapter — that is not original 10 s qualification).
- Direct Bun first failed on `node:test` wrappers (`Cannot use test outside of the test runner`). Wrappers were restored to the file’s existing `assert` + `console.log` style without dropping assertions. Packet source is that restored form.
- Four public Twin tests: pass, 1193.957 ms, **original** 10 s (`r8-receipt-ownership-public-test.log`).
- Caps / ref-check / empty diff-check: pass. Package typing/build is recorded as passing in the supervisor verification; this review does not treat empty `package-build.log` as extra proof.

Gaps that do not undermine the claims: there is no separate `rehydrate` + absence-point case (same `touchProofs` path as `setReceipt`); no explicit Bytes/media payload (body string is the same ownership shape; media columns are not ordinary index keys); no assertion that expected keys become unreachable *after* the owner is deleted (the `range(-1)` / `owners.delete` path drops them).

## Residuals (preexisting, not introduced)

These predate the delta. They are recorded so they are not mistaken for new defects or for waivers.

1. **`rehydrate` still mutates rows and replaces `CoverageIndex` before validating the incoming receipt.** Pool/halo/`prepareRange`/verdict checks run inside the subsequent `setReceipt`. On throw, tables already match the new rows, `facts` is empty, and `touchProofs(old)` never runs, so directories can remain at the last allow. The old implementation had the same wipe-then-`setReceipt` order; it also skipped directory touch on throw. `setReceipt` itself *does* validate before replacement, and that is what the new tests cover. A later hardening would validate (or dry-run `CoverageIndex.set`) before `remove`/`put`/`new CoverageIndex`.

2. **Duplicate absence keys on one owner.** `held.absences.push(key)` can repeat; owner removal does `this.absences.get(key)!` and will throw `TypeError` on the second copy after the map entry is deleted. Duplicate *verdicts* are counted and tested; duplicate absences are not. Engine receipts are not expected to duplicate points.

3. **`authorityOwners()` returns a live `Map.values()` iterator.** Safe at the one call site because the old map is abandoned before iteration. A snapshot array would be the more obvious freeze if another caller appears.

## Resource failures (not waived)

Session-delegated complete-runtime contract for this work: five-root ceiling **66,000** gzip / target **64,000**, 1M steps / 4 MiB closure / 8 MiB execution heap / 1 MiB output, combined 524,288 logical slots, exact ordinary AND timed all-ID closed-extent consistency, Exact 2 deferred. The 34,000-byte figure in `NOT-DOING.md` / LLP 1012 indexed-held-search prose is obsolete for this session and does not bind this review.

Measured complete entry: **221,580 minified / 72,229 gzip**, **+75 / +30** vs parent, **FAIL 6,229 over 66,000**. That is independent of this ownership delta and is not a size-pass. Historical R8 movement at the original 10 s remains failed; exploratory 43/43 at 23.819 s with a 120 s budget is not a pass at the original deadline. Exact-cap pass was attributed to a separately authorized byte-identical setup allocation repair, not this product change. No new native, device, or whole-resident proof. Root authorized this checkpoint push and review despite those known independent failures.

The reachability test proves obsolete row-container/body ownership removal inside its inspected graph (own data properties, Map, Set). It does not prove closures, RSS, heap, or phone.

## Limitations of this review

- Packet `source/` + `before/` + `delta.patch` + named evidence only. No other reviewers, no coding-conversation lanes, no mutable product tree.
- No new build, full suite, size, movement, cap, heavy memory, remote, or repeated unchanged run. No probe was required: parent/candidate/rehydrate-before/final logs already split the two defects this delta claims to fix.
- Unchanged callees were read, not re-executed.
- `ClientStore.receipts` had no remaining product readers; twin/backends keep their own answer receipts.

This focused three-file ownership delta is ready as a correctness change. It does not make the tree landing-ready or release-ready while the independent resource failures remain.
