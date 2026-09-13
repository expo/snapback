# Snapback 4: Check operation uniqueness after module qualification

Status: Open
Priority: P2
Observed: 2026-09-12
Review finding: R23
Evidence: Reproduced with two source modules
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The documented naming rule makes operations in `schema.q` bare and operations
in other files module-qualified. The duplicate check runs on the unqualified
declaration name first, so unrelated `list` operations in different modules
cannot coexist.

Reproduction: compile `schema.q` containing `query list(): return 1` and
`other.q` containing `query list(): return 2` (with ordinary multiline Quarry
indentation). Compilation reports a duplicate operation `list`, although the
public names should be `list` and `other.list`.

Check uniqueness in the actual operation namespace and emit the same qualified
identity into programs, generated types and API values. Cover two non-schema
modules with the same local name, a schema/module pair, and a true duplicate
inside one module. Genuine collisions must retain a clear diagnostic pointing
to both declarations.

## Implementation locations

- [crates/snapback4-lang/src/bind/mod.rs](../snapback4/crates/snapback4-lang/src/bind/mod.rs)
- [crates/snapback4-lang/src/emit.rs](../snapback4/crates/snapback4-lang/src/emit.rs)
