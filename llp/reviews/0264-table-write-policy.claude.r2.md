# Delta review (round 2): LLP 0264 — Table write policy

**Reviewer family:** Claude
**Provider / runtime:** claude-fable-5
**Date:** 2026-08-15
**Redacted:** no
**Method:** fresh-session delta review; blind to the other family's round-2
artifact. Inputs read in order: both round-1 reviews, `REVISION-NOTES-0264.md`,
the revised Spec in full, and the shipped code where a claim is load-bearing
(`src/manifest.rs`, `src/runtime.rs`, `packages/snapback-codegen/standard-patterns.mjs`,
`llp/0234-visibility-override-governance.rfc.md`).
**Revision reviewed:** `llp/0264-table-write-policy.spec.md`, Revised
2026-08-15 (round-2 dual-family response).

## A. Resolution of round-1 findings

| Finding | Disposition | Reason |
| --- | --- | --- |
| GPT MATERIAL 1 — write-axis comparator + policy-removal ambiguity | RESOLVED | D1 now explicitly extends LLP 0234 D5's shared body/digest/baseline/ledger/comparators with a versioned `writePosture` axis ("The comparator is read × write; `narrowing` requires neither axis to broaden"; old readers refuse the new schema version), worked both directions (`public-read|any-of -> owner` governed, `owner -> public-read` governed); D2's frozen installed-lineage migration root plus `SNAPBACK_TABLE_WRITE_POLICY_REMOVAL_REFUSED` (D10) close the removal/omission route; acceptance item 10 carries every requested comparator case, including `owner -> omitted` and new omission before/after G0/G1. Verified against 0234 D5's actual read-only order ("fewer admitted principals/rows is narrower, `public-read` is the maximum"). |
| GPT MATERIAL 2 — HostPlan absent-disposition binding | RESOLVED | D4 introduces the sealed `ownerWriteCheck` carrier binding `no-effect`/`refuse` with canonical public code/message/details **bytes** and digest, applied before row binding; Scope's absent-semantics definition and D4 both state `Get`/`Guard` is never the carrier and never write authorization; aliasing/uncertain prior reads refuse fail-closed unless compounded or provably composed to identical absent bytes; D9 carries `absentDisposition`/`absentDispositionDigest`; acceptance item 3 has the exact requested negatives (bare `Get`, differing Get/Guard codes, same-id multi-read/write, missing and other-owner rows, byte-identical public results). |
| GPT MATERIAL 3 — uniqueness existence oracle | RESOLVED | D3's unique-conflict disclosure gate requires every reachable constraint (patch reach with uncertainty-as-reach) to contain the owner field or be named in the closed `discloseUniqueConflicts` fact, mirroring the shipped `SNAPBACK_STANDARD_PATTERN_DISCLOSURE_REQUIRED` rule (`standard-patterns.mjs:278-305`, verified); otherwise generation/activation refuses (`SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED`); the residual bit is projected (`uniqueConflictDisposition`) and D8 names it a residual disclosure, with "Error redaction alone cannot close the bit" stated in D3. Alice/Bob insert and patch fixtures are in acceptance item 2. |
| GPT MATERIAL 4 — D9 multi-site / runtime vocabulary | RESOLVED | D9 now keys rows operation × stable `siteId` × form × table fact ("same-form/table sites never collapse"), expands closed runtime ceilings one row per member, defines a complete opaque row with explicit `runtime-resolved`/null vocabulary for every target-dependent scalar, splits `preflightChecks[]` from `authoritativeChecks[]`, and keeps per-site `sourceEvidence` ("never a merged/dropped scalar"); acceptance item 9 requires golden rows for multi-site, runtime-ceiling-member, and opaque classes. The ceiling substrate exists (`EffectCeiling`, `src/manifest.rs:8558-8566`). |
| Claude MATERIAL 1 — write-posture widening rides comparator as self-proving narrowing | RESOLVED | Same mechanism as GPT 1: two-axis product order recorded as a 0264-owned extension of the shared comparator ("its read-only order is insufficient"), the exact remedy the finding offered as an alternative to a 0234 amendment; `genericWriteDisposition` change to owner-admitted is broadening, requiring 0234's remotely prior approval, receipt, ratchet, and activation verdict. |
| Claude MATERIAL 2 — declared-then-deleted revert + pre-G0 mechanism | RESOLVED | D2 names the concrete predecessor source (versioned root frozen from the protected immediately prior installed lineage, deep-matched and retained through G1, empty for a fresh app); removal refuses in every phase (D1, D2 table row, D10 code); "`legacy-undeclared` exists only at D2's root" closes the relapse route where a root member gains `owner` and then deletes it — the ledger predecessor, not root membership, governs; Phase 1 states the body/digest/comparator include write posture from first activation with broader/incomparable edits refusing without remote authority, making the pre-G0 "inert/refused" claim implementable. |
| Claude MATERIAL 3 — uniqueness oracle | RESOLVED | Same disposition as GPT 3; the gate lives at the D1 policy locus (generation/activation over both generic forms), not only inside `defineOwnedCrud`. |
| Claude MINOR 4 — unclassified write-bearing `MutationStep` variants | RESOLVED | Scope pins the closed classification: five generic, `AssetCollection` (LLP 0239 D2) and `AllocateSequence` (LLP 0135) specialized, five non-writers. Verified exhaustive against the shipped enum (`src/manifest.rs:10097-10182`, exactly twelve variants). |
| Claude MINOR 5 — D9 fields undefined for runtime/opaque rows | RESOLVED | Every target-dependent field now has pinned runtime/opaque values in the D9 table (`runtime-resolved`, null, `ownerFieldResolution`), plus per-member expansion for closed ceilings. |
| Claude MINOR 6 — refusal precedence unpinned | RESOLVED | D10 pins the full precedence chain and the specific doubly-ineligible case (`SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE` wins over row-policy ineligibility). |

## B. New findings on the revision's new surface

1. **MINOR — the phase at which opaque targets refuse is stated inconsistently
   between D3 and D9.** D3's disclosure gate says "Runtime sites satisfy all
   ceiling members; opaque ceilings refuse," which makes every opaque-target
   generic insert/patch refuse at generation from Phase 1 (the gate cannot
   bound constraint reach without a ceiling). D9 says, unqualified, "Phase 2
   refuses opaque targets," which reads as opaque sites being tolerated and
   projected in Phase 1. Both readings are fail-closed, and the reconciliation
   (insert/patch refuse in Phase 1 via the D3 gate; opaque delete/delete-where
   survive as projected `opaque` rows until Phase 2) is recoverable, but an
   implementer must infer it. **Suggested resolution:** one sentence in the
   Phase-1 bullet list or D9 pinning the per-form asymmetry explicitly.

2. **MINOR — D4's "independently composed to identical absent bytes" escape
   hatch does not explicitly quantify over intermediate steps that observe the
   aliased binding.** A plan with `Get(id, elseError: X)`, then a guard on
   another field of the bound row with code `Y`, then a carrier-checked
   `Patch` bound to `X` yields `X` for a missing row and `Y` for another
   owner's row — an existence oracle — even though the Get's own absent bytes
   match the carrier's. The fail-closed default ("aliasing/uncertain prior
   read refuses") and acceptance item 3's "differing Get/Guard codes" negative
   arguably cover this, but the proof obligation should be stated as ranging
   over the complete public plan outcome for a not-owned row, not just the
   adjacent read's declared error. **Suggested resolution:** add that sentence
   to D4 and one negative fixture (identical-bytes `Get`, divergent
   intermediate guard, checked write) to acceptance item 3.

3. **MINOR — the shared-ledger schema now has normative text in two documents
   that disagree until LLP 0234 is amended.** LLP 0234's own text still scopes
   its machinery to reads ("An override declaration may list writes only as
   non-authoritative review facts") while D1 extends the same shared body,
   digest, baseline, ledger, and comparators with `writePosture`. The
   0264-owned extension was an explicitly offered round-1 remedy and the
   schema-version refusal rule makes coexistence implementable, so this is not
   blocking; but a reciprocal amendment or pointer in LLP 0234 should land
   with Phase 1 so the shared ledger schema has a single owner of record.
   **Suggested resolution:** note the required 0234 pointer in the Phase-1
   bullet list or Related section.

## Assessment

All seven round-1 MATERIAL findings and all three MINOR findings are genuinely
resolved with implementable, code-consistent mechanisms; the new surface
(two-axis comparator, disclosure gate, sealed absent-disposition carrier,
per-site projection) introduces only clarity-level residue, each with a
one-sentence fix and none security-affecting in its fail-closed reading.

VERDICT: READY
