# Review artifact — LLP 0221 (GPT family)

**Round:** 1
**Date:** 2026-08-10
**Target:** llp/0221-offline-search-parity.rfc.md (revision b, blob 3520dfe726862631ba846ef056a960e4bccfe18f)
**Capsule:** sha256-16 e0e655a7a895dd81 (target + Related LLPs 0043/0053/0073/0126/0129/0131/0155/0166/0189/0201 + P2 pilot record + social-messenger brief + 3 issue tickets + code copies/excerpts of snapback-codegen define.mjs/index.mjs, snapback-client index.mjs/materialization-store.mjs, src/search/sqlite.rs, typed-search-wrapper.test.mjs; llp/reviews/* excluded)
**Reviewer runtime:** codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, --sandbox read-only, capsule cwd
**Verdict:** NOT READY

Extraction note: final message taken verbatim from after the last "tokens used" line of the codex transcript; the leading token-count residue line ("182,118") is CLI framing, not review text, and is omitted.

---

The review below is sealed verbatim as received.

---

1. **MATERIAL — Phase 4 bypasses the governing source-row evaluation gate.**

   **Evidence:** LLP 0221 lines 75–80, 129–134, and 200–204 introduce a locally evaluable document corpus and derived index. LLP 0155 lines 709–725 and LLP 0166 D7 lines 1670–1674 explicitly defer source-row evaluation behind LLP 0155 OQ2’s projection-aware authority gate; LLP 0166 lines 1968–1970 currently prohibit cross-query normalization and local execution of a plan’s source-row pipeline. Merely listing these documents as Related does not establish amendment or precedence.

   **Minimal fix:** Make Phase 4 conditional on an owner-approved successor amendment advancing that gate. State whether the search corpus is a single-address, query/partition-scoped exception with no cross-query row sharing, or an admission of normalization; require separately authorized corpus projections rather than deriving authority from online indexed fields.

2. **MATERIAL — `partial` contradicts the cited completeness vocabulary.**

   **Evidence:** LLP 0221 lines 141–143 says an unproved no-hit reports `unknown`/`partial` “per LLP 0166 §D4.” LLP 0166 D4 lines 1112–1121 says everything outside proved completeness is `unknown` or `refused`, adds no sixth answer class, and specifically says partial hydration yields `unknown` for the requested scope. LLP 0221 separately introduces a `coverage` fact, so an implementer could reasonably—but incorrectly—add `partial` to completeness.

   **Minimal fix:** Say incomplete scope reports `completeness: "unknown"`; represent partiality only through the orthogonal `coverage` fact. Do not add a new D4 answer class.

3. **MATERIAL — The conformance design does not bind the promised work-limit equivalence.**

   **Evidence:** The binding promise at lines 54–56 includes identical work-limit outcomes, but Phase 1’s profile and corpus at lines 182–185 enumerate only Unicode, matching, ranking, and highlights. LLP 0073 lines 481–488 makes logical work accounting and exact-or-refuse behavior semantic, and its acceptance lines 825–827 requires at/below/one-over ceiling cases. Unless work counters and effective ceilings are bound into the semantic-profile identity, the same named profile and corpus can still produce different limit outcomes.

   **Minimal fix:** State that the semantic-profile version/hash binds logical work units, counting rules, and every effective ceiling. Add at-limit and one-over-limit vectors to the dual-runtime conformance corpus.

MINOR-only:

- **MINOR — Pilot evidence is overstated.** The score values are correct, but the run record labels them N=1, builder-scored, calibration-only evidence. It does not itself substantiate the claim that every lane implemented matching over an application-owned cache, nor prove that exactly these three findings “produced” the score. Label the score accordingly, change “produced” to “contributed to,” and either cite retained per-lane artifacts or narrow the all-lanes claim.

- **MINOR — Phase 2’s restart proof does not match its stated ownership.** A pure evaluator over caller-supplied rows owns no IndexedDB or Node persistence. Either make the restart tests conditional on a public-data corpus prototype shipping in Phase 2, or move them to the owned-corpus phase.

- **MINOR — Phase 0 citation precision.** The supplied code verifies the fix shape, but not commit `f8e8892af` or its `main` status. Also, client line ~321 covers reference validation; delegation to `query()` is around lines 5618–5648. Cite both locations and a release/commit receipt if the exact commit assertion is retained.

- **MINOR — Unicode-table subsetting needs a semantic guardrail.** Open question 2 should say a subset is acceptable only if it remains observationally complete for the same profile; otherwise it requires a distinct versioned profile with explicit admission/refusal rules.

VERDICT: NOT READY

---

# Round 2

**Round:** 2
**Date:** 2026-08-10
**Target:** llp/0221-offline-search-parity.rfc.md (revision c, blob 39d9fb03ce25c1af814e8e7c706e54a3e7fe89e3)
**Capsule:** sha256-16 2669dbb06b79760c (round-1 capsule set + revision-c target + LLP 0157; llp/reviews/* excluded)
**Reviewer runtime:** codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, --sandbox read-only, capsule cwd
**Verdict:** NOT READY (both MATERIALs IN-DELTA; pre-existing text clean)

Extraction note: final message taken verbatim from after the last "tokens used" line of the codex transcript; the leading token-count residue line ("146,888") is CLI framing, not review text, and is omitted.

---

The review below is sealed verbatim as received.

---

1. **MATERIAL — IN-DELTA: the claimed semantic delta omits token-boundary behavior.**

   Evidence: revision (c) says prefix support already exists and therefore “the actual deltas” are normalization and ordering (`0221` lines 135–137). The benchmark requires punctuation to split words (`social-messenger.md` lines 518–525), while LLP 0073 keeps internal U+0027/U+2019 apostrophes inside tokens (lines 245–250). Thus `can't` tokenizes differently even after normalization and ordering are corrected. Reusing the existing analyzer as directed would fail the declared benchmark semantics.

   Minimal fix: state that the prefix atom is reusable, but the new profile must also pin benchmark-compatible token boundaries, including apostrophes. Add an apostrophe boundary conformance vector.

2. **MATERIAL — IN-DELTA: `prefer-online` still lacks a safe fallback trigger.**

   Evidence: `0221` lines 159–166 now define the mid-sequence cursor divergence, but never state which online failures permit local fallback. Falling back after an authorization, revocation, custody, contract, corruption, or work-limit response could mask a stronger server decision. Current client behavior distinguishes connectivity failures explicitly (`snapback-client-index` lines 5608–5614), and LLP 0043/0053/0166 make authority transitions render-blocking.

   Minimal fix: define v1 fallback as connectivity/transport failure before a semantic server response only. Never fall back from authorization, custody, contract, corruption, or work-limit refusals; the local path must independently pass its current witness, fence, and lease checks.

### MINOR-only

3. **MINOR — IN-DELTA:** The assertion that `issues/closed/20260809-typed-search-reference-hash-skew.md` is closed cannot be verified from the capsule: that artifact is absent, and no included file corroborates it. Include the closure artifact in the evidence set or remove/qualify the assertion.

4. **MINOR — IN-DELTA:** `0221` lines 282–285 attributes offline-search ownership uncertainty to LLP 0126 OQ6/OQ7. OQ6 covers the search mechanism and capability ID; OQ7 concerns ownership of the embedded-runtime design specifically. The general named-owner requirement is in LLP 0126 §Relationship. Cite OQ6 plus §Relationship, retaining OQ7 only for an embedded-runtime alternative.

5. **MINOR — IN-DELTA:** “Otherwise it reports `unknown`” at lines 168–173 can read as collapsing LLP 0166 D4’s existing `refused` case. Qualify this as “when evaluation is admitted but completeness is unproved”; established refusal states must remain `refused`.

6. **MINOR — IN-DELTA:** OQ2 should say that a same-profile fail-closed Unicode subset is a declared input-admission capability and is covered by in-range, boundary, and out-of-range vectors. If cross-runtime comparison is claimed for that identity, both evaluators must apply the same admission gate.

7. **MINOR — PRE-EXISTING:** The additive result facts should be explicitly confined to the rotated offline-capable reference/result overload. LLP 0073 defines a closed `SearchPageV1`, and the current client returns exactly `{items, cursor, hasMore}`; say that legacy online calls retain that shape.

No PRE-EXISTING MATERIAL concerns remain; the pre-existing text is clean at the material level.

VERDICT: NOT READY
