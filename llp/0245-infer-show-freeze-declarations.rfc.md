# LLP 0245: Infer, show, and freeze declarations

**Type:** RFC
**Status:** Review
**Systems:** Authoring, TypeScript, Code generation, Application data API,
Diagnostics, Developer experience, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (entered an author-invoked, single-family GPT-5.6 Sol
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
```

The command reads the stable source snapshot and generated schema/type facts,
then emits either a unified patch or `DeclarationSuggestionV1`. It never edits
source, replaces generated artifacts, or activates a generation. Applying the
patch is a separate explicit editor/user action.

Each suggestion binds operation id, source and schema digests, compiler and
analyzer identities, the frozen declaration before/after, evidence per proposed
field, confidence class, and diagnostics. A stale source/schema digest makes a
later apply refuse and requires regeneration.

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
unresolved. `--apply` is deliberately absent from v1. Editors may offer an
"Apply patch" action only after rendering the semantic consequences and exact
source diff; bulk acceptance remains an explicit author action recorded by the
editor, not by Snapback runtime authority.

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
   lines, correction loops, review errors, and time to first green proof.
6. Consider a guarded apply command only in a successor RFC after measured
   review behavior; v1 itself has none.

## Acceptance

- A returned object containing stored documents plus computed fields produces a
  paste-ready exact contract or explicit holes; it never emits `any`/`unknown`.
- Applying the displayed patch and running normal generation yields the same
  contract hash and runtime validation as an equivalent hand-authored block.
- A source/schema change between suggestion and apply refuses the stale patch.
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

Draft. This RFC proposes an authoring assistant, not TypeScript-as-contract
authority. It requires review against LLP 0108 and LLP 0146 before acceptance.
