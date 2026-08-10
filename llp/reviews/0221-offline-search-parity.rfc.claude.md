# Review artifact — LLP 0221 (Claude family)

**Round:** 1
**Date:** 2026-08-10
**Target:** llp/0221-offline-search-parity.rfc.md (revision b, blob 3520dfe726862631ba846ef056a960e4bccfe18f)
**Capsule:** sha256-16 e0e655a7a895dd81 (target + Related LLPs 0043/0053/0073/0126/0129/0131/0155/0166/0189/0201 + P2 pilot record + social-messenger brief + 3 issue tickets + code copies/excerpts of snapback-codegen define.mjs/index.mjs, snapback-client index.mjs/materialization-store.mjs, src/search/sqlite.rs, typed-search-wrapper.test.mjs; llp/reviews/* excluded)
**Reviewer runtime:** Claude family via Agent tool (subagent_type general-purpose), capsule-confined read-only instructions
**Verdict:** NOT READY

---

The review below is sealed verbatim as received.

---

I have read the target RFC in full and verified its claims against the capsule evidence (benchmark record, three issue tickets, LLP 0073/0126/0131/0155/0166/0043, the brief's §Search, and the line-numbered code excerpts). Here is my review.

# Review — LLP 0221 (Round 1, blind reviewer)

## Citation verification summary

The following load-bearing citations all check out against the capsule:

- B6 scores 55/58/65 and lane posture — `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` lines 44 and F5.
- 582 ms p50 / 806 ms p95, 10k-message chat, 166k-action envelope, 31–77 ms other probes, Convex 82 ms p95 posture-different — both the record (§Scale-envelope probe data) and `issues/20260809-membership-search-envelope-latency.md`.
- LLP 0073 offline-search nonclaim at line 1034 ("retention/resume, and offline search remain nonclaims") — exact.
- Analyzer `snapback-category-unicode17-v1` (0073 line 221), Unicode 17 `toNFKC_Casefold` (line 240), `score-desc-row-id-asc.v1` (line 172), recency deferred to "a later scorer with a declared typed timestamp" (0073 §Ranking line 369) — all exact.
- Brief §Search pins NFC, Unicode simple case folding, word-prefix, newest-first (`benchmarks/briefs/social-messenger.md` lines 518–526) — exact.
- Contract-hash-skew mechanism and fix shape — matches LLP 0131's 2026-08-09 amendment (lines 1278–1313), the codegen excerpt (`searchRequestContractHash` at ~10666, cited as ~10661, acceptable with the tilde), the client marker check (~310–366, cited as ~321), and the landed `typed-search-wrapper.test.mjs` matrix, which does cover plain + membership references, the corrupted-hash refusal (`SNAPBACK_SEARCH_REFERENCE_INVALID`), and the missing-resource refusal (`SNAPBACK_ARGUMENT_VALIDATION_FAILED`) before I/O.
- Phase 0(b) code diagnosis — the single pre-traversal seat lookup is exactly at `src/search/sqlite.rs` 1798–1817; the non-sargable `substr(token,1,length(?5))=?5` prefix predicates are at 1528/1551 inside `posting_candidates_for_atom` (cited ~1503, the function head — fine); the per-candidate source lookup + authoritative reload/re-analysis loop starts at 1857–1928 with the final per-item authoritative recheck at 2003–2040. The RFC's refinement of the ticket's "membership filter composes badly" hypothesis is evidence-backed and sound.
- Custody-gate framing matches `issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` exactly: leg 1 (query-authorization namespaces, signed `AuthorizedLease`, equality-expiry deletion-before-render) is the only leg still open.
- "Fragments, not searchable source rows" — LLP 0155 §"Store model: fragments first, normalization gated" (line 642). Completeness-honest no-hit rule — LLP 0166 §D4. Both exact.

## Concerns

**1. MATERIAL — OQ2's "table subset" option can silently break the qualified parity promise, and Phase 1's conformance proof as written would not necessarily catch it.**
Evidence: OQ2 asks "is a table subset acceptable for the kernel rung?" with no constraint tying the answer to the promise. Binding decision 3 promises identical matches/ordering/highlights/work-limit outcomes *for the same semantic-profile version*. A JS kernel shipping a subset of the Unicode 17 `toNFKC_Casefold`/category tables (0073 lines 221–240) under the *same* profile version would diverge from the Rust analyzer exactly on out-of-subset codepoints — and Phase 1's proof ("the committed corpus, both runtimes green") only witnesses equivalence over whatever the corpus contains; the motivating benchmark corpus is explicitly Latin-only (brief lines 524–526), so a Latin-weighted conformance corpus would be blind to the divergence. An implementer resolving OQ2 with "subset is fine" would break the promise without any red gate. This is a missing load-bearing constraint, not an implementation-detail demand.
Minimal fix (two sentences, within recorded direction): amend OQ2 to state that any table subset must either (a) be a distinct declared semantic-profile/artifact identity, or (b) fail closed (refuse analysis) on out-of-subset input — never a silent divergence under the same profile version; and amend Phase 1's proof to require the conformance corpus to include out-of-subset / non-Latin / edge-codepoint vectors so the dual-runtime gate actually witnesses analyzer equivalence at the table boundary.

## MINOR-only list

- **M1 — Phase 2 scope ambiguity around the restart tests.** Phase 2 is defined as "pure JS evaluator over caller-supplied rows; no protected-data retention," yet its proof includes "IndexedDB and Node restart tests for the non-protected path," which implies something persists. Whether the §Surfaces derived corpus/index record (non-protected variant) is in the Phase-2 rung or deferred to Phase 4 is left to inference (Phase 3's "public-data-only prototype may precede this gate" hints but does not say). One sentence naming what the restart tests exercise — caller-persisted rows and evaluator-artifact determinism vs. a non-protected derived corpus record — would remove the ambiguity.
- **M2 — LLP 0126 OQ citation is slightly off.** OQ4 cites "LLP 0126 OQ6 left the owner unresolved," but 0126's OQ6 (lines 1184–1186) asks the *mechanism and capability id* question; the *owning-document* question is OQ7 (lines 1187–1191: LLP 0051 revival vs 0008/0043 amendment family vs new owned Spec, and whether LLP 0115 absorbs the front). Cite OQ6/OQ7 together or rephrase to "left the mechanism and owning document unresolved."
- **M3 — "closing the duplicate ticket" (Phase 0a) names no ticket.** The capsule contains one skew ticket; if a duplicate exists elsewhere, name its path so the closure step is executable; if not, drop the clause.
- **M4 — "word-prefix/recency profile" naming.** Prefix matching already ships as a query atom (`SearchMatchAtomV1::Prefix`, scored at weight×tf×80, 0073 §Ranking); the actual deltas versus the brief are normalization (NFKC_Casefold vs NFC + simple fold) and ordering. A half-sentence noting that prefix *atoms* exist and the new profile pins normalization/ordering would prevent readers from thinking prefix matching itself is new.
- **M5 — `prefer-online` continuation edge.** Since cursors never cross execution modes, a `prefer-online` pagination that loses connectivity mid-sequence cannot resume locally; this is covered in spirit by "continuation is a documented divergence" but is worth one clause where the option is introduced, since `prefer-online` is the one mode where users will hit it.

## AUTHOR-DECISION

None. All five binding decisions read as sound at rethink scale on this evidence; nothing to escalate.

VERDICT: NOT READY

---

# Round 2

**Round:** 2
**Date:** 2026-08-10
**Target:** llp/0221-offline-search-parity.rfc.md (revision c, blob 39d9fb03ce25c1af814e8e7c706e54a3e7fe89e3)
**Capsule:** sha256-16 2669dbb06b79760c (round-1 capsule set + revision-c target + LLP 0157; llp/reviews/* excluded)
**Reviewer runtime:** Claude family via Agent tool (subagent_type general-purpose), capsule-confined read-only instructions
**Verdict:** NOT READY (one MATERIAL, IN-DELTA; pre-existing text clean)

---

The review below is sealed verbatim as received.

---

All evidence is now verified. Here is my round-2 review.

---

# Round-2 review — LLP 0221 (revision c), capsule-confined, blind

## Evidence verification summary

I checked every load-bearing citation against the capsule. All of the following check out exactly:

- **Pilot record**: B6 = 55/58/65 (SB/CX/SU); "PILOT — calibration evidence only", N=1 per lane, "builder self-assessments … for anchor calibration, not outcomes" — the Summary's new labeling matches the record verbatim in substance.
- **Latency ticket**: 582 ms p50 / 806 ms p95, 31–77 ms p95 flat probes, Convex 82 ms p95 with the "posture differs — signal, not a claim" hedge carried over faithfully.
- **LLP 0073**: offline-search nonclaim at line 1034; analyzer `snapback-category-unicode17-v1` (Unicode 17.0.0 `toNFKC_Casefold`); `score-desc-row-id-asc.v1`; recency deferred to "a later scorer with a declared typed timestamp" (§Ranking, ~368); exact-or-refuse work ceilings with at/below/one-above vectors already 0073's own pattern (~485, ~825, ~901).
- **Code**: `assertSearchFunctionReferenceV1` at index.mjs 321 (dedicated `searchRequestContractHash` pin, delegation semantics); `client.search()` delegation at 5618–5648; codegen `searchRequestContractHash` excluding the resource sibling at index.mjs ~10661–10686; seat lookup at sqlite.rs ~1798–1817 (genuinely a single pre-traversal query); `substr(token,1,length(?5))=?5` prefix predicates at ~1528/~1551 inside the function at ~1503; per-candidate source lookup + authoritative reload/re-analysis + final per-item authoritative query at ~1857–2040; `SearchMatchAtomV1::Prefix` exists (~1429/1450).
- **Test matrix**: `typed-search-wrapper.test.mjs` covers exactly what Phase 0(a) claims — plain + membership references, corrupted-hash refusal (`SNAPBACK_SEARCH_REFERENCE_INVALID`), missing-resource refusal, refuse-before-I/O, plus strict typecheck fixtures.
- **LLP 0131 2026-08-09 amendment**: dual-witness design matches Phase 0(a)'s description point for point.
- **LLP 0166 §D4**: closed answer classes ("The store adds no sixth class"), partial hydration answers `unknown` for the set scope — the revised Answer-honesty bullet is now exactly aligned.
- **LLP 0157 §D7 / LLP 0155 OQ2**: cross-query canonical-row normalization "not admitted … enters only by dated amendment" (0157 ~1784–1787); 0166 explicitly does not advance it ("§D7's gate, untouched", ~2172–2174); 0155 OQ2 names the decision. Phase 4's new conditioning quotes this territory accurately.
- **Custody ticket**: leg 1 open, leg 2 implemented 2026-08-06, leg 3 resolved — Phase 3's leg-1 component list (query-authorization namespaces, signed `AuthorizedLease`, equality-expiry deletion-before-render) matches the ticket.
- **Brief §Search (M5)**: NFC, Unicode simple case folding, word-prefix, newest-first, Latin-only frozen corpus — supporting both the Semantics section and Phase 1's non-Latin-vector rationale.

## Concerns

**1. MATERIAL / IN-DELTA — The public-data-only prototype's relationship to the new Phase 4 owner-amendment gate is unstated, and the phase ordering implies the wrong answer.**

Evidence: Phase 2 (delta item 8) now says "§Surfaces' derived corpus/index record is Phase 4 work (its public-data-only prototype may precede the Phase 3 gate, per Phase 3)" — "its" grammatically binds the prototype to the derived corpus/index record. Phase 3 says "A public-data-only prototype may precede this gate" in a section about landing order. Phase 4 (delta item 9) now says the record "lands only through an owner-approved successor amendment … blocks rather than routing around the gate." Because the phases are sequenced 3-then-4, "prototype may precede the Phase 3 gate" naturally reads as "a public-data-only version of the Phase-4-gated record may land before the owner amendment exists." That is exactly the routing-around the round-1 fix was written to foreclose: a shipped public-only derived corpus record in the client store is still new store policy that LLP 0157 §D7 / LLP 0166 admit only by dated amendment (0157 ~1784–1787; 0166 ~2172–2174 make no public-data exception). A strict reader can reconcile the texts (the prototype clause relaxes only custody ordering), but the document never says whether the prototype is (a) an out-of-store spike, (b) subject to the same owner amendment, or (c) exempt because a single-plan record is not cross-query normalization — and an implementer citing Phase 2's parenthetical could land the record pre-amendment in good faith.

Minimal fix (one clause, within the recorded direction): in Phase 3 — or the Phase 2 parenthetical — state the prototype's scope explicitly, e.g. "A public-data-only prototype may precede this custody gate — but it does not precede Phase 4's owner-amendment condition: any materialization of the derived corpus/index record in the shipped store waits for that amendment; only out-of-store spike prototypes are unrestricted." (If the author instead intends the public-only record to be admissible pre-amendment on the theory that a single-plan record is outside §D7's cross-query territory, say that explicitly and reconcile it with Phase 4's "source-row evaluation territory" framing — but that is the author's call, not mine to redesign.)

## MINOR-only list

- **MINOR / IN-DELTA — Closed-twin ticket unverifiable in capsule.** Phase 0(a) names `issues/closed/20260809-typed-search-reference-hash-skew.md` as already closed; the capsule contains only the open twin, so this citation could not be checked either way. No fix needed if the file exists in-repo; noting for the orchestrator's verification.
- **MINOR / IN-DELTA — "normalization and ordering" slightly undercounts the analyzer delta.** The brief also pins word boundaries "split on whitespace and punctuation," while the shipped analyzer is category-based segmentation — tokenization is plausibly a third delta versus the brief. Smallest fix: "the new profile's actual deltas … are the analyzer (normalization/segmentation) and ordering, not prefix support."
- **MINOR / IN-DELTA — LLP 0126 OQ7 attribution is a half-step loose.** OQ6 leaves offline search's mechanism and capability id unresolved; OQ7's owning-document question is about the embedded-runtime front generally (offline search sits inside that territory per 0126 ~821–829, so the widened citation is defensible). A two-word gloss ("…and the broader front's owning document…") would make it exact. Optional.

## Pre-existing text

**No PRE-EXISTING MATERIAL concerns remain.** I re-read the pre-existing Summary, Options, Semantics, Surfaces, Phases 0/3/5, and open questions against the capsule evidence; every factual claim I could test checks out, the option analysis is consistent with the related LLPs' recorded boundaries (0155 fragments-first, 0166 registration guardrails, 0043/0053 custody), and the Phase 0(b) bottleneck analysis is a fair, code-grounded refinement of the ticket's coarser hypothesis. Pre-existing text is clean at MATERIAL level.

## AUTHOR-DECISION

None. All five binding decisions read as sound at rethink scale; the qualified parity promise in particular is well-supported by the cursor-binding and work-ceiling code the capsule contains.

---

The single MATERIAL is narrow — one clarifying clause closes it — but it sits on exactly the gate the round-1 fixes were bound to, so it must not ship ambiguous.

VERDICT: NOT READY
