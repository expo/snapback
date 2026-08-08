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
