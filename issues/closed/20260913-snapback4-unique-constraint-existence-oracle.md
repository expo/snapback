# Snapback 4: Unique constraints disclose hidden rows

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-13
Review finding: S05
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md)

## Problem and reproduction

Point reads hide a row the viewer may not read (`null`, same as absent). Unique-index enforcement does not:

```
{table} already has a row where {columns} = {values}
```

`lookup` in `check_constraints` is a store read, not a rule-checked get. `insert if absent` returns `null` when any unique index hits, including on a row this viewer cannot read.

Reproduction sketch: table `accounts` with `unique byEmail: email`, `read <- .owner = viewer`. Principal A inserts `{email: "x@example.com", owner: A}`. Principal B inserts the same email. B is refused with the values, so B learns that a hidden account with that email exists. The same leak is a boolean via `insert … if absent`.

Id collisions (`already has a row with id {id}`) are the same class; client-minted 128-bit ids make that guess harder, not hidden.

## Acceptance

- A uniqueness (or id) collision the viewer cannot read must be indistinguishable from a generic write refusal, **or** `check` must refuse unique indexes whose columns are not implied visible to every writer who can insert those columns.
- Cover `insert`, `upsert`, `insert if absent`, and the id primary key.
- Public unique columns (chat `handle`) may keep a specific message; the engine must not rely on the author remembering that distinction.

## Implementation locations

- [crates/snapback4-core/src/engine/write.rs](../../snapback4/crates/snapback4-core/src/engine/write.rs) (`check_constraints`, `insert_mode`)

## Resolution — 2026-09-13

Hidden unique and primary-key collisions now produce only the generic E_RULE write refusal, without index names, values, or a false insert-if-absent result. The same visibility decision applies to insert, upsert, and insert-if-absent; readable collisions retain E_CONSTRAINT and nullable unique keys retain their normal semantics. The security regression exercises all four paths. This is the ticket's generic-refusal contract, not a claim of formal write noninterference.

Delivery validation and independent review for the current-main port are in
the [remediation record](../../llp/reviews/3000-security-remediation-20260913.md).

## 2026-09-14 — received Clique correction at 0.2.10

The completed Grok 0.2.10 builder's final report labels its loop 6
`snapback-defect`: `insert ... if absent` on a private `intents` table
returned `E_RULE`, so the builder made the table public. Its final schema
uses the inserted row's nullable result to recognize an already-applied
intent. Preserve that received label and the actual rewrite cost.

A hidden collision on this operation is the deliberate S05 refusal, also
explicit in the published 0.2.10 README and
[LLP 3000.007 §8](../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#8)
item 7(f). It is not evidence that the private target resolution for
`update` or `upsert` failed. Those two operations now follow the narrower
write-authority contract in item 7; the original resolution paragraph above
predates that change. This disposition does not reopen the security ticket
or claim an independent reproduction of the builder's exact pre-workaround
application.

Evidence: `~/clique-sb4-20260913-relaxed-3models/lanes/grok-snapback4/`
`final-report.md` (loop 6), `diary.md` (M2), and `snapback/schema.q`
(`intents` and its if-absent callers). The final report and selected source
were captured before grading/M7 under
`~/projects/snapback-lanebriefs/cell-custody-0.2.10/grok/`.
