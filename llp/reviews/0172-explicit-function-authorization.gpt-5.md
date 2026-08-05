# LLP 0172 review — gpt-5 family

**Target:** `llp/0172-explicit-function-authorization.rfc.md`
**Reviewed revision:** `63967ae6a759e9c9d51d03a8b7eef84d6db0252b`
**Capsule sha256:** `15b25f1650ff65f0…`
**Runner:** codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only
**Independence:** **SELF-REVIEW** — this family authored the document. Adversarial instruction applied; reduced weight.
**Topology:** independent loop

---

## Round 1 — 2026-08-04

Provenance note: under LLP 0005, this is an adversarial author-side pass, not an independent-family review artifact.

1. **[MATERIAL] Verified current behavior / Scope** — The supplied source does not establish the RFC’s central compatibility premise. `define.mjs` proves only that present values are restricted to three spellings; the `index.mjs` excerpts pass through `fn.authRequirement` or `def.auth`. None shows `def.auth ?? 'optional-user'`, manifest-loader defaulting, or fail-closed output behavior. The excerpts also expose auth-bearing asset-intent authorizers without classifying whether they fall inside the supposedly closed function scope.  
   **Fix:** Cite and test the exact normalization, identity, diagnostic, and manifest-loading paths for every in-scope function kind. Explicitly classify asset intents, callbacks, cron wrappers, and job targets as included or excluded.

2. **[MATERIAL] Proposal §§1–3 / Non-goals / Acceptance** — The RFC acknowledges that manifest loading also defaults omissions, but W/E enforcement is specified only for codegen. It never decides whether Phase E loaders reject missing requirements/provenance, continue accepting legacy manifests, or version their interpretation. Consequently, the claim that the final sessions API has no default is not established, while rejecting legacy manifests during implementation would introduce an unspecified compatibility break. Acceptance tests only generation entry points, not provisioning or loading.  
   **Fix:** Decide the manifest-level contract: format/version changes, Phase W and E loader behavior, treatment of old manifests, and stale generated artifacts. Test omission through actual provisioning and startup. If this is intentionally only an authoring lint, narrow the universal and “no default” claims accordingly.

3. **[MATERIAL] Closed requirement provenance / Acceptance 6** — `derived` is a load-bearing but undefined witness. The RFC does not specify who may assert it or how codegen proves that a particular versioned constructor fixed the requirement. With ordinary JavaScript objects, author code can potentially forge, copy, spread, or erase origin metadata. Acceptance 6 states the desired outcome but provides no buildable trust mechanism. This could falsely silence the diagnostic and mislead review evidence.  
   **Fix:** Make derivation codegen-owned—for example, an opaque constructor or registry binding generator ID/version to a fixed requirement, with author-supplied or damaged provenance rejected. The cheaper alternative is to remove the exemption and require every final emitted definition to contain `auth`, even when a generator supplied it. Add forgery, cloning, spreading, and mutation tests.

4. **[DETAIL] Diagnostics / Acceptance 1** — Diagnostics makes `sourceSpan` conditional (“when codegen can identify it”), while Acceptance 1 requires it unconditionally. Generated definitions may not have a direct authoring span.  
   **Fix:** Either require generators to preserve a source location or make the acceptance criterion allow an explicit unavailable span plus generator identity.

5. **[DETAIL] Verified current behavior / Acceptance 5** — The admission table mentions only anonymous and user-bearing authority, while the cron discussion says `public` and `optional-user` are compatible with distinct `system` authority.  
   **Fix:** State explicitly whether system authority is treated as anonymous by this check or add it to the admission table.

What is good: the core explicitness change is narrow and avoids silently converting omissions to `authenticated`. Explicit `optional-user` remains available, and the RFC correctly separates authentication from row authorization and internal-only invocation. It does not rely on `authScopeField` as an identity witness; the supplied export path instead disqualifies a non-null `authScopeField` from the authority-independent profile. The cross-entry-point diagnostic parity and pre-handler denial acceptance tests are also strong.

NOT READY
