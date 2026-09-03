# snapback2: cursor and identity analysis follow-ups from the s2/q-platform landing review

**Opened:** 2026-09-02 · **Systems:** snapback2-core certifier and engine, evaluator twin, compiler type analysis, Quarry front end
**Source:** the final blind review of the `s2/q-platform` landing (scan-order tuple cursors, certify-time Id/cursor refusals). Every item below was reproduced by the reviewer with a concrete program; none blocks the landing, each is fix-forward. The landing's governing rule: static analysis never refuses what the runtime accepts, except the total-order index rule (a cursored index ends in `id` or is unique).

1. **Twin accepts an object cursor the engine refuses.** Raw `Scan items.byId prefix [] after Object{} take 1`: engine `E_SCHEMA: row is not an indexable scalar` (`encode_index_value`), twin returns `[]` (`evaluator.ts` `cursorTuple` wraps any non-array; `totalCompare` orders Row/Map after scalars). `verified-regression-tests.ts` pins the twin's green. Fix: the twin refuses non-scalar cursor elements with `E_TYPE`; the test asserts red in both runtimes.
2. **Tied-key two-page assertions run only in `export_corpus`,** which `scripts/test.sh` never invokes; no blocking Rust test executes a `Desc` scan or a `before` cursor against the engine. Fix: a store/spike test that executes the four `cursor-*` corpus programs through `Engine::memory` (or replays `expected.localResult` for that category).
3. **Cursor on a fully specified prefix:** static `E_ARGS_CURSOR_SHAPE "expected exactly 0 cursor value(s)"` (with an empty-tuple rewrite and a stray args edit) while both runtimes silently ignore the cursor (`index.rs` skips bounds when `range_column == columns.len()`). Fix: refuse at runtime (`push_cursor_bound` with zero remaining columns), keep the static refusal, drop the empty-tuple rewrite.
4. **Quarry rewrites:** `E_ARGS_CURSOR_INDEX` reaches a `.q` author with the unchanged source as its rewrite, and `E_ARGS_CURSOR_SHAPE` on a unique index has no tuple rewrite because `quarry/program.ts` gates the tuple rewrite on `columns.at(-1) === "id"`. Fix: gate on `at(-1) === "id" || index.unique`; give `E_ARGS_CURSOR_INDEX` a `.q` rewrite (`by byAuthorAt: author, at, id`).
5. **`prefixArity` counts an identifier prefix as one column** (`type-analysis.ts`), so `const key = [args.owner, args.at]; db.scan(items.byOwnerAt, key, { after: "row-1" })` types the cursor literal against the wrong column and lowers `Literal.String`; the page silently restarts. Fix: resolve the identifier's array identity as `lowerKey` does.
6. **`hasMore` remnant in the raw certifier:** `certificate_policy.rs` still special-cases `Field hasMore` and `tests/completeness.rs` still certifies `docs.hasMore`; `(scan as any).hasMore` certifies and both runtimes fail with `E_TYPE`. Fix: delete the fact branch and refuse `Field` on a list-typed base (both runtimes are red, so the refusal is legal).
7. **Wrong-domain tuple is silent everywhere:** `after: [previous.id, previous.at]` on `byAt [at, id]` certifies (silence rule) and both runtimes return `[]` on every page because Int tags sort below Id tags. Fix: validate cursor element kinds against the index column types at runtime (`push_cursor_bound` / `cursorTuple`), after which the static refusal becomes legal.
8. **Equality operands never receive the Id target,** so `db.get(users, "user-1")` lowers `Literal.Id` while `row.owner === "user-1"` lowers `Literal.String` and the guard is always false with no diagnostic. Fix: propagate an Id-typed operand as the contextual target of the other operand for `===`/`!==`, or refuse Id-vs-Text comparisons.
9. Nits: `args.maybe ?? "anonymous"` with `maybe: t.optional(t.id())` now yields `{Id:"anonymous"}` (wire-variant change, undocumented); `lib.d.ts` types `after?: unknown[] | unknown`, which collapses to `unknown` (only the doc comment carries the contract).

## Added from the phase-2 (composite-key writes) review, 2026-09-02

10. An alternate-key update patch naming `id` is refused by the platform (`E_SCHEMA_ID_RESERVED`, whole-file rewrite, plus a leaked `E_OPAQUE`) rather than by the Quarry front end with a sited drop-field rewrite; add `id` to the guarded set in `validateAddressedKeyFields` for updates.
11. A row the viewer cannot read is `NOT_FOUND` through an alternate key but `E_RULE` through its id; the guide's absence paragraph says "missing" and should say "missing or unreadable".

## Resolution

**Closed:** 2026-09-03 · **Landed:** `cfbd52280` on `main` (lane `s2/q-followups`,
codex gpt-5.6-sol xhigh, two blind reviews folded).

All eleven items landed together, under the rule the landing review stated:
static analysis never refuses what the runtime accepts, except the total-order
index rule, and every runtime refusal exists in both runtimes.

1. The twin refuses non-scalar cursor components (`E_TYPE`); the engine's
   `E_SCHEMA` is pinned by `corpus_cursors.rs`; the raw-IR pin asserts red in both.
2. `tests/corpus_cursors.rs` executes the four `cursor-*` corpus programs
   (including a `Desc` scan and a `before` cursor) through `Engine::memory` and
   compares with `expected.localResult`; it runs in `scripts/test.sh`.
3. A cursor whose prefix names every index column is refused at runtime in both
   runtimes and at certification with a drop-the-bound rewrite (TS: the option
   is removed; Quarry: the clause is removed); an overlong prefix is refused
   separately, and the twin now refuses it as the engine does.
4. Quarry refuses a cursor on a non-total index in the front end with the `.q`
   rewrite `by <index>: …, id` sited at the index declaration; the tuple
   rewrite also fires for unique indexes; `E_ARGS_CURSOR_INDEX` no longer
   reaches `.q` authors.
5. `prefixArity` resolves a stable identifier's array initializer (and helper
   arrays), so the cursor literal types against the right column.
6. The `hasMore` fact branch is gone; `Field` on a statically known list is
   `E_ARGS_TYPE` at certification (both runtimes were already red).
7. Cursor components are kind-checked against index columns at runtime in both
   runtimes (`Null` is the universal pre-first sentinel); the static layers
   refuse definitely mismatched tuples with a column-order rewrite (`.q`:
   `after (p.at, p.id)`), structurally (Decimal/Money ↔ Int/Time match).
8. Equality operands propagate an Id-typed side as the contextual target of the
   other, so `row.owner === "user-1"` compares Ids; `contextualNodeKey` is now
   unambiguous per node.
9. Documented: a text literal in an Id position (key, cursor, equality, `??`
   fallback) is an Id value on the wire; `lib.d.ts` types `after`/`before` as
   tuple or indexable scalar.
10. An update patch naming `id` is refused by the Quarry front end with a
    sited drop-field rewrite; no platform `E_SCHEMA_ID_RESERVED`/`E_OPAQUE` leak.
11. The guide's absence paragraph says "missing or unreadable" and states the
    `NOT_FOUND`-through-alternate-key versus `E_RULE`-through-id asymmetry,
    now pinned by a paired test.

LLP 1001's cursor paragraph records the runtime semantics (full-prefix refusal,
kind validation, universal `Null` sentinel, non-scalar refusal).
