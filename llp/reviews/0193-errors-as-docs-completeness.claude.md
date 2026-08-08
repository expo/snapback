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
## Round 2 — 2026-08-08 (claude family, delta round)

Provenance: fresh cold-context subagent, Fable 5, capsule sr-capsule-r2,
targets at 601f867da. One launch. Body verbatim from the reviewer's
final report:

I have verified the capsule against the repository and the cited artifacts. Final review follows.

---

## Delta-round review: LLP 0193–0197 cluster (r1)

### Concerns

**1. [MATERIAL] [IN-DELTA] — 0196, entire body / Revised header.** The r1 revision was not applied to this document's body. The capsule copy differs from the pre-r1 repository copy (`llp/0196-template-and-recipe-portfolio.plan.md`) only in `Status: Review` and the added Revised header; the body is byte-identical. The header asserts "unretained/incorrect quantitative claims corrected to retained-artifact citations," but none of the changes the revision is supposed to carry are present: T1 does not contain the "exercising the same capability surface" wording, T5 is not split into a pre-release staged-tarball gate plus post-release registry canary, and the exit criteria contain neither the template-assisted-labeling rule nor the held-out-brief rule. A Revised header claiming corrections that were not made is worse than the uncorrected text alone. **Resolving change:** apply the r1 body revisions to 0196 (or, if they exist elsewhere, capsule the correct file) and re-review the applied text.

**2. [MATERIAL] [IN-DELTA] — 0196 §T1 + Exit criteria (unresolved by r1).** T1 is defined as "matching `benchmarks/briefs/crud.md`" and the exit criterion reads "The next benchmark run on the CRUD brief uses T1 and its lane report cites no template gaps." This is circular twice over: (a) a template authored to match the benchmark brief will trivially show "no template gaps" on that brief — the criterion measures template–brief fit, not authoring capability; (b) it contaminates the benchmark series that LLP 0197 proposes to publish — a Snapback lane scaffolding a template purpose-built from the published brief is an answer-key-in-hand run, exactly the kind of asymmetry 0197's fairness notes would have to disclose. The delta manifest's own intended fixes (capability-surface wording, held-out-brief rule) are the right shape and are absent. **Resolving change:** land the held-out-brief rule (benchmark evidence for T1/T2 must come from a brief not used to author the template, or the pairing must be disclosed as a template-fit check, not a capability measurement), and reword T1 to target the capability surface rather than the brief document.

**3. [MATERIAL] [IN-DELTA] — 0196 §T5 (unresolved by r1).** "templates cold-install and pass their suites against the *published* closure in CI" is post-release-only detection: a template that teaches a drifted surface ships in the release that breaks it and is caught only after publication, contradicting the stated goal "so a template can never teach a drifted surface." The delta's intended split (pre-release staged-tarball gate + post-release registry canary) resolves this and is absent. **Resolving change:** apply the T5 split so a release cannot ship with a template failing against its own staged closure, with the registry run demoted to canary.

**4. [MATERIAL] [IN-DELTA] — 0197, entire body / Revised header.** Same defect as concern 1: the capsule body is identical to the pre-r1 repository copy; only the header changed. Concretely falsifiable in-document: rule 6 still reads "The credibility of the 94-run honesty discipline is the asset" while the header claims incorrect quantitative claims were corrected — the retained record is five measurement runs and four published-consumer audits (CONTEXT; diaries 0058/0065/0066/0068/0069). An uncorrected fabricated-looking count inside a document whose entire subject is publication credibility is disqualifying for that document's own standard ("No superlatives that a record link cannot back"). The claimed rules 4a (starter symmetry) and 4b (equal-proof-bar failure protocol), the reproducibility-manifest rewording, and the rule-6 artifact schema are likewise absent. **Resolving change:** apply the r1 body revisions; at minimum, correct "94-run" to the retained five-run/four-audit record.

**5. [MATERIAL] [IN-DELTA] — 0197 §Summary (unresolved by r1).** "a series showing the skill lane moving from 3.26x to ~2x tokens against Convex." Three problems: (a) diary 0069 explicitly disclaims directional readings of the ratio at N=1 with ±30% variance ("ratio movement of this size is not a signal in either direction"); the Summary states the trend without the directional-not-controlled caveat the revision was supposed to add; (b) the current standing number is 2.24x tokens (diary 0069, "For the ratchet"), and the most recent movement was 2.00x → 2.24x — worsening — so "~2x" is a favorable rounding that hides the last data point; (c) it conflicts with the document's own rule 1 ("single-run ratios unpublishable"), which also leaves "the series chart (with the early losing runs included)" in "What publishing looks like" in unstated tension with rule 1. **Resolving change:** carry the caveat in the Summary, state 2.24x (or median-when-available), and state how the historical N=1 series chart is exempted from rule 1 (narrative/directional annotation, not a claim).

**6. [MATERIAL] [IN-DELTA] — 0197 §The standard, rule 3 (unresolved by r1; interacts with concern 2).** The fairness notes cover model, machine, docs access, and prior-familiarity asymmetry, but say nothing about starter/template symmetry — while sibling Plan 0196 T1 creates a Snapback template purpose-matched to a benchmark brief. Without a starter-symmetry rule (the delta's intended 4a), a published chart where the Snapback lane scaffolds `crud-dashboard` against the CRUD brief while the competitor lane starts bare is straightforwardly attackable as rigged, and the standard as written would permit it. **Resolving change:** add the starter-symmetry rule (each lane uses its ecosystem's best equivalent starter, disclosed per chart, with brief–template provenance stated).

**7. [minor] [IN-DELTA] — 0194 §What this kills vs §Design 5.** The kills list claims "`ctx.db` verbs via binary strings (0069 residue 2), verify-config contract (0068 and 0069 residue 5)" among what "this RFC removes," but the r1 scope rule (Design 5) defers exactly those two surfaces as named exclusions until declaration files land (OQ2, unscheduled). The two most expensive named excursions are behind the exclusion. Honest as written, but the kills section should mark which entries are contingent on OQ2 landing rather than on the initial scope.

**8. [minor] [PRE-EXISTING] — 0193 §Evidence; 0193/0195 Related/Summary citations.** (a) "the 0.1.10-era `host-ops response was not JSON`" — the retained record is diary 0058 line 168 ("host-ops error response was not JSON", in-checkout era) and `issues/closed/20260805-managed-dev-multi-json-load.md`; the era attribution and exact quote are both slightly off. (b) The range notation "diaries 0065-0069" (0193 Related, 0195 §What this does not claim) nominally includes diary 0067, which is the browser-local-first witness, not a measurement-series audit; 0195's count of four is correct but the range is misleading — enumerate 0065/0066/0068/0069.

**9. [minor] [PRE-EXISTING] — 0193 §Evidence.** "the hashed field path… cost a bisection session" carries no artifact pointer, and I could not locate it in the retained measurement diaries (it may live in an older bakeoff diary). Given r1's stated discipline of citing only retained artifacts, this exemplar should get a pointer or the "unretained incidents exist but are not cited" disclaimer should absorb it.

Documents 0193, 0194, and 0195 verifiably carry their r1 changes, and their factual claims check out against retained artifacts (diary 0048 decode diagnostic; `assets put --user` in `issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`; diary 0069 residues 2/3/5 and "dominant term"; diary 0068 `createAssetClient` and sessions-construction pair; 41.5→29.6 min bare lane; the OQ6 carrier ticket and flat-projection-oversize ticket both exist; `briefs/crud.md`, `media.md`, `messaging-equal-proof-bar.md` all exist).

### Verdicts

0193: READY
0194: READY
0195: READY
0196: NOT READY — blocking: 1, 2, 3
0197: NOT READY — blocking: 4, 5, 6

SET: NOT READY
## Round 3 — 2026-08-08 (claude family, delta round)

Provenance: fresh cold-context subagent, Fable 5, capsule sr-capsule-r3,
targets at c4c4bb6a5. One launch. Body verbatim from the reviewer's
final report:

All citations verified against the repository (diaries 0058/0066/0068/0069 figures, closed tickets, benchmark briefs, the 20260808 ticket set, `generate-guide-manifest.mjs`, the export-parity test, the ~2,700-symbol estimate — a unique-identifier sweep finds 2,839). The review follows.

---

# Delta-round (r3) review — LLP 0193/0194/0195/0196/0197

Independent reviewer; documents read in full; cited repository artifacts verified (diary figures, closed tickets, briefs, 2026-08-08 ticket filenames, generation/parity machinery, `SNAPBACK_*` symbol count).

## Concerns

1. **[minor] [IN-DELTA] — 0193 (Summary, Evidence) and 0195 (Summary, Related): diary-number collisions make bare-number citations ambiguous.** The corpus contains two diaries each numbered 0048 (`0048-upload-bakeoff-clip-locker`, `0048-upload-bakeoff-faceplate`), 0058 (`0058-messaging-snapback`, `0058-relay-room-expo-backend-bakeoff`), and 0065 (`0065-fleet-observatory-move1`, `0065-rematch-published-closure-bakeoff`). The r3 delta's exact citations — "diary 0048's `SNAPBACK_ASSET_IMAGE_DECODE_FAILED`", "diary 0058's 'host-ops error response was not JSON'", the 0065/0066/0068/0069 enumerations — all resolve correctly (I verified each quote pins a unique file: the faceplate 0048, the relay-room 0058, the rematch 0065), but only via the quoted content, not the citation itself. Suggested improvement (non-blocking): cite by filename slug where a colliding number is referenced.

2. **[minor] [PRE-EXISTING] — 0197 (Related): "diaries 0058-0069" retains the range form the delta replaced elsewhere.** The range sweeps in seven diaries (0059–0064, 0067) that are not measurement-run diaries; the r3 delta applied enumeration precision to 0193 and 0195 but not here. Suggested improvement: enumerate 0058/0065/0066/0068/0069 as in the sibling documents.

3. **[minor] [IN-DELTA] — 0196 (Summary): the scoped superlative is a class-of-one comparison, and the underlying step is N=1 under demonstrated variance.** "produced the largest improvement of any release whose changes were knowledge-placement rather than defect fixes — bare lane 41m32s→29m35s". The figures are verified (diaries 0068/0069) and the 0.1.13 mechanism distinction (80m33s→41m32s, seven-defect layer) is verified against diary 0066 — the scoping is honest and correct. But with exactly one knowledge-placement release in the series, "largest of any" is vacuously true, and the 29% step is inside diary 0069's own demonstrated ±30% per-lane variance at N=1, which that diary explicitly disclaims as signal. Publication exposure is fully guarded by 0197 rule 1 and the document uses the number only as plan motivation, so this identifies no defective decision — but a one-clause N=1/variance caveat inline would match the candor the rest of the set now practices.

4. **[minor] [IN-DELTA] — 0194 (What this kills / OQ2): the document argues its own most expensive coverage gap should be scheduled, then leaves it an open question.** "the two most expensive named excursions sit behind that exclusion, which is the strongest argument for scheduling OQ2 early." The r2/r3 resolution (no hand-written interim; named exclusion until a `ctx` declaration file lands) is the right call — it preserves the no-drift invariant and the completeness claim simultaneously — but having concluded the `ctx` declaration is the highest-value item, the RFC could promote it from OQ2 to an ordered scope entry in Design 5 rather than a proposal inside an open question. Implementation-phase sequencing note; no defective decision.

5. **[minor] [IN-DELTA] — 0197 (rule 4b): success-only efficiency ratios carry residual survivorship framing.** "efficiency ratios computed only across runs meeting the identical bar, with the capability-failure table published beside them" — computing ratios over qualifying runs only can flatter a lane that fails often but is fast when it succeeds. The adjacent capability-failure table plus preregistered identical budgets (rule 4b) and rule 3's every-chart fairness notes substantially mitigate this; consider additionally requiring per-lane success counts stated on the ratio chart itself rather than only beside it.

No MATERIAL concerns found, in-delta or pre-existing. The delta changes were each verified for correctness and coherence: 0197's restated series matches the retained records (329k/113k = 2.91x in diary 0068; diary 0069 itself states 2.24x and the ±30% variance); the diary-0058 26m03s-vs-11m15s citation is verbatim in the retained diary; the rule-1 preregistration, 4a/4b, and rule-6 publication-safe schema are internally consistent (rule 3's every-chart fairness notes close the historical-narrative-chart exemption; rule 2's rerunnability needs briefs/prompts/harness, not the never-published raw transcripts); 0196's T5 two-gate split, T1/T2 capability-surface wording, and held-out-brief exit rule are coherent and mutually consistent with 0197 4a/4b; 0194's OQ2 resolution removes the earlier contradiction between the no-hand-written rule and the completeness claim; 0193's citations all resolve to retained artifacts, and the referenced tickets (`20260806-llp0146-oq6-remediation-carrier-decision.md`, both closed 20260805 tickets, the four 20260808 recipe/papercut tickets) exist.

## Verdicts

0193: READY
0194: READY
0195: READY
0196: READY
0197: READY

SET: READY
## Round 4 — 2026-08-08 (claude family, delta round)

Provenance: fresh cold-context subagent, Fable 5, capsule sr-capsule-r4,
targets at 68da5ad37. One launch. Body verbatim:

All verification done. Here is the review.

---

# Independent review — r4 delta round, LLP 0193–0197 set

Reviewer: independent, no prior context; capsule at `sr-capsule-r4/`; repository consulted at `/Users/ccheever/projects/snapback` (nothing under `llp/reviews/` was read).

## Concerns

**1. [MATERIAL] [IN-DELTA] — 0194, Design 5 + OQ2: the verify-config "no declaration source today" premise is false; the exact artifact OQ2 asks for already exists and is exported.**
Quote (Design 5): *"The `ctx` handler surface and the CLI verify/config contracts have no declaration source today; they JOIN the reference when their declaration sources land (OQ2 proposes both: a `ctx` declaration file and a verify-config types/schema export)"*; quote (OQ2): *"the verify-config contract joins only via a published machine-readable source (a types export or schema from `@expo/snapback-cli`'s verify module)."*
Repository fact: `packages/snapback-cli/verify.d.mts` exists on main and contains the full contract — `interface VerifyConfig` (`schemaVersion: 'snapback.verify-config.v1'`, profiles/paths/testFiles), `defineVerifyConfig`, `loadVerifyConfig`, `defaultVerifyConfig`, receipt validators — and `packages/snapback-cli/package.json` publishes it: `"./verify": { "types": "./verify.d.mts", "default": "./verify.mjs" }`, with `verify.d.mts` in the `files` list. It landed 2026-08-04 (commit `9342b17d9`), four days before these r4 documents (dated 2026-08-08) and before the 0.1.15 publish (`guide/published-closure.json` `publishedAt: 2026-08-08`). This is precisely the delta text: r4's stated change is that OQ2 "now names declaration sources for BOTH contingent surfaces," and the verify-config half names a source as future-contingent when it already shipped. The consequence is a defective sequencing decision, not just a wrong sentence: one of the *"two most expensive named excursions"* (0068/0069 residue 5) is classified as a named exclusion "ordered immediately after the initial package scope," when it is eligible for the initial declaration-sourced scope now — the actual gap is discoverability/generation coverage (diary 0069 residue 5 records the lane reading `verify.mjs` source, and the guide never points at the types export), not a missing source. The `ctx` half of the claim checks out (no `HandlerContext`/`ctx.db` declaration exists in any package `.d.mts`).
Resolving change: restate Design 5/OQ2 — verify-config already has a published machine-readable declaration source (`@expo/snapback-cli/verify` → `verify.d.mts`); either move it into the initial scope, or state explicitly why the existing export is insufficient (e.g. unaudited completeness against the runtime's actual verify contract) and gate on that audit instead. OQ2 then narrows to the `ctx` declaration file only.

**2. [minor] [IN-DELTA] — 0193/0195/0197: the slug-disambiguation fix is incomplete — diary 0065 also collides and is cited bare.**
r4's stated fix is *"colliding diary-number citations gained filename slugs"* (0193) and *"Related enumerates diaries with a slug disambiguation"* (0197). 0048 and 0058 got slugs, but `diaries/` contains two 0065 files (`0065-rematch-published-closure-bakeoff.diary.md` and `0065-fleet-observatory-move1.diary.md`), and 0065 is cited without a slug in 0193 (Summary: *"diary 0065's tickets"*; Related: *"diaries 0065/0066/0068/0069"*), 0195 (Related and *"four published-consumer audits (diaries 0065/0066/0068/0069…)"*), and 0197 (Related: *"diaries 0058/0065/0066/0068/0069 … 0058 by filename …, a colliding number exists"* — noting only 0058's collision).
Resolving change: add the `0065-rematch-published-closure-bakeoff` slug once per document (or note both collisions in 0197's Related).

**3. [minor] [PRE-EXISTING] — 0193, Summary: the `assets put --user` exemplar is misattributed and temporally inverted as evidence.**
Quote: *"the anonymous-upload refusal naming `snapback assets put --user` (diary 0065's tickets) are retained exemplars"* — presented as an exemplar of refusals that *"resolved fastest when the refusal named its own fix."* The retained record says otherwise on both points: the ticket is `issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`, whose provenance is the diary-0058-era messaging build (the ticket itself cites `0058-relay-room-expo-backend-bakeoff`; diary 0065-rematch's ticket list contains only three 20260806 tickets, none about anonymous upload), and at the time of that ticket the refusal did **not** name the fix — the agent found `assets put --user` by reading `src/local.rs`/`assets.mjs` (the ticket documents exactly that excursion). The remediation-carrying message (`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`, `src/local.rs:8038`, which does name `snapback assets put --user <handle>`) is the *fix produced by* that ticket, not an observed cheap resolution. The thesis survives on the other exemplars (diary 0048's decode diagnostic is genuinely observed), but this one is a retrofit presented as evidence.
Resolving change: cite the ticket path directly, attribute it to the 0058-era run, and label it as the retrofitted A-grade exemplar rather than an observed near-zero-cost resolution — or replace it with an exemplar observed resolving cheaply in a run.

**4. [minor] [PRE-EXISTING] — 0197, rule 4b: success-conditioned ratios retain a survivorship channel.**
Quote: *"efficiency ratios computed only across runs meeting the identical bar, with the capability-failure table published beside them and per-lane success counts stated on the ratio chart itself."* The r4 addition (success counts on the chart) discloses the problem but does not bound it: a headline ratio computed over 3/3 vs 1/3 successes is still permitted as the headline. A one-line floor (e.g. no headline ratio when per-lane success counts differ beyond a stated threshold; publish the capability-failure comparison as the headline instead) would close it. Implementation-adjacent, but it is a publication-standard rule, so worth a sentence.

**5. [minor] [PRE-EXISTING] — 0193, Phase 3: the ratchet has a lateral evasion channel via reclassification.**
The gate refuses *"grade regressions"*, and codes *"genuinely internal (never agent-triggerable) are marked so in the ledger rather than polished"* — but nothing governs later reclassification of an agent-triggerable code to internal, which removes it from the bar without a grade regression. OQ2 covers initial grading authority only. Resolving change: one sentence making triggerability reclassification a gated ledger change (same review bar as a grade regression).

**6. [minor] [IN-DELTA] — all five, Revised header: the shared r4 changelog entry mislabels per-document provenance.**
Every document's r4 entry lists the whole set's fixes (e.g. 0195's header claims *"0194 verify-config declaration path + scope ordering; 0197 aid symmetry…"* though 0195's own r4 delta is header-only). A single-document reader cannot tell what changed in *this* document. Cosmetic but it degrades exactly the citation-precision property r3/r4 were tightening.

Verified clean (checks that found no defect): the 2.91x/2.24x arithmetic against retained diary tables (328.9k/113k, 201.3k/89.8k); 41m32s→29m35s and 80m33s→41m32s bare-lane steps with the seven-fix attribution (diaries 0066/0068/0069); the ±30%/N=1 variance caveat now inline in 0196 matches diary 0069's own disclaimer; `benchmarks/briefs/{crud,media,messaging-equal-proof-bar}.md` all exist; all four ticketed recipes/papercuts in 0196 T3/T4 exist under `issues/`; the OQ6 carrier and flat-projection-oversize tickets exist; ~2,700 symbol estimate is consistent (2,852 measured repo-wide); 0197's history-narrative section contains no cross-vendor numbers as the delta claims; 0197 rule 4a's benchmark-lane-apps clause correctly closes the loop that 0195 Proposal 2 opens; the `0058-relay-room` slug correctly identifies the origin-run diary (26m03s/11m15s confirmed in that file).

## Verdicts

- **0193 (errors-as-docs completeness, Plan):** READY — no MATERIAL concern; minors 2, 3, 5.
- **0194 (generated API reference, RFC):** NOT READY — MATERIAL IN-DELTA concern 1 (false "no declaration source today" premise for verify-config; scope/sequencing decision built on it).
- **0195 (public documentation surface, RFC):** READY — no MATERIAL concern; minors 2, 6.
- **0196 (template and recipe portfolio, Plan):** READY — no MATERIAL concern; the r4 N=1 caveat resolves the motivation-evidence risk cleanly.
- **0197 (benchmark publication standard, RFC):** READY — no MATERIAL concern; minors 2, 4; the r4 aid-symmetry widening and no-numbers history narrative are correct and well-formed.

**SET VERDICT: NOT READY — one MATERIAL IN-DELTA concern (0194, concern 1); all other concerns are minor and the remaining four documents are individually READY.**