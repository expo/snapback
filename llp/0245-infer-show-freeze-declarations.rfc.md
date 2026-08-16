# LLP 0245: Infer, show, and freeze declarations

**Type:** RFC
**Status:** Accepted
**Systems:** Authoring, TypeScript, Code generation, Application data API,
Diagnostics, Developer experience, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-15 (Rollout 4 runtime-witnessed implementation and
adversarial fix round: Charlie Cheever ruled that R4 may consume
`snapback.verify-receipt.v1` conformance while LLP 0146 remains Draft, provided
the evidence class itself carries the registered-paths-only caveat.
`DeclarationSuggestionV1` analyzer v2 now schema- and consistency-validates
matching receipts, binds their exact bytes, resolves a null receipt
`functionId` only through an unambiguous registered-path/generated-function
identity, emits path-specific `runtime-witnessed` evidence, and exposes only
addition-only `reads`/`writes` changes with `completeSetClaim: false`;
`overDeclarations`, zero-path aggregates, and `not-claimed` aggregates have no
suggestion projection. Every admission failure for the auto-discovered
conventional receipt—including legacy/schema-invalid, inconsistent, blocked,
and identity-mismatched shapes—is a fail-open warning-bearing skip with no
runtime evidence, so result-only suggestions remain available; explicitly
passed receipt paths and apply evidence remain fail-closed. A 33-backend
measurement preserved the prior 106 result candidates (20 exact, 37
schema-derived, 36 holed, 13 refused, 0 widened) and reported zero
runtime-witnessed receipts/additions because the source-only corpus retains no
verify receipts; source bytes did not change.) 2026-08-12 (author acceptance: Charlie Cheever accepted this RFC at
the exact revision bound by the final GPT-5.6 Sol round-3 READY artifacts,
SHA-256 `06aee0324c71e22e9de1a863e0af16a6f65e891c1c1824c528450155cda3cec4`; see
`llp/reviews/0245-0249-single-family-super-refine.md`). 2026-08-12 (round-1 revision: gave single-suggestion application a
Snapback-owned analysis-input CAS, scoped manual-paste guarantees, and added
stable refusal reasons and evidence-class review metrics). 2026-08-12 (entered
an author-invoked, single-family GPT-5.6 Sol
xhigh refinement loop; initial Draft took up LLP 0117 option C and LLP 0236
OQ3 without changing the authority of explicit contracts)
**Related:** LLP 0004, LLP 0009, LLP 0037, LLP 0061, LLP 0108, LLP 0115,
LLP 0117, LLP 0127, LLP 0146, LLP 0178, LLP 0198, LLP 0203, LLP 0236,
LLP 0237, LLP 0241, LLP 0246

## Summary

Snapback should remove declaration transcription without making inferred
behavior authoritative. A new authoring assistant statically derives candidate
result contracts and conservative declaration additions, shows a complete
source patch with provenance and uncertainty, and freezes only the patch the
author accepts into ordinary committed source.

The rule is: **inference proposes; explicit source remains authority**. Runtime,
manifests, clients, replay identity, and cross-language projections consume only
the frozen declaration. They never consume an ambient TypeScript inference
result or a sampled invocation.

## Motivation

LLP 0117 found that explicit result contracts buy runtime egress enforcement,
portable clients, and stable artifact identity, but make ordinary TypeScript
handlers substantially more verbose than Convex. LLP 0127 deliberately chose
schema-reference compression first and left infer-then-freeze conditional. The
later Clique synthesis asks which declarations codegen could infer and present
for confirmation.

That question now has enough boundary conditions for a proposal. Generated
handler context types and schema references improve static evidence; LLP 0146
records declared and observed dependencies; agents are effective reviewers of
small concrete diffs. The missing product surface is a safe way to turn those
facts into source without hiding who authorized them.

## Constraints

- Frozen args, result, authority, reads, writes, effects, capabilities, and
  refusal declarations remain the only manifest authority (LLP 0108).
- Runtime observations are path-specific lower bounds. They may prove a missing
  declaration but never prove that an unobserved dependency is absent (LLP
  0146#d1-declarationobservation-conformance).
- Authorization, public exposure, secret access, external effects, retention,
  and portability are never narrowed or granted by inference.
- Suggestion production is deterministic, versioned, source-attributed, and
  read-only unless an author explicitly applies a patch.
- The accepted source remains readable without the suggestion tool or its
  cache.

## Decision

### D1. One read-only suggestion command

Add:

```sh
snapback author suggest <operation-or-file> --format patch
snapback author suggest <operation-or-file> --json
snapback author suggestion apply <suggestion.json> --json
```

The `suggest` command reads a stable source snapshot and generated schema/type
facts, then emits either a unified patch or `DeclarationSuggestionV1`. It never
edits source, replaces generated artifacts, or activates a generation. The
separate `suggestion apply` protocol accepts exactly one suggestion for one
operation and is the Snapback-owned compare-and-write seam used by editors; v1
has no multi-operation or ambient “apply current suggestions” command.

Each suggestion binds operation id, source and schema digests, compiler and
analyzer identities, the frozen declaration before/after, evidence per proposed
field, confidence class, and diagnostics. It also binds one domain-separated
`analysisInputId` over the complete analyzed definition/helper/type-source
closure and module-format facts, schema and generated-type facts, effective
compiler configuration, compiler/analyzer identities, and every runtime
evidence receipt used. Immediately before writing, the apply protocol takes a
fresh stable snapshot, recomputes that complete identity, compares the exact
before-declaration and patch target, and atomically writes only on an exact
match. Any mismatch refuses with
`SNAPBACK_DECLARATION_SUGGESTION_STALE` and requires regeneration; a failed
write changes no source.

Manual copy/paste remains allowed because the emitted patch is ordinary source,
but it is not stale-safe: only the Snapback-owned single-suggestion protocol
makes the stale-refusal claim. Normal generation still rechecks a manually
edited declaration and leaves the previous generation active on failure.

### D2. Result contracts are the first authoritative candidate class

V1 proposes `result:` blocks from a closed TypeScript/JSDoc return shape plus
declared schema references. It prefers existing contract vocabulary:

- `v.doc(table)` or exact document references for intact stored documents;
- closed objects, arrays, literals, unions, null, optional fields, ids,
  integer/finite-real distinctions, and existing bounded primitives; and
- explicit refusal when TypeScript is wider than Snapback's runtime contract
  vocabulary (`any`, `unknown`, unbounded index signatures, unsupported class
  instances, ambiguous numbers, recursion, or non-JSON values).

The tool never invents a bound, integer refinement, asset policy, or table
identity. When a required refinement is not derivable, it emits a hole with the
source expression and available choices rather than a plausible contract.
Holes and refused candidate classes carry stable machine-readable reason codes
from the same generated table used by CLI and editor projections.

### D3. Dependency suggestions only widen

Static analysis and LLP 0146 observations may propose additions to `reads` and
`writes`:

- a statically resolved `ctx.db` access is `static-complete` evidence for that
  access site;
- an observed undeclared access is `runtime-witnessed` evidence for an addition;
  and
- helper/import uncertainty is reported as `incomplete`, never guessed.

V1 never proposes removing a declared read/write and never converts one run's
observed set into a complete set. It does not propose `auth`, effects, secrets,
capabilities, public exposure, retention, or target portability. Those fields
may receive diagnostics and links, but remain author-written decisions.

### D4. Show means a reviewable semantic diff

Human and machine output group changes by contract consequence, not text order:

- runtime validation and generated-client type changes;
- dependency additions and their evidence;
- unresolved holes;
- semantic/executable/evidence identity changes under LLP 0241; and
- the exact checks that will run after acceptance.

The patch includes normal source only—no analyzer-owned opaque blob. Optional
provenance lives in a separate suggestion receipt and generation log. A reviewer
can understand and edit the resulting declaration without rerunning inference.

### D5. Freeze is ordinary generation

After the patch is accepted, normal `snapback generate --check` treats it exactly
like hand-authored source. The frozen declarations are hashed, projected, and
runtime-enforced through existing owners. The suggestion receipt has no runtime
authority and its absence cannot weaken enforcement.

A later source change may produce a new suggestion, but does not silently update
the declaration. Existing conformance checks still catch actual under-
declaration. Suggestion drift alone is advisory until the author asks for it.

### D6. Rubber-stamp resistance is visible, not paternalistic

The tool reports how much of a candidate was exact, schema-derived, widened, or
unresolved. A generic or bulk `--apply` is deliberately absent from v1. Editors
may offer an "Apply this suggestion" action only after rendering the semantic
consequences and exact source diff, and must invoke D1's identity-checking
single-suggestion protocol rather than write the patch themselves. Each
acceptance remains an explicit author action recorded in the suggestion receipt;
neither the editor nor the receipt gains runtime authority.

## Compatibility and migration

This is additive authoring tooling. Existing declarations and generated
artifacts do not change. A repository may ignore suggestion receipts. Compiler
or analyzer upgrades rotate suggestion identity but cannot rotate an active
application generation until changed source is accepted and generated.

LLP 0246 improves proposal quality for TypeScript modules but is not a
prerequisite: pinned `checkJs` plus generated context declarations can propose
from `.mjs`. Conversely, LLP 0246 never makes its inferred return type a
contract; it composes through this RFC when proposing one.

## Rollout

1. Freeze `DeclarationSuggestionV1`, evidence classes, and stale-apply refusal.
2. Run result-only suggestions over the existing bakeoff corpus without edits;
   report exact, holed, and refused proportions.
3. Add patch rendering and editor action, still without dependency suggestions.
4. Add addition-only read/write proposals from static and conformance evidence.
5. Run fresh npm Clique and plain-CRUD controls; compare authored contract
   lines, correction loops, review errors, time to first green proof, and
   semantic correction/false-acceptance rates by confidence and evidence class.
6. Consider bulk or multi-operation application only in a successor RFC after
   measured review behavior; v1 remains single-suggestion only.

### Rollout 4 implementation note — 2026-08-15

Charlie Cheever ruled that Rollout 4's `runtime-witnessed` evidence may source
LLP 0146 D1 facts from `snapback.verify-receipt.v1` while LLP 0146 remains
Draft, with one non-negotiable provenance boundary: the evidence class must
say `scope: 'explicitly-registered-paths-only'`, and a receipt with no
registered acceptance paths remains `status: 'not-claimed'` rather than a
coverage claim.

The implementation consumes the conventional `.snapback/verify-receipt.json`
only when its artifact identity matches the current generated manifests. It
validates the complete receipt schema and then checks profile/path membership,
evidence counts, aggregate status, and that under/over declarations are exactly
derived from the retained path reports. A receipt path whose `functionId` is
null can identify a generated operation only when its normalized path id maps
to exactly one generated function identity; ambiguous paths produce no
addition. The analyzer binds admitted receipt bytes into `analysisInputId`,
retains receipt/profile/path/target/function and read-or-write provenance on
every proposed table, and projects only aggregate `underDeclarations` with a
positive registered path set and a status other than `not-claimed` or
`blocked`. The closed dependency-change record has `mode: 'addition-only'`,
`completeSetClaim: false`, and an `additions` array; it has no removal member,
and `overDeclarations` are not consumed. An already-declared table is silent.

The conventional auto-discovered receipt is advisory. Any failure to read,
parse, schema-admit, envelope/consistency-admit, or identity-admit it—including
legacy main-era `blocked` receipts with zero registered paths—is a fail-open
machine-readable warning and supplies no runtime evidence rather than
suppressing result-only suggestions. Explicitly passed receipt paths remain
fail-closed, including the explicit evidence rereads used by the compare-and-
write seam. Changing an admitted retained receipt before that seam yields
`SNAPBACK_DECLARATION_SUGGESTION_STALE` without changing source.
`snapback verify` also emits the same empty `not-claimed` aggregate for zero
registered paths when an upstream stage blocks execution, rather than a
zero-path `blocked`/`failed` coverage shape.

The Rollout 4 corpus runner now reports evidence-class counts beside the
candidate-confidence distribution. Its 2026-08-15 source-only rerun covered 33
backends and reproduced 106 candidates: 20 exact (18.87%), 37 schema-derived
(34.91%), 36 holed (33.96%), 13 refused (12.26%), and 0 widened. The corpus
retains no verify receipts, so `runtime-witnessed` reported 0 candidate
suggestions, 0 receipts, 0 not-claimed receipts, 0 additions, and 0 path
witnesses. That zero is a corpus-input fact, not a broader evidence claim;
`sourceBytesChanged` remained false.

## Acceptance

- A returned object containing stored documents plus computed fields produces a
  paste-ready exact contract or explicit holes; it never emits `any`/`unknown`.
- Applying the displayed patch and running normal generation yields the same
  contract hash and runtime validation as an equivalent hand-authored block.
- A source, helper/type closure, schema/generated-type, compiler-configuration,
  analyzer, or evidence-receipt change between suggestion and the D1 apply
  protocol refuses the stale patch; manual paste makes no stale-safe claim.
- Branch-only and helper-hidden dependencies never produce removal suggestions.
- An observed undeclared read proposes only an addition and retains its
  path-specific provenance.
- No suggestion can add or narrow auth, effects, secrets, capabilities,
  retention, or public exposure.
- Removing all suggestion receipts leaves a fully reviewable and enforceable
  application.
- A fresh builder can accept or repair one proposal without reading package
  source, and the benchmark records proposal acceptance and correction rates.

## Risks

- Authors may rubber-stamp plausible output. Consequence rendering, holes, and
  no v1 bulk-apply reduce but cannot remove review responsibility.
- TypeScript inference can be weaker than runtime contracts. Fail-closed holes
  are preferable to invented refinements.
- Suggestions can become noisy. They are on-demand in v1; ordinary generation
  reports only existing conformance violations.
- Static dependency analysis can appear stronger than it is. Evidence classes
  and addition-only behavior prevent a sampled or incomplete set from becoming
  an authority ceiling.

## Open questions

1. Should a later CI mode require that a committed suggestion receipt matches
   source, or would that create a second declaration authority?
2. Which computed numeric patterns can prove integer/finite refinements without
   inventing application bounds?
3. Does measured review quality justify an editor-local multi-operation apply
   action after v1?

## Status

Accepted. This RFC defines an authoring assistant, not TypeScript-as-contract
authority; LLP 0108 and LLP 0146 remain the governing declaration and
conformance owners. Accepted by the author on 2026-08-12 at the revision bound
by the final single-family GPT-5.6 Sol READY review.
