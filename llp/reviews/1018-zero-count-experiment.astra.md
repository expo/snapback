# LLP 1018 count experiment review — Astra

**Reviewer:** gpt-6-astra, xhigh, fresh Codex CLI session
**Date:** 2026-09-07
**Session:** 01a07de7-4878-7c30-a61b-4ec6b31f1086
**Target:** 56b0323bd9c4512f039d4bf628a7c72cdd913fca
**Method:** Supplied source capsule only; no tools or tests
**Redacted:** No

## Author disposition

This review found no material source issue within its supplied capsule, but
the actual public-client witness subsequently disproved the intended prediction
outcome. The capsule did not include the target unique-index check called by
aggregate insertion; its TypeScript coverage description was insufficient.
The count patch was removed instead of using this review as evidence of
successful behavior. See the open zero-count ticket and LLP 1018 §13.
This artifact is not approval of the final reduced delivery.

## Actual review

**No material finding remains for target `56b0323bd9c4512f039d4bf628a7c72cdd913fca` within the supplied capsule.**

The original grouping lookup remains authoritative. The additional probe runs only after a physical group miss on an eligible public Count target, verifies the primary index shape, and records absence only when that separate lookup misses. Both noncanonical survivor cases preserve the original result.

Certification reserves additional steps and receipt bytes, propagates them through composition, and declares the primary index and constraint dependency. Reusing the one-row examined allowance is sound: the grouping lookup and fallback cannot both hit. The receipt absence is contained in the server trace; the constraint trace matches its declared check.

The tests meaningfully cover primary absence acquisition, both survivor cases, eligibility exclusions, and admission refusal under a tight closure budget. The public integration scenario exercises cold reopen, prediction, reconnect, unheld counts, and atomic overflow. The declaration witness checks the actual generated package graph under both declaration settings and enforces the negative assignment.

This is a **source-only verdict**: no tools, additional files, builds, or tests were used. The reported typing results were not independently reproduced; native/public execution remains pending as stated. Unchanged envelope filtering, TypeScript coverage behavior, and live invalidation are assessed under the supplied custody descriptions. This verdict does not establish complete cold scalar-zero queries. The author remains the decision maker.