# Confirming delta review (round 4): LLP 0234 — Visibility override governance

**Reviewer model:** claude-fable-5
**Date:** 2026-08-15
**Document revision reviewed:** Revised 2026-08-15 (round-6 targeted
delta-review response)
**Review scope:** confirming delta reviewer for the round-6 targeted revision,
blind to every other r4 artifact. Read in order:
`llp/reviews/0234-visibility-override-governance.gpt-5.r3.md`,
`llp/reviews/0234-visibility-override-governance.claude.r3.md`, the round-6
section of `REVISION-NOTES.md`, and the revised RFC sections those
dispositions touch (Summary, D1, D3 loci 1/3/4, D5, G0, Costs, Acceptance
1/2/4/25, OQ1/OQ5, Status, revision history), with surrounding context for
coherence. Whole-document re-review was not required and was not performed.

## A. Resolution of the round-5 open set

| Item | Verdict | Reason |
| --- | --- | --- |
| Green verdict must bind the staged authorization artifacts (gpt-5 r3 MATERIAL 1) | RESOLVED | The suggested resolution is adopted as written and end-to-end. Before emitting green, the protected observer checks out the exact `after` OID and either derives the staged artifacts itself or verifies an attestation from a separately custodied builder whose configuration/key the judged push cannot alter; that derivation produces the exact `DeploymentIdentity` — `schemaHash`, `functionBundleHash`, `generationInputsHash` — plus `visibilityAuthorizationProgramDigest` when the program is staged separately, with `generationInputsHash` covering the complete canonical governance-input closure; the observer copies the attested identity fields into the signed verdict rather than trusting deployment-request fields (`llp/0234-visibility-override-governance.rfc.md:544-566`). Activation locus 4 obtains the verdict through target custody, verifies it under the externally pinned observer epoch, recomputes all four identity fields from the staged artifacts and governance inputs, and requires deep equality before the atomic activation point; a mismatch refuses with the dedicated `SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH`, and a bundle/request field can supply neither OID, verdict, key epoch, checkpoint, nor expected identity (`:570-591`). The requested negative family exists twice: Acceptance 4 holds one green OID/verdict fixed and swaps staged schema, function bundle, governance baseline, and any other authorization-program input one at a time, each refusing before activation (`:1710-1723`), and Acceptance 25 requires every target profile to enforce OID-derived identity recomputation/deep-match and run the same swap family (`:1852-1864`). The benign-commit-C/authorization-bundle-D pairing the finding named is now impossible without breaking the deep match. Summary, D5, G0 (`:1407-1415`), Costs (`:1600-1608`), OQ1/OQ5, and Status carry the change coherently. |
| Scanner-invisible inline-alias runtime diagnostic understated (claude r3 MINOR 1) | RESOLVED | D1's inline bullet now states that the static `SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE` refusal reaches only forms the scanner can see, and that a scanner-invisible alias such as `const c = ctx; c.db.elevated.get(...)` yields no admitted capability, its eventual host call refusing before storage with `SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED` (`:226-236`). Acceptance 1 adds the required hidden-alias runtime-refusal fixture in exactly those terms (`:1678-1687`), and G0 repeats the enforcement-locus split (`:1428-1432`). This is the one-sentence-plus-fixture completion the finding asked for. |
| Codegen receipt-signature trust root unnamed (claude r3 MINOR 2) | RESOLVED | D3 locus 1 names the trust root: the committed `snapback/visibility-governance-observer-keys.json` registry binding observer keys/digests to epochs, with codegen cross-checking the selected epoch and key digest against the target-owned pin where target custody is reachable; with only a tree-supplied registry, the check is explicitly integrity/accident detection, not a forgery fence, and activation's externally pinned epoch remains the fence (`:515-524`). Acceptance 2 fixtures both the target-connected cross-check and the replaced-receipt-plus-replaced-key case that only activation may reject (`:1692-1700`), target configuration pins the codegen-registry key digest (`:628-631`), and Costs states the per-locus honesty requirement (`:1604-1607`). This is the finding's suggested resolution, adopted as written. |

## B. NEW findings introduced by the round-6 revision

None. I probed the changed sections for the failure modes the new binding
could plausibly introduce and found each closed or honestly fail-closed:

- **Verdict selection/replay:** even if the target channel could serve a green
  verdict for a different OID, the host's recomputed-identity deep match
  refuses any staged artifacts not derived from that verdict's judged OID
  (`:570-591`), and the pinned latest quarantine-ledger checkpoint refuses
  stale/rolled-back sets (`:579-586`); pairing attacks reduce to breaking the
  deep match or forging the externally pinned signature, which is the already
  stated privileged-control-plane residual (`:632-638`).
- **Recomputation determinism/toolchain skew:** the verdict carries
  comparator/input and build-tool versions and the builder attestation names
  toolchain/generator versions (`:560-566`); any skew between observer/builder
  derivation and host recomputation yields a mismatch and refuses — an
  availability cost, not an authority leak — and Costs already prices
  observer/builder availability as authority availability (`:1592-1608`).
- **In-tree registry trust:** the tree-only-versus-target-pinned distinction
  is now stated per locus rather than implied, so no locus overclaims.

## Summary

The single round-5 MATERIAL and both MINORs are genuinely resolved with
implementable mechanisms — a signed identity-carrying verdict, host
recomputation with a dedicated refusal code, named trust roots, and negative
fixture families in Acceptance 1, 2, 4, and 25 — each adopted in the form the
originating reviewer specified, and the round-6 changes introduce no new
material concern in the sections they touch.

VERDICT: READY
