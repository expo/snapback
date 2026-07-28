# Backend bakeoff first-rerun corrections

**Status:** In Progress  
**Impact:** 5  
**Urgency:** 5  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Authoring, Security, React, Client integration, Developer experience, Acceptance testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** `demos/backend-bakeoff/acceptance/results/bakeoff-first-rerun.v1.json`, LLP 0101, LLP 0102, LLP 0103, LLP 0104, LLP 0107  
**Marker:** backend-bakeoff, first-rerun-feedback

The first full rerun deliberately stopped short of a revised ranking: the
Snapback comparator selected a native runtime older than the generated route
manifest and failed before executing a check. A fresh Fable 5 review and an
adversarial implementation audit then found security, cleanup, and evidence
contracts that must be corrected before rerunning.

## Mandatory corrections

- Enforce every write-with-activity non-scope row's foreign key and protected
  relation incarnation against the selected scope's current active
  incarnation inside the same transaction. Cross-scope and stale
  delete/recreate rows must collapse to the public missing-row outcome.
- Fail closed on inline-handler computed member access that static admission
  cannot resolve. Computed and destructured constructor aliases must not reach
  `Function` construction.
- Remove React cleanup's dependency on the AdminWrite disconnect route.
  Unadopted registered owners use only their grant-owned socket seam; adopted
  and ordinary providers retire through child reference counts without
  disrupting a sibling provider sharing the connection.
- Infer sessions startup artifacts in ordinary `snapback dev`, and translate
  generated/runtime decoder drift into a first-class identity diagnostic with
  exact recovery guidance.
- Rebuild and select the current binary before rerunning the comparator.

## Contract and evidence closure

- Make bounded-children results a sealed discriminator with exactly one outer
  row in runtime validation and generated API/provider/Contract types.
- Preserve optional stored JSON as one JSON contract rather than an
  overlapping `null | json` union.
- Require generated Query search references, keep the search page nominal,
  reject `after: null`, and distinguish the ordinary query wire result from
  `client.search()`'s page projection.
- Type the exact versioned-seed preview, ensure, reset-install, and clear
  carriers and reject impossible operation/artifact/predecessor combinations.
- Bind sessions comparator evidence to the server-minted principal; classify
  development labels as asserted behavioral identities and retain an explicit
  authentication nonclaim.
- Add dedicated capability requirements for the two LLP 0104 profiles so a
  target cannot publish either from type/code presence alone.
- Replace the cold browser-secret proof's field-name scan with a random
  high-entropy canary that would be inlined if the build leaked it.

## Acceptance

- Focused adversarial tests cover every item above, including stale-orphan
  patch/delete, dynamic computed constructor keys, zero/two bounded rows,
  shared-provider cleanup, structural search-page lookalikes, invalid seed
  variants, asserted-versus-authenticated comparator identity, and deliberate
  stale-runtime restart.
- Generated artifacts, Guide pages, and LLP evidence are reconciled with the
  implemented contracts.
- The complete Signal Desk contract, Snapback, Convex, Supabase, TypeScript,
  production-build, and browser/nonclaim matrix is rerun and retained.
- An independent final review finds no material correctness, safety, evidence,
  or overclaim defect.
