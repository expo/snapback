# LLP 0116 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, delta/synthesis review of
the v0.2 overview against its reviewed siblings and the program journal,
cross-family blind for 0116 artifacts (the Codex 0116 artifact was never
read); the review session was interrupted mid-verification by a
usage-credits outage and resumed in the same context, with the target
SHA-256 re-verified unchanged on resumption
**Target SHA-256:** `4d243213f84bcb6b646414afa90ae667e68fe30da78449bca87c6d1a69f5f827`
**Status:** completed

## Overall assessment

The v0.2 overview does what the delta review asks of it: all nine
index-table headlines were checked against the siblings' reviewed texts
and each is supported by that sibling's current Summary/Findings — the
post-review corrections (0119's unreachable `SearchQuery` arm as
hypothesis, 0118's context-capability-freedom lane and splice-dominates
result, 0123's strict-Host boot-probe hazard, 0125's
absence-of-regression restatement, 0117's four-carrier/interior-typing
corrections, 0121's execution-guarantee split) are all accurately
carried. Cross-cutting findings 1–7 check out against the siblings, the
program journal, and LLP 0115 v0.4; the answered OQ1/OQ2 records match
the journal's convergence table and 0115's v0.4 header verbatim; the
"What this series is not" retired-gap list matches 0115's Summary.

What does not survive verification is the Summary's opening sentence,
which is v0.1 framing text carried into v0.2 unchanged: it counts "Ten
agent-authored diaries" while its own parentheticals enumerate fourteen,
and it labels the bakeoff corpus "the five-backend bakeoffs" when the
reviewed sibling LLP 0120 correctly calls Diary 0029 "the seven-backend
Linear bakeoff" (Diary 0029 ran seven arms; Diary 0022 ran three). Both
are one-line fixes, but they are genuine factual errors in the sentence
that frames the entire series, in a document whose sole job is accurate
representation.

## Per-row headline verification

- **0117** — Accurate. Four mechanisms, board covers only (b)/(c)
  (Finding 1: "nothing on 0115's status board covers (a) or (d)"),
  per-boundary cost with tied totals (Finding 2), CV-5 search AST as
  structured-input instance (§CV-5), interior gap not a toolchain gap
  (Finding 8). One nit: "reference-not-respell compression leads the
  zero-inference options" sharpens the doc's "Alongside A, the most
  promising near-term option" (option E) into sole leadership.
- **0118** — Accurate. Designed consequence / never had open imports
  (Findings 1–2 verbatim), same-file 1a precedes emission (v0.2 note;
  §option 1a "is prior to 'group-bundle versus splice'"),
  resolve-and-splice dominates today (Finding at line ~910), and the
  v0.5 two-established-properties claim is correctly compressed: the
  *statically provable* lane is context-capability-freedom, with
  side-effect-freedom a separate analysis (ambient-nondeterminism
  denial, the runtime-enforced second property, is elided but not
  contradicted).
- **0119** — Accurate. Evidence choice (Finding 2), shipped ingredients
  with no end-to-end path / unreachable matcher arm / hypothesis with
  blockers inventory (Finding 4), and the quarantine sentence tracks
  Finding 7 almost verbatim ("must not be fixed by smoothing the
  revocation path"; declaration gap vs obligation-lane cost an open
  diagnosis).
- **0120** — Accurate. "Aggregation and multi-child fan-out, not joins"
  (Finding 1), three-way exclusion "not uniformly as Non-goals"
  (Summary), three primitives with sequence allocation smallest, two
  demonstrated demand sites plus one inferred reuse, "this document's
  visible lean, labeled as such" (Findings 4/OQ7 area).
- **0121** — Accurate. Design exists in 0070 (Finding 2), three-property
  decomposition (§How they differ; Finding 5), domain-result reactivity
  falls out of 0070's terminal mutation (Finding 5), receipts as
  over-delivery ("a chance to over-deliver rather than merely catch
  up," Finding 10), and Finding 11 states exactly the headline's
  guarantee split ("0070 is uniformly at-least-once with fenced
  attempts" vs Convex's exactly-once/at-most-once).
- **0122** — Accurate. Publication→adoption with the three-day fact
  (Finding 2), five facets with the closure addressing "mainly the
  install facet" (Finding 3).
- **0123** — Accurate. "Two independently refreshable native artifacts"
  (§How they differ) fairly compressed to "two swappable artifacts";
  sealed engine+server account labeled inference (same section);
  `HERMES_LINK_STATIC` unused and per-platform runtime packages
  existing-but-unqualified (Findings 6–7); strict-Host handoff hazard
  and "readiness evidence must not weaken the posture it verifies"
  (v0.3 Option 2, journal round 2).
- **0124** — Accurate. Asymmetric ownership verbatim from the Summary;
  0073 "reserves the slot and the admission rule"; design-home question
  is 0019's open question 5 (Findings/OQ section).
- **0125** — Accurate. Absence-of-regression restatement carried
  correctly (Summary; the v0.2 Fable fix), the remainder triple matches
  the Summary and Finding 5, `elseError`/`guard` channel existence
  matches the v0.2 Codex fix, and "named by 0115 v0.4 OQ6, scheduled by
  no CV item" matches both 0125's findings and 0115 OQ6(a).

## Cross-cutting findings check

1. **Decomposition** — supported: 0117 Finding 1 (four mechanisms),
   0121 Finding 5 (three properties), 0122 Finding 3 (five facets).
   Nit: "the package closure fixes one facet of five" hardens 0122's
   "at least five facets" / "addresses mainly the install facet."
2. **Execution lag** — verified in every named sibling: 0125 Summary
   (fixed, held), 0121 Finding 2 (0070 complete as design), 0118
   Finding 1 (demoted on review-loop timeout, not refuted) with the
   warm-pool caveat matching the journal's round-1 resolution, 0124
   Summary (LLP 0044 Draft), 0123 Finding 6 (static linking unused),
   0122 Finding 2 (published but unconsumed). "Bucket (1)" matches
   0115's v0.2 audit headline verbatim.
3. **Named design holes** — verified: 0124 Summary (no vector owner),
   0117 Finding 1 + 0115 OQ6(b) (return inference and interior typing
   unowned), 0125 Finding 5 + 0115 OQ6(a) (cluster tracked, no CV
   item), 0120 (Non-goals of both owners), 0119 Finding 4 (head start
   as hypothesis).
4. **Out-evidence options** — verified: 0125 Option 4 ("Automatic retry
   as a declared, evidenced contract"), 0121 Option 3 + the generated
   declared job-status query, 0120's 2a/2b split with 2b named a
   no-evidence-regression failure as a tier (v0.2 Revised note,
   quoted correctly).
5. **The filter** — supported: 0118 Finding 2 (neither revert nor open
   imports follows), 0119 Finding 6 (erasure is "the only option
   requiring a new theory" — note 0119 v0.2 softened pure erasure with
   the 1a/1b hybrids, which the overview's compression does not
   contradict but also does not mention), 0120 Finding 6 (unbounded
   language: "the evidence model is the casualty"), 0124 S4 ("as a
   destination it concedes the Partiful class permanently").
6. **Corrections record** — verified: Relay re-attribution, two-lane
   `resultOnly` structure, info-severity hypothesis, and the
   `./online` types gap all appear in the named siblings *and* in
   0115's v0.4 Revised note, which names each correction.
7. **Program self-validation** — matches the journal: ~120 round-1
   concerns, none refuted in any round, two reviewer paraphrases
   corrected (two-case cancellation; 0124 line drift); the three
   highest-value catches named are the journal's round-2 catches. The
   closing "found at review cost what running the code would have found
   later" is the overview's own interpretation, reasonably presented as
   what the program demonstrated.

**OQ1/OQ2 and Summary:** OQ1's topology and convergence record (0117
R3, 0118 R5, 0122 R3, 0123 R3; Tier-2 single rounds) matches the
journal's table exactly. OQ2 matches 0115's v0.4 header (Analysis
column, corrections, OQ6–7 author-gated). The Summary's 55/45 figure
matches Diary 0039 line 15; "nine-document series," the reviewed
"v0.2–v0.5" version range, and the retired-gaps list all check out.
The two count defects below are the exceptions.

**Method/provenance:** still substantially true — layer 2's revision
lineage (`01e94173`) matches Diary 0039, layer 3's owner list matches
the siblings' Related headers, and the diary-vs-background provenance
discipline is real in every sibling read. One staleness: the reviewed
corpus now has a *fourth* evidence lane the section does not mention —
official-Convex-docs verification with dated consultation pins (0121's
guarantee table, 0124's delivery-model claims, 0125's background),
added by the review program. The two-class description ("diary
evidence" vs "general background... not treated as evidence")
undersells the reviewed siblings' actual provenance.

## Concerns

- **C1 (MATERIAL, factual).** Summary line 24: "Ten agent-authored
  diaries" — the parentheticals enumerate fourteen (Diary 0022 +
  0027–0031 = six bakeoff diaries; Diary 0032–0039 = eight rerun
  documents). No counting of campaigns, workloads, or arms reaches
  ten. One-line fix.
- **C2 (MATERIAL, factual/stale-vs-sibling).** Summary line 24: "the
  five-backend bakeoffs (Diary 0022, 0027–0031)" — the backend count
  varies per diary (Diary 0022 ran three arms; Diaries 0029/0030 ran
  seven), and reviewed sibling LLP 0120 calls Diary 0029 "the
  seven-backend Linear bakeoff." "Five-backend" appears nowhere else
  in the corpus. One-line fix (e.g., "multi-backend bakeoffs").
- **C3 (DETAIL).** Cross-cutting finding 1: "the package closure fixes
  one facet of five" — 0122 says "at least five facets" and
  "addresses mainly the install facet"; the index-table row for 0122
  has it right. Suggest matching the row's phrasing.
- **C4 (NIT).** 0117 row: "leads the zero-inference options" — the
  sibling ranks option E "alongside A, the most promising near-term
  option"; joint leadership, not sole.
- **C5 (NIT).** Method layer 1 omits the docs-verified Convex lane the
  review program added to 0121/0124/0125 (dated consultation pins);
  one sentence would true it up.
- **C6 (NIT).** "Diary 0022" is cited without the slug; 0117 and 0118
  were both corrected in review to disambiguate
  `0022-backend-bakeoff` from `0022-catalog-lens`. The overview could
  adopt the same disambiguation once.

## Verdict

**NOT READY** — by the thinnest margin, on C1 and C2 only. Every
sibling-representation check passed: the nine headlines, the seven
cross-cutting findings, the OQ1/OQ2 records, and the program-record
claims are faithful to the reviewed texts and the journal, with only
compression-level nits. But a synthesis document whose opening sentence
miscounts its own evidence base, and whose corpus label contradicts a
fact a reviewed sibling states correctly, has not met the bar its own
finding 7 celebrates. Both defects are one-line fixes; nothing
structural is wrong.

## Recommended next step

Apply C1 and C2 (and optionally C3–C6) in a single v0.3 pass; a
fix-verification against the two corrected lines — per the 0122 round-3
precedent — suffices. No new full round is warranted: the synthesis
itself is faithful, and after the two count corrections this reviewer
would be READY.


## Round 2 — 2026-07-30 (fix verification)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, same
resumed subagent context as Round 1
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fix-verification in the resumed Round-1 context, scoped to
the v0.3 corrected sentences plus a no-damage sweep of the text verified
clean in Round 1; cross-family blind for 0116 artifacts maintained (the
Codex 0116 artifact was not read)
**Target SHA-256:** `37a5c1cc9724177ca17d9a0ee4f9a999732a0680b9557c9b15cc939b85850650`
**Status:** completed

### Per-item results

- **C1 — FIXED.** "Fourteen agent-authored diaries" (Summary line 45);
  arithmetic now matches the enumeration (0022 + 0027–0031 = six;
  0032–0039 = eight).
- **C2 — FIXED.** "the multi-backend bakeoffs"; the Revised note's
  rationale re-verified (Diary 0022 ran three arms — Snapback, Convex,
  Supabase; LLP 0120 records Diary 0029 as "the seven-backend Linear
  bakeoff").
- **C3 — FIXED.** Cross-cutting finding 1 now reads "at least five
  coherence facets" / "addresses mainly the install facet", matching
  0122 Finding 3.
- **C4 — FIXED.** The 0117 row now reads "is, alongside the
  structured-input extension, the most promising near-term option" —
  matching 0117 option E's "Alongside A, the most promising near-term
  option", with "the structured-input extension" correctly naming
  option A (CV-4a/4b).
- **C5 — FIXED, with the fixer's correction of my Round-1 paraphrase
  verified correct.** 0125's pin is the bakeoffs' `convex` 1.42.x
  package version, present since the committed v0.1 (line 54), not a
  docs pin; the dated docs.convex.dev consultation pins are in 0121 and
  0124, and I verified they were review-added (the committed v0.1 of
  0121 contains no occurrence of "official Convex docs"). The Method
  text states the lane as it actually landed. Residual NIT, non-gating:
  the sentence's "The review program added…" can be read to also cover
  0125's package pin, which predates the program; a two-word
  qualification ("pre-existing" or moving the 0125 clause out of the
  colon list) would close it.
- **C6 — FIXED.** Diary 0022 disambiguated to `0022-backend-bakeoff`
  with the `0022-catalog-lens` collision named.

### Cross-family fixes spot-checked (without reading the Codex artifact)

- **Cross-cutting finding 4 narrowing — VERIFIED against 0121.** The
  new text's three claims all check: terminal state inspectable in
  `_scheduled_functions` (0121 §What Convex does; Diary 0030's
  acceptance read), "one status row" as the evidence entry (0121's
  guarantee table; "mutable" is a fair gloss of a row whose state
  transitions), and producer correlation offered by "neither product
  today" (0121 §property 3 split). This also repairs a v0.2
  overstatement Round 1 did not catch — "scheduled work… invisible at
  the evidence layer" contradicted 0121's inspectability property —
  so the narrowed claim is now what 0121 actually supports.
- **Cross-cutting finding 7 — VERIFIED.** The running-the-code
  counterfactual is now labeled "this overview's inference, not a
  journal finding", which matches the journal (which records the
  catches but makes no such counterfactual).
- The v0.3 Revised note's characterization of the Fable round-1 review
  is accurate. Its characterization of the Codex round ("both families
  NOT READY on sentence-level items only, with all nine index-table
  headlines verified faithful… by both") is not verifiable by this
  reviewer under the blindness rule and is taken as the author's
  record, not independently confirmed.

### No-damage check

All nine index-table rows are byte-stable against the verified v0.2
text except the 0117 row's corrected final clause; Method layers 2–3,
cross-cutting findings 2, 3, 5, and 6, "What this series is not",
Confidence, and open questions 1–3 are unchanged. The Summary's second
paragraph, the 55/45 figure, and the retired-gaps list are unchanged.
No previously verified claim was disturbed.

### Verdict

**READY.** Both gating defects (C1, C2) are fixed and verified against
the tree; the optional items landed correctly; the cross-family fixes I
could verify are accurate; the one residual item (the C5 "added" scope
NIT) is cosmetic and non-gating. The overview now faithfully indexes
its reviewed siblings and the program record within the author's bar.
