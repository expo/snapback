# LLP 0119 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 40ca18b9, mutually blind (no llp/reviews/
artifacts for LLPs 0116–0125 read)
**Target SHA-256:** `0afa360ef52e3b598c141efa77a055e7d3d3948a5162644bc8aaaee5a7340305`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## 1. Overall assessment

This is a strong research document — the strongest kind of pre-empirical
analysis: dense with checkable citations, honest about both sides of the
comparison, and disciplined about what only running code can answer. I
spot-checked roughly forty load-bearing claims against the tree and the
diaries; the large majority verified exactly, several verbatim:

- `FunctionKind { Query, Mutation, LiveQuery, Action }` — `src/manifest.rs:3661–3666`.
- The `SNAPBACK_FUNCTION_NOT_LIVE` refusal on `kind != LiveQuery` —
  `src/local.rs:7702–7710`.
- `defineQuery` / `defineLiveQuery` / `defineJsLiveQuery` /
  `defineSearchQuery` — `packages/snapback-codegen/define.d.ts:449–453`.
- The conservative table-granular matcher arms for relational,
  bounded-children, and `HandlerPlan::SearchQuery` plans —
  `src/live_matcher.rs:174–182` (search functions indeed cannot be
  subscribed today, yet the arm exists exactly as claimed).
- `compute_live_delta`'s `Replace` fallbacks for ordered/limited windows
  and membership-gated queries — `src/live_matcher.rs:650–667`, matching
  the document's characterization precisely, including the "changed-row
  set alone cannot resolve the new window" rationale.
- Per-page authorization/digest recheck in the search executor —
  `src/search/sqlite.rs:1713, 1813–1839`.
- Diary 0028's "Reactive queries were the standout…" quote (0028:177–178),
  its revocation observation (0028:183–185), and the online-only cache
  observation (0028:238–240, 274–275).
- Diary 0037 checks 6 and 7 exactly as cited (0037:106–110).
- Diary 0039 §3 ("Convex keeps a small developer-experience lead",
  0039:113–114), §4 heartbeat rows (0039:126–128), §6 (0039:159–161), and
  the "Reactive-by-default data and search" heading (0039:236).
- Diary 0030's quarantine-to-empty quote verbatim (0030:543–545).
- LLP 0073's four-way non-live pin, the 2026-07-30 reaffirmation
  (0073:8, 24, 174, 764, 840), the 120-second cursor (0073:54, 399, 861),
  and partition-embedded postings (0073:427–481).
- LLP 0074's Differentiate and Refuse clauses (0074:494–495, 510).
- LLP 0115 CV-11 evidence/work/exit verbatim (0115:552–570), the watch
  item (0115:667–678), and Sequencing item 5's React-surface measurement
  requirement (0115:636–644).
- LLP 0112's one-through-32 all-`LiveQuery` eligibility (0112:84–85, 167)
  and LLP 0114's hook surface (0114:32–38).

Against that high hit rate I found three genuine defects: one misattributed
diary quote (the quote exists, but in a different diary than claimed, and
the cited diary records no such observation), one code claim that asserts
more than the maintenance path currently does, and one underspecified
inference basis inside option 2 that the document's own LLP 0108 discussion
makes load-bearing. All three are fixable by a small pre-empirical
correction pass; none undermines the document's conclusions. But the stated
bar includes "there are no flaws in this," and these are verified flaws.

## 2. Strengths (cite sections)

- **Citation density and accuracy.** Nearly every quoted diary and LLP
  passage I checked was verbatim-correct ("What Convex does," "What
  Snapback does today," "How they differ"). The Confidence section's claim
  that code was spot-checked against current main is borne out.
- **Both-sides honesty.** The three structural Convex costs (determinism/
  runtime capture, durable-only reactivity, online-only cache — "What
  Convex does," final paragraph) and the "honest other side" list are all
  diary-grounded, and Finding 9 correctly notes the scoring rarely prices
  them. The Diary 0022 boot-consistency caveat (Convex also has
  logical-timestamp consistency; the claimed advantage is inspectable
  evidence, not consistency Convex lacks) is exactly the right discipline.
- **Provenance hygiene on Convex.** The general-background paragraph is
  explicitly labeled non-diary, placed under LLP 0074's re-verify rule,
  and downgraded to Medium confidence. This is the pattern the capsule
  asks for.
- **The option-4/option-5 relationship** ("Option 5," Findings 4–5). The
  argument that a changed posting proves candidacy but not the new top
  page — so option 5 cannot avoid re-execution and is a wake-precision
  refinement of option 4's delivery model — is analytically correct and
  the most useful single insight in the document.
- **The quarantine sub-question.** Correctly identifies that the obvious
  fix (holding prior rows) would soften LLP 0053's fail-closed revocation
  proof, and reframes as wake precision. Verified against 0053's
  obligation model (negative deltas are obligations; quarantine start
  states, 0053:221–249).
- **Empirical honesty.** The Confidence section's three-tier structure and
  the explicit "structural arguments, not measurements" label on option
  4/5 costs answer capsule point 4 well; Open questions 1–6 correctly name
  the decision-shaped and empirical residue.
- **Decision hygiene.** The ownership map ("Relationship to LLP 0115 and
  owning documents") cleanly routes options 1–2 to the watch-item trigger
  and 3–6 to owners; the document takes no position it disclaims.
- **The measurement-gap observation** (option 3, Finding 3): the rerun
  drove headless clients so 0112/0114 gains were structurally invisible —
  verified against 0115 Sequencing item 5, which says exactly this.

## 3. Concerns

**C1 — MATERIAL — Diary 0034 misattribution.** The document (line 41)
attributes the quote "ordinary queries become reactive without a separate
live classification" to "Diary 0034 (Campfire rerun)." That quote is in
Diary 0039 §3 (0039:110–111), the report's Campfire section. Diary 0034
itself (`diaries/0034-campfire-main-rerun.diary.md`) contains no occurrence
of "reactive" or "live classification" at all; its only realtime
observation is the acceptance line "native client B observed client A's
sequence-5 message over the live stream." This also softens Finding 1's
"four independent diaries" tally, since the Campfire-generation recording
exists only in the 0039 synthesis, not in the in-arm diary. *Resolve:*
reattribute to Diary 0039 §3 and adjust Finding 1's wording (e.g., "four
documents across two generations, with the Campfire observation recorded at
report level").

**C2 — MATERIAL — Option 5's posting-union claim overstates current code.**
"the synchronous maintenance path already computes the exact union of
old/new posting keys per mutation" (option 5, opening; echoed by the
benefit framing). In `src/search/sqlite.rs:476–487` the maintenance path
COUNTs the old postings (for the old-plus-new work ceiling,
`SNAPBACK_SEARCH_SOURCE_LIMIT` at :528–534) and then DELETEs them without
ever materializing the old posting keys; only the new token set is computed
(`source_tokens`, :527ff). The union is *available inside the maintenance
transaction* but is not computed today — capturing the old-key half needs
an additional read. The document's own conclusion (option 5 is materially
harder and not near-term) survives, but the "already exists" inventory is
inflated as written. *Resolve:* reword to "the maintenance transaction
touches the exact union of old/new postings and could materialize it with
one additional read of the old posting set before deletion."

**C3 — MATERIAL — Option 2's static-inference basis for JS queries is
unspecified where it decides the document's own 0108 question.** Option 2
proposes inferring live capability for "JS queries whose captured-read
vocabulary the matcher covers" and defends the inference as "classifying
from the closed generated plan is static and reviewable, unlike inferring
behavior from handler source." That defense holds for host-plan queries,
which have a closed plan. JS (Ibex) queries do not: the matcher rides a
*declared* `read_set_summary` (`src/live_matcher.rs:147–168`) plus
dependencies *captured at runtime* (:190ff). Which of those is the
inference carrier determines whether option 2 stays on the safe side of
LLP 0108's no-inference invariants (0108:39–69, "infer reads, writes,
auth, effects … from handler behavior" is forbidden) — the exact
distinction the document says "must be argued explicitly" but then leaves
unargued for the JS half. *Resolve:* one paragraph naming the JS carrier
(plausibly: inference only from the declared read-set summary and the
matcher's static vocabulary coverage, never from captured runtime reads)
or explicitly scoping option 2's inference to host-plan queries with JS
remaining authored.

**C4 — DETAIL — "deepest structural" attribution.** The Summary says "the
2026-07-30 rerun (Diary 0039) named it Convex's deepest structural one."
Diary 0039 never uses "structural" and does not rank its four "Where
Convex is better" items; the superlative is LLP 0115's watch-item language
(0115:667). Substance intact, attribution wrong. *Resolve:* attribute the
characterization to LLP 0115 (which absorbed 0039), or soften to "recorded
it among Convex's advantages."

**C5 — DETAIL — Option 6 attributes "no simulated reactivity, no
capability drift" to LLP 0073.** The exact phrase is LLP 0115 CV-11's Work
section (0115:564–565), restating 0073's pin; the phrase does not occur in
0073 (verified by search). The normative substance is genuinely 0073's
(nonclaims at 0073:764, reaffirmed refusal at 0073:24). *Resolve:* cite
0115 CV-11 for the phrase or paraphrase without quotation marks.

**C6 — DETAIL — function-name drift.** "`live_subscribe` in `src/local.rs`"
— the actual entry points are `subscribe_live` (`src/local.rs:7342`) and
`subscribe_live_prepared_with_invalidation` (:7685, where the refusal
lives). *Resolve:* use the real name.

**C7 — DETAIL — decision-adjacent phrasing in Finding 5.** "treating it as
the v1 target would stall the practical win" presumes option 4 is the
desired win, in a document that "ranks nothing and decides nothing." The
structural claim (option 5 refines option 4) is analysis; "the practical
win" is advocacy. *Resolve:* neutral phrasing, e.g. "would defer any
shipped subscription contract behind research-grade work."

## 4. Suggestions (non-blocking)

- Name the composed client-unification shape explicitly: a single
  `useSnapbackQuery`-style hook that uses push for `LiveQuery` functions
  and option 6's declared-refresh protocol for non-live ones would erase
  most of the felt split at the client without any server claim change.
  The document says options compose but never names this most likely
  composition (3 + 6) as a concrete shape.
- "hosted targets have no live evidence today" (option 1 costs) is
  plausible given LLP 0072's ungated drill legs, but it is the one code/
  evidence claim in the document with no pointer; a parenthetical citing
  what evidences it would keep it checkable, and should distinguish the
  hosted target profile from the 2026-07-27 served-origin matrix runs.
- Option 2's drift hazard has a sibling the document could note in one
  line: under auto-classification, a silent live-to-non-live downgrade
  also flips LLP 0112 register-eligibility for every route containing the
  function — the cliff reappears as a regeneration hazard rather than an
  authoring one. Open question 3 would then cover both.
- The Revised header is empty; the correction pass resolving C1–C3 should
  stamp it.

## 5. Open questions

- Is Diary 0034's *silence* on the classification itself signal? The
  Campfire in-arm rerun passed 6/6 on both arms including live delivery,
  and its "what remains worse" list is about pagination discoverability
  and result-contract bulk — not the live boundary. Whether the boundary's
  felt cost appears only at report-synthesis level is a fact the next
  rerun could deliberately probe.
- Should the document state what evidences "hosted targets have no live
  evidence today" (see Suggestions), given LLP 0115's no-evidence-
  regression constraint makes that fact load-bearing for option 1's cost
  case?
- Option 6's hint channel is described as "a live query over the index's
  table-version or generation counter" — is such a counter currently
  exposed as a queryable row at all, or does this presuppose a small new
  server surface? The document does not say which; if the latter, the
  "tiny server cost" benefit understates the contract work its own
  cost paragraph then correctly names.

## 6. Verdict

**NOT READY** — narrowly, and only against the stated bar's "no flaws"
clause. The analysis itself — option space, cost/benefit fairness,
empirical-question discipline, decision hygiene, owning-LLP interactions —
meets the bar; I found no missing genuinely distinct option and no smuggled
decision beyond C7's phrasing. But C1 (a quote attributed to a diary that
does not contain it), C2 (a code claim the tree contradicts as written),
and C3 (an inference-basis gap the document's own 0108 discussion makes
load-bearing) are verified pre-empirical flaws, exactly the class this
review exists to catch, and all are fixable without running anything.

## 7. Recommended next step

A single correction pass: fix C1 (reattribute + adjust Finding 1), C2
(reword the posting-union claim), C3 (one paragraph naming option 2's JS
inference carrier or scoping it out), and the C4–C7 details; stamp the
Revised header. No structural rework is needed. A delta-scoped re-review of
just those edits should suffice for READY.
