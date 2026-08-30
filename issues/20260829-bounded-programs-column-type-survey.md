# bounded-programs: the column type set is missing types the corpus already needs

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Schema, Authoring surface, Code generation, Agent experience
**Date:** 2026-08-29
**Related:** LLP 0329.015, LLP 0329.017, LLP 0120,
`spikes/bounded-programs/SPEC.md`, `spikes/bounded-programs/src/schema.rs`,
Diary 0114

## Summary

`spikes/bounded-programs/src/schema.rs` admits exactly:

```rust
pub enum ColumnType { Id, Text { max }, Int, Bool, Time, Ref { table }, Json { max_bytes } }
```

That set is small on purpose and the value model (`null | bool | int | string | id
| row | array | map`, i53, no floats) is right — see §Why no floats is correct. But
several types the existing corpus *already needs* are absent, and in each case the
demand is currently met by a convention the schema cannot check. Conventions that a
schema cannot check are exactly what an agent author cannot discover.

Ranked by evidence already in the repository.

## 1. `Decimal { scale }` — highest, and the reason this issue was filed

There is no way to declare that a column holds money. `$9.99` must be stored as
`999` minor units in an `Int`, and the spike's own report describes the expense
allocator as restricting "its intended use to non-negative **minor-unit** amounts"
— which is a sentence in a report, not a type.

Consequences: nothing stops one table storing dollars and another cents; nothing
tells an agent which this schema uses; and a 100× error is silent.

Proposal: `Decimal { scale }`, i53 underneath, so storage and arithmetic are
unchanged. `9.99` becomes writable in source, the compiler multiplies by `10^scale`,
and mixing scales is a compile error. Optionally `Money { currency }` on top, so
mixing currencies is also a compile error — grok's ledger archetype
(LLP 0329.015.003) raised multi-currency with a rate captured at expense time, and
that design is unexpressible today.

## 2. `Interval { of }` — most evidence, and already deferred

LLP 0329.015 K5 found interval membership needed by **all four** stress-test
archetypes: booking's cancelled-but-historical reservations, the workspace's
inherited grants and link expiry, the auction's sealed-until-close bids, and the
ledger's former-member-versus-new-expense. It is also `coterie`'s original
active-versus-historical membership trap.

The ledger report states the shape exactly: **`roles: ['member', 'former']` is not
an interval.** A role enum cannot express membership-at-a-time.

`SPEC.md` already names this: *"`interval.contains` and `exclusion` are
intentionally skipped in S1."* So the gap is known; this issue records that four
independent applications demanded it, which is more evidence than the deferral had
when it was taken.

## 3. `Enum { variants }` — cheapest, and the corpus is already writing it in comments

Four instances across three demo schemas where the comment does the type's job:

```js
demos/chat-matrix/snapback/schema.mjs:16       role: v.string(),   // 'user' | 'assistant'
demos/messaging-snapback/snapback/schema.mjs:28 kind: v.string(),  // 'dm' | 'group'
demos/shindig/snapback/schema.mjs:61           status: v.string(), // 'host' | 'invited' | 'going' | 'maybe' | 'cant'
```

An agent reading the schema sees `string`. An agent reading the comment sees the
truth. Nothing rejects `status: "atendng"`. This is the cheapest item on the list —
a closed variant list is a set membership check — and probably the highest
agent-experience return per line of spec.

## 4. `Bytes { max }` — has a shipped failure to point at

Diary 0114 records that **"a 32 KiB structured-value ceiling blocked base64 media in
document fields."** With no binary type, binary data goes into `Text` as base64,
which costs 33% size, spends the structured-value budget, and makes the ceiling
arrive sooner and more confusingly.

Hashes, thumbnails, signatures, and content digests are all naturally `Bytes`.

## 5. Lower-confidence candidates, listed for completeness

- **`Duration`** — `Time` exists; an interval *length* is a different thing and is
  currently an `Int` of unstated units. Same unstated-unit problem as money.
- **`Set { of, max }`** — an array with declared uniqueness. Membership rosters and
  tag lists are the shape; today uniqueness is maintained by hand.
- **Refined `Text`** — `Email`, `Url`, `Handle`. Marginal as types, but agents guess
  formats and a declared refinement is a cheap refusal. Lower priority than the
  above because a regex-shaped constraint may belong in `constraints` rather than in
  the type.
- **`Point`/geo** — genuinely continuous, wants fixed-point microdegrees. Niche
  relative to 1–4, and the `Decimal { scale }` mechanism covers it if it lands.

## Why "no floats" is correct and should not be reconsidered

Recording this so the type survey is not misread as an argument for floats.

1. **Money in floats is a defect.** `$9.99` has no exact binary representation.
2. **Local re-execution requires bit-identical arithmetic.** The whole premise is
   that the client re-runs the same program and gets the same answer. Float results
   are not reliably identical across x87/SSE, fused multiply-add, compiler
   reassociation, or libm implementations. Integers are.
3. **`NaN` and `-0.0` break total ordering**, and the IR depends on stable sort and
   index range scans with cursors. A `NaN` poisons a cursor.

The gap is not the absence of floats. It is the absence of a *declared scale*, which
is what makes integer-backed fractions safe to author.

## Suggested sequence

`Enum` first (cheapest, most immediate agent benefit), then `Decimal { scale }`
(clear failure mode, well-understood mechanism), then `Bytes` (has a shipped
incident), then `Interval` (most evidence but also the most semantics — it interacts
with visibility, retention, and the deferred `exclusion` constraint).
