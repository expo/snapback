# Declarative plan refusal codes bypass the app-refusal envelope and are never cross-checked against `refusals`

**Opened:** 2026-08-08 · **Severity:** P3 (contract-coherence; found by the guide
refusals pass, Lane H of the 2026-08-08 sweep, commit d1e4c57d9)
**Status:** Partially resolved 2026-08-10; envelope unification remains open

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

## Lane D resolution (2026-08-10)

The declaration cross-check is implemented. Codegen now refuses a plain
declarative mutation when an app-namespaced `Get.elseError` or `Guard` code is
absent from that function's `refusals`, with
`FUNCTION_PLAN_REFUSAL_UNDECLARED` identifying the function, step kind,
zero-based step index, and code. Served manifest validation independently
enforces the same invariant with
`SNAPBACK_FUNCTION_PLAN_REFUSAL_UNDECLARED`. Host-owned `SNAPBACK_*` outcomes
remain outside the app declaration because the reserved namespace is already
forbidden in `refusals`.

The envelope question remains open. This change does not route declarative
plan outcomes through `SNAPBACK_APP_REFUSAL`, does not add `appCode` to their
runtime envelope, and does not rule the existing split intentional. That
requires the owning-LLP decision explicitly excluded from this lane.

## Resolution — 2026-08-10 (option (a))

Codegen rejects undeclared application codes from `Get.else_error` /
`Guard.else_error` with `FUNCTION_PLAN_REFUSAL_UNDECLARED` (function, step
kind, index, code); server manifest validation independently rejects the
same artifact with `SNAPBACK_FUNCTION_PLAN_REFUSAL_UNDECLARED`. Reserved
`SNAPBACK_*` codes are exempt (cannot appear in app `refusals`).
latency-kanban's declarative mutations now declare the two shared codes the
new validation exposed; the declarative-plans and mutations guide pages state
both facts. Option (b) — routing plan failures through the
`SNAPBACK_APP_REFUSAL`/`appCode` envelope — remains explicitly unimplemented
and needs an owning-LLP (0012/0043 lineage) ruling; re-file there if wanted.
