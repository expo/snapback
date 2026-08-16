# LLP 0134 D-4 range relaxation needs sound scope derivation

**Status:** Open — needs-design
**Filed:** 2026-08-16
**Systems:** Capability maturity, Claim snapshots, Testing, CI
**Related:** LLP 0134, LLP 0189,
`issues/20260807-llp-0189-claim-snapshot-implementation.md`

## Goal

Allow a capability promotion to advance across a commit range instead of
requiring `candidateSourceSha == candidateParentSha`, while validating the
range against the capability's true LLP 0189 D-4 surface. The eventual design
must preserve A5's binding to the promotion commit's actual sole parent and
must fail closed when any semantics-affecting part of that surface changed
without requalification.

Until that design is accepted and implemented, LLP 0134 promotion keeps the
exact-pin rule. E2 own-corpus scoping, E4(a) claim-surface audit/ref-check
scoping, and A5's transition/tree checks remain independently useful at that
one exact parent; none authorizes evidence reuse across a range.

## Four-cycle finding history

Four review cycles exposed three distinct derivation-authority leaks:

1. **Cycle 1 — unconstrained self-narrowing.** The receipt could declare an
   arbitrarily narrow scope, repeat it in its audit/range evidence, and omit a
   changed part of the capability surface.
2. **Cycle 2 — floor-only self-narrowing.** Adding a generic five-path floor
   still let the receipt omit capability runtime modules, semantic checkers,
   conformance inputs, and target capability manifests.
3. **Cycle 3 — orphan non-transition promotion.** Treating earlier promotion
   receipts as derivation sources let a schema-valid receipt introduced
   without any maturity transition bootstrap range authority for a later real
   promotion.
4. **Cycle 4 — equal-pin promote/demote/re-promote bootstrap.** Requiring the
   earlier receipt to be transition-bound was still insufficient. A genuine
   first equal-pin promotion of an underived capability could self-declare a
   floor-sized scope; after demotion, that receipt became apparent derivation
   authority for an advanced re-promotion and hid an intervening runtime
   change.

The sequence shows that patching receipt provenance does not establish scope
completeness. This is a design problem, not another local validator fix.

## Design bar

A receipt must never be self-authorizing for its own first promotion's
minimum. Derivation authority must come from independently code-derived scope
proven at the promoting commit, not from prior receipts' self-declared scope.

A sound proposal must therefore define:

- the code-owned source of the complete per-capability D-4 surface;
- how that source closes over runtime, semantic checkers, conformance inputs,
  generated/manifest inputs, and the scope-derivation code itself;
- how the promoting commit proves the derived scope and the checked range
  without a receipt/hash cycle;
- behavior for atomic capability sets, missing derivations, re-scopes,
  demotion/re-promotion, and incomparable history; and
- adversarial fixtures for all four cycles above, including a first promotion
  with no prior authority.

## Done when

An accepted LLP amendment defines that authority model, the validator derives
and proves the true surface independently at the promoting commit, all four
attack histories refuse, legitimate clear-range promotion succeeds, and the
exact-pin fallback remains available and tested.

## Resolution (2026-08-16) — DISCHARGED by LLP 0271 (shelve)

Two dual-family super-refine rounds concluded D-4 range relaxation is not worth a sound implementation: the sound form needs a complete build-input closure (falsified by scripts/runtime-build-inputs.txt), a trusted base-revision execution root (the H/HEAD tamper), and witnessed-not-named evidence — all disproportionate to a rarely-usable optimization when exact-pin is already sound. LLP 0271 (Decision, Accepted) records the finding and retains exact-pin. The one genuine exact-pin hole the exploration surfaced (the A5 sole-parent merge bypass) is filed at issues/20260816-capability-maturity-a5-merge-bypass.md for independent fix.
