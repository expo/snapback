# guide-gap: put the complete Familiar handler dialect on its first-read path

**Status:** Resolved 2026-08-21
**Opened:** 2026-08-20
**Systems:** Guide, Familiar authoring, Handler runtime, Code generation
**Related:** LLP 0237; LLP 0252; LLP 0253; LLP 0259; LLP 0277 P19; LLP 0295;
diaries 0093, 0097, 0099, 0101, 0103

## Problem

The Familiar vocabulary successfully lets agents begin from Convex-shaped
priors, but the first-read page does not consolidate the boundaries that make
it a dialect rather than unrestricted TypeScript. Agents learned by refusal
that dynamic computed access, captured constants, imported helpers, some
result forms, clock-dependent visibility, and sequence surfaces differ.

Diary 0105 adds build-matched current-source evidence for the result-form
boundary. `guide/backend/familiar-profile.md` positively says a point query may
return `v.union([v.doc("todos"), v.null()])` and a closed object directly, while
the same checkout's Familiar lowering explicitly refuses the nullable document
shape and generation rejects a value-object live query with
`SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID`. Both succeeded only after becoming
singleton relational arrays. The same lane also found that membership-backed
ephemeral typing is buildable but the Familiar entrypoint does not export the
ephemeral constructor, so the capability escape required Guide search plus the
lower-level public type declarations.

An older guide fix documents the inline subset elsewhere; the current matrix
shows that it is not routed from the Familiar decision point and therefore
does not prevent repeated correction loops.

## Requested repair

- Add one compact "handler dialect" table to the Familiar page: allowed form,
  refused familiar-looking form, standard rewrite, and when Explicit is the
  better profile.
- Reconcile the direct point/object return promise with LLP 0253, Familiar
  lowering, and runtime result admission. Positive snippets must generate and
  execute; otherwise document the exact singleton-array contract.
- Add one short capability-escape row for shared declarations such as
  ephemeral collections, including the supported import surface.
- Link it from generated refusals and the Familiar template start packet.
- Add retrieval-eval cases for `array[i]`, imported helper, top-level const,
  `Date.now`, mutation document arrays, and sequence allocation.
- Keep the full source/runtime authority in existing LLP/guide pages; this is
  a bounded first-read projection, not a second specification.

## Exit

A cold Familiar agent encounters the supported rewrite before authoring each
of the matrix's replicated dialect violations.

## Resolution

Expanded `guide/backend/familiar-profile.md` with the bounded handler-dialect
table and shared-declaration escape. The Guide now keeps point reads at the
qualified singleton-relational-array contract; LLP 0253 records why the
direct-value target is not yet a shipped Guide promise. The Familiar start
packet links the dialect. Retrieval cases 63–68 independently preserve
`array[i]`, imported helper, top-level const, `Date.now`, mutation document
arrays, and sequence-allocation vocabulary. The retained cold run at
`guide/eval-runs/2026-08-21/familiar-handler-dialect.md` passed all rewrites in
12/15 tool uses.

Closure evidence: all new terms route in the 70-case retrieval check; the full
Guide check, first-read check, and `./ref-check --verbose` pass.
