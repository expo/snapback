# guide-gap: Contract `invariant` grammar and its limits are undocumented

**Status:** Open
**Opened:** 2026-08-10 · **Severity:** P3 · **Area:** Contract/Exact adapter · testing
**Related:** LLP 0005, Diary 0074, `demos/pointing-room`

## Problem

`guide/clients/contract-adapter.md` and the checked-in Contract demo corpus
never show the `invariant` clause or state what it can express. Discovering the
grammar required reading Exact package source
(`@exact/contract/src/compiler/parser.ts`, IR comments, invariant tests).

The limits matter for exactly the case an author reaches for it: an invariant
can wrap only `has`, `missing`, `count`, and element-state assertions. There is
**no** assertion for rendered-text equality, per-row field provenance, or a
quantified rule such as "for every tally row, rendered text equals
`value ?? '?'`".

`demos/pointing-room` wanted to state a disclosure claim in the `contract`
block — a face-down card renders `?` precisely because the server sent `null`.
The nearest expressible formulation partitions the query by nullability and
checks masked/revealed node counts against derives, with mutually exclusive
view branches. That is genuine UI-side evidence but materially weaker than the
server result contract, and an author cannot learn where that ceiling is
without reading the compiler.

## Desired resolution

This is a cross-repo seam: Exact owns the grammar, Snapback's adapter page owns
the reader standing in front of it.

- Exact guide: document the `invariant` clause and enumerate the assertion
  kinds it admits.
- Snapback adapter page: state the ceiling for authorization/disclosure-shaped
  claims, and say what the Contract block *can* and *cannot* carry, so authors
  pair it with a wire-level acceptance test instead of over-trusting the block.
  `demos/pointing-room`'s split (count-partition invariants in Contract, raw
  two-principal byte assertions in the headless proof) is a usable model.
