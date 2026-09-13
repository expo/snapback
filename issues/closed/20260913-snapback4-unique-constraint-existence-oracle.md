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

Validation: Linux `cargo test --workspace --no-fail-fast --quiet`, wasm build, and the full `scripts/test.sh` at `8d8c1b7c170183d6a54d7a37af8b34596410160d` passed (0 failures in 45 seconds; 71 client tests). The final audience-index selection correction at `90152c6f2` passed its affected regression. See the [remediation and review record](../../llp/reviews/3000-security-remediation-20260913.md) for review scope and follow-up integration fixes.
