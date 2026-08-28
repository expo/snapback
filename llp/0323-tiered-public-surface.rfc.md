# LLP 0323: A tiered public surface

**Type:** RFC
**Status:** Withdrawn
**Systems:** Client, React/Expo, Code generation, Guide, Developer
experience, Agent experience, Packaging
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-27
**Revised:** 2026-08-27 (b — **Withdrawn** by the author after round 1 of
`llp-super-refine`; see Withdrawal below. Both families returned NOT READY
(codex 4 MATERIAL / grok 2 MATERIAL) and the defects are not revisable without
replacing the proposal.) 2026-08-27 (a — Draft → Review at llp-super-refine
loop start, the one authorized transition)
**Related:** LLP 0064, LLP 0194, LLP 0114, LLP 0259, LLP 0061, LLP 0318,
LLP 0319, LLP 0320, LLP 0322, LLP 0314.001

## Withdrawal (2026-08-27)

The diagnosis misses implemented prior art and the proposal is
internally inconsistent.

`@expo/snapback-react` already exports `.`, `./core`, `./familiar`, and
`./thumbhash`; `core.mjs` states that "the package root remains the
compatibility composition" and LLP 0145 records that decision with a
measured 44-46% bundle reduction for `/core`. The guide documents
`/core` in 88 places including a working import in
`guide/clients/react.md`. Tiering exists. The real proposal is
*inverting* the default from Full to Core, which is a different and more
contestable argument the RFC never makes.

A small default root and zero removed published identities are also
mutually exclusive, because tracked identities are module-qualified
(`npm:@expo/snapback-react#useSnapbackAssetUpload`): moving a symbol to
`/assets` removes one identity and creates another. §3's "every one of
the 4,248 identities stays reachable" therefore contradicts §2's byte
claim, and LLP 0314.001 had delegated its registry reduction here on the
premise of "fewer published symbols."

The sketched eight-name core is also not the output of the RFC's own
Rule 1 — the shipped React template imports `useSnapbackAuth`,
`useSnapbackConnection`, `useSnapbackCurrentPrincipal`,
`useSnapbackMutation`, and `useSnapbackQueries`, while `usePresence`,
`useUpload`, and `useConnection` are not current exports at all.

This document is retained unrevised as the record of the proposal and
its refutation. The reviews are the durable artifact:
[codex](./reviews/0318-one-authoring-profile.codex.md) /
[grok](./reviews/0318-one-authoring-profile.grok.md) for the
authoring-surface cluster,
[codex](./reviews/0322-tiered-diagnostic-codes.codex.md) /
[grok](./reviews/0322-tiered-diagnostic-codes.grok.md) for the
size-and-hygiene cluster, with the run journal at
[`0318-one-authoring-profile.run.md`](./reviews/0318-one-authoring-profile.run.md).

Everything below is the original text as reviewed. Its claims were not
corrected; several are false and are enumerated above.

## Summary

`guide/reference/published-symbols.json` tracks **4,248 published symbol
identities**. `guide/reference/registry.json` describes **1,461 symbols
across 56 modules** and is 5.16 MB. The generated reference for one
package, `guide/reference/expo-snapback-client.md`, is **501 KB**.

Snapback's public API is not too *capable*. It is too *flat*: everything
a client can do is reachable from a top-level import, so nothing signals
what an ordinary app needs versus what exists for a specific arm,
subsystem, or benchmark.

This RFC proposes tiering the published surface — a small default export
per package, everything else behind explicit subpath exports — so that
the generated reference has an obvious first page and a cold agent has an
obvious first import.

Confidence is **0.8**. The tiering is uncontroversial; the partition and
the migration are the work.

## 1. Evidence

**Client.** `packages/snapback-client/package.json` lists on the order of
forty published files (`app-client`, `app-data`, `agent-authority`,
`answer-classes`, `argument-normalization`, `assets`, …), and the
generated reference for the package is 501 KB.

**React.** `packages/snapback-react` exports 28 hooks:

```
useSnapbackQuery          useSnapbackQueries         useSnapbackMutation
useSnapbackSettledMutation                           useSnapbackOptimisticCreate
useSnapbackCommand        useSnapbackOutbox          useSnapbackConnection
useSnapbackAuth           useSnapbackCurrentPrincipal
useSnapbackAuthorityMutation   useSnapbackAuthorityMutationStatus
useSnapbackAuthorityMyRole     useSnapbackAuthorityRoster
useSnapbackPresence       useSnapbackActivityPresence
useSnapbackAssetUpload    useSnapbackAssetUrl        useSnapbackAssetImage
useSnapbackMedia          useSnapbackMediaCollection
useSnapbackDiagnostics    useSnapbackProviderClient  useEphemeralRepublisher
useSurface
useQuery  useMutation  useAction        (familiar profile)
```

A todo app needs three of these. Several —
`useSnapbackAuthorityMutationStatus`, `useSnapbackOptimisticCreate`,
`useSnapbackSettledMutation`, `useSnapbackMediaCollection` — read as
answers to specific situations that were promoted to top-level names
rather than to options on an existing hook. `[inferred]`

**Authoring.** `packages/snapback-codegen/define.mjs` exports 140 names.
Roughly 60 are the expression IR, ~20 are `is*Def` type predicates that
no application ever calls, and 31 are constructors
([LLP 0319](./0319-one-query-constructor.rfc.md) addresses the
constructors, [LLP 0320](./0320-plan-ir-as-compiler-output.rfc.md) the IR).

## 2. Proposal

**Three tiers per package, expressed as export subpaths.**

| Tier | Contains | Import |
|---|---|---|
| Core | what a straightforward app needs | `@expo/snapback-react` |
| Extended | real capability, not everyday | `@expo/snapback-react/assets`, `/authority`, `/presence` |
| Internal | seams for arms, harnesses, benchmarks, codegen | `@expo/snapback-react/internal` |

Sketch for React core — target ~8 names:

```
SnapbackProvider
useQuery  useMutation  useAction
usePresence
useAuth
useUpload
useConnection
```

Everything else moves to `/authority`, `/assets`, `/media`,
`/diagnostics`, `/internal`. No capability is removed; each becomes one
explicit import away.

Rules:

1. **Core is defined by the templates.** A symbol is core iff a shipped
   template or the canonical benchmark app imports it. That is a
   mechanical, re-checkable rule rather than a taste judgment, and it
   ties the tier to evidence about what apps actually use.
2. **`/internal` carries no stability promise** and is excluded from the
   published reference. LLP 0194's generated reference then describes a
   contract rather than an inventory.
3. **The reference is generated per tier.** `guide/reference/index.md`
   opens on core. The 501 KB flat listing becomes a small first page with
   drill-down — which is also ~1 MB off the shipped corpus
   ([LLP 0314.001](./0314.001-derived-guide-bytes.rfc.md) §2c defers to
   this RFC for exactly that reason).
4. **`published-symbols.json` gains a tier field**, so the lifecycle
   tracking that already exists (`removedSymbols`, 120 entries) can
   enforce stability *per tier* rather than uniformly.

## 3. What this does not do

- **It does not remove exports.** Every one of the 4,248 identities stays
  reachable. Tiering is about the default import and the first page of
  the reference.
- **It does not merge hooks.** Whether
  `useSnapbackSettledMutation` should be `useMutation({ settled: true })`
  is a real question and a good one, but it is a separate change with
  separate risk. This RFC only moves it out of the core import.
- **It does not change the wire protocol or the client's behavior.**
  Pure packaging and documentation topology.
- **It does not decide the hook naming question.** LLP 0318 OQ3 owns
  whether core spells it `useQuery` or `useSnapbackQuery`. The table above
  uses the short form illustratively, not as a ruling.

## 4. Open questions

- **OQ1 — Does "imported by a template" produce a sane core?** It is
  mechanical, which is its virtue, but templates are chosen and may
  under-represent common needs (error handling, optimistic updates). Run
  the rule against the template corpus and the `demos/` tree and inspect
  the result before adopting it.
- **OQ2 — Tree-shaking versus subpaths.** Subpath exports are for
  *cognitive* size; they do not shrink a bundle that a modern bundler
  would tree-shake anyway. If bundle size is also a goal, that is a
  separate measurement and possibly a separate answer. This RFC claims
  the cognitive benefit only.
- **OQ3 — Does `/internal` need to be published at all?** Arms,
  harnesses, and the acceptance runner consume it across package
  boundaries, so probably yes — but if the consumers are all in-repo, it
  could stay unpublished, which is a larger reduction.
- **OQ4 — Interaction with LLP 0318.** Profile convergence removes one of
  the two React hook families outright. Doing that first makes this
  partition considerably easier; doing this first means partitioning a
  surface that is about to lose a third of its names.
- **OQ5 — Ordering against LLP 0319/0320.** Both shrink `define.mjs`
  substantially. Tiering the authoring surface before they land means
  tiering names that are scheduled for deletion.

## 5. Cost

Low for the packaging change (export maps plus re-export shims),
moderate for the generated-reference change (LLP 0194's generator becomes
tier-aware), low-but-wide for updating imports across demos, templates,
and fixtures.

## 6. Sequencing

This RFC is the natural *last* of the batch. LLP 0318 removes a hook
family, LLP 0319 removes ~12 constructors, LLP 0320 removes ~60 IR
exports, and LLP 0322 removes most of the diagnostics surface. Tiering
what remains is both easier and more meaningful than tiering what exists
now.

## 7. Why it matters

A 4,248-symbol public surface with no tiering means the generated
reference — the artifact LLP 0194 built specifically so agents would stop
guessing signatures — opens on a wall. The LLP 0259 read budget assumes
the first page is the useful one. Tiering is how you make that true
without deleting anything.
