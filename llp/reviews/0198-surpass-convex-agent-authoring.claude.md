# Review artifact — LLP 0198, Claude family

Provenance: llp-super-refine loop, orchestrated 2026-08-08; reviewer =
fresh Claude-family subagent (claude-fable-5, session-default effort),
mutually blind, design-partner lens; capsule tar sha256 ce0cafe26d10…
(git archive of 763b408, llp/reviews/0198-* excluded); instructions
sha256-16 4a61d27333c303d9; runtime 8m17s. Body below is verbatim.

---

## Round 1 — 2026-08-08 — revision (a) 763b4080 / sha256 9351ad5c… — verdict: NOT READY

# Review — LLP 0198 (round 1, Claude family, design-partner lens)

Target: `llp/0198-surpass-convex-agent-authoring.plan.md`, revision a,
commit 763b408066e26fabc6e1894ed0096c2c41fa09c5, sha256 9351ad5c….
Verified against: diaries 0057, 0058 (both), 0059, 0060, 0065 (rematch),
0066, 0068, 0069; `benchmarks/README.md`, `protocol.md`,
`schema/run-record.schema.json`, `records/2026-08-07-messaging-0113.md`,
`records/2026-08-08-messaging-0115.md`, `briefs/*`, `lanes/*`; LLPs 0186,
0189, 0193, 0194, 0195, 0196, 0197 — all inside the capsule.

The synthesis (Part I) is very good: nearly every number, quote, and
attribution I checked matched its primary source exactly — the five-run
table, both rubric tables' run-1 column, the loop series, the Convex
weaknesses list, the 0057/0059 verbatim verdicts, the residue list, and
the 0186/0189 framing all check out. The concerns below are concentrated
where the plan touches the recently revised lane documents (0195/0196/0197)
and the instrument's own protocol.

## Concerns

1. **MATERIAL — P0's exit contradicts the instrument's own repetition
   floors.** P0 promises "Run the N≥3 repeat protocol … to establish the
   per-lane variance band" with exit "standing mean±band numbers …
   ratchet tolerance derivable from data," but `benchmarks/protocol.md`
   ("Repetitions and variance") states flatly that **no variance claim is
   made from fewer than 8 repetitions per lane**; N≥3 is only the ratchet-
   claim minimum. As specified, P0's exit either violates the protocol it
   cites or requires N≥8 (4 lanes × 8 = 32 runs), whose cost the phase
   never prices. Say which: either P0 runs N≥3 for ratchet-eligible means
   and defers band/tolerance claims to an N≥8 study on the primary pair
   only, or it budgets the full N≥8. (Evidence: 0198 §II.3 P0 vs
   `benchmarks/protocol.md` "Repetitions and variance".)

2. **MATERIAL — the P2 lever is characterized by a quote the revised
   LLP 0195 no longer supports.** I.5 attributes to 0195 the quoted phrase
   "the only available lever on the training-data moat"; that phrase
   appears nowhere in the capsule's 0195 (r1), which was deliberately
   revised to demote the training effect to a "plausible but **unverified
   hypothesis**" whose "decision case rests on discoverability and
   retrieval" (0195 Summary, OQ4). 0198's P2 sequencing note and the
   V1-stretch "contingent on training-data presence" framing lean on the
   stronger pre-revision claim. This is exactly the recently-revised-lane
   drift a synthesis must not carry: re-quote 0195 accurately and restate
   P2's mechanism as pre-install orientation/discoverability first,
   training-data upside second. (Evidence: 0198 §I.5 term 1, §II.3 P2,
   §II.5 vs `llp/0195` Summary and OQ4.)

3. **MATERIAL — V1/V4 as phrased collide with 0196's exit criteria and
   0197 rule 4a (template-assisted labeling / held-out briefs).** The
   skill-web lane V1 names is template-scaffolded (the 0.1.15 expo-chat
   defaults are credited for run 5's gains, I.1), and the messaging brief
   is the surface the expo-chat template was built around; 0197 rule 4a —
   which 0196's exit criteria explicitly adopt — says template-assisted
   results "are never published as general authoring-efficiency claims"
   and portfolio-level claims need a held-out brief variant. V4 proposes
   publishing V1 under 0197's standard without ever mentioning this
   constraint, so the plan's headline victory condition is, as written, a
   claim its own publication standard would refuse or force to be
   relabeled. Fix: define V1 explicitly as a template-assisted,
   labeled scenario and add the held-out-brief variant as the condition
   for the general claim (or fold it into P3's brief work). (Evidence:
   0198 §II.1 V1/V4, §II.3 P5 vs `llp/0197` rule 4a and `llp/0196` exit
   criteria.)

4. **MATERIAL — "0 backend / 0 framework across all three Snapback
   lanes" overstates the run-5 record.** Both diary 0069's table and
   `records/2026-08-08-messaging-0115.md` show the bare lane at "6 (~2)"
   under "Loops (framework)" — the same parenthetical the plan's own I.2
   series counts as "framework-attributed correction loops" for runs 2–4
   (4/8/3). The diary's prose ("zero framework **defects** in any lane")
   and its table ("~2" framework-attributed loops, knowledge-shaped) are
   in tension, and the plan silently resolves it in the favorable
   direction while using the loop-count series one sentence earlier.
   State it the way the record supports: zero defect-shaped framework
   loops anywhere; ~2 framework-attributed knowledge loops remained in
   the bare lane (the template web-deps gap). The "defect war is won"
   conclusion survives; the sentence as written doesn't match the source.
   (Evidence: 0198 §Summary and §I.2 vs diary 0069 table + prose and the
   0115 record.)

5. **MATERIAL — P1's exit is stated in a category the instrument cannot
   measure.** Exit: "a measurement run in which … knowledge-attributed
   loops are 0." The run-record schema's attribution enum is
   `snapback-defect / agent-error / environment / ambiguous` — there is
   no defect-vs-knowledge split, so the exit as specified is judged from
   diary prose, not the instrument, in a plan whose stated discipline is
   "claim nothing before the instrument supports it." Cheap fix that also
   repairs concern 4: amend `protocol.md`'s attribution rule with a
   sub-attribution on snapback-attributed loops (`defect` vs
   `knowledge-gap`), and let P1's exit read from records. (Evidence:
   0198 §II.3 P1 exit vs `benchmarks/schema/run-record.schema.json`
   `correctionLoops.attribution`.)

6. minor — The Convex loop comparison "2–3 per run" only fits runs 2–3;
   the framework-attributed Convex figures are 2, 3, 1, 0 (runs 2–5), and
   run 5's 1-loop/0-framework Convex lane actually strengthens the point
   being made. (0198 §I.2 vs 0065/0066/0068/0069 tables.)

7. minor — Four run-2 rubric cells are mistranscribed: functional is
   95 (plan "~96"), images is 78/93 (plan "~82 / 92"), data-model Convex
   is 90 (plan 91). A synthesis whose purpose is "captures the current
   state in one place" should transcribe the scored record exactly; the
   tildes suggest reconstruction from memory. (0198 §I.3 vs diary 0065
   scores table.)

8. minor — "the published skill (already worth ~10m wall in run 5: 19m vs
   29m35s bare)" overclaims twice: diary 0068 notes the scaffold now
   ships the skill, so the bare lane reads it post-scaffold and the delta
   measures **pre-scaffold routing**, not the skill's whole value; and a
   single-run 10m delta is inside the ±30% band the plan's own
   measurement posture refuses to read. (0198 §I.5 term 1 vs diary 0068
   "The bare/skill distinction is collapsing by design".)

9. minor — P0's "the schema requires it" (rubric scoring): true of the
   JSON schema, but the README labels that schema "optional" for records,
   so the enforcement claim is weaker than stated; if P0 wants scoring
   mandatory per run, say the record format (records/schema.md + README
   procedure) is being amended to require it. (0198 §II.3 P0 vs
   `benchmarks/README.md` directory-layout line.)

10. minor — In the I.1 table, run 2 sits in the "Snapback skill lane"
    column but was a bare lane (no skill existed until run 3); run 1 is
    footnoted "(no skill yet)", run 2 is not. Diary 0068's series table
    has the same wart; the plan should carry the caveat 0197 already
    states ("bases differ across rows"). (0198 §I.1 vs diary 0065 method.)

11. minor — Two quote-hygiene items: the I.3 mature-hypothetical quote
    splices two sentences and drops "fundamentally" from diary 0058; and
    "zero documentation consumed in any run" is documented for runs 2–5
    but not stated by the run-1 diary. (0198 §I.3/§I.4 vs diary
    0058-relay-room.)

12. minor (courtesy flag, not 0198's defect) — LLP 0197's Summary
    restates the token series as "2.91x … on 0.1.13", which matches
    neither the 0113 record (skill 2.00x) nor any lane I can derive;
    0198's own table is right, but since P5 delegates publication to
    0197, the author should reconcile the sibling doc.

## Generative input

Ranked by expected impact.

1. **Add a day-2 / evolution brief to P3 — the corpus's second systematic
   blind spot, by the plan's own logic.** I.6 correctly names the auth
   seam as a caveat that "cuts against Snapback" because every brief
   zeroes the dimension Snapback is strongest on. The exact same argument
   applies in the other direction to greenfield-only measurement: all
   five runs build from empty, so the corpus zeroes the dimension where
   Snapback's *known open frictions* live — the doc-comment/artifact-
   identity rollover (0186 W4's remaining item), deployment pinning vs
   the edit loop, and 0057's explicit pre-production ask ("a story for
   evolving a sessions app without dropping its database"). Convex's
   edit-loop story is plausibly its second moat after training data. A
   "day-2 brief" — take the messaging app as built, apply three scripted
   change requests (add a field + migrate live data, add a feature
   touching schema+client, a pure refactor) — would price this before a
   competitor's blog post does it for you. Symmetry is the fairness
   argument: the plan already adds a real-auth brief to price Snapback's
   hidden strength; add the day-2 brief to price its hidden weakness, and
   the brief portfolio becomes visibly honest in both directions. Lands:
   P3 (third bullet) + I.6 (name greenfield-only as a caveat alongside
   the auth seam).

2. **Define requalification semantics for benchmark claims — what
   actually invalidates V1/V2.** II.1 borrows 0189's vocabulary
   (snapshot, scoped digest, requalify after drift), but 0189's machinery
   is built for code claims whose claim-relevant surface is a file set.
   A benchmark claim's claim-relevant surface includes things no digest
   hashes: the Convex version, the model build, the machine class, the
   brief text. 0197 rule 5 says claims "age out when either moves
   materially" without defining materially. Propose the operational rule
   here: a V1/V2 claim names {closure version, competitor version, model
   build, harness commit}; a standing **control-lane cadence** (one
   Convex lane re-run per epoch — monthly or per competitor minor
   version, whichever first) detects control drift; control drift beyond
   the P0 band, a Snapback promotion, or a model-epoch change each
   trigger requalification on the next natural cycle, 0189 D-3 style.
   This turns "Convex keeps improving" from a listed risk into a
   mechanism, and it is the piece 0197 explicitly left to the owning
   plan. Lands: II.1 preamble + P5.

3. **Promote model diversity from OQ3 to a cheap P0/P3 leg, and scope
   V1–V3 to the pinned family until it runs.** The plan's own diagnosis
   says the dominant remaining term is prior familiarity — a property of
   the *model family's training distribution*, not of Snapback. That
   makes V1/V2/V3 uniquely exposed to being one-family artifacts: another
   family with deeper Convex priors (or shallower ones) could move the
   ratio more than any P1–P3 work. One replication run of the primary
   pair on a non-Fable family (N=1 is fine — it answers "is the ranking
   family-stable?", not magnitude) is a day of cost and would be the
   single cheapest hedge on the entire program's validity. Until it
   exists, V1/V2 should carry "on the pinned model family, stated" the
   way 0197 OQ1 already anticipates. Lands: P0 (one replication leg) or
   P3; wording in II.1.

4. **Specify the real-auth brief with the equal-proof-bar pattern:
   outcome-stated bar + negative proofs.** OQ2 worries "each platform's
   idiomatic auth" won't survive fairness review; the corpus already
   contains the answer's shape. State the bar as vendor-neutral outcomes,
   exactly like the equal-proof-bar brief does for offline: (a) identity
   is server-derived — no client-supplied sender reaches storage; (b) a
   valid token for principal X cannot read a conversation X is not a
   member of, proven by a **two-principal negative test** (0057's spec
   shape, and the corpus's only real-auth precedent); (c) an
   unauthenticated request to any protected operation is refused. Each
   lane uses its platform's recommended path to *meet the stated
   outcomes*; transcripts published per OQ2's own proposal. This converts
   OQ2 from an open worry into a design, reusing a pattern 0197 rule 4
   already blesses. Lands: P3 bullet 2.

5. **Answer OQ5 now: mirror `wallClock.phases` with `tokens.phases`, and
   make P0's repeats carry it.** The schema already splits wall-clock
   into orientation/authoring/verification/diagnosis; tokens — the
   plan's preferred cross-run metric — have no split, which is why I.5's
   four-term decomposition is narrative rather than measured. Adding the
   same four-phase split to `tokens` (nullable, like the wall phases)
   before the P0 study means the N≥3 repeats produce the decomposition
   for free: term 1 (orientation) and term 3 (proof surface) become
   record fields, P2's exit ("orientation cost measured as its own
   split") gets its token half, and the deeper-proof asymmetry stops
   silently inflating the headline ratio. Sequencing matters: land the
   schema change first or the P0 runs are spent producing pre-split
   records. Lands: P0 + OQ5 (resolved).

6. **Give the P4 sitting measured options, not just named ones.** The
   62–70 vs 96 operations deficit is currently a judged rubric score from
   two runs. A small "deploy-and-operate" brief leg — reach a real URL,
   read logs after an induced error, restart, rotate a secret — run once
   per platform would convert the deficit into a cost table before the
   author chooses among (a)/(b)/(c). It also directly serves option (b):
   if contest-the-definition is chosen, the fairness note needs
   per-sub-dimension scores (hosting productization vs operational
   truthfulness — receipts, determinism, scale-to-zero), and a measured
   leg is what makes that split credible rather than defensive. Lands:
   P4, as pre-decision evidence gathering with a named small budget.

7. **Make V3 a pick-and-build probe, not a stated-preference poll.** OQ4
   already worries a preference probe is gameable; the fix is to make the
   stated choice costly: the agent picks from redacted public surfaces
   (platform names stripped, docs/template/skill artifacts only), then
   **must build the brief with its pick**, and the record captures (a)
   the pick, (b) whether the agent expresses regret or switches, (c)
   whether its justification cites properties the measured record
   supports. Run N≥5 fresh contexts per brief family across the OQ3
   panel. Preference revealed under commitment is the qualitative flip of
   run 1's verdict in a form a skeptic can't dismiss as prompt framing.
   Lands: V3 + OQ4 (resolved into a design).

8. **Add time-to-first-passing-proof as a standing sub-metric.** Convex's
   felt advantage — and the verdict pattern's recurring phrase ("this
   week", "faster to get from schema to a live app") — is the first
   fifteen minutes, but V1 measures whole-run wall, where Snapback's
   deeper proof tail dilutes the demo-moment gap. Recording the epoch of
   each lane's *first green proof* (the schema's timestamps make this
   nearly free) gives the program a metric for the adoption-critical
   moment, and II.4's endgame sentence ("making the first fifteen minutes
   as cheap as Convex's") gets a number instead of a vibe. Lands: P0
   metrics + records/schema.md.

## Verdict

NOT READY — the synthesis is accurate and the strategy is right, but five
MATERIAL defects (the N≥3-variance/protocol contradiction, the stale 0195
quote, the V1/V4 vs 0197-4a collision, the run-5 zero-framework
overstatement, and the unmeasurable P1 exit) need one revision pass.
Reviewed revision: 763b4080 / sha256 9351ad5c….

---

## Round 2 — 2026-08-08 — revision (b) 2f117950 / sha256 404b0b93… — DELTA ROUND — verdict: NOT READY (3 MATERIAL, all IN-DELTA; 0 PRE-EXISTING MATERIAL)

Provenance: fresh Claude-family subagent (claude-fable-5), mutually
blind, capsule-r2 tar sha256-16 2ebbcffa4b9760df (round-1 artifacts and
run journal structurally excluded; DELTA-a-to-b.diff at root);
instructions sha256-16 1c24ec63046f17f1; runtime 8m59s. Body verbatim.

# Review — LLP 0198 (revision b), super-refine round 2 (delta round), Claude-family reviewer

**Target:** `llp/0198-surpass-convex-agent-authoring.plan.md`, revision b,
commit 2f11795033ae122d210321d62c862a9df66002c6, file sha256
404b0b93353eaffa6e91fee5ff70d7f3b0ca216224561a8cd6061d8709955abc.
Reviewed against the capsule's primary sources only: diaries 0057–0060 and
0065–0069, `benchmarks/` (README, protocol.md, records incl.
`2026-08-08-messaging-0115.md`, `schema/run-record.schema.json`,
`records/schema.md`, briefs, lanes), LLPs 0186, 0189, 0171 (Finding D),
0193–0197, and the capsule-root `DELTA-a-to-b.diff`. No review artifacts
consulted.

What was verified and found sound before the concerns: the full I.1 run
table (all five runs' walls/tokens/ratios match diaries 0058-relay-room,
0065-rematch, 0066, 0068, 0069 and records 0113/0115); both scored-rubric
columns and the mature-hypothetical flip (diaries 0058/0065, exact values);
the Convex loop series 2/3/1/0; all I.4 verbatim quotes located in their
diaries; P0.0(d)'s "the JSON schema alone is optional today" (correct —
`run-record.schema.json` requires `rubric` but `records/schema.md` makes the
JSON record itself optional, so (b)'s fix of (a)'s wrong "the schema requires
it" claim landed properly); P0.1/P0.2's staging against `protocol.md`'s
explicit N≥3 ratchet floor and N≥8 variance floor; P0b's no-cross-family
token pooling (consistent with protocol OPEN/0186 OQ1 and 0197 OQ1); the
requalification tuple and "held at snapshot X" semantics against LLP 0189
D-3/D-5/D-6; P4(b)'s preregistered-new-scorecard guard against 0197 rule 1's
preregistration and the frozen-rubric provenance; the equal-proof-bar brief's
existence and never-run status; and the greenfield-caveat quote in diary 0057.

## Concerns

1. **MATERIAL — IN-DELTA.** The run-5 loop accounting still misstates the
   record it cites: I.2's series claims "run 5 **0**" framework-attributed
   loops in the skill lane and (with the Summary) confines the surviving
   knowledge-shaped framework loops to the bare lane, but the 0115 record
   annotates the skill lane "7 (0 **backend**)" — not 0 framework — and diary
   0069 residue 1 says the expo-chat web-deps gap was "**both web lanes'**
   longest single loop," so the skill lane had at least one
   framework-attributed knowledge-shaped loop. Evidence:
   `benchmarks/records/2026-08-08-messaging-0115.md` (lane table + notes);
   `diaries/0069-run5-measurement-0115.diary.md` (table row "7 (0 backend)"
   vs native "8 (0 framework)"; residue 1). The "zero defect-shaped loops in
   any lane" sentence is supported; the series figure and the bare-lane
   exclusivity are not — and this was exactly the claim the (b) revision set
   out to make precise, and it feeds I.5's knowledge-residue decomposition
   and P1's exit accounting.

2. **MATERIAL — IN-DELTA.** P1 and I.5(2) misstate LLP 0194's exclusion set:
   the Plan asserts "0194 names the `ctx` handler surface **and the
   verify-config contract** as exclusions until declaration files exist" and
   makes "a verify-config contract source" a P1 acceptance item — but 0194
   (r5, in this capsule) moved verify-config into the INITIAL scope because
   its declaration source already exists and is published
   (`@expo/snapback-cli/verify` → `verify.d.mts`, landed 2026-08-04), and its
   OQ2 explicitly says "Verify-config needs no OQ." Only `ctx` remains a
   named exclusion. Evidence: `llp/0194-generated-api-reference.rfc.md`
   Design 5, "What this kills," OQ2. The Plan's ownership-correction — its
   own headline round-1 fix — is therefore half wrong: "0194 covers it is
   false until the declarations land" holds for `ctx` only; for verify-config
   the residue is discoverability, which 0194 already claims.

3. **MATERIAL — IN-DELTA.** L5 rests on "the **P3 pick-and-build probe**,"
   but P3 contains no such work item: its four bullets are equal-proof-bar,
   trust-boundary, day-2, and CRUD/media briefs. Revision (a)'s V3 defined
   the choose-your-backend probe; the (b) rewrite kept the rung (and OQ4's
   mechanics question) but dropped the probe from every phase, so the
   confirmation leg of the unqualified "surpasses Convex" phrase has no
   owner, no design beyond L5's parenthetical, and no exit criterion
   anywhere in II.3. Evidence: II.1 L5 vs II.3 P3 (diff hunk replacing the
   P3 section); OQ4.

4. **minor — IN-DELTA.** L2's win condition ("Snapback wins wall **or**
   tokens outright") permits exactly what L1's own rationale forbids —
   "parity bought by doubling inference spend is not parity" — since a wall
   win at any token cost satisfies the rung; the disjunction/conjunction
   asymmetry between adjacent rungs is unexplained.

5. **minor — IN-DELTA.** L4 invokes "P0's two-layer scoring," but P0 defines
   no such mechanism — P0.0(d) only makes rubric scoring required by the
   record format; the two-layer design (frozen 0058 rubric for messaging,
   preregistered per-brief outcome rubrics, unexercised dimensions kept out
   of cross-brief aggregation) exists only inline in L4 and II.5. Dangling
   internal attribution; the mechanism should live in P0.0 or be cited to
   where it is defined.

6. **minor — IN-DELTA.** II.1's labeling trigger ("labeled
   **template-assisted** wherever a first-party template materially built the
   lane's start") is narrower than the 0197 rule 4a it claims to apply: 4a
   labels **aid-assisted** scenarios covering *every* vendor-authored aid —
   templates, example apps, recipes, and **skill content**. A skill-equipped,
   template-free lane escapes the Plan's label while 4a requires it; L3's
   paraphrase "no template was designed against" similarly narrows 4a's "no
   vendor-authored aid." Evidence: `llp/0197-…rfc.md` rule 4a;
   `llp/0196-…plan.md` exit criteria (which adopt the aid wording).

7. **minor — IN-DELTA.** The control-lane cadence treats a single per-epoch
   Convex re-run "beyond the P0 band" as a requalification trigger, while
   `protocol.md` forbids treating a delta as real below N≥8 and the observed
   spread is ±30% — a lone-run band exceedance will fire spuriously and
   thrash claims into "historical." The direction is conservative (lapse,
   not overclaim), but an intermediate confirmatory step (N≥3 on exceedance
   before requalification) is missing from an otherwise
   staged-by-cost design.

8. **minor — PRE-EXISTING.** I.1's secondary-lane note calls the 0.1.15
   template defaults "the largest single-release improvement of the program,"
   dropping LLP 0196's qualifier ("of any release whose changes were
   knowledge-placement rather than defect fixes"); the 0.1.13 seven-fix layer
   produced larger single-release steps (bare 80m33s→41m32s, skill
   64m→26m22s). Evidence: `llp/0196-…plan.md` Summary; diaries 0066/0068.

9. **minor — PRE-EXISTING.** I.2 opens "Framework-attributed correction
   loops **in the skill lane**: run 2 **4** …," but run 2 had no skill lane
   (I.1's own basis note says runs 1–2 predate the skill); the unchanged
   sentence still misnames the lane the run-2 figure belongs to
   (0065-rematch's bare published lane).

10. **minor — PRE-EXISTING.** Citation imprecision under a known filename
    collision: the Plan cites "diary 0058" for run 1 and the rubric
    (`0058-relay-room-expo-backend-bakeoff`) while also quoting "the headless
    acceptance harness caught every real bug before the UI ever ran," which
    lives in the *other* 0058 (`0058-messaging-snapback.diary.md`); LLP 0197
    itself pins 0058 by slug because of this collision. Relatedly, "Eight
    diaries (0057–0060, 0065–0069)" spans nine numbers (0067, a
    Snapback-only witness, is presumably not in the corpus) and more files
    than eight.

## Generative input

Brief, and only where omission is a near-defect: (a) give the pick-and-build
probe a P3 bullet with the commitment mechanic and its publication label —
it is the only L-rung instrument the phases don't produce (concern 3 covers
the defect; this is the one-line fix). (b) When P0.0(c) lands the
`defect`/`knowledge-gap` sub-attribution, keep it as a sub-field of the
protocol's existing `snapback-defect` enum value rather than a new top-level
attribution, so the loop-series continuity (runs 2–5) and the protocol's
tie-break ("discoverability is part of the product under test") survive the
schema change intact.

## Verdict

NOT READY — the delta text contains three unresolved MATERIAL defects: the
run-5 skill-lane loop series contradicts the 0115 record and diary 0069, the
P1/I.5 ownership correction misstates LLP 0194's current exclusion set
(verify-config is initial-scope, not excluded), and L5's pick-and-build probe
is owned by no phase. Reviewed revision: 2f11795033ae122d210321d62c862a9df66002c6
/ sha256 404b0b93353eaffa6e91fee5ff70d7f3b0ca216224561a8cd6061d8709955abc.

---

**Counts:** MATERIAL — 3 IN-DELTA, 0 PRE-EXISTING. minor — 4 IN-DELTA,
3 PRE-EXISTING.

---

## Round 3 — 2026-08-08 — revision (c) b5a1a7d6 / sha256 db995830… — DELTA ROUND — verdict: READY (0 MATERIAL; 3 IN-DELTA minor, 1 PRE-EXISTING minor)

Provenance: fresh Claude-family subagent (claude-fable-5), mutually
blind, capsule-r3 tar sha256-16 590e4cc9c11fa629 (0198 artifacts
excluded; DELTA-b-to-c.diff at root); instructions sha256-16
9f06e55946a7833f; runtime 7m00s. Body verbatim.

# Claude-family review — LLP 0198, round 3 (delta round)

**Target:** `llp/0198-surpass-convex-agent-authoring.plan.md`, revision (c),
commit b5a1a7d6a96e255fc4978bcb1c5aa415cdb30c93, file sha256
db99583036f3aee8d5f8dfbf6007f8fa767171dd2a31c33114d85cf54fe3161c
(verified against the capsule file).

**Method.** Read the full (c) text, then `DELTA-b-to-c.diff`, then verified
every load-bearing (c) claim against capsule primary sources:
`benchmarks/records/2026-08-08-messaging-0115.md` and
`2026-08-07-messaging-0113.md`, `benchmarks/protocol.md`, `benchmarks/README.md`,
`benchmarks/schema/run-record.schema.json`, `benchmarks/records/schema.md`,
diaries 0069/0058-relay-room/0058-messaging/0067, LLP 0197 (rules 1/3/4a/4b/5/6),
LLP 0194 (r5 header, initial scope, OQ2), LLP 0171 Finding D, LLP 0189
(D-3/D-4), LLP 0196 (0.1.15 qualifier), LLP 0195 (training-data hypothesis).

Verification results feeding the concerns below (all checks that passed,
briefly): the restated run-5 loop accounting quotes the 0115 record's
annotations verbatim and its "no defect-shaped framework loop in any run-5
Snapback lane" reading matches both the record's Notes line ("first run with
zero framework defects in any Snapback lane") and diary 0069; the web-deps
"both web lanes' longest single loop" claim matches diary 0069 residue 1;
the 0196 qualifier ("largest knowledge-placement improvement; 0.1.13's
defect-fix layer produced larger raw steps") matches LLP 0196 lines 22–26;
the P1 rewrite matches LLP 0194 r5 exactly (verify-config in initial scope
via published `verify.d.mts`, `ctx` the sole remaining named exclusion,
OQ2 narrowed accordingly); the retry ask matches 0171 Finding D verbatim
(LLP 0070 owns both questions; finite cap, backoff/jitter, generation pin,
proved no-effect stage); aid-assisted labeling and symmetric predeclared
competitor aid selection match 0197 rule 4a's full scope; the
publication-safe projection ("raw transcripts never publish") matches 0197
rule 6; material-competitor-release aging matches rule 5; the qualification
digest binding matches 0189 D-3/D-4; P0.1's "no variance band at N≥3"
and P0.2's N≥8 blocked design match protocol.md's floors; P0b's
no-cross-family token pooling is honored by L1's "within-family tokens";
P0.0(c)'s sub-attribution as a sub-field of the existing `snapback-defect`
enum value is coherent with the schema and preserves the discoverability
tie-break; P0.0(a)'s narrowed claim (orientation/verification shares only,
not the full four-term decomposition) is now honest against I.5; the
0058-messaging quote attribution and the run-1 scored figures
(26m03s/11m15s, 84/86, mature-hypothetical 97/96) all check.

## Concerns

1. **minor — IN-DELTA.** I.2's trajectory series changes units at its last
   entry: runs 2–4 figures (4, 8, 3) are framework-attributed loop *counts*
   (confirmed against the 0113 record's "9 (3 framework)" convention) while
   run 5's entry is "zero defect-shaped" — a different unit whose
   framework-attributed comparable is nonzero (skill "7 (0 backend)", bare
   "6 (~2)", with the web-deps loop framework-attributed via the
   discoverability tie-break). The (c) text discloses this immediately and
   quotes the annotations verbatim, which is the right call, but the
   series as a series still invites an unlike-units 3→0 reading; one clause
   noting that run 5's framework-attributed comparable is nonzero-but-
   knowledge-shaped would close it. Evidence:
   `benchmarks/records/2026-08-08-messaging-0115.md` (table + Notes) vs
   `2026-08-07-messaging-0113.md` ("total (framework)" convention).

2. **minor — IN-DELTA.** The pick-and-build preregistration (P3) defines
   "favors Snapback" (strict majority of picks, no majority post-build
   regret) but leaves L5's other necessary condition — "at worst neutral on
   plain CRUD" — without a decision rule, and captures "regret or switch"
   while only regret enters the rule. As stated, L5's CRUD leg cannot be
   adjudicated from the preregistered rule. Evidence: II.1 L5 bullet vs P3
   pick-and-build bullet.

3. **minor — IN-DELTA.** The requalification trigger has a control-lane band
   exceedance confirmed by an N≥3 series against a band produced at N≥8,
   while `protocol.md` reserves "treating a delta as real" (regression
   attribution) for N≥8. The conservative direction (requalification lapses
   a claim rather than making one) makes N≥3 defensible, and the
   protocol.md citation is used only for the single-run half — but the text
   should say the confirmatory standard is deliberately below the N≥8
   attribution floor *because* requalification is claim-protective, so the
   choice cannot be read as a protocol violation. Evidence: II.1
   Requalification vs `benchmarks/protocol.md` "Repetitions and variance".

4. **minor — PRE-EXISTING.** The Related header's "diaries 0057–0060 and
   0065–0069" range includes diary 0067 (browser local-first public
   witness), which the (c) I.4 enumeration now deliberately — and correctly
   (0067 is a witness-harness diary, not a bakeoff arm) — excludes from the
   bakeoff corpus; harmless as a Related pointer, but the visible
   range-vs-enumeration mismatch is worth one word ("plus witness diary
   0067" or trimming the range). Evidence: header Related line vs I.4
   first sentence; `diaries/0067-browser-local-first-public-witness.diary.md`.

## Generative input

- The rung matrix (II.1) is the right container for the preregistered
  decision rules concern 2 identifies; when it is first committed under
  `benchmarks/`, giving every rung's *negative* space a row (what outcome
  demotes or blocks the rung, not just what satisfies it — e.g. L5's CRUD
  neutrality band, L2's loss-publishes-as-honesty path) would make the
  matrix the single audit surface P5 needs and retire concerns 2/3
  structurally.

## Verdict

READY — no unresolved MATERIAL concern anywhere in the document: every
(b)→(c) mechanism checks against the sources it cites (0115 record, diary
0069, LLP 0194 r5, 0171 Finding D, 0197 rules 1/4a/5/6, 0189 D-3/D-4,
protocol.md's N≥3/N≥8 floors), and the four residual concerns are minor
wording/preregistration-completeness items. Reviewed revision:
b5a1a7d6a96e255fc4978bcb1c5aa415cdb30c93 / sha256 db99583036f3aee8d5f8dfbf6007f8fa767171dd2a31c33114d85cf54fe3161c.
