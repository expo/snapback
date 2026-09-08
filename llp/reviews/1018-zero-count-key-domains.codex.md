# LLP 1018 paired-proof key-domain review — Codex

**Reviewer:** independent collaboration agent `/root/review_fixes`; session
identifies Codex based on GPT-6; exact variant/reasoning unavailable
**Date:** 2026-09-07
**Target:** uncommitted paired-proof patch on base `7b947aa4d`, before key-domain guard
**Method:** bounded source inspection, including native lookup/admission and public wire hydration; no builds/tests
**Verdict:** CHANGES_REQUIRED

The reviewer found one material authority gap. Native point admission checks
arity but can accept `String("alice")` against a Principal grouping index. Its
physical miss differs from `Id("alice")`; public projection erases the tag and
schema-based hydration restores Id. The proposed range could therefore become
false empty-group coverage for an existing public, unheld ordinary survivor.
Combining it with an independently legitimate canonical primary absence could
let the twin predict an insertion that violates the survivor's unique group.

The reviewer required native-to-wire-to-schema key identity before admitting
either optional proof, conservatively omitting unsupported domains. Existing
cursor validation was insufficient because it admits sentinel nulls and JSON
variants for another purpose. Otherwise the paired physical reads, authority
gate, retained point, exact receipt scope and certificate composition appeared
coherent. Actual-size checks bound admitted bytes, not all transient allocation.

**Author disposition:** accepted. `cap.rs` now limits the optimization to typed
scalar columns (recursively through Optional) and validates each key with the
existing column validator. JSON and compound descriptors omit the proof pair;
invalid lookup keys preserve the original query and mint no additional proof.
The regression retains noncanonical survivors and exercises both String/Id
mismatches and required Null. The follow-up review is recorded separately.
