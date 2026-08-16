# Confirming delta review (round 4): LLP 0234 — Visibility override governance

**Reviewer model:** gpt-5.6-sol (xhigh)

**Provider/runtime:** OpenAI / Codex

**Date:** 2026-08-15

**Document revision reviewed:** Revised 2026-08-15 (round-6 targeted delta-review response)

**Redacted:** No

**Method:** Targeted confirmation of the three items left open by the round-5 r3 artifacts. Reviewed both r3 artifacts, the round-6 section of `REVISION-NOTES.md`, and the revised Summary, D1, D3, D5, G0, Costs, Acceptance 1/2/4/25, OQ1/OQ5, Status, and revision-history context. This was not a whole-document re-review.

## Resolution of the round-6 open set

| Open item | Verdict | Reason |
| --- | --- | --- |
| gpt-5 r3 MATERIAL — green verdict did not bind the staged authorization artifacts | **RESOLVED** | Before green, the protected observer now checks out the judged `after` OID and derives the staged artifacts itself or verifies a separately custodied builder attestation that names that OID, protected key epoch, toolchain/generator versions, and every identity field. The signed verdict carries `schemaHash`, `functionBundleHash`, `generationInputsHash`, and any separately staged `visibilityAuthorizationProgramDigest`; the defined closures cover governance baselines and every other authorization-program input (`llp/0234-visibility-override-governance.rfc.md:544-564`). Activation obtains the verdict through target custody, verifies the externally pinned observer epoch, recomputes every identity field from the staged artifacts and governance inputs, and requires deep equality before atomic activation (`:570-592`). Acceptance 4 and 25 keep the green OID/verdict fixed while independently swapping schema, function bundle, governance baseline, and other authorization-program input, with every mismatch refusing before activation (`:1708-1723`, `:1852-1862`). This is the requested implementable OID → deployment-identity attestation and host-side binding, including the swap-negative family. |
| claude r3 MINOR — inline-alias runtime diagnostic wording | **RESOLVED** | D1 now distinguishes syntactically visible escape forms, which codegen refuses as `SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE`, from scanner-invisible aliases, which receive no generated capability and are refused by the closed host-call boundary before storage as `SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED` (`:224-245`). G0 requires both enforcement paths, and Acceptance 1 names the hidden-alias runtime-refusal fixture (`:1424-1433`, `:1669-1686`). The wording now matches the actual alias-proof enforcement locus. |
| claude r3 MINOR — codegen receipt-signature trust root | **RESOLVED** | Codegen's trust root is now the committed observer-key registry keyed by epoch and digest; when target custody is reachable, codegen cross-checks that selection against the target-owned pin. The RFC explicitly limits exported-tree verification with a tree-supplied registry to integrity/accident detection and leaves the forgery fence at activation's externally pinned observer epoch (`:515-523`, `:570-589`). G0 provisions the registry, target cross-check, epoch/revocation handling, and target pin (`:1409-1422`), while Acceptance 2 proves both the target-connected match and rejection at activation after a receipt-plus-tree-key replacement (`:1687-1698`). |

## NEW findings introduced by round 6

None. The changed sections introduce no new MATERIAL or MINOR concern.

VERDICT: READY
