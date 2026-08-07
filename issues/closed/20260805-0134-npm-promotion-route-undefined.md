# LLP 0134 has no route for an npm `latest` promotion receipt

**Status:** Closed — superseded by the 2026-08-06 author ruling
**Opened:** 2026-08-05
**Systems:** Packaging, Capability maturity, Testing
**Related:** LLP 0041, LLP 0074, LLP 0113, LLP 0122, LLP 0134,
`issues/closed/20260803-first-npm-latest-promotion.md`,
`issues/closed/20260806-llp0134-bar-vs-npm-promotion-ruling-needed.md`

## Production-use finding

The first production execution of
`issues/closed/20260803-first-npm-latest-promotion.md` reached its evidence
boundary
at candidate source
`4c8245a1a05e4f5f724771e7557f9a583bac2410`. Main local-proof run
`31035872210` is green with 119 selected gates passing, zero failed or blocked
gates, and only the two expected not-selected gates. Qualified staging run
`019fd366-7f4c-7998-a1ff-1c4382ac338d` then completed successfully for version
`0.1.9` at that exact source revision: both runtime builds, assembly, both
staged cold installs, and retained release are green. Its ledger and tarballs
validate, but the real-publication consumer separately rejects the EAS-hosted
platform receipts; that independent producer/consumer gap is recorded in
`issues/closed/20260805-eas-qualified-receipts-rejected-by-publish-validator.md`.

The capstone's step 2 asks for per-route `soakEvidence` and a
`MaturityPromotionReceiptV1` pinned to the package candidate's
`candidateSourceSha` and `stagedTreeManifestSha256`. That receipt cannot be
constructed honestly from the recorded instruction:

1. LLP 0134 governs a named capability-id transition from `experimental` to
   `stable`. Its receipt requires a non-empty `capabilityIds` set, a governing
   LLP, the exact maturity registry transition, one of its two closed routes,
   and author adjudication. The npm capstone names none of those facts and
   does not authorize any capability maturity change.
2. LLP 0134's Non-goals explicitly leave npm dist-tags and release ledgers to
   LLP 0041/0111. An npm channel move is therefore not itself an LLP 0134
   promotion act.
3. The only retained production-tree soak observation is
   `tests/acceptance/maturity/inline-handler-local-dev-2026-08-03.soak-observation.json`.
   On 2026-08-05 it supplies one local profile/day cell, not the default
   route's required 14 consecutive UTC days immediately preceding a
   promotion. There is no complete observation window, bound defect search,
   two-tree audit pair, consumer evidence set, or author adjudication from
   which a valid receipt could be emitted. The record also concerns
   `inline_handler_v1`; selecting it merely because a record exists would be
   an unsupported claim-increasing transition.
4. LLP 0122's 2026-08-02 npm-gating decision says the local package closure
   may promote when it satisfies LLP 0134's maturity bar, while LLP 0134 says
   packaging/channel policy is out of scope. The production instruction turns
   that reference into a request for an actual maturity receipt, exposing the
   missing bridge between the two evidence systems.

No receipt, soak day, capability id, or stable claim was fabricated. No npm
candidate or `latest` tag has been mutated by this finding.

## Resolution needed

Record which evidence contract governs an npm-only channel promotion. At
minimum it must decide one of these shapes without weakening LLP 0134:

- define a package/channel promotion receipt under LLP 0041/0113 that binds
  the green source proof, qualified nine-package staging ledger and both
  platform receipts, honesty audit, publication lease, registry observations,
  and final cold-install receipts, while making no capability maturity
  transition; or
- name the exact capability id set and governing LLP that is intended to move
  to stable, then wait for and retain every LLP 0134 E1-E8 item, including the
  complete non-retroactive 14-day window and a dated author adjudication.

Reconcile the capstone ticket and LLP 0122 with LLP 0134's channel-policy
non-goal in the same landing. Until then, qualified staging may finish and be
retained, but the capstone must stop before any npm publication or dist-tag
mutation.

## Resolution — 2026-08-06

Author decision sitting #4 ruled that LLP 0134 governs capability maturity,
not npm packaging. LLP 0041 owns npm packaging evidence; the ceremony bar is
qualified staging receipts after the EAS-provenance repair, without an LLP
0134 soak requirement. The complete ruling and its implementation pointer are
retained in
`issues/closed/20260806-llp0134-bar-vs-npm-promotion-ruling-needed.md`.
This ticket closes as the production-use evidence that elicited that ruling;
no maturity receipt or capability transition is imputed retroactively.
