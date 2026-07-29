# Backend bakeoff first-rerun corrections

**Status:** Closed
**Impact:** 5  
**Urgency:** 5  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Authoring, Security, React, Client integration, Developer experience, Acceptance testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** `demos/signal-desk/acceptance/results/bakeoff-first-rerun.v1.json`, LLP 0108, LLP 0114, LLP 0109, LLP 0110, LLP 0112
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
- Add dedicated capability requirements for the two LLP 0110 profiles so a
  target cannot publish either from type/code presence alone.
- Replace the cold browser-secret proof's field-name scan with a random
  high-entropy canary that would be inlined if the build leaked it.
- Make every competitor live witness non-vacuous and comparably bounded.
  Convex must not accept a stale row from a reused deployment; Supabase must
  start its delivery budget after the insert and may use only one recorded
  retry with a fresh transport and witness.

## Official rerun checkpoint — 2026-07-28

The first v2 aggregate receipt is retained at
`demos/signal-desk/acceptance/results/backend-bakeoff-run.87f231220e684164ec23a3d48a8b646cc141483205dc52d23597f2fd33f5d557.v2.json`.
It is intentionally and validly failed: seven of eight commands passed and
Supabase Realtime alone timed out. Fable 5 independently reverified its
content digest, all logs and child projections, the clean source binding, and
the runtime identity; the complete review is retained under
`demos/signal-desk/acceptance/reviews/official-rerun-round1-fable-5.md`.

The review found that the Convex arm could pass from a stale witness in the
initial subscription snapshot while Supabase used a single shared deadline.
The corrected arms now use isolated nonce-bound incidents, subscription-ready
barriers, separate post-insert delivery budgets, timestamped evidence, and
cleanup. Convex uses distinct actor and observer clients, bounds cleanup, and
closes both transports even when cleanup fails. Supabase's one retry owns a
fresh client/socket/channel/witness.

The integrated security re-audit also found and closed a final browser proof
overclaim: receipts now distinguish proof-owned transformations bounded before
allocation after host return from nine exact browser collection APIs whose
result allocation cannot be bounded until the host call returns.

## Resolution — 2026-07-28

The final retained receipt is
`demos/signal-desk/acceptance/results/backend-bakeoff-run.43d6c570f7f3f752f61ca545a1d81ef1a1a6b3b4d34fbe0066a6becc95d3d989.v2.json`.
It binds clean source revision `f789a143`, passes all eight required lanes with
zero timeouts, and reopens every child/log digest. Its Convex lane proves a
nonce traveled from a distinct actor to observer after subscription readiness;
cleanup and both client closes are bounded. Its Supabase lane retains a failed
first delivery and the one permitted successful fresh-transport retry.

Fable 5 reviewed both the failed and first green checkpoints. The final
integrated review at retention commit `7f92156b` re-ran the standalone
verifier, 8/8 runner tests, 64/64 publication/browser/authority tests, and the
LLP reference audit, and returned `READY` with no blocker. The comparison and
diary now narrate the final result. All acceptance criteria are met.

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
