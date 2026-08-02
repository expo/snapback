# G-02: LLP 0127 move-1 type-flow remainder — schema-referencing contract nodes and generated interior types

**Status:** Open
**Program:** 20260802-convex-erg-00-program.md
**Systems:** Codegen, API, Client integration
**Related:** LLP 0127 move 1, LLP 0115 (CV-4 family; 0131 landed CV-4a+CV-5),
LLP 0131 (args contracts — shipped), LLP 0155 Move 1 (composition-algebra
Spec, commissioned — coordinate)

## Task

The measured type-flow gap to Convex: Convex infers types end to end;
Snapback makes authors respell shapes at every boundary. LLP 0131 shipped the
argument-contracts piece (one recursive grammar, ingress validation). The
remainder of LLP 0127 move 1 has no implementation lane:

- **Schema-referencing contract nodes** — a contract can say "rows of table
  T" / "document of table T" by reference instead of respelling the field
  set, with the reference resolving against the schema manifest at
  generation time and staying honest under schema evolution.
- **Generated interior types** — handler-visible types (ctx.db reads, helper
  boundaries, result shapes) flow from the schema + contract artifacts so an
  author writes a shape once and TypeScript infers everywhere the platform
  already knows it.

**Verify first:** re-read LLP 0127 move 1 and the LLP 0115 board's current
item states — the exact remainder item ids should be pinned in this ticket
(the survey did not resolve them), and 0131's §Status implementation-record
amendment lists rulings/divergences the remainder must respect.

**Scope guard:** this is codegen/type-projection work over existing
authorities. It does not reopen the args grammar (0131), does not add new
runtime validation semantics, and must coordinate with the commissioned
LLP 0155 Move-1 composition-algebra Spec before generating any query-graph
result types — the composition Spec owns those shapes.

## Exit

- A demo-grade before/after: one of the improvement-sweep arms' contracts
  (the A2/A6 respelling pain recorded in diaries 0042-0047) rewritten with
  schema references, with the duplicated spellings counted and eliminated.
- Schema-evolution honesty test: evolving a referenced table's fields
  regenerates or refuses per the evolution rules — never a silently stale
  contract.
- ref-check green; the LLP 0115 board row updated with the landing.
