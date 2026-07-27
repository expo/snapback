# 0093 P-4 spec defect: the fixture corpus teaches the wrong row identity member

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Dart client build).
**Systems:** Wire Protocol, Client SDK, Live Queries, Tests
**Severity:** high — a conformant-by-the-corpus client silently corrupts
every result set after the first `live_delta`.

## The defect

`LiveDelta` ops address rows by an explicit `op.id`. `LiveReplace.rows` is
`Vec<Value>` with **no stated identity member** — so a client must read the
id out of the row itself to know which row a later `remove`/`update`
addresses.

Nothing in LLP 0094, LLP 0095, `live.envelope.schema.json`, or
`live.subscribe.output.schema.json` says which member that is. A clean-room
implementer therefore takes it from the only executable authority available:
the normative-for-clients fixture corpus. **The corpus is wrong.**

- Every row in `schemas/live.wire-fixtures.v1.json` spells it **`id`**
  (`{"id": "todo_1", "title": "current row"}`, and the delta ops address
  `todo_1`/`todo_2`).
- The server derives it from **`_id`**:
  `row.get("_id").and_then(Value::as_str)` (`src/live_matcher.rs`, the
  delta-op construction path), and `src/live_wire.rs`'s own wire-shape test
  uses `json!({ "_id": "a" })`.
- A real `live_replace` row carries `_id` and **no `id`**. Verified against
  a live local server (`demos/todo`, `listTodos`):

  ```json
  {"_id":"seed_todo_1","_version":1,"_createdAt":1785049208787,
   "_updatedAt":1785049208787,"title":"Read the Snapback explainer",
   "completed":true,"userId":"user_ada"}
  ```

## Why it matters

A client keyed on the corpus's `id` passes 17/17 corpus fixtures and then,
against a real server, indexes every replaced row under a synthetic
fallback key. Every subsequent `update` inserts a phantom row and every
`remove` is a no-op — a **silently divergent result set** that no
conformance signal catches. This is precisely the failure mode LLP 0093 D1
raises the corpus to normative status to prevent: the corpus is the artifact
that "makes the second client cheap", and here it makes it wrong.

The Swift P-2 client did not hit this because its live harness exercised
`live_replace` refreshes; `demos/todo`'s `listTodos` is
replace-eligible and the delta path never fired in the acceptance run.
The bug is latent in any client built from the corpus alone.

## Resolution taken in the Dart client

`rowIdOf` prefers `_id` (the wire truth), falls back to `id` (the corpus
spelling), and is regression-tested both ways plus for the collision case
where a row carries a user field also named `id`
(`clients/dart/test/conformance_test.dart`, group "live_replace row
identity"). The fallback is a workaround for the corpus, not a contract.

## Fix wanted

1. **State the contract.** LLP 0094 §0C (or a `live.envelope` schema
   description) says the identity member of a `live_replace` row is the
   system field `_id`, and that it is the same string space `LiveDeltaWireOp.id`
   addresses. This is currently *nowhere*.
2. **Correct the corpus.** Regenerate `live.wire-fixtures.v1.json` so its
   rows use `_id`, and add a fixture that is a `live_replace` **followed by**
   a `live_delta` addressing a row the replace delivered — the corpus today
   has no fixture where the two interact, which is exactly why the
   divergence survives. (This needs the multi-step `steps` fixture shape
   already wanted by `issues/20260725-0093-p1-fixture-corpus-coverage.md`
   and `issues/20260725-0093-p3-profile-fixture-classes.md`.)
3. Consider a corpus-honesty gate in `tests/wire_fixtures_v1.rs`: assert
   that every fixture row carries the same identity member the delta-op
   construction path reads.

## Resolution

The corpus now uses `_id` consistently, includes a multi-step
replace-then-delta trace, and asserts the exact final row-ID population.
Rust and Swift conformance harnesses exercise the invariant.
