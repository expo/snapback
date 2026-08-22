# guide-gap: put the complete Familiar handler dialect on its first-read path

**Status:** Closed
**Opened:** 2026-08-20
**Resolved:** 2026-08-21
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

## Reopening note — 2026-08-21

Independent review showed the advertised `{ maxItems: 1 }` document array is a
`results.value` carrier, not the empty-capable relational row-set the page
claimed. The page now uses an unbounded `v.array(v.doc(table))` contract with a
handler-side `.take(1)`, backed by a generation test. The generated refusal now
routes to the dialect table. However, the packed-external vertical fixture
required by LLP 0295 and this ticket's generate-and-execute exit is still open
under `issues/20260821-authoring-profile-vertical-contract-fixtures.md`; this
ticket must remain open until that receipt exists.

## Partial implementation

Expanded `guide/backend/familiar-profile.md` with the bounded handler-dialect
table and shared-declaration escape. The Guide now keeps point reads at the
qualified singleton-relational-array contract; LLP 0253 records why the
direct-value target is not yet a shipped Guide promise. The Familiar start
packet links the dialect. Retrieval cases 63–68 independently preserve
`array[i]`, imported helper, top-level const, `Date.now`, mutation document
arrays, and sequence-allocation vocabulary. The retained cold run at
`guide/eval-runs/2026-08-21/familiar-handler-dialect.md` passed all rewrites in
12/15 tool uses.

Partial evidence: all dialect terms and the point-read carrier route in the
retrieval check; the Guide, first-read, codegen, and ref checks pass. The
packed-external runtime/client/negative receipt remains open.

## Resolution — 2026-08-21

Closed after the packed document-result parity receipt landed. The Familiar
first-read page now has one four-column projection of the handler dialect:
allowed form, refused familiar-looking form, standard rewrite, and when the
Explicit profile is better. Its result row records current source truth:
bare/nullable document queries and query document arrays generate, while
mutation/action document arrays refuse before activation output with
`SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE` and the Explicit-result route.

Generated-refusal guidance routes that code to the table, and the `expo-chat`
start packet links the table behind its Familiar stop sign without exceeding
the LLP 0259 first-read budget. Retrieval-eval cases 63–68 preserve the exact
diary vocabulary for `array[i]`, imported helpers, top-level constants,
`Date.now()`, mutation document arrays, and sequence allocation. The retained
cold run passed all six rewrites; the current static retrieval probe binds the
post-landing document-result split.

The complete source/runtime authority remains in LLP 0237/0252/0253 and the
handler-runtime Guide. This table is only the bounded first-read projection.

landing SHA: a5e518c0a
