# P1: db.insert's returned row re-evaluates the row expression — silent id corruption

**Opened:** 2026-08-31 · **Systems:** snapback2 engine/compiler write path
**Severity:** P1 — silent referential corruption. **VERIFIED by orchestrator repro.**

When the inserted row literal contains an impure builtin inline, the row
`db.insert` RETURNS diverges from the row STORED. Verified minimal repro
(plain TS, packaged 0.0.1, no quarryc):

```ts
export const insertIdProbe3 = mutation({}, ({ db, ctx }) => {
  const row = db.insert(todos, { id: ctx.newId(), title: "probe3", done: false, ownerId: ctx.viewer });
  return { returned: row.id };
});
// PROBE3 returned=id-…-16385 returnedInStore=false storedId=id-…-16384
```

The returned `.id` exists nowhere; the stored row has the prior mint —
`ctx.newId()` was evaluated twice (once for the store, once for the
return projection). Hoisting the mint into a local round-trips correctly
(verified), which is why the todos template's idiom hides the bug. The
same double-evaluation class presumably affects inline `ctx.now()`
(stored time ≠ returned time). Found by the Quarry benchmark lane
(quarryc emits the inline-mint idiom; every feedItem pointed at a
nonexistent post; no refusal anywhere — the lane diffed `snapback2 data`
dumps). Fix: evaluate the row expression once and return the stored row;
or refuse impure builtins in insert literals at certify time. A packaged-
consumer regression test should pin returned-id == stored-id.

**Resolved 2026-09-02 (`b2bebb49a`, LLP 1007 §5 item 1 / LLP 1004 P0-A).** The
compiler's `db.insert` lowering binds the lowered row expression to one `Let`
temporary; the `Insert` statement and the call's value both read that
variable, so inline `ctx.newId()`/`ctx.now()` evaluate once and the returned
row is the stored row. Pinned by a compiler test on the IR shape and an
executed returned-id == stored-id check.
