# LLP 1018 key-domain repair follow-up — Codex

**Reviewer:** independent collaboration agent `/root/review_fixes`; session
identifies Codex based on GPT-6; exact variant/reasoning unavailable
**Date:** 2026-09-07
**Target:** final `cap.rs` key guard and LLP 1001 delta, subsequently committed in `6b8530f6e`
**Method:** bounded source follow-up; no builds/tests
**Verdict:** no new material finding in this bounded follow-up

The reviewer concluded the update closes the reported wire-domain
counterexample. Scalar validation rejects String/Id mismatches and out-of-range
integers before constructing optional evidence. Recursive descriptor filtering
excludes JSON and compound cases, including optional wrappers. Valid optional
nulls and supported scalar variants retain identity through projection and
hydration. Invalid keys preserve original query behavior; LLP 1001 accurately
describes the restriction.

This is source-review clearance, not independently executed test evidence.
**Author disposition:** accepted; final native controls and public-owner rerun
remain separately recorded validation obligations.
