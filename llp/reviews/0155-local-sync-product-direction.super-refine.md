# LLP 0155 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-08-02: "Do an /llp-super-refine on
LLP 0155. Include Fable and Gpt-5.6 as design partners and allow them to
revise the plan and direction significantly or completely if they think
that's the right thing to do." No round cap was set; the loop runs to
convergence under the standing stopping rules (dual-READY, or the
asymmetric-stop precedent when one family repeats convergent verdicts).
Both families' capsules carry the author's design-partner mandate verbatim:
the reviewers adjudicate the direction itself (ENDORSE / REVISE / REPLACE),
not only defects.

The target is untracked in the working tree at loop start; the base RFC is
Codex-drafted (header: Charlie Cheever / Codex). The orchestrating session
(Fable) did not author it and runs the loop only.

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence."

The target is a Draft **RFC**: it recommends rather than decides and may
leave questions open — but every claim about the LLP corpus, the shipped
code, and the LLP 0138 bakeoff record must be true against the repository
as it exists today, and nothing open may be smuggled as settled.

Loop mechanics as in the 0116–0154 journals: dual-family rounds (fresh
non-author Fable subagent contexts; GPT-5.6 via codex-cli 0.146.0
`codex exec`, model `gpt-5.6-sol`, read-only sandbox,
`model_reasoning_effort=xhigh`), mutually blind on 0155 artifacts in round
1, SHA-pinned targets and instruction capsules, verify-then-fix passes
between rounds. The loop cannot advance the target beyond Draft;
adjudication is the author's.

## Round 1 — 2026-08-02

Capsule: `capsule-0155-r1.md` (shared framing for both families;
design-partner mandate with explicit ENDORSE/REVISE/REPLACE direction
verdict; blindness on all 0155 review artifacts and all super-refine
journals).

Target SHA-256 (v0.1, 1014 lines):
`58974aac57502e07047fec4d6a61e0dc598fe1345ed124dca5cd531991ee951e`

Repo revision at review start: `main` `cbbb58ec`; the target untracked.

### Orchestrator pre-verification (concurrent with round 1)

Checked before either family reported: LLP 0138's retained primary totals
match the RFC's figures (Snapback 47 PASS / 3 GAP / 1 FAIL, Zero 46 PASS /
5 GAP / 0 FAIL, Replicache control 8 PASS / 3 GAP / 0 FAIL;
`llp/0138:300-302`); LLP 0129's Candidate A/B/C ladder and Option-C
non-admission are as characterized (`llp/0129:665`, `llp/0129:1006-1009`);
LLP 0080's stable relational surface is the bounded two-source equi-join
contract (`llp/0080:57`); `rqsEligible` is a shipped schema concept in the
codegen runtime artifacts.

### Round 1 results

**Split verdict with convergent substance — Fable READY "moderate margin,"
direction ENDORSE (3 MATERIAL + 4 DETAIL, C1–C3 must-fix); GPT-5.6 NOT
READY "moderate margin," direction REVISE (3 BLOCKING + 3 MATERIAL + 2
DETAIL).** Blindness audited and held for both (the Codex transcript's only
`llp/reviews/`/journal traces are the capsule prohibition, its stated
intent, incidental in-body mentions in other LLPs, and a search glob
*excluding* those paths). Both families verified the bakeoff totals, the
current-implementation bullets, and the 0129/0133/0053 characterizations
independently; Fable additionally reproduced the cited test suites live
(26/26, 20/20, React offline green), and GPT-5.6 additionally web-verified
the external Zero/Replicache claims (GA, no-offline-writes, aggregates and
`prefix` as future work, archive date 2026-06-10).

The two families converged blind on the same defect from opposite sides:
Fable C2/C3 (the "start now" IR-evaluator bullet bypasses 0129 Phase-1
machinery; Stages-vs-Phases dual vocabulary) and GPT-5.6 B3 (sequence not
reconciled with 0129's IR-rung-first authority; OQ8/OQ10 unaddressed) are
one finding at two depths.

GPT-5.6's design-partner revision (every element verified against the tree
by the orchestrator before application — LLP 0120 option 3a text, LLP 0008
DK-9's "document/result cache … not a relational replica" plus revisit
trigger, LLP 0080's opaque-snapshot-only retention, 0129's decision-2
IR-rung-first text, Phase-1 OQ8 escalation, OQ10, the exact two-attempt
proof rules and Outcome 0, LLP 0147 Micro's exclusion list, and the
`clientMutationId = null` default in `packages/snapback-client/index.mjs`):

- **B1** — Move 1's broad graph grammar presupposes an unselected algebra;
  recast as composition of admitted bounded nodes (0120 option 3a), graph
  syntax as compilation sugar, aggregates (including `count`, which Zero
  itself does not ship) deferred to a separately admitted node class.
- **B2** — Move 2's canonical-row store contradicted its own OQ2 and
  silently reopened DK-9; make opaque result fragments + witnesses the
  baseline, gate cross-query normalization behind a projection-aware
  authority design, and name the DK-9/0080 amendments explicitly.
- **B3** — replace the six-stage global sequence with a Stage 0 authority
  reconciliation plus two lanes: a read lane 0129 explicitly permits, and a
  write lane that keeps 0129's phase machinery unmodified.
- **M4** — completeness needs a compositional witness (one common
  authoritative snapshot across all declared nodes, or `unknown`).
- **M5** — Move 5 compressed 0129's proof protocol; incorporate the exact
  rules (one-valid-implementation-defeats, both-attempts-same-fact with
  sealed evidence, named primitive + owner validation, B held to A's
  standard, Outcome 0 and the misattribution classes).
- **M6** — Stage 5 implied the current 0147 Micro could package local
  sync; Micro v1 excludes exactly those modules — measure Full first.
- **D7** — mutation-identity claim needed arm-specific qualification.
- **D8** — the focused test-run paragraph needed provenance (commands,
  author-reported-run labeling).

**Fable-only, confirmed:** C1 ("existing LLP 0133 settlement machinery" —
Accepted Spec, no lane-L implementation in the tree; 0129 OQ8's own words);
C4 (wire owners are now the 0093 family's delegated Specs 0094/0095); C5
(membership/semi-join predicates lacked their shipped owners LLP 0100/
0073); C6 (inspector has no named owning surface; LLP 0017 unrelated); C7
(external as-of dates rest on URLs alone). Fable's suggestions applied:
claim OQ8's substrate-bounding credit explicitly; state that IR replay at
boot closes the pre-intent restart gap independent of Move 5; inherit the
open delta-egress ticket fail-closed as a Move 2 guardrail; two-tier Move 1
acceptance (completeness-first interim milestone on the current grammar);
LLP 0145 left to round 2 (see residue).

### Round-1 dispositions

All 15 distinct findings applied in **v0.2** (1302 lines, +28.4% — above
the ~20% guideline; the excess is the author-mandated design revision
itself: the two-lane sequencing rewrite, the exact proof protocol, and the
fragment/normalization split are new normative text, accepted as prior
loops accepted correction overages), SHA-256
`cfae8a5c2376490a950c799e4c4a4f7d1f39e4f4c25233a5c86794ca87de4948`.
Zero findings refuted. Substantively:

- Summary moves 1–2 recast (bounded-node composition; fragment baseline);
  the six moves now run as two lanes under a Stage 0 reconciliation.
- §Decision requested split "Start now" into the read lane (with 0129's
  permission quoted) and the write lane (Phase-1 preconditions named);
  do-not-admit extended to normalization-before-authority-design and
  aggregates-before-semantics; owners list corrected (0100/0073, 0094/0095).
- §Authority gained the per-move authority table and the explicit
  commissions-not-amends rule (DK-9 exception named, not smuggled).
- Move 1 rewritten around 0120 option 3a with the open composite semantics
  (cursor coordination, partial refusal, shared-parent dedup, composite
  identity) as named design obligations; aggregates deferred; compositional
  completeness witness added; inspector-owner OQ; interim completeness
  milestone.
- Move 2 rewritten fragments-first with the gated normalization upgrade,
  its authority-model requirements, the DK-9/0080 amendment paragraph, the
  delta-egress guardrail, and the adversarial-projection acceptance case.
- Move 3 pinned to Phase 1; lane-L landing named as rung work, not
  precondition; pre-intent restart payoff stated.
- Move 4 framed as a Candidate-B experiment with OQ10 as prerequisite.
- Move 5's admission bar now incorporates 0129's proof protocol verbatim in
  substance, separately for A and B, including Outcome 0.
- §Sequencing restructured (Stage 0 reconciliation+freeze; read lane; write
  rungs 1–3 mapped to 0129's phases; graduation stage with the 0147
  Full-first correction and conflict rule "LLP 0129 wins").
- Background: arm-specific mutation identity, author-reported test-run
  provenance, externally-sourced date markers.
- Open questions rewritten: OQ2 (normalization gated), OQ3 (aggregates
  deferred), OQ4 (Zero `prefix` future-work note), plus new OQ11–16
  (inspector owner, conformance-corpus owner, manifests frozen-vs-fresh,
  shipped-form-vs-lab-grade Candidate A, 0129 OQ7 browser witness,
  Contract-arm store semantics).

**Residue: none carried.** Fable's LLP 0145 cross-reference suggestion and
GPT-5.6's measurement-separation suggestion were both applied in the same
pass (Move 2 storage profile; §Measurement preamble), so round 2 reviews
them with everything else.

## Round 2 — 2026-08-02

Capsule: `capsule-0155-r2.md` (family-conditioned blindness — own round-1
artifact allowed, other family's and all journals prohibited; enumerates
the v0.2 change sites; directs scrutiny at the revision text itself).

Target SHA-256 (v0.2, 1302 lines):
`cfae8a5c2376490a950c799e4c4a4f7d1f39e4f4c25233a5c86794ca87de4948`

### Round 2 results

**Split verdict again, margins converging — Fable READY "comfortable,"
ENDORSE (2 MATERIAL + 4 DETAIL, C1/C2 must-fix; "no fix that introduced a
substantive defect"); GPT-5.6 NOT READY "narrow-to-moderate," REVISE with
the architecture explicitly endorsed ("the product direction remains sound
and should not be replaced"; 1 BLOCKING + 6 MATERIAL + 1 DETAIL).**
Blindness held for both (each read only its own permitted round-1
artifact). Both families verified the round-1 repairs substantively —
Fable: all four focus classes resolved correctly, the 0129 reconciliation,
option-3a recast, DK-9/0080 honesty split, and proof protocol each checked
against the named documents; GPT-5.6: same, with `ref-check` run and the
SHA re-verified at review end. Both re-verified the external Zero/
Replicache claims against the live pages (independent fetches).

**Found blind by both families (three convergent pairs):**

- **"LLP 0129 names exactly this class" over-attribution** (Fable C1 =
  half of Codex M2): 0129's enumerated permission covers planning/
  inspection/completeness; local materialization is licensed by the
  paragraph's governing criterion (work that does not change browser-write
  expressiveness), not the list.
- **The DK-9 revisit-trigger gloss** (Fable C3 = Codex M4, Codex deeper):
  the trigger is SQL-specific, and LLP 0051 already adjudicated it
  *answered* without SQL (`llp/0051:785+` — "This answers DK-9's recorded
  revisit trigger"). Claiming it as the amendment's basis was wrong twice
  over; the amendment is a deliberate new author decision.
- **The delta-egress staleness** (Fable C2 = Codex D8): a concurrent fleet
  session closed the motivating ticket the same day (fix 3, lane refusal —
  delta candidacy narrowed to schema-exact `documents(table)` contracts;
  `eda8f231`, regression in `tests/live_delta_v0.rs`), moving it to
  `issues/closed/`. Both reviewers found the closure independently; the
  RFC's "open defect / read-lane prerequisite" claims were stale within
  hours of being written.

**GPT-5.6-only, all verified by the orchestrator before application:**
B1 BLOCKING — three sites (authority table row 4, Move 4, write rung 2)
allowed Candidate-B prototyping "after Candidate A is qualified," while
0129:1138 requires B implementation only after a **retained
inexpressibility result**, and the RFC's own Move 5 stated the correct
rule — an internal contradiction introduced in round 1's fix. M2 — Phase 1
start / evidence gate / advancement / lab scheduling are four distinct
gate states 0129 keeps separate; the v0.2 "preconditions" list conflated
them. M3 — Stage 0 froze all six manifests, bypassing or duplicating the
0129 lab's own freeze protocol (owner/timebox before freeze,
baseline-change rule). M5 — Move 4's "counts"/"availability counts"
conflicted with the aggregate deferral and ignored LLP 0130 SD-2's
standing aggregate branch (verified: exact-or-refuse default, fires on 3a
usage evidence, maintained-exact needs contention evidence). M6 — "All
first-party clients expose one query-result materialization" settled what
OQ16 leaves open (the stricter Contract-arm profile). M7 — the proof
digest claimed to incorporate "rather than paraphrase" while omitting
load-bearing rules (role assignment/diary blindness, B coherence ceilings,
ordering-bias handling, the full eight-class misattribution log).

**Fable-only, confirmed:** C4 (same taxonomy hole as Codex M7, plus the
pin-collision disposition — a correctly classified pin collision is a
proposed dated amendment, not Outcome 0; 0129:1481-1485); C5 (two
unmarked external claims); C6 (the read-lane OQ8 sentence renamed OQ8's
substrate list). Fable also verified the closed ticket's fix shape in
detail and supplied the four-site update plan the C2 fix followed.

### Round-2 dispositions

All 14 distinct findings applied in **v0.3** (1398 lines), SHA-256
`602497f35ba140dabd7804b0acecd0db6b73546aad652d51ac747a7afb01eb2e`.
Zero findings refuted. Substantively:

- **B1 propagated:** all three sites now require a retained,
  owner-validated A inexpressibility result under the exact protocol
  (plus OQ10's frozen boundary/owner) before any B-shaped Move 4
  prototyping; the OQ7 escape (Move 4 as Candidate A substrate via the
  logical-mint mapping) stated at each site.
- **Gate states separated** in §Decision requested and authority-table
  row 3 (OQ5 owner/timebox = start; sizing+D5 = evidence gate;
  author-presented advancement while OQ8 pends; OQ8 answer = lab
  scheduling).
- **Manifest freeze split:** Stage 0 freezes read-lane successor manifests
  (Triage/Fleet) only; Kanban/Calendar/Notebook + Incident are LLP 0129
  lab manifests freezing under that Plan's protocol; separate-name rule
  added; OQ13 narrowed accordingly.
- **DK-9 reframed** at all three sites: deliberate new author decision;
  the SQL-specific trigger quoted and explicitly not claimed; LLP 0051's
  adjudication and its one narrow client-side evaluation site
  acknowledged; "This move amends" → "commissions dated amendments."
- **Counts defined** as client-derived cardinalities over complete bounded
  local results (not aggregate nodes) in Move 4's outcome and gate; OQ3
  rewritten around SD-2's standing branch.
- **Move 2 outcome weakened** to a shared materialization vocabulary with
  arm-specific admitted authority/retention profiles pending OQ16.
- **Proof digest marked illustrative** with LLP 0129 as sole normative
  text and the omitted rules enumerated (including the full eight-class
  log, "unresolved" never-defaults-toward-detection, and the
  pin-collision disposition).
- **Delta-egress closure recorded** at all four sites as a worked example
  of the guardrail's fail-closed posture, with the standing regression
  obligation homed in the Move 1/2 owning Spec on any re-widening.
- Details: the two Zero-doc claims marked externally-verified 2026-08-02;
  the read-lane OQ8 sentence rescoped to the store/presentation slice;
  wire-owner split made precise (0094 envelope / 0095 lifecycle /
  0034 Contract provider seam); OQ14 updated to the baseline-change
  half-answer; Status step 2 pins same-change coupling for Stage 0's
  reconciliation half.

## Round 3 — 2026-08-02

Capsule: `capsule-0155-r3.md` (family-conditioned blindness — own prior
artifacts allowed, other family's and all journals prohibited; enumerates
the v0.3 change sites; focused delta review per GPT-5.6's round-2
condition "one focused re-review of those eight edits"; direction verdict
still required).

Target SHA-256 (v0.3, 1398 lines):
`602497f35ba140dabd7804b0acecd0db6b73546aad652d51ac747a7afb01eb2e`

### Round 3 results — CONVERGED, dual READY, dual ENDORSE

**Fable READY "comfortable," ENDORSE (1 MATERIAL + 3 DETAIL); GPT-5.6
READY "moderate," ENDORSE (0 BLOCKING, 0 MATERIAL, 2 DETAIL — its round-2
NOT READY was conditioned on exactly the v0.3 edits plus this focused
check, which it performed itself).** Blindness held for both. Both
verified all ten v0.3 change classes against the owning documents; both
independently re-verified the delta-egress fix in code
(`src/local.rs:2974` schema-exact contract gate, both regression
directions in `tests/live_delta_v0.rs`) and the external Zero claims.

The one substantive round-3 find was convergent and blind again: **the
round-2 manifest-split fix mis-bucketed Incident Room as an "LLP 0129 lab
manifest"** (Fable C1 MATERIAL = Codex DETAIL-2). Verified: 0129's lab
freezes exactly three manifests (Kanban, Calendar, Notebook) and the
string "Incident" appears nowhere in that Plan — the safety-control
election is this RFC's own, so its freeze home must be Stage 0, not
0129's protocol. The same fix-introduces-defect class the loop has now
caught in every fix round, each time smaller: round 1 introduced a
BLOCKING contradiction, round 2 a single mis-homed manifest, round 3's
repairs are clause-scale.

**Also noted (GPT-5.6):** the capsule's "untracked" repo-state claim was
stale — v0.1 was committed at `cbbb58ec` ("feat(embed): land Rust facade
and pending LLP work") by the concurrent fleet at loop start, so the
working tree shows the revision as a tracked modification. The round-1
journal entry's "the target untracked" reflects the conversation-start
snapshot, not the tree at review time; SHA pinning made this harmless.

### Round-3 dispositions and loop closure

All 6 round-3 items applied in **v0.4** (1424 lines), SHA-256
`659399202c3857dfbac3ff49ed3fc4273df7d01a181d632b72150ce81d717e50`
(post-READY fixes, applied after both verdicts; all are the reviewers' own
named resolutions):

- **Incident Room re-homed** (Fable C1 = Codex D2): frozen in Stage 0 as
  this RFC's named product-direction safety-control manifest, with the
  why (the bakeoff's protected-retirement/authority-transition witness),
  the cross-reference proposing registration in 0129, write rung 3 citing
  the home, and OQ13's parenthetical corrected.
- **Candidate-A alternative surfaced** in Summary move 4 and authority
  table row 4 (Codex D1).
- **Pin-collision clause regained the relaxed-policy condition**
  (Fable C2); **the conservative prototype/implement reading marked as
  this RFC's deliberate choice** (Fable C3); **the read-lane amendment
  condition rescoped to plan evaluation only**, with the
  fragment-baseline-inside-envelope reminder (Fable C4); **the Calendar
  count-lifecycle compatibility made citable** (Fable suggestion).

**The loop closes here: dual-READY, dual-ENDORSE at round 3.** Score by
origin: round 1 — 15 findings (Fable 3 MATERIAL + 4 DETAIL + 5 applied
suggestions; GPT-5.6 3 BLOCKING + 3 MATERIAL + 2 DETAIL; one blind
convergent pair). Round 2 — 14 findings (Fable 2 MATERIAL + 4 DETAIL;
GPT-5.6 1 BLOCKING + 6 MATERIAL + 1 DETAIL; three blind convergent
pairs). Round 3 — 6 items (Fable 1 MATERIAL + 3 DETAIL + 1 suggestion;
GPT-5.6 2 DETAIL; one blind convergent pair). **Zero findings refuted
across the loop.** The document grew v0.1→v0.4 from 1014 to 1424 lines
(+40%), all of it reviewer-driven design revision and precision text
under the author's explicit revise-significantly mandate.

The design-partner mandate produced a real revision, not a polish: GPT-5.6
REVISE'd the architecture in round 1 (bounded-node composition per LLP
0120 option 3a; fragments-first with normalization gated; two-lane
sequencing under 0129's authority) and Fable — which had endorsed v0.1 —
judged the revised shape "stronger than the v0.1 shape my family endorsed"
in round 2. Both families converged on ENDORSE for the revised thesis:
copy Zero's outcomes, not its architecture, with Snapback's authority
model preserved.

**Proposed next step (the author decides; this loop cannot accept):**
LLP 0155 stays **Draft** RFC at v0.4, dual-READY. The author's decision
queue: (1) accept/revise/reject the six-move direction itself (both
families recommend acceptance of the revised form); (2) if accepted,
execute Stage 0's reconciliation half — the dated LLP 0129
cross-reference (including Incident Room registration and the read-lane
substrate-bounding evidence toward OQ8), the commissioned LLP 0008 DK-9 /
LLP 0080 amendments, the Candidate-B boundary prerequisite record — in
the same change where practical, and commission the Move 1
composition-algebra owning Spec; (3) the author-gated open questions
(OQ1–OQ5, OQ11–OQ16). The base v0.1 is committed at `cbbb58ec`; the
v0.4 revision is a working-tree modification awaiting the author's
landing decision alongside these review artifacts.

## Author adjudication — 2026-08-02

Charlie Cheever accepted: "accept, promote, commit and push." Applied in
the landing commit: LLP 0155 promoted **Draft → Accepted** at v0.4; Stage
0's reconciliation half executed in the same change per the RFC's own
Status step 2 — the dated product-direction cross-reference in LLP 0129
(consumers, lane split, no-amendment record, OQ8 substrate-slice evidence
offer, conservative prototype/implement reading, Incident Room
registration *proposal* — adoption stays the author's under 0129's own
machinery), the DK-9 dated commissioning note in LLP 0008 (deliberate new
policy, explicitly not the SQL-specific trigger firing), and the
retention-section dated note in LLP 0080 (opaque-snapshot-only governs
until the extension lands). Next concrete artifact: the Move 1
composition-algebra owning Spec (OQ1's recommended successor-Spec route).
