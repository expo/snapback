# Review: LLP 0021 — Contract/Exact integration hardening

**Reviewed:** `llp/0021-contract-exact-integration-hardening.plan.md` (working-tree revision after the Claude review pass)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-27
**Redacted:** No — reviewed against the in-repo Snapback LLP corpus, diaries, and adjacent local Exact LLPs 0263/0265. No additional external reviewer or provider was invoked beyond this GPT-5 Codex session.
**Method:** Same-session read-and-critique, grounded by LLP 0005, LLP 0012, LLP 0016, LLP 0017, LLP 0020, diaries 0001/0003, and local Exact LLPs 0263/0265. Requested as "`$llp-review 0021` revise if you see ways you can make it better"; this pass applied the revisions marked below.

> **Independence note.** LLP 0021's Author line includes Codex, so this GPT-5/Codex review should **not** be counted as a separate cross-family review under the LLP 0005 honesty rule. The existing Claude artifact remains the independent cross-family review. This artifact is useful as a same-family close-out pass over the revised plan, especially because it directly checked the Snapback plan against Exact 0263/0265.

## Overall assessment

LLP 0021 is a strong and appropriately scoped Plan. After the Claude pass, its core shape is right: Snapback owns the adapter, generated artifacts, packaging recipe, diagnostics, and deletion of demo-local glue; Exact owns Contract language/compiler/runtime semantics; LLP 0012 and LLP 0020 own the shared headless/core facts. The Plan also correctly keeps the first adapter in the Online capability class and refuses to let Contract become a private backend.

The remaining gaps were mostly at the seam between Snapback's adapter plan and Exact's current Contract data-binding RFCs. Exact 0263 is explicit that Contract imports TypeScript descriptor modules, not raw JSON manifests; Exact 0265 is explicit that row-shape honesty, component lifecycle, provider diagnostics, and verification/conformance are part of making the data path boring. LLP 0021 cited those RFCs, but the body did not yet carry several of those constraints into Snapback acceptance gates. I applied narrow revisions to make those constraints visible without moving Exact-owned language work into Snapback.

## Strengths

- **Good ownership boundaries.** The Scope and Non-Goals sections keep Contract syntax, Exact native protocol, React/Expo adapter design, and core `ctx.db`/typed-artifact/realtime work out of this Plan while preserving the shared generated-artifact contract.
- **The projection framing is the right default.** Treating `ContractDataManifest` as a Contract-side projection over LLP 0012 artifacts, not a parallel source of truth, matches LLP 0012's registry discipline and avoids duplicating row shapes, capability classes, and read/write summaries.
- **Online-vs-Parity honesty is preserved.** The adapter can offer optimistic Online behavior, but the plan requires it to report Online until local handler execution, offline queueing, deterministic replay, and rebase-on-reconnect exist.
- **The plan is falsifiable.** The phase gates require bridge deletion, stale-manifest diagnostics, cross-surface mutation observation, server-only bundle inspection, Exact-optional core tests, and native/web packaging diagnostics.
- **The diary evidence is used with restraint.** Diary 0003's correction that the admin gap was fluency/tooling rather than Contract expressiveness keeps the plan focused on adapters, packaging, diagnostics, and recipes.

## Concerns

- **C1 — The Exact import seam was under-specified. [Medium] [Applied]** Exact 0263 says Contract `use` imports resolve TypeScript modules classified as query/mutation symbols; raw JSON manifests are not the Contract import surface. LLP 0021 discussed manifests and descriptors but did not require the generated TypeScript descriptor-module seam. That left room for the current sidecar/manual-module pattern to persist. *Resolved by:* Phase 1 now requires a provider manifest module plus per-query/per-mutation descriptor modules and gates ordinary generated bindings on avoiding hand-written `.contract-meta.ts` sidecars.

- **C2 — Row-shape and hash honesty needed one more guardrail. [Medium] [Applied]** The plan already said Contract analysis should catch field mistakes, but Exact 0265 distinguishes direct table rows from projected/computed query results and explicitly allows unknown shapes only with degraded diagnostics. LLP 0012 also warns that codegen input hashes and handler bundle hashes must not be compared as if they are the same thing. *Resolved by:* Phase 1 now requires direct table row aliases only for table-shaped queries, query-result aliases for projections/computed results, visible degraded-type diagnostics for unknown shapes, and explicit separation between `inputsHash` freshness and handler `bundleHash`.

- **C3 — Provider lifecycle was not part of the adapter contract. [Medium] [Applied]** LLP 0012 covers reference race handling, but Exact 0265 adds a separate lifecycle requirement: subscriptions follow component lifetimes and dispose on unmount/HMR reset. LLP 0021 previously required hydration and unsubscribe semantics but not mount/remount/HMR cleanup or runtime-link staleness prevention. *Resolved by:* Phase 2 now requires provider lifecycle ownership, subscription identity by manifest id plus args, dedupe allowance, disposal on unmount/reset/HMR, and stale runtime-link prevention.

- **C4 — Happy-path mutation proof was not enough. [Medium] [Applied]** Phase 2 required a successful Contract action to mutate Snapback and be observed by the headless client. That is necessary, but Exact 0263/0265 also make rejection/rollback, provider diagnostics, and conformance part of the data contract. Without a failure-path gate, optimistic Online behavior could look green while rejection left stale UI. *Resolved by:* Phase 2 now gates rejected mutations on re-publishing affected query cells and surfacing diagnostics, and requires the adapter to pass the Contract DataProvider conformance subset for claimed capabilities.

- **C5 — Surface migration should include generated descriptor modules, not just the adapter and manifest. [Low-Medium] [Applied]** Phase 4 already said todo/admin should consume the adapter and `ContractDataManifest`; after C1, the generated descriptor modules are also part of the product surface. *Resolved by:* Phase 4 and diagnostics now name missing/stale/inconsistent descriptor modules explicitly.

## Open questions

- **`ContractDataManifest` ownership remains the largest real decision.** The plan's body now leans projection-over-LLP-0012, while the Open Question still asks whether the artifact is specified in Snapback, Exact, or a shared boundary LLP. Keep the Plan in Draft until that is deliberately answered.
- **Conformance suite ownership is still split.** The Snapback adapter should pass the claimed-capability subset, but Exact likely owns the canonical Contract DataProvider conformance tests. The implementation should avoid a Snapback-only test harness that drifts from Exact's provider contract.
- **Descriptor-module generation may require an Exact-side affordance.** If Contract still needs hand-written sidecars for generated query/mutation modules, that is an Exact dependency, not Snapback app glue. Track it under Phase 5 rather than quietly copying sidecars into each surface.

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0021 in `Draft`. The revisions make the plan sharper but do not resolve the manifest ownership question. The next author decision should be whether `ContractDataManifest` is formally a projection registered into LLP 0012's artifact/versioning machinery or a shared Snapback/Exact boundary artifact. Once that is answered, Phase 1 can become implementation-ready.
