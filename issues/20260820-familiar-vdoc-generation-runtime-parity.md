# Familiar `v.doc` needs one-pass generation and runtime parity

**Status:** Open
**Opened:** 2026-08-20
**Systems:** Familiar authoring, Code generation, Result contracts, Runtime
**Related:** LLP 0253; LLP 0277 P18; LLP 0295; Diary 0093

## Problem

The published Familiar profile exhibits two phase disagreements:

1. a function returning `v.doc("profiles")` cannot bootstrap from a clean
   checkout until schema-only generation has run first; and
2. a mutation document result can pass codegen and then fail the runtime
   result contract.

The lane repeatedly generated schema first and preserved/reseeded sessions
stores around corrections. Both failures look like application contract bugs
even though the authoring shape was admitted earlier in the pipeline.

## Requested repair

- Make clean-checkout generation resolve document types from the schema in the
  same invocation, or emit a stable phase-specific refusal before output.
- Make every result shape admitted by Familiar lowering admissible by runtime
  validation with the same effective contract; otherwise reject it at codegen.
- Add clean first-generation and query/mutation/action parity fixtures for
  single and array document results.

## Exit

One `snapback generate` on a clean Familiar app succeeds, and no generated
`v.doc` result fails solely because a later runtime phase interprets it
differently.
