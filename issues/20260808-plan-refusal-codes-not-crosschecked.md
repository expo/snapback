# Declarative plan refusal codes bypass the app-refusal envelope and are never cross-checked against `refusals`

**Opened:** 2026-08-08 · **Severity:** P3 (contract-coherence; found by the guide
refusals pass, Lane H of the 2026-08-08 sweep, commit d1e4c57d9)

## Observed

Declarative host-plan `elseError`/`guard` codes are delivered as
`diagnostic.code` itself (`mutation_plan_refusal`, `src/storage.rs` ~16100),
**not** wrapped in `SNAPBACK_APP_REFUSAL` with an `appCode` the way
`ctx.refuse(code)` refusals are. And codegen never cross-checks plan codes
against a function's declared `refusals: [...]` list — `demos/warble` declares
`refusals: ['POST_NOT_FOUND']` on a plan mutation, and that declaration is
documentation-only today.

## Why it matters

A client written to branch on one envelope shape for "application refusals"
silently misses the other family. The guide now documents the split honestly
(guide/backend/mutations.md, landed d1e4c57d9), but the platform seam is
incoherent: two channels for the same concept, one typed and declared, one
neither.

## Ask

Either (a) route plan `elseError`/`guard` codes through the same
`SNAPBACK_APP_REFUSAL` + `appCode` envelope, treating `refusals` as the single
declaration for both imperative and declarative refusals (codegen refusing an
undeclared plan code), or (b) rule the split intentional in the owning LLP and
make codegen at least warn when a plan code appears in `refusals` (where it is
inert). Owner seam: mutation semantics / declarative plans (LLP 0012/0043
lineage); coordinate with the open refusal-discoverability ticket
`20260808-guide-gap-declared-refusals-discoverability.md`.
