# LLP 0124 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 40ca18b9, mutually blind (no llp/reviews/
artifacts for LLPs 0116–0125 read)
**Target SHA-256:** `19348a3dbf8bb0d0d4bdd519490050dd0b51027b1377bf10354382849a1ab3ac`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

### 1. Overall assessment

This is one of the most thoroughly verifiable documents in the series
front I have reviewed: I spot-checked roughly thirty load-bearing claims
against the tree and the diaries, and the overwhelming majority check out
verbatim — the manifest nonclaims (`src/manifest.rs:5818,6023,6402`; all
three `schemas/capability.manifest.*.json` report `assetUpload: false`),
both guide GAP rows (`guide/capabilities.md:50,52`), the absence of any
asset/vector/embedding product code in `src/` and `packages/` (the only
"asset" hits are admin-console static files; the only "embedding" hits are
host-embedding seams; `src/search/` is FTS only), the LLP 0044 header and
design content, the LLP 0019 F7 recommendation and open question 5, all
three LLP 0073 quotes, the LLP 0007 paved-path quote, the LLP 0111 Tigris
machinery and its "application access to Fly/Tigris primitives" non-goal
(llp/0111:411,437), and over a dozen diary quotes from 0029/0030/0031/0039
— including ones I initially failed to find and that turned out to be
exact (both "Match the outcome ..." lessons, diaries/0030:816 and
diaries/0031:790–791). The provenance discipline is real: Convex claims
are explicitly split into diary-evidenced and labeled background, and the
Confidence section honestly downgrades the directional cost judgments.

Against the stated bar, however, the document does not quite clear "no
flaws": one diary citation is invented as written (a quote and an
inline-256-KiB-asset fact attributed to "Diary 0028's Snapback chat arm"
actually belong to Diary 0030's SpacetimeDB arm; Diary 0028 contains
neither), one characterization of LLP 0044's non-goals is wrong in a way
that understates S1's reconciliation scope, and V1's determinism-by-
precedent claim elides that the precedent it leans on (integer scoring)
does not transfer to float distance arithmetic. All are fixable in a
single small revision with no structural change.

### 2. Strengths

- **Current-state verification is exemplary** (§What Snapback does today,
  §Findings 1–2). Every checkable fact held: `assetUpload: false`
  hard-coded, both GAP rows quoted accurately with honest elision, zero
  asset/vector product code, the 23-days-stale arithmetic on LLP 0044, the
  resolved ticket (`issues/closed/20260728-guide-gap-assets-and-
  notifications-capability-rows.md`) saying exactly what is claimed.
- **The ownership-asymmetry finding is genuinely load-bearing and correct**
  (§Summary, §Findings 2). "The witness column is itself the finding" —
  verified: `backend.vector-search`'s witness really is LLP 0019 marked
  "unmade product decision," and 0019's open question 5 really is
  unanswered since 2026-06-26.
- **Diary quotation is near-verbatim throughout** (§What Convex does, §How
  they differ). The hard ones all check: "Storage was cohesive..."
  (0030:756), 40.168 ms asset round trip (0030:791), "One schema declared
  ordinary, full-text, and vector indexes" (0031:728), the action →
  internal query composition cost quote (0031:762–764), "13 passes ... zero
  failures" (0031:810), "same files/vector GAPs" (0031:893), "prioritize
  real asset lifecycle..." (0031:882–884), the 0029 choice-blocking quote
  (0029:130–131), and the 0039 method-bounds sentence (0039:67–69).
- **The structural-invisibility argument about LLP 0115 is correct and
  well-framed** (§Why LLP 0115 does not cover this). Verified against
  0039's method bounds and 0115's exit criterion; 0115 v0.4's new open
  question 7 now reciprocally adopts exactly this framing, which is
  independent confirmation the analysis landed.
- **Option spaces are complete and fairly costed** (§Option space ×2). The
  S-paths' composition note, S2's honest split of whose claim byte
  durability is, S4's ceiling set by the diaries' own words, V2 as V1's
  boundary condition foreclosing V3 creep, and V4's worse evidence story
  (negative probes crossing a network boundary) are all genuine analysis,
  not option-listing. Finding 7's fence observation (0111 non-goal) is the
  kind of unstated interaction this series exists to surface.
- **Nonclaim/retired-gap hygiene** (§One neighboring gap already retired,
  §Finding 8) correctly pins the full-text half to 0115 (CV-5/10/11/12
  verified on the status board) and refuses to re-litigate.

### 3. Concerns

- **C1 — BLOCKING-FOR-BAR. Invented diary attribution, repeated twice.**
  §File storage says: "why Diary 0028's Snapback chat arm, which did ship
  an inline 256 KiB asset as table bytes, conceded that 'production event
  media would still want object storage.'" That quote and that fact are
  Diary 0030's **SpacetimeDB** arm — "The frozen 256 KiB asset worked as
  inline table bytes with clean authority and hash evidence. Production
  event media would still want object storage, signed delivery, metadata,
  and lifecycle support" (diaries/0030-partiful-backend-bakeoff.diary.md:
  317–319, inside the arm headed at line 257). Diary 0028 (chat bakeoff)
  contains no 256 KiB asset, no inline-byte asset content, and no such
  quote (checked: no KiB/262,144/attachment/object-storage hits anywhere;
  the frozen 256 KiB asset is a Diary 0030 protocol artifact only, and
  "event media" is Partiful vocabulary). §S4 propagates the error
  ("Diary 0028's 256 KiB lesson"). In a document whose declared job is
  carrying the bakeoff record accurately, a wrong-diary, wrong-workload,
  wrong-arm attribution is precisely the flaw class the bar excludes.
  *Resolves:* reattribute both occurrences to Diary 0030's SpacetimeDB
  arm. The analytic point survives — arguably strengthened: a competitor
  whose inline bytes *worked* still conceded object storage.
- **C2 — MATERIAL. V1's determinism-by-precedent elides the float
  problem.** §V1 claims 0073's frame answers determinism "the way FTS
  pinned integer scoring." But the precedent worked *because* it pinned
  integers (`snapback-term-score-v1` is a cross-target integer scorer,
  llp/0073:857; ordering pinned as `score-desc-row-id-asc.v1`, llp/0073:
  159), and that move does not transfer to cosine/L2 distances: portable
  "exact distance arithmetic" over floats needs a named strategy (pinned
  accumulation order, no FMA/SIMD reassociation, or integer/fixed-point-
  quantized distances), and float tie-breaking has its own hazards. This
  is analyzable without running code and is not named; open question 3
  covers exact-vs-ANN but not how "exact" is achieved portably.
  *Resolves:* one or two sentences in V1 and/or OQ3 naming the
  arithmetic-pinning question as part of the vector-v1 design burden.
- **C3 — MATERIAL. Wrong characterization of LLP 0044's non-goals.** §S1
  says the diaries ask for nothing fancier "(no transforms, no CDN —
  0044's non-goals already exclude them)." 0044's non-goals exclude CDN
  and *full video transcoding* only (llp/0044:125–134); its v1 pipeline
  explicitly **includes** transforms — "image dimension detection;
  thumbnail generation where local tools are available" (llp/0044:
  106–111), with a processing acceptance criterion (llp/0044:144–145).
  Consequence understated: the diaries' seven-step minimum is *smaller*
  than 0044's current v1 scope, so the S1 reconciliation the document
  correctly demands also includes deciding whether to descope processing
  — a real cost line S1 currently hides. *Resolves:* correct the
  parenthetical and add the scope-delta observation to S1's cost.
- **C4 — DETAIL. "LLP 0074's verified capability inventory" overstates.**
  0074's inventory is "doc-confirmed 2026-07-22" with a two-tier legend
  (llp/0074:405–410): ◇ = confirmed against the named page; ◈ = "rest on
  adjacent official pages or reviewer prior knowledge and must be
  page-verified at the protocol refresh." Both file storage and vector
  search are ◈ (llp/0074:431–432). The document leans on "verified
  inventory" twice (§Storage background, §Confidence). The diaries do
  verify the behaviors empirically, so substance stands; the provenance
  label should not claim more than 0074 itself does. *Resolves:* rephrase
  ("doc-confirmed inventory; these entries flagged for page
  verification").
- **C5 — DETAIL. Stale 0115 version pin and missing reciprocal pointer.**
  §Confidence says the facts were read "on the same main revision that
  carries LLP 0115 v0.3"; the tree under review (40ca18b9) carries 0115
  v0.4 (Revised 2026-07-30), whose new open question 7 cites LLP 0124 by
  name and adopts its scope-boundary framing (llp/0115:726–734). True at
  the authoring commit (b6c1d19d predates 2c95664b), stale at the
  reviewed tree. *Resolves:* bump the reference and record the reciprocal
  OQ7 pointer in §Relationship.
- **C6 — DETAIL. Decision-flavored absolute in V3.** "Research posture: a
  later ergonomic layer over V1+V2, **never** the admission path" is a
  smuggled forever-ruling in a deliberately decision-free document.
  LLP 0019 sequences the embedding half after storage/index; it does not
  foreclose it permanently. *Resolves:* "not the admission path on
  current evidence" or explicit attribution to 0019's sequencing.
- **C7 — DETAIL. Two citation-precision nits.** (a) "scored it as the
  arm's second standout after transactions/realtime": the diary names
  transactions/realtime "the standout" (0030:750) and describes Storage
  in the next paragraph; "second standout" is paragraph-order inference,
  not a diary score. (b) "(Partiful workload, 2026-07-29)": the Convex
  arm header is "2026-07-28 to 2026-07-29" (0030:718).

### 4. Suggestions

- Name the visibility×top-k interaction as an accelerator-stage proof
  obligation. V1's authorization claim is structurally sound for exact
  brute-force (compute all distances, filter by generated visibility,
  take k), but an ANN accelerator must over-fetch or use filter-aware
  traversal to honor "search never authorizes data" without under-filling
  k — the vector analog of 0073's candidate-superset rule (llp/0073:
  83–89). One sentence would make the later capability inherit the
  obligation explicitly.
- Close the option space affirmatively on two adjacent shapes: a
  client-arm/on-device vector path (or an explicit delegation to 0073's
  "offline client-side search ... separate future profiles" fence) and
  hybrid FTS+vector fusion as an out-of-scope extension.
- Cite the vector row's own resolved ticket
  (`issues/closed/20260729-guide-gap-vector-semantic-search-capability-row.md`)
  beside the assets one — the document currently cites only the latter.
- Status precision on "0070, which supersedes its cron-sweep fallback":
  0070 is a Draft RFC that *designs* the successor and names 0044's sweep
  as a consumer-to-be (llp/0070:384–386); "designed successor" is more
  accurate than "supersedes."
- §S4's "consistent with how notifications are held today" would benefit
  from a citation (LLP 0045 / the notifications GAP row) so the analogy
  is checkable.

### 5. Open questions

- Should this document, rather than 0115 OQ7, say anything about *who*
  answers its own open question 5 (tranche-gating vs parallel start)?
  As written both documents point at the author, which is probably right
  for a Research type — flagging only so the loop confirms it is
  intentional.
- Is the S2 posture toward 0111's non-goal fence ("consciously moved, not
  worked around") strong enough, or should the document name what an
  amendment would minimally have to preserve (per-role prefix custody,
  read-back evidence discipline) so a future S2 owner does not treat the
  fence as merely procedural?
- OQ6 asks whether a paved workaround recipe would "blunt the pressure to
  ship the real capability" — is there corpus precedent either way
  (notifications?) that a revision could cite instead of leaving it purely
  rhetorical?

### 6. Verdict

**NOT READY** — narrowly, and strictly against the stated bar. The
document's current-state record, provenance labeling, option spaces, and
empirical-question hygiene are at or above the bar; but "no flaws" is the
bar, and C1 is an objective evidence-attribution error repeated twice in
a document whose function is carrying the record, with C2 and C3 as real
analysis gaps pre-empirical work could and should close. None of the
concerns is a request for decisions, implementation detail, or empirical
results.

### 7. Recommended next step

One focused revision pass: fix C1 (reattribute to Diary 0030's
SpacetimeDB arm, both occurrences), add the C2 arithmetic-pinning
sentence to V1/OQ3, correct C3's non-goals parenthetical and add the
scope-delta cost to S1, and sweep C4–C7. No structural changes are
needed. Then a delta re-review of the changed passages only — I would
expect quick convergence to READY.
