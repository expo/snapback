# Review artifact — claude family — cluster 0193-0197 (primary 0193)

## Round 1 — 2026-08-08

Provenance: fresh cold-context general-purpose subagent, Claude Fable 5,
capsule sr-capsule-r1 (hashes in the run journal), targets at revision 54fa456cf.
One launch; body preserved verbatim from the reviewer's final report as
delivered to the orchestrator. Blindness: capsule structural at launch;
repo consultation permitted excluding llp/reviews/ (instruction-based,
self-attested by the reviewer).

I have now read the capsule in full and verified the cited context against the repository (LLP 0186, LLP 0146, diaries 0058/0065/0066/0068/0069, `benchmarks/` briefs, lanes and records, and the referenced issues). Review follows.

---

1. [MATERIAL] — **0193, Summary and Evidence.** The document's flagship exemplar is unsupported by any retained artifact. Summary: "lanes repeatedly resolved failures fastest when the refusal named its own fix (the PNG-CRC diagnostic naming the failing chunk is the exemplar)"; Evidence repeats "the CRC chunk" in the near-zero-cost list. A search of all diaries (0001–0069), `issues/`, `benchmarks/`, and LLPs 0146/0186 finds no PNG-CRC event and no "failing chunk" phrasing anywhere except 0193 itself. The nearest retained evidence is diary 0048's `SNAPBACK_ASSET_IMAGE_DECODE_FAILED` ("exact upstream parser error in the message" — a JPEG fixture). This matters beyond hygiene: Phase 2 orders fixes by "every B/C code that appears in any diary's correction-loop list," so the plan's own mechanism runs on diary-traceable citations, and its headline exemplar is not one. Resolution: cite a retained exemplar (diary 0048's decode diagnostic, or the `snapback assets put --user` / `details.path` cases already verifiable), or land the lane-report source the CRC claim comes from and cite it.

2. [MATERIAL] — **0193, Phase 3.** "this is 0146 D7's enforcement carrier — the typed `remediations` shape lands here if not already built" treats an explicitly open author ruling as settled. LLP 0146 assigns the carrier choice (envelope member vs diagnostic-`details` member vs separate lookup) to the LLP 0094/0095 wire-contract family, and the open ticket `issues/20260806-llp0146-oq6-remediation-carrier-decision.md` states: "No runtime, HTTP, CLI, MCP, diagnostic, or ControlCatalog carrier has been added while this question remains open." 0193's OQ1 flags structured-vs-text as open but never names the carrier ruling, while Phase 3's main text asserts the shape lands under this Plan. Resolution: make Phase 3's gate carrier-agnostic (require *a* remediation field or resolving anchor in whatever carrier the OQ6 ruling selects; text+anchor as interim floor) and add the OQ6 ruling as a named dependency of the structured half.

3. [minor] — **0193, Phase 1.** "estimated 200-500 codes" may be low: a sweep of `src/` + `packages/` finds ~2,700 distinct `SNAPBACK_*` identifiers (inflated by env vars and test-only constants, but the diagnostic subset plausibly exceeds the estimate's ceiling). Harmless because Phase 1 enumerates the real population, but the fan-out/grading cost expectation is set by this number.

4. [MATERIAL] — **0194, "What this kills".** "Roughly a third of the residual orientation bucket in diary 0069's decomposition" cites a decomposition that does not exist. Diary 0069 contains a seven-item residue list and the sentence "The orientation gap is now the dominant term" — no bucket decomposition and no fraction. The fraction is this RFC's impact claim, presented as sourced. Resolution: restate qualitatively against what the diary actually retains (e.g., "residue items 2, 3, and 5 of diary 0069's list are signature-shaped"), or land the decomposition as a benchmark record and cite it.

5. [minor] — **0194, "What this kills".** Several run attributions are not traceable to retained records: "hook state shapes (0066)" does not appear in diary 0066's findings list, and "constructor option pairs (0069×2)" is not in diary 0069's residue (the nearest retained fact is 0068's residue 4, the sessions client-construction pair "hit by two lanes"). The 0113 record itself concedes per-loop lines "were not retained in-repo," so per-run counts like "×2" should either be marked as resting on unretained lane reports or corrected to the retained items.

6. [minor] — **0194, Design 3 + OQ1.** The reference joins "flat.md" while `issues/20260806-guide-flat-projection-oversize.md` is still open and LLP 0186's amendment records the flat projection at 857 KB "and growing," already past LLP 0061's one-request premise. OQ1 gestures at "the flat-guide size discipline" but should name the interaction: adding per-package reference pages to an already-oversized projection worsens a known open defect unless the reference is excluded or the diet/tier amendment lands first.

7. [MATERIAL] — **0195, Summary.** "the measurement series attributes roughly a third of the remaining efficiency gap to orientation cost that Convex does not pay" is unsupported. Diary 0068 attributes the remaining ~2x to two unquantified components (orientation + deeper proof surface); diary 0069 calls orientation "the dominant term"; no retained artifact states a fraction. It also collides with 0194's different use of "roughly a third" (there: a third *of* the orientation bucket) — two documents in the same set deploying the same fraction for different quantities, neither sourced. Since this sentence is the RFC's central sizing of the problem the public surface fixes, it should either quote the diaries' actual language ("the dominant term") or be grounded in a real decomposition.

8. [minor] — **0195, "What this does not claim".** "the honesty discipline that survived five external-consumer audits" — the series is five runs, but run 1 (diary 0058) was in-checkout, not an external-consumer/published-surfaces run (the 0113 record: "not directly comparable to diary 0058's in-checkout clock"). Four published-consumer audits is the defensible count.

9. [MATERIAL] — **0196, Summary.** "knowledge moved into template defaults … produced the largest single-release wall-clock improvement of the program (bare lane 41.5→29.6 min)" is false on the retained numbers. The 0.1.12→0.1.13 release moved the same bare lane 80m33s→41m32s (diaries 0066/0068 — "The bare lane halved its wall time"), a larger absolute and relative single-release improvement, and it came from the seven-fix defect layer, not template defaults. Since this superlative is the empirical anchor for the Plan's ladder thesis ("scaffold beats guide beats package source"), it must be corrected — e.g., "the largest improvement in a release whose changes were knowledge-placement rather than defect fixes" — which the diary text does support ("the 0.1.15 template defaults did what they were built to do").

10. [MATERIAL] — **0197, rule 6.** "The credibility of the 94-run honesty discipline is the asset." No retained artifact supports "94"; nothing in diaries, records, or LLPs counts 94 of anything relevant (the series is five runs; the 0115 record and CONTEXT agree). An invented-looking number inside the document that defines the publication honesty standard is precisely the defect class the standard exists to prevent, and it would be quoted if published. Resolution: correct to the real count (five runs / four published-consumer audits) or drop the figure.

11. [minor] — **0197, Summary.** "a series showing the skill lane moving from 3.26x to ~2x tokens" drops the record's own caveat: the 3.26x row (diary 0065) was a *bare* lane on 0.1.10, and the 0113 record states "The bases differ across rows… The series is directional, not a controlled sequence." Also the latest skill-lane figure is 2.24x, with 2.00x one run earlier. Given this RFC mandates fairness notes on every chart, its own summary should carry the same discipline.

Implementation-phase notes (non-material): (a) 0193 Phase 4 requires a refusal-grade field in the `benchmarks/records/schema.md` lane-report shape — worth naming so the next run captures it; (b) 0196 T5's cold-install-against-registry CI gate is network-dependent and needs a flake/offline policy; (c) 0197 rule 2's "run it yourself" section should state expected run cost (wall/tokens) so outsiders can actually attempt reproduction.

---

0193: NOT READY — blocking concerns: 1, 2
0194: NOT READY — blocking concerns: 4
0195: NOT READY — blocking concerns: 7
0196: NOT READY — blocking concerns: 9
0197: NOT READY — blocking concerns: 10

SET: NOT READY — the cross-document seams (0193→0194 anchor targets, 0194→0195 snapshot question, 0195↔0197 publication gating, 0196→0195 examples mirror) are structurally coherent, but the set shares a cross-cutting defect pattern: unsupported quantitative claims presented as sourced (concerns 1, 4, 7, 9, 10), including two different unsourced "roughly a third" figures across 0194 and 0195. In a cluster whose stated asset is measurement honesty, this pattern is itself the set-level blocker; each individual fix is small.