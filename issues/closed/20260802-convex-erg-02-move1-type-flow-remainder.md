# G-02: LLP 0127 move-1 type-flow remainder — schema-referencing contract nodes and generated interior types

**Status:** Resolved 2026-08-02
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

## Running log

- **2026-08-02 — current-main verification and boundary.** Started from
  `origin/main` `9d1954a0`. LLP 0157 is still **Draft** (v0.2, with its
  refinement blockers open), so its composition algebra and every generated
  query-graph/composite result shape were deferred and left untouched. The
  permitted remainder is result-side `v.doc(table)` plus handler/helper
  interiors derived from existing manifests. LLP 0131's argument grammar was
  not reopened; `v.doc` is explicitly refused in arguments and stored schema
  fields, leaving CV-4b Open.
- **2026-08-02 — schema-reference carrier implemented.** The authored
  app-authority marker expands immediately against the loaded table manifest.
  A top-level `results.records(v.doc(T))` normalizes to the shipped
  `results.documents(T)` descriptor and identical hash; nested references
  carry the same frozen structural object. No new deployed node or runtime
  validation semantic exists. Unknown tables refuse, and schema evolution
  changes the effective contract hash and generated types.
- **2026-08-02 — generated interiors and A2 pilot.** `api.d.ts` now projects
  table rows, inserts, patches, index names, query builders, read-only query
  databases, write-capable mutation databases, authority-nullability-aware
  contexts, per-function auth narrowing, and `GeneratedHandler` from the
  schema/function manifests. The A2 message arm moved its whole-document
  result to `v.doc` with the same witness and typed one shared context-reader
  helper: complete-document field respellings stayed honestly 0 → 0 because
  the arm already used `results.documents`; repeated message reader spellings
  fell 4 → 1 (three eliminated). Regenerated-arm checkJs is green; a seeded
  handler/result mismatch in the focused fixture is a required diagnostic.
  This is an explicit current-main divergence from the ticket's assumed
  before-state: no named A2/A6 whole-document contract still respelled its
  fields, so a positive contract-field elimination count could not be produced
  without broadening an API or inventing a fixture. The landing preserves the
  existing A2 witness and records 0 → 0 rather than claiming that stale exit;
  the independently measured helper duplication reduction is 4 → 1.
- **2026-08-02 — current-main proof.** Rebased through `origin/main`
  `3b6059a7`. The complete codegen package suite passes, including the new
  schema-reference/type-interior fixture and the existing RBAC surface. A
  regenerated five-table/twelve-operation A2 backend passes strict whole-file
  checkJs, retains the `documents` result descriptor/hash, and contains one
  shared message reader. Full `cargo test --lib` passes 1,740 tests with one
  ignored benchmark and zero failures. `./ref-check --verbose` passes 158 LLPs
  and 2,792 references with zero errors/unchecked; the guide check passes 46
  pages, 142 snippets, 91 routes, and 29 host operations with its 17 inherited
  freshness warnings. `git diff --check` is clean.
- **2026-08-02 — final landing rebase and generated closure.** The landing was
  rebased onto `origin/main` `a32d151a`; the implementation commit became
  `d9ebc2b1`. Regeneration refreshed the committed typed APIs, review
  manifests, and their bound artifact identities, and registered the new
  proof as test 159 in the canonical package inventory. The complete codegen
  suite (including the concurrent settlement suite), generated-type compile,
  generated-artifact idempotence check, package inventory, ref-check, and
  guide check all pass on a clean worktree after that refresh.

## Resolution

Implementation commit `d9ebc2b1` closes the admitted G-02 remainder:
result-only `v.doc(table)` references resolve from the app schema into the
existing document contract/hash, and generated handler/helper/context types
project the same schema/function/result artifacts with exact read/write,
membership, last-holder, optional-null, and auth authority distinctions. It
does not add a deployed reference node, widen argument or stored-field
grammar, or generate any LLP 0157-owned composition shape.

The A2 arm proves the demo boundary honestly: whole-document field
respellings were already 0 and remain 0, while four repeated context-reader
chains become one shared typed helper. The current-main proof is the final
running-log entry above: complete codegen and Rust library suites green,
regenerated A2 strict checkJs green, guide/ref checks green, and the LLP 0115
CV-17 row updated.
