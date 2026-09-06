I'll run an independent code review of this overlay follow-up against the stated base, using only the patch and the relevant source/LLP contracts. First I'll load the review skill and locate the scoped files.This is a scoped independent Grok review of the named overlay follow-up, so I’ll stay on `revision.patch` plus the source and LLP contracts it actually touches.I have the overlay workspace and `revision.patch`; next I’ll confirm the two SHAs and read the patch plus the overlay/cursor contracts.The patch is small and scoped. I’ll read it in full, then the LLP and source files it actually changes.The patch is in hand. Next I’ll read the production overlay, reset, serializer, and cursor paths plus the LLP contracts they must satisfy.# Overlay follow-ups `44cd420ae` vs `6b0a8e293`

**Verdict: READY**

Static review of `revision.patch` plus the production overlay/reset/serializer/cursor paths and the LLP 1001 / 1011 / 1012 contracts those paths cite. Tests were not executed. No other-family reviews, parent plans, implementation reports, or app scores were read. Reconnect’s full-delivery-after-refresh fix is treated as already reviewed; only interactions with this delta are in scope.

The three production edits do what the ticket claims. The tests pin the intended observables, including a real owner that refuses the wrong cursor spelling. Wrapped object roots stay outside `result_pages`, which is the current contract, not a hole this change is supposed to close.

## Scope

| Path | Role |
|---|---|
| `snapback2/packages/snapback2/src/types.ts` | Reexport `canonical` as `stableSerialize` |
| `snapback2/packages/snapback2/src/store/canonical.ts` | Single serializer |
| `snapback2/packages/snapback2/src/store/range-store.ts` | `resetCoverage` clears `overlayNegatives`; retained answers cannot prove tail pages |
| `snapback2/packages/snapback2/src/store/overlay-retirement.ts` | Chain / `pagePosition` (unchanged; used by the new filter) |
| `snapback2/packages/snapback2/src/client-outbox.ts` | Settlement uses recorded `watermark.cursorArg` |
| `snapback2/crates/snapback2/src/writer_resume.rs` | Empty `result_pages` → `E_OFFLINE_RESUME` |
| `snapback2/crates/snapback2-core/src/certificate/page.rs` | Object wrappers are not page origins |
| `llp/1012-local-first-v1.spec.md` §7 follow-up | Spec text for this landing |
| Tests / harness in the patch | Reset negatives, retained denied tail, real-owner cursor and object wrapper |

## Production checks

### 1. Canonical serializer reexport — holds

`types.ts` deleted its private `canonical` / `stableSerialize` pair and now does:

```397:397:snapback2/packages/snapback2/src/types.ts
export { canonical as stableSerialize };
```

`store/canonical.ts` is the same encoding (`undefined` → `"undefined"`, sorted object keys, recursive arrays). `reduceQueryState` and the range store already share that function. React / client keys that import `stableSerialize` from `types` cannot drift from overlay chain identity. No second serializer remains on the production path.

### 2. `resetCoverage` clears coverage-scoped `overlayNegatives` — holds

`applySwap` runs `applyCoverage` before overlay retirement (`range-store.ts` ~864, then ~918). Reset is:

```1009:1020:snapback2/packages/snapback2/src/store/range-store.ts
    if (swap.resetCoverage) {
      state.rows = {};
      state.rowSeq = {};
      state.negative = {};
      state.overlayNegatives = {};
      state.answers = {};
      state.watermarks = {};
      state.overlayWatermarks = Object.fromEntries(Object.keys(state.overlay).map((intent) => [intent, null]));
      state.overlayMisses = {};
      delete state.facts;
    }
```

Queued negatives are the hazard: retirement reads **this swap’s** `authoritativeNegatives` plus **persisted** `overlayNegatives`, not `state.negative`. A later `{ outbox: { put: [committed] } }` is custody-only (`changesCoverage` is false), so `applyCoverage` does not run again. If `overlayNegatives` survived reset, that delayed terminal would retire from the old generation. Clearing the map is the fix; T2 already dropped `state.negative`.

The old tombstone pin (`if (kind === "tombstone") await store.commit({ resetCoverage: true })` before delayed commit) is gone. New carrier tests (file + IndexedDB) show: reset/reopen keeps the queued intent and overlay; delayed commit does **not** retire; a fresh negative at seq 31 in the new coverage **does**.

Intent, overlay, and outbox bytes are untouched. `overlayWatermarks` stay as `null` per intent (rebase), which is a different coverage fact.

### 3. Denied retained pages cannot prove tail arrival — holds

Denied + `delivered-history` is stored as the **previous** complete/capped body with `retained: true`:

```1121:1151:snapback2/packages/snapback2/src/store/range-store.ts
      if (delivery.state === "denied" && old && retainedRefs.size > 0) {
        data = clone(old.data);
        answerState = old.state;
      } else if (old && retainedRefs.size > 0) {
        data = restoreRetained(old.data, data, retainedRefs);
      }
      // ...
        ...(retained ? { retained: true } : {}),
```

Predicted-row arrival already ignored retained/denied answers. The hole was `pages`, which feeds `cursorChain` and tail arrival. The filter is now:

```925:932:snapback2/packages/snapback2/src/store/range-store.ts
    const pages = answers.filter((answer) => {
      const nonempty = Array.isArray(answer.data) ? answer.data.length > 0 : collectRefs(answer.data).length > 0;
      return !answer.retained && (answer.state === "complete" || answer.state === "capped") && answer.receipt !== undefined
        && !answer.receipt.ranges.some((range) => (range.evictedIds?.length ?? 0) > 0)
        && nonempty && answer.refs.length > 0 && answer.refs.every((ref) => state.rows[rowKey(ref)] !== undefined);
    });
```

**Counterexample that used to fire, and now must not.** Commit snapshot at `c="a"`, seq 30. Hold a nonempty complete page at `c="b"` (seq 29, row `old`). Re-deliver that page as `denied` at seq 31 with `deliveries: delivered-history`. Stored answer is `complete` + `retained` + old refs. Then deliver a fresh link `c="a" → next "b"` at seq 31.

- `cursorChain` from `"a"` yields `reached = {"b"}`.
- Before: retained page at `"b"` is nonempty complete with live refs, `seq >= 30`, position in `reached` → **false arrival**.
- After: retained page is not in `pages` → overlay stays. A later non-retained page at `"b"` (seq 32) still retires.

The new test is that sequence, including cold reopen of `retained: true`. Adjacent existing test (`messages.byId` denied-history) still covers the predicted-row path.

### 4. Test control is real owner cursor precedence — holds

Settlement:

```278:281:snapback2/packages/snapback2/src/client-outbox.ts
  const cursor = watermark.cursorArg ?? runtime.cursorArg(watermark.op);
  const args = watermark.watermark === null
    ? watermark.args
    : { ...(watermark.args as Record<string, unknown>), [cursor]: watermark.watermark };
```

The fake-owner loop that accepted both `after` and `c` is gone. Replacement: drain `integration.inboxProjected(after: cursor ?, label: text <=40 ?)` so a second nullable string cannot impersonate the cursor; persist `cursorArg: "after"`; reopen; patch **only** `runtime.cursorArg` to `"c"` after the mutation returns `committed`; assert the settlement `/api/query` body is `{ after: <minted>, label: null }`; assert `{ ...args, c: watermark }` is HTTP 400.

If recorded-name precedence were removed, that query would be `E_INPUT: unknown operation args: c`. That is a real-owner control, not a fake that blesses both spellings.

### 5. Wrapped object root cursor is unsupported under `result_pages` — holds

LLP 1011 B1: nesting a page in an object yields no cursor. LLP 1001: non-page returns have no continuation.

`certificate/page.rs` `expression_origin` treats scans/merges/variables/empty arrays as pages. `Expr::Object` is not a page origin. Compiler fixture `ops.nested` (`return { rows: page }`) is already asserted to have no `result_pages`. Empty maps are omitted on the wire (`skip_serializing_if = "BTreeMap::is_empty"`).

`writer_resume.rs` `log_page`: empty `result_pages` → `E_OFFLINE_RESUME` “returns no page” (HTTP 413).

Harness:

```42:46:snapback2/packages/snapback2/tests/owner-harness.ts
query inboxObject(after: cursor ?, label: text <=40 ?):
  return { entries: deliveries[viewer] after after first 1 by byRecipientAt { id, kind } }

query inboxProjected(after: cursor ?, label: text <=40 ?):
  return deliveries[viewer] after after first 1 by byRecipientAt { id, kind }
```

`inboxProjected` is a certified shaped page (same class as `ops.shaped`). Real-owner test walks engine-minted `next` links after cold reopen and retires. `inboxObject` returns `next: null`, `result_pages` absent, resume 413. No receipt fallback for an impossible selected-log shape. That is a contract statement, not an unfixed tail-proof bug.

## Authority / overlay / cursor

- **Authority.** Reset still drops generation-scoped coverage (`rows`, `answers`, `watermarks`, `negative`, now `overlayNegatives`) and keeps outbox, overlay, grants, viewed. Fresh negatives at the same data seq in the new coverage may retire. Matches LLP 1012 §7 follow-up and T2.
- **Overlay.** Tail proof is only non-retained complete/capped pages with intact receipts and pooled rows, reached by post-commit next-links. Retained history cannot supply arrival or a continuation link. Two-miss patience is unchanged.
- **Cursor.** Query identity in `pagePosition` still uses the store serializer. Settlement **request** args prefer persisted `watermark.cursorArg`. Resume log must be a certified ascending page; object wrappers are refused before execution.

## Reconnect interaction (base fix, this delta)

Reconnect compares a later full envelope to the fingerprint at `nextSeq`, then installs at the refreshed seq. This patch does not change that.

Interactions that stay consistent:

- `cursorChain` already uses `page.nextSeq ?? page.seq`, so a conditional refresh alone still cannot promote a pre-commit link. Existing test `a full delivery at a refreshed seq renews continuation evidence only after content validation` is untouched.
- Retained answers are no longer in `pages`, so a denied-history body cannot become a “renewed” link after a seq bump. A non-retained equal full delivery still can.
- Denied-then-fresh at the **same** seq is still conflicting-deliveries (different fingerprints). The new test correctly uses seq 32 for the live tail page.

No reconnect regression in this delta.

## Same-class cases

Covered, same production branch:

| Case | Where |
|---|---|
| Absence and tombstone survive reset until delayed commit (must not) | New `resetCoverage discards queued ${kind}…` on both carriers |
| Fresh negative after reset at the same seq (must) | Same tests |
| Denied retained tail as arrival (must not), then live tail (must) | New retained-tail test, file + IndexedDB |
| Scalar projected pages with no `$row` in `data` | Existing store test + new real-owner minted-cursor walk |
| Object wrapper as resume log | Real owner 413 + compiler `ops.nested` |
| Recorded `after` vs live `c`, extra arg refused | Real-owner settlement test |

Not distinct production branches (same `overlayNegatives = {}` / `!answer.retained`):

- Predicted-deletion overlay through reset (map wipe does not care about `removed`)
- Non-denied mixed retained pages (`restoreRetained` also sets `retained: true`; LLP text is all retained answers)
- Conditional refresh after reset (answers are gone; refresh no-ops; need a fresh delivery)

Those are not missing holes in the predicates this patch added.

## Issues

None that require a code change.

## Non-blocking notes

1. **Static vs executed.** This review did not run the 183-test claim, `caps`, or `ref-check`. Correctness is from reading the patch against the cited functions. Do not treat this as native/benchmark qualification.
2. **Settlement stamps `cursorArg` from live metadata.** `offline.ts` still does `cursorArg: this.cursorArg(op)` on deliveries. Settlement **args** use recorded `watermark.cursorArg`. If live metadata is `"c"` and recorded is `"after"`, the query is correct but the filed page may carry `cursorArg: "c"`, and `pagePosition` will not treat it as the selected log (overlay leak, not false retire). Pre-existing; this test only asserts request args. Not a regression of this follow-up.
3. **Comment vs predicate.** The new comment talks about denial; the predicate is every `retained` answer, which matches LLP 1012 §7.

## Not in scope

No SQLite-carrier rerun, no exact-HEAD suite, no twin-size remeasure, no wrapped-page feature, no reconnect re-review.
