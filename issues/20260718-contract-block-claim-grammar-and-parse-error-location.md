# Upstream Exact: contract-block claim grammar rejects `mutates` with a mislocated parse error

**Status:** Open
**Severity:** P3
**Systems:** Upstream Exact, Contract Compiler, DX
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** demos/shindig/surfaces/contract/feed.contract (diary 0015); Exact contract compiler (upstream repo)
**Marker:** exact, contract-language, parse-error, claim-grammar

Repo-scoped pointer to an upstream Exact issue (promote to the Exact repo /
Linear when triaged).

Two compounding problems hit while authoring Shindig's Contract arm:

1. **The `contract` block's action-claim grammar accepts only `writes`
   clauses.** `action respond mutates respondMut` — a copy of the action's
   own declaration line, and the natural way to claim "this action drives
   that mutation" — is a parse error. Either the claim grammar should accept
   `mutates` (the compiler already knows the binding from the action
   declaration), or the error should say the claim grammar is `writes`-only.

2. **The parse error points far from the offender.** The diagnostic was
   `expected "writes" in action clause` anchored at a `view`-section line
   ~13 lines *below* the offending claim (the parser had consumed into the
   view before failing). Wrong-line parse errors in an indentation-based
   language are disproportionately costly.

**Done when:**

- Filed upstream (Exact repo or Linear) with a minimal repro; this file then
  records the upstream reference and moves to `closed/`.
- Either `mutates` claims parse in contract blocks or the diagnostic names
  the allowed claim forms, and the error anchors at the offending claim
  line.
