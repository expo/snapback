# Review artifact — LLP 0201, Claude family

Provenance: llp-review loop (single round), orchestrated 2026-08-08;
reviewer = fresh Claude-family subagent (claude-fable-5,
session-default effort), mutually blind to the GPT-family reviewer and
to the authoring session; scope = uncommitted working tree at base
68fbbb602 — llp/0201-social-messenger-canonical-benchmark.plan.md
(blob 5d1788da) + benchmarks/briefs/social-messenger.md
(blob a1e7aa46), with LLP 0197/0198, benchmarks/protocol.md,
rung-matrix.md, briefs/messaging.md, guide/capabilities.md as
read-only context; not redacted; method = shared standard prompt
(scratchpad 0201-review-prompt.md), review-only, no edits permitted;
runtime 6m08s. Body below is verbatim.

---

## Round 1 — 2026-08-08 — working tree at 68fbbb602 (blobs 5d1788da / a1e7aa46)

# Review: LLP 0201 + `benchmarks/briefs/social-messenger.md` (one unit)

Reviewer: independent, fresh-context. Documents read in full; consistency-checked against LLP 0197, LLP 0198, `benchmarks/protocol.md`, `benchmarks/rung-matrix.md`, `benchmarks/briefs/messaging.md`, and `guide/capabilities.md`.

## Overall assessment

This is a well-constructed instrument: the milestone structure with per-milestone budgets and the proceed rule, the builder/grader observation split, the probes-published-after-rotation resolution of the 0197 conflict, and the backend-neutral action-log replay are all genuinely good measurement design. However, the pair has one incoherence serious enough to block acceptance as written — the first scored publication (P4, reduced run M1–M3) cannot exercise most of the outcome rubric it is scored on — plus a cluster of MATERIAL spec ambiguities (cap-setting, replay semantics, grader mechanics, milestone ordering) that would make lanes diverge or make the record unpublishable under 0197. All are resolvable with bounded edits; none require rethinking the architecture.

## Strengths

- **The proceed rule and its stated rationale** (D2, "without the proceed rule, partial credit collapses and one stuck milestone eats the lane") is the right call and correctly anticipated the failure mode.
- **The probe-rotation resolution** (D3.4: "probes are published after each scored wave and rotated for the next") is an elegant, honest reconciliation of holdout validity with 0197 rule 3's publish-the-instrument requirement, and the brief correctly publishes the probe *categories* and the scale envelope as the standing contract.
- **Degradation rules instead of absolute milliseconds** ("the signal is pathological growth, not milliseconds", brief §Scale envelope) is exactly the right hardware-independence posture for a local colocated run, and the specific rules (page-50 ≤ 3× page-1, follow-count invariance) are well-chosen.
- **The action-log replay through the app's own write path** is a strong design: it prices bulk ingest, guarantees semantically identical end states, and avoids smuggling a schema shape into the seed.
- **The UI-kit rationale** (D6) shows real awareness of worldview-smuggling ("hooks-shaped interfaces favor reactive backends; fetch-shaped favor Supabase") and the naive-prop-shapes rule is the correct neutralization.
- **The essay-before-numbers sequencing** (D4, brief §Scoring) and the non-formulaic holistic with cited moments are good instruments against post-hoc rationalization.
- **The named self-tuning risk** (D5: the guide "may be unconsciously tuned to" Claude/Codex, with Kimi/Grok as "the cleanest generalization test") is the kind of disclosed asymmetry 0197 rule 6 wants.

## Concerns

### C1 — BLOCKING — Reduced-run scoring is incoherent: P4 publishes a rubric its milestones cannot exercise

Sections: Plan D4, D7 (P4); brief §Scoring, §Milestones.

The first scored, published wave is P4 on M1–M3. Against the rubric as written:

- **O5** is handled (recorded null, never averaged in). No other dimension gets a null rule.
- **O4 (Observed offline behavior, 9 pts)**: M1–M3 contain *no offline requirement at all* — offline search arrives at M5, offline reads/writes at M6. There is nothing for the grader to observe.
- **O3 (Trust boundaries, 8 pts)**: the probe list is API-shaped ("can user A fetch user B's DMs through the API"), and the custom-client API is an M6 deliverable. The brief itself concedes this for M1 acceptance 4 ("probe-able via the API in M6 waves"). On a reduced run the grader has only browser automation, so most trust probes are unexecutable or must go through backend-specific surfaces, which is neither neutral nor preregistrable.
- **B4, B6, B7, B8** (offline authoring, search, push/actions, day-2 — 19 pts) have no basis on M1–M3.

So roughly 36 of 100 points are unmeasurable on the wave the plan publishes first, and the documents specify no null/renormalization/reporting rule for any of them except O5. Under 0198 P0.0(e)'s own principle ("never by averaging unexercised dimensions"), P4's scoring is currently undefined.

Compounding this: the reduced run drops offline entirely, whereas the *small frozen messaging brief includes* offline-readable history — so the reduced scored wave zeroes the dimension 0198 I.5(3) identifies as where Snapback's proof-surface asymmetry gets credited, while M1's real auth prices Snapback's known-weak setup ceremony. That is symmetric and therefore fair, but it means P4's published comparison has a coverage profile the plan nowhere acknowledges.

**Resolution:** add an explicit reduced-run scoring annex to the brief: which dimensions are null on M1–M3 (extend O5's "recorded null, never averaged in" rule), what total is reported and how it is labeled, and how the grader executes (or explicitly skips) trust probes without the API. Separately, either add a minimal offline-read requirement to the reduced run (restoring continuity with the messaging brief and keeping the differentiator priced) or state in D7/P4 that reduced-run publications are scoped as auth+social+messaging-core comparisons and say so in the fairness notes.

### C2 — MATERIAL — Budget-cap setting rule and milestone-dependency semantics are unspecified, and both are outcome-determining

Sections: Plan D2 ("Budget caps and the proceed rule"), D7 (P2/P3); brief §Milestones preamble.

"Set from the pilot, frozen with the brief" leaves the two most consequential questions open:

1. **Are caps uniform across lanes/backends, and what is the formula?** If the Snapback pilot lane takes 30m on M2 and the Convex lane 10m, a cap set anywhere in between converts one backend's slowness into "capability failure" — a categorically worse published result than a slow success — while a loose cap lets a stuck lane burn tokens. The cap-setting rule is itself gameable and must be preregistered *in the Plan*, not improvised at P3 (e.g., "one shared cap per milestone = k× the slowest pilot lane's figure, k pinned now"). A cap calibrated from an N=1 pilot against the observed ±30% spread also deserves an explicit safety margin rule.
2. **Cascading failures.** Milestones are dependent: a lane that fails M3 (messaging core) on cap cannot meaningfully attempt M4 (media *messages*), M5 (in-chat search), or most of M6. "Proceeds to the next milestone" with no dependency rule produces a chain of recorded capability failures that misattributes one failure as five. Define it: either downstream milestones blocked by a failed prerequisite are recorded as `blocked-by-M{n}` (distinct from capability failure), or the lane terminates after two consecutive cap failures.
3. Also state whether unused milestone budget rolls over (it should not, and the brief should say so).

### C3 — MATERIAL — Scale-replay semantics are underspecified in ways that will make lanes diverge

Sections: brief §Scale envelope and performance, §Seeding; Plan D2 ("Performance at scale").

Four ambiguities:

1. **Timestamps.** The log carries "fixed timestamps and ordering" (e.g. `2026-01-03T10:15:00Z`), but replay "through the app's own write path" means the backend stamps arrival time at replay. Either the timestamps are decorative (feeds order by arrival, and the brief should say so) or lanes must backdate — which requires a privileged write seam that changes the schema and the trust boundary, and some lanes will build one while others won't. Worse, backdated seeded messages in any chat with a disappearing-messages setting would be instantly expired. Pin it: replay order is authoritative, log timestamps are documentation, disappearing settings are off in the scale log.
2. **Registration.** ~1,000 users must exist. Does the log contain `register` actions through the real signup path (hashing 1,000 passwords), and where do the grader's probe-user credentials live? The fixture pack section covers only the eight personas.
3. **Whose budget builds the replay tool?** "The lane's seed tooling replays the log" — is authoring that tooling inside M6's cap, a separate budgeted phase, or unbudgeted? Lanes will diverge on where the cost lands, corrupting the per-milestone localization the design exists for.
4. **Side-effect load and bounds.** Replaying ~100k messages to users with no connected clients will, per M6's spec, emit ~100k push payloads through the seam, plus receipts machinery; state whether the push seam is active during replay. And there is no cap on replay wall time — an O(n²) ingest can run for days. Give replay its own wall cap whose exhaustion scores O5, not the lane's completion.

### C4 — MATERIAL — Grader mechanics have three unspecified failure modes

Sections: Plan D3; brief §Global rulings (platform proof), §Scoring.

1. **Native proofs.** D3 says the grader "independently executes the checklist via the custom-client API and browser automation on the web build" — but O4's 90-anchor is explicitly "on the native proof," and M6's offline proofs run on the iOS simulator. Either the grader drives the simulator (a large, flaky harness lift the P1 list doesn't name) or O4 is scored from builder-produced simulator artifacts — which contradicts the section's own principle that "the builder scores experience; a separate grader scores outcome." State which, and if the latter, require the choreography script to produce mechanically checkable artifacts (recordings + receipts), not builder assertions.
2. **Grader failure and adjudication.** Nothing distinguishes "grader couldn't run the suite" (environment, grader error) from "app is broken." A grader-side failure currently lands in the lane's defect list. Define a grader-abort protocol (re-run once, then escalate) and an adjudication rule for disputed defects — "grader panels are deferred... unless grader noise shows up" needs an operational definition of grader noise to trigger on.
3. **Grader outputs need a record schema.** 0197 rules 4 and 12 require publication from schema-valid machine records via a checked publisher. The P1 deliverable list extends the record for per-milestone phases and performance probes but not for the grader's severity-bucketed defect list, probe results, or O-dimension scores. Add the grader-report schema to P1, and state how the agent-grader's judgment layers on the deterministic core (harness-executed builder suite = the 0197 rule 8 receipts; grader judgment = a separate, retained artifact) so rule 8's "any proof that still needs human judgment is identified" is satisfied.

Also unstated: whether the grader receives source code (it needs it to run the suite, and M1's "stored only as a standard hash" is unverifiable without either code inspection or a backend-specific console), and who grades exploratory Kimi/Grok lanes, for which "the other scored family" is undefined.

### C5 — MATERIAL — Citations to LLP 0197 "rule 4a" and "rule 4b" don't resolve

Sections: Plan D2 ("per LLP 0197 rule 4b: as capability failures, never silently dropped"), D6 ("disclosed as a symmetric aid under LLP 0197 rule 4a"); brief header.

LLP 0197 as committed numbers its rules 1–12 with no lettered sub-rules. Aid disclosure is rule 10; "all runs reported" is rule 1; there is no "capability failures never silently dropped" rule in 0197 at all — that language lives in 0198 II.1-L2 and the rung matrix. LLP 0198 carries the same phantom citations, so this is inherited corpus drift, but this Plan is a preregistration document whose citation integrity is load-bearing: a published claim will point at these rules. **Resolution:** either amend 0197 to introduce the 4a/4b lettering the rest of the corpus already assumes, or fix the citations here (D2 → 0197 rule 1 + the rung-matrix/0198-L2 capability-failure language; D6 → rule 10). Do it once, corpus-wide.

### C6 — MATERIAL — M5's offline-search requirement lands before the offline substrate exists (M6), and the warm/cold distinction is unpinned

Sections: brief M5 spec + acceptance 5; Plan D1 (M5/M6).

"Results for **already-synced** messages must also return while offline" is required at M5, but offline reads (the local store, cold-start survival) are M6. If M5's acceptance ("airplane-mode search over previously synced messages") means *warm* offline — app still running, data in memory — it is cheap and sequenced correctly; if it implies a durable local store, M5 silently absorbs M6's hardest work and per-milestone attribution is corrupted. Lanes will read it both ways. **Resolution:** one sentence in M5: airplane-mode without app restart; cold-start offline search moves to (or is re-verified in) M6.

### C7 — MATERIAL — View-once vs offline media cache is a specified contradiction and an unprobed bypass channel

Sections: brief M5 (view-once), M6 spec + acceptance 1.

M6 requires cold-start offline to render "previously synced chats, messages, and media **already viewed**." A view-once photo that has been viewed is exactly "media already viewed" — an offline cache that retains it lets any recipient re-view indefinitely, defeating the server-side one-view rule the holdout probes test. The brief must pin that view-once media is never durably cached and never renders offline after its view (and, ideally, add an offline-bypass probe to the trust-boundary category list, since the cache is the obvious evasion channel for every server-side denial: view-once, delete-for-everyone tombstones, disappearing expiry, unfollow feed removal). Same family of unpinned edges: do expired disappearing messages purge from the local store and from offline search results? Currently silent; lanes will diverge on a trust-shaped behavior.

### C8 — MATERIAL — M7 measures evolution cost confounded with the lane's own M1–M6 artifact, contradicting the paired-start principle 0198 just adopted

Sections: Plan D1 (M7), D7; LLP 0198 P3 (day-2 brief) and revision (d) note.

0198's round-3 revision explicitly added "day-2 acceptance-equivalent paired starts" so that repeats "measure evolution cost, not one lucky or poor prior implementation." M7 evolves each lane's *own* artifact: across N≥3 repetitions, M7's cost varies jointly with the quality of that repetition's M1–M6 output. That is defensible as integrated realism, but the Plan sells M7 as pricing "the edit-loop story LLP 0198 flags" without acknowledging the confound or stating the relationship to 0198 P3's separately-planned day-2 brief (and likewise the trust-boundary brief vs this instrument's probes — a real duplicated-spend question at 10–30M tokens). **Resolution:** a short paragraph in D1 or D7: M7 is an integrated, artifact-coupled measurement; isolated day-2 *claims* remain the paired-start brief's; state whether this instrument's coverage defers, replaces, or complements 0198 P3's two briefs.

### C9 — MINOR — "Keeping the series comparable" overclaims M3's relationship to the frozen messaging brief

Plan D1 (M3). M3 lacks image messages, offline-readable history, and the test-persona switcher (real auth from M1 instead), and reactions arrive only at M4 — all present in the frozen brief. "Approximates... keeping the series comparable" sits awkwardly beside the Summary's "no claim inheritance from the messaging configuration." Soften to "structurally similar; no longitudinal comparison is claimed," which is what the rest of the document already believes.

### C10 — MINOR — Cost estimate omits grader and capability-floor tokens

Plan D7. The 10–30M figure appears to count builder lanes only. P4 alone is 18 reduced lanes, each with a grader session; P5 adds the mid-tier leg (9+ lanes) and graders throughout. The estimate is plausibly 2× low; since its stated purpose is "so scope stays conscious," add grader and floor-leg lines to the arithmetic. Relatedly, D2 records dollar cost per lane — record grader cost per lane too.

### C11 — MINOR — Continuous-session mechanics (compaction) unpinned

Plan D1 (Session shape). A 1–3M-token single session will hit context limits; compaction behavior differs by harness and family and is a real behavioral confound (a lane that compacts away its own schema decisions behaves differently at M5). Family-scoped claims contain most of the damage, but the record should pin the compaction policy and log compaction events so within-family variance can be inspected.

### C12 — MINOR — Probe rotation lacks a difficulty-equivalence rule

Plan D3.4; brief §Holdout probes. Cross-wave O3/O5 comparisons are confounded if a rotation changes difficulty. The published category list mostly handles this; add one sentence: each rotation must cover every published category with at least one instance, and the rotation log records the category mapping.

### C13 — MINOR — Small spec/consistency nits

- Plan D1 coverage rationale calls view-once "scheduled server-side deletion" — view-once is deny-after-first-view; only disappearing messages are scheduled deletion.
- M7's aid condition (does the fresh session get the same skill/kit/docs posture as the lane?) and whether the same grader grades M7 are unstated.
- M7 acceptance 3's "pre-M7 snapshot" needs a named backend-neutral mechanism (grader-driven API export?) in the P1 fixture/harness deliverables.
- The protocol's clock-stop rule ("last passing acceptance evidence") needs restating for the milestone structure (per-milestone clocks; lane end on M6 completion or cap) in the P1 schema work.

## Suggestions (ideas, not defects)

1. **Grader calibration run:** before P4, have each grader grade one pilot artifact with known, planted defects; publish the calibration transcript with the instrument. This gives the "grader noise" trigger of C4 an operational baseline and makes severity buckets comparable across the two grader families.
2. **Uniform acceptance-suite entrypoint contract:** pin one invocation shape in the brief (e.g., a single documented `acceptance` command from a clean checkout, like M6's demo script). Removes a whole class of grader `environment` loops.
3. **Timing-probe retry rule:** for timing-sensitive checks (typing within 2 s, live updates), specify best-of-k under grader execution so machine-load flakes don't inflate O2.
4. **Publish the kit neutrality review:** D6's "reviewed against each tier-1 backend's idioms" should retain and publish per-backend review notes with the kit version — cheap credibility under 0197 rule 3.
5. **Per-milestone medians as a first-class published view:** the per-milestone phase data supports a "which milestone did the gap come from" chart that is the whole point of the milestone design; name it as a P5 publication artifact now so the checked publisher (0197 rule 12) grows support for it.
6. **Offline-bypass probe category** (from C7): add "server-side denials survive the offline cache" to the published probe categories — it is the strongest trust-shaped differentiator this app design can measure.

## Open questions

1. Who provides B8 and the M7 narrative — does the M1–M6 builder record B8 as null and the M7 session score it, and does M7 write its own diary entry/essay under the same sequencing rule?
2. Are the wall/token caps shared across all lanes of a comparison set, or per-backend? (C2 needs the answer preregistered either way.)
3. Is the scale replay executed inside the builder session (agent-authored tooling, budgeted where?) or as a post-session harness phase?
4. Which harness runs the GPT-family lanes, and is the grader's harness pinned independently of the builder's?
5. Does this instrument's full-app wave subsume 0198 P3's trust-boundary and day-2 briefs for claim purposes, or do both programs run?
6. For the capability-floor and exploratory legs, who grades, given "the other scored family" is defined only for the two scored families?

## Recommended next step

**Revise, then one more review round.** C1 (reduced-run scoring), C2 (cap rule + dependency semantics), and C3 (replay semantics) go to the heart of what P4 would publish and how lanes are budgeted; C5's citation repair touches 0197/0198 as well. All are bounded edits, but together they change enough preregistered substance that the revision deserves a fresh pass before author acceptance — this is exactly the class of document where preregistration errors are expensive to discover after freeze.


---

## Round 2 — 2026-08-08 — revision (c), plan blob 62b9d7d4 / brief blob f6b4a8c7 — verdict: NOT READY

Provenance: llp-super-refine loop round 2 (loop round 1); reviewer =
fresh claude-fable-5 subagent, capsule-confined (capsule
0201-capsule-r2.tar sha256-16 bb633d5e666ea2d5; structurally excludes
llp/reviews/*; out-of-capsule abstinence self-attested); instructions
sha256-16 bdd074e44ffbdbe8 (delta round: IN-DELTA vs PRE-EXISTING
required; refine-not-redesign mandate; AUTHOR-DECISION channel);
mutually blind to the GPT-family reviewer; runtime 7m40s. Body below
is verbatim.

Overall assessment

Revision (c) plus the brief is a substantially coherent, unusually well-instrumented design: the reduced-run scoring profile, separate clocks, replay contract, scale-safety rescoping of O5, and probe custody all hang together and conform to LLP 0197/0198 and the protocol. The remaining defects are concentrated where the delta's new machinery meets the milestone structure: seeding vs the replay adapter, what "milestone green" actually requires, anchor-probe custody, scoring of full runs with unexercised dimensions, and M7's data environment/snapshot. These are pinning and coherence gaps, not design mistakes — each has a refinement-scale fix — but several would make lanes or waves diverge if frozen as written.

Concerns

1. **MATERIAL, IN-DELTA — Starter seeding collides with the replay-adapter ruling and is under-pinned for M1–M3.** (Brief "Global rulings › Seeding" + "Replay contract"; Plan D2.) The brief makes *both* seeds fixture-pack action logs "replayed through the app's own write path," and the replay contract assigns the replay adapter to **M6's budget** as "a thin client of the M6 API/headless surface." But seeded content is required from M2 (acceptance #8 needs &gt;20 seeded posts) and M3 (seeded personas; idempotency is acceptance #7) — before any M6 surface exists, and in reduced runs that never reach M6. It is also unstated what a lane does with starter-log actions its current milestone cannot yet execute (message/follow actions at M1), and what "running it twice changes nothing" means while capability is still growing. Lanes will diverge on when the log parser is built (whose milestone budget absorbs it), and whether they replay prefixes, filter unsupported actions, or defer seeding. Resolution: state explicitly that the M6-budget/adapter ruling applies to the **scale** replay only; have the fixture pack ship the starter log segmented per milestone (or a per-milestone seed manifest), with idempotency judged per installed segment; name where starter-seed replay effort lands (the milestone that first needs the segment).

2. **MATERIAL, IN-DELTA — "Green" hangs on a builder-authored suite with no pinned coverage requirement.** (Plan D2 "Separate recorded clocks", D3.1–3.2; Brief "Statuses and dependencies", "Acceptance entrypoint".) A milestone's authoring clock stops and its status becomes `green` at "the first harness-executed passing run of that milestone's acceptance suite" — but the suite is builder-shipped and nothing binds its content to the frozen checklist. A lane with a thin suite goes green earlier and cheaper than a rigorous one; the grader's independent checklist execution protects O1 but not the clock, the capability-failure statuses, or the cap accounting — the exact statistics efficiency claims read. The checklist also silently mixes executors: M1 #7 is explicitly grader source inspection, M4 #4 explicitly grader-via-API, but M5 #1's "(API check)" has no executor and, at suite-run time, no API exists yet. Resolution: for each checklist item, freeze whether it is suite-required, harness-choreography, or grader-only; require the suite to cover every suite-required item (e.g., a coverage manifest mapping tests to checklist items, verified by the harness/grader before a green receipt is honored, with a defined reclassification if coverage was absent).

3. **MATERIAL, IN-DELTA — Anchor probes contradict the holdout claim.** (Plan D3.5; Brief "Holdout probes".) The text asserts both that probes "are published after each scored wave" and that "no builder sees its own wave's probes" — but each category's **anchor probe is published after wave N and reused unchanged in wave N+1**, so wave-N+1 builders (and the treadmill's doc/skill authors) can see a live probe. The three goals — rule-3 inspectability, cross-wave comparability, holdout secrecy — do not compose for anchors as written. Resolution options (pick a precedence and say it): (a) publish anchor *results* each wave but the anchor's query text only at retirement, with the pre-wave sha256 commitment carrying continuity — and state this as a scoped exception to full retroactive inspectability; or (b) accept that anchors become quasi-public after their first wave, narrow the claim to "no builder sees its wave's *rotated* probes," and note that anchors test obligations already published in the brief so their holdout value is deliberately limited.

4. **MATERIAL, IN-DELTA — Full-run overall totals are undefined when dimensions go unexercised.** (Brief "Scoring" + "Reduced-run applicability"; Plan D4.) The frozen applicability table covers reduced runs only, yet full runs can also leave dimensions unexercised: if M6 is a capability failure, M7 is `blocked-by-M6` and B8 — scored only by the M7 session, "recorded null by the M1–M6 builder" — stays null; O5 and the replay never run; B7's seam may never be attempted. The brief nonetheless states "overall totals exist only for full runs," with no rule for null-vs-zero vs renormalization, so the first full run with a mid-lane failure produces an uncomputable or incomparable headline total. Resolution: extend the applicability rule to statuses — e.g., attempted (`capability-failure`) milestones score their B-dimensions from the attempt; never-attempted (`blocked`) milestones record null; and any full run with a null dimension publishes per-dimension only (the reduced-run profile generalized), consistent with 0198 P0.0(e)'s bar on averaging unexercised dimensions.

5. **MATERIAL, IN-DELTA — The pre-M7 snapshot's coverage exceeds what the M6 API is required to expose, and the verification mechanics are unpinned.** (Brief M6 spec, M7 acceptance #4; Plan D1 M7, D2 replay contract.) M7 acceptance #4 verifies "messages, media, receipts, and reactions" against a snapshot "exported through the custom-client API" — but the M6 API's required surface is authenticate / list conversations / page history / send / receive; nothing obliges it to expose receipt states, reactions, media references, or tombstone/edited status. Snapshot completeness therefore varies by lane, and a minimal API yields a *weaker* M7 intactness bar (a mild incentive toward thin APIs), undercutting "backend-neutral by construction." Relatedly, the mechanism for verifying the scale replay's invariant manifest (per-entity and follow-edge counts — the API has no follow-graph surface) is unstated. Resolution: pin the minimum message-object fields the history operation must expose (or define a required snapshot/export operation with a fixed field manifest in the brief), and state how invariant-manifest counts are read (API + web-UI probes, and which).

6. MINOR, IN-DELTA — Pilot under-specification feeding preregistered numbers: P2 doesn't say which model family (or both) pilots, whether the pilot includes M7 and the scale replay (both needed to calibrate their caps/ceilings), whether caps apply per family or across families, or what the cap formula does when a pilot lane DNFs a milestone (2× an undefined figure). One paragraph in D7/P2 fixes all four.

7. MINOR, PRE-EXISTING — Plan D1's coverage rationale claims the app exercises "cron/one-off jobs," but the brief's pinned observables (server refuses expired content within 5 minutes; deny-after-first-view) are satisfiable by lazy read-time filtering with no scheduled execution. Soften the coverage claim or accept that this row is backend-shaped and may go unexercised.

8. MINOR/altitude, IN-DELTA — Checkpoint probe choreography: probes "run at each checkpoint," implying the replay pauses at 10%/50% and probe wall time is excluded from the replay cap; neither pause semantics nor cap treatment is stated. P1 harness detail, but worth one sentence in the replay contract.

9. MINOR/altitude, PRE-EXISTING — The kit's component list has no poll/vote components; M7 sessions would pixel-push, adding noise to B8. Since M7's polls are in the frozen brief, the frozen kit can include them (P1 detail).

10. MINOR/altitude, IN-DELTA — Several anchors read full-run-shaped for dimensions that reduced runs score (O1's "M1–M4 solid"; B5's revocation clauses vs reduced runs' avatars/post-media scope). A one-line reduced-run interpolation note per affected dimension reduces cross-lane variance.

11. MINOR, PRE-EXISTING — The exploratory leg doesn't name Kimi/Grok's backend set (presumably tier-1), and the grader-abort protocol doesn't say what happens to the lane's O-dimension scores after escalation (regrade by panel? null?). Both can be pinned in the D5 configuration table / D3.4.

AUTHOR-DECISION items

- **M7's starting data state.** Sequencing puts the scale replay inside M1–M6 grading and M7 "after M1–M6 grading … against the live app and its data" — so as written M7 plausibly inherits the ~100k-message envelope, making the backfill a scale migration and the API snapshot export very expensive; but nothing pins this, and different waves could instantiate it differently. This is a scoping ruling with order-of-magnitude cost and construct implications, not a text repair, so it is the author's call. Options: (a) M7 runs on the post-replay envelope — strongest day-2 signal (migration at scale), highest cost, snapshot should then lean on the invariant manifest rather than full export; (b) restore/branch to the pre-replay starter state for M7 — cheap, clean snapshot, but the backfill migration is toy-sized and B8 measures less; (c) run M7 before the scale replay — cheap and clean, but forfeits migration-at-scale and complicates the "after grading" fresh-session isolation. Whichever is ruled, the brief's M7 header should state the environment explicitly.

Suggestions

- Concern 2's coverage manifest doubles as grader tooling: the grader can diff suite coverage against the checklist mechanically, per 0197 rule 8's deterministic-receipts posture.
- In D2, state explicitly that a capability-failure milestone's authoring clock contribution is the cap value (implied by "final cap," but the record schema will need the rule).
- The brief's "Budget caps" table should grow a row per milestone at P3 rather than the single "M1–M7" row, since caps are per-milestone.

The pair is close: the architecture and its governing-document alignment hold, but five pinning/coherence defects — seeding vs the replay adapter, unpinned suite coverage behind `green`, the anchor-probe contradiction, undefined full-run totals under failure statuses, and the M7 snapshot/environment gap — would each cause lane or wave divergence if frozen as written.

VERDICT: NOT READY


---

## Round 3 — 2026-08-08 — revision (d), plan blob c34b1393 / brief blob 4463d502 — verdict: NOT READY (pre-existing clean; 3 MATERIAL, all IN-DELTA)

Provenance: llp-super-refine loop round 3, delta round; reviewer =
fresh claude-fable-5 subagent, capsule-confined (capsule
0201-capsule-r3.tar sha256-16 2c991ced709a5e1f; structurally excludes
llp/reviews/*; out-of-capsule abstinence self-attested); instructions
= 0201-r3-instructions.md (delta enumeration; IN-DELTA vs
PRE-EXISTING classification; convergence = no MATERIAL in
PRE-EXISTING across families); mutually blind to the GPT-family
reviewer; runtime 5m55s. Body below is verbatim.

## Overall assessment

Revision (d) is a substantial, mostly well-composed response to the round-2 dual-NOT-READY: the three author rulings (M7 pre-replay state, nulls-block-totals, non-scored anchors) integrate cleanly with the scoring, publication, and holdout machinery, and the pre-existing structure (milestones, lanes, phases, rubric, grading split) reads coherent — I found no MATERIAL concern in pre-existing text. However, the delta itself introduces three composition defects, all clustered around the new cap/clock/green machinery: the GPT token-cap calibration cannot be produced by the stated formula from a single Convex mini-pilot lane, the scale-replay adapter escapes both the cap and the authoring clock, and the new executor-class taxonomy exempts exactly the two-client realtime items from the coverage-validated green gate the delta exists to create.

## Concerns

**C1 — MATERIAL, IN-DELTA — D2 (budget caps) + D7 P2 + brief "Budgets".** The cap formula is "2× the slowest tier-1 pilot lane's figure," but the GPT family's token caps calibrate from a **one-lane Convex mini-pilot**. With one lane there is no "slowest," and Convex — chosen as familiarity-maximal — is predictably the *cheapest* token lane, while the measured cross-backend token spread is 2–3× (LLP 0198 I.1: 2.24–3.26×). The 2× multiplier is justified in the same paragraph as absorbing a ±30% per-lane spread, not a 2–3× cross-backend gap. As written, GPT-family Snapback/Supabase lanes face structurally under-calibrated token caps, manufacturing spurious `capability-failure` records asymmetrically against Snapback in exactly the cross-family leg that exists to de-risk one-family artifacts. The mini-pilot's milestone scope (M1–M3 vs M1–M7 + replay) is also unpinned. *Resolution:* preregister a cross-backend transfer rule (GPT cap for backend B = GPT-Convex figure × the primary family's per-milestone B/Convex cap ratio), or run the mini-pilot on the primary family's slowest backend, or per-backend GPT mini-pilots; and pin the mini-pilot's scope.

**C2 — MATERIAL, IN-DELTA — brief "Replay contract" + D2 (separate clocks).** "The replay adapter is authored inside M6's budget," but the adapter appears in no M6 checklist item, is not in the coverage manifest, and does not gate green — while M6's **authoring clock stops at the first green suite run** and "the lane's authoring wall ends at M6 green or final cap." A metric-optimizing lane therefore orders work as: reach M6 green, then author the adapter off-clock and un-capped. "Inside M6's budget" is unenforceable as written, and the efficiency statistic silently excludes a real, potentially large piece of required work. *Resolution:* add a harness-validated M6 item — adapter exists and demonstrably covers every verb of the frozen action schema — to the coverage manifest so green requires it; or record adapter authoring as its own capped, separately clocked phase that is included in the authoring wall.

**C3 — MATERIAL, IN-DELTA — brief "Executors" + "Statuses" + D2 (authoring clock).** Green is "the first harness-executed passing run of its coverage-validated acceptance suite," and the coverage manifest maps only **suite-required** items — while `[choreo]` is defined as "items phrased across two clients or on the simulator." That routes most of M2/M3's substance (live feed updates, typing, receipts, live counts) outside the green gate, so a realtime-heavy milestone can go green — and stop its authoring clock — with none of its live behavior proven. This structurally undermines the delta's own fix ("a thin suite cannot buy an early green") for exactly the milestones where thinness is cheapest. *Resolution:* pin that a milestone's green receipt = suite pass **plus** that milestone's choreography-script segment pass; or reclassify headlessly coverable two-client items as suite-required (two headless clients), reserving `[choreo]` for simulator/visual proofs.

**C4 — MINOR, IN-DELTA — D2/brief O5.** O5 is "mapped deterministically," but the 30/60/90 anchors leave undefined regions (ceiling margins between 50% and 80%; rule-pass + ceiling-exceeded + high-cap-margin combinations; replay-cap *exhaustion* is stated to "score O5" but is mapped to no anchor), and the rubric-wide "interpolate" instruction contradicts determinism. *Resolution:* publish a complete O5 decision table with the brief at P3.

**C5 — MINOR, IN-DELTA — D2.** A `capability-failure` milestone contributes its full **wall** cap to the authoring wall, but token treatment is unspecified — a wall-exhausted milestone publishes an artificially small token figure (and vice versa). *Resolution:* charge the token cap symmetrically, or state the actual-tokens-with-caveat rule.

**C6 — MINOR, IN-DELTA — brief "Statuses".** Green→`capability-failure` reclassification on a dishonest mapping does not state downstream effects: whether dependents retroactively become `blocked`, whether it counts toward the consecutive-failure termination, or whether it is scoring-only. *Resolution:* pin non-retroactive, scoring-only semantics (wall recharged at cap, O1 not-passed; statuses and termination as run).

**C7 — MINOR, IN-DELTA — brief "Budgets" vs end table vs D2.** The Budgets paragraph says "wall/token caps are **shared by every lane of a comparison set**," the end table and plan say token caps are per model family; and since protocol rule 4 makes a comparison set same-model, "shared across every lane of a comparison set" cannot express the intended **cross-family** wall-cap sharing. *Resolution:* align all three statements; say explicitly that wall caps are shared across comparison sets/families and token caps per family.

**C8 — MINOR, IN-DELTA — D3.4.** The grader-abort fallback regrades by "the other scored family," which for a scored lane is the **builder's own family**, weakening cross-family independence for that lane. Acceptable as a fallback, but the record/publication should label same-family-graded lanes as such.

**C9 — MINOR, IN-DELTA — D5/D7.** The mid-tier capability-floor leg has no pinned cap-calibration source (the pilot protocol names only the frontier-Claude pilot and the GPT mini-pilot). *Resolution:* state at P3/OQ1 whether mid-tier lanes inherit frontier-family caps or get their own mini-pilot.

**C10 — MINOR, IN-DELTA — brief "Seeding"/"Replay contract".** Segment idempotency is "judged per installed segment," but only M3's checklist carries a seed-idempotency item (M1/M2 segments have no executor); and the scale replay's **base state** is unpinned (does replay start from the starter-seeded instance? is the invariant manifest generated over starter+scale content combined?) — exact per-entity counts are unverifiable without it. *Resolution:* tag segment-idempotency coverage per milestone (or state M3's item covers installed segments), and pin the replay base state and manifest generation basis in the fixture pack.

**C11 — MINOR, PRE-EXISTING — D1/M7 + brief.** The whole brief (including M7's polls and backfilled count) is visible to the M1–M6 builder, so a lane could maintain a message count from M3 onward and trivialize the "forced migration" B8 signal. Agents follow milestone order and would spend capped budget for no credit, so the risk is soft — but worth a record field: whether the pre-M7 schema already carried count structures.

## AUTHOR-DECISION items

None. All three MATERIAL items are integration defects of the delta's own machinery, resolvable within the existing rulings and the P1/P3 artifact plan; no settled decision needs reopening.

## VERDICT

Pre-existing text is clean across the pair, but the (d) delta's cap-calibration, adapter-clock, and green-gating machinery each contain an unresolved MATERIAL composition defect.

VERDICT: NOT READY


---

## Round 4 — 2026-08-08 — revision (e), plan blob d1fc24cb / brief blob 398dd288 — verdict: NOT READY (pre-existing clean; 5 MATERIAL, all IN-DELTA)

Provenance: llp-super-refine loop round 4, final budgeted delta round;
reviewer = fresh claude-fable-5 subagent, capsule-confined (capsule
0201-capsule-r4.tar sha256-16 3863da9478a5c784; structurally excludes
llp/reviews/*; out-of-capsule abstinence self-attested); instructions
= 0201-r4-instructions.md; mutually blind to the GPT-family reviewer;
runtime 6m36s. Body below is verbatim.

# Round-4 delta review — LLP 0201 (e) + brief blob 398dd288

## Overall assessment

The (e) delta is aimed correctly: every round-3 MATERIAL got a concrete mechanism (assertion-level executor mapping, a closed status machine, keyed caps with a transfer rule, a pinned replay base, an exact O5 function, an applicability manifest). Pre-existing text remains clean — I found no MATERIAL concern outside the (e) delta. However, five of the new mechanisms are not internally closed: the applicability table's blanket rules contradict O1/O2/O5's own definitions, the token-cap keying contradicts the transfer rule it feeds, the O5 "exact function" is neither total nor unambiguous as written, the replay base state is not pinned to a fresh instance (making spurious O5=0 nonconformance likely), and the `aborted` status escapes the cap-charging rule that exists to prevent exactly that under-reporting. Each has a one-to-two-sentence fix, but on a final budgeted round they are precision defects in the delta's own machinery, not altitude nits.

## Concerns

**1. MATERIAL — IN-DELTA — brief §Scoring (Applicability) + plan D4 (complete lane): the blanket applicability rules contradict the dimension definitions they govern.**
(a) O1/O2's observing scope is "all in-scope" and "an O-dimension needs its observing scope **green**" — read literally, any lane with one non-green milestone records O1/O2 null, directly contradicting O1's own text ("every milestone of the run's scope in the denominator regardless of status; `capability-failure` and `blocked` milestones score their checklists as not passed") and collapsing the partial-credit design. (b) The same reading makes a **complete lane** require every milestone green, contradicting both the plan's parenthetical "(M6 and the replay for O4/O5)" and its own "every other milestone was at least attempted" clause. (c) O5's scope is "the replay" with a green requirement, but the O5 function scores an attempted-nonconforming replay **0**, not null — and "green" is undefined for the replay, which is not a milestone with a status. (d) B9/B10/B11's scope "the whole run" plus "scores if every observing milestone was at least attempted" nulls exactly the DX/diagnostics/operations scores of terminated lanes — the runs whose experience data most needs publishing.
*Smallest fix:* replace the blanket O-rule with per-dimension applicability: O1/O2 score whenever the grading phase ran (null only if grading never happened); O3/O4 need M6 green (O3 plus M1–M5 attempted, as already stated); O5 needs the replay attempted (its function handles failure); B9–B11 score if at least one milestone was attempted; restate the complete-lane definition by enumeration of those scopes rather than "every O-dimension's scope green."

**2. MATERIAL — IN-DELTA — plan D2 (Cap keys) + brief §Budgets: token-cap keying and the transfer rule contradict each other.**
The key is declared as "(model family, milestone)" and the formula ("2× the **slowest** tier-1 pilot lane's figure") collapses backends into one shared cap per (family, milestone). But the transfer rule defines "GPT cap(**backend B**, milestone m)" and the brief says the GPT/mid-tier families derive "**per-backend** token caps" — a per-backend key the declared keying doesn't admit. Additionally "the primary family's cap ratio B(m)/Convex(m)" presupposes per-backend primary caps that the shared-cap formula never produces (only per-backend pilot *figures* exist).
*Smallest fix:* pick one keying and state it in both documents — either (i) token caps are keyed (family, backend, milestone), with the primary family's per-backend cap = 2× that backend's pilot figure (the "slowest" wording then applies to the wall cap only), or (ii) token caps stay family-shared and GPT's cap(m) = max over tier-1 backends of GPT-Convex(m) × [primary pilot figure B(m) / primary pilot figure Convex(m)]. Either way, say "pilot figure ratios," not "cap ratios."

**3. MATERIAL — IN-DELTA — brief §O5: the "exact function" is not exact as written.**
The 75 band's predicate "any ceiling **margin** above 50%" has two opposite readings. Read as headroom (usage ≤50% of ceiling), 75 overlaps 90 (every 90-qualifying lane also matches 75, making 90 unreachable under first-match) and leaves a hole (all usages in 50–100%, replay <50% of cap matches no band — the function is not total). Read as usage (>50% of ceiling), the function is total but "margin" is a misnomer, and the 50%/80% boundary inclusivity (75's "between 50–80%" vs 90's "≤50%", 60's ">80%") plus band-precedence order are unstated. Since the entire point of this fix was O5 determinism, an ambiguous/non-total frozen function defeats it, and the P3 decision table cannot be derived unambiguously from it.
*Smallest fix:* rewrite 75 as the explicit complement — "all rules and ceilings pass and the 90 condition is not met" — or as explicit usage fractions with stated inclusivity, and declare first-match-in-listed-order precedence.

**4. MATERIAL — IN-DELTA — brief §Scale envelope (Base state) + plan D2: the replay base state is not pinned to a *fresh* instance, so exact-count verification can fail spuriously.**
"The scale replay runs against the starter-seeded instance" is ambiguous between the lane's dev instance (which was starter-seeded) and a fresh instance. The dev instance carries M1–M6 acceptance and choreography residue — the choreography script drives Alice/Bob's *starter* DM, acceptance items leave persistent posts/follows, and M6's new 50-action sample-log conformance check adds its own residue — so the seeded deterministic sample's spot-checks (sampled chats' message counts, sampled users' follow counts) against exact combined starter+scale expectations can nonconform through no fault of the artifact, and "manifest nonconformance caps O5 at its failure band (0)" then fires spuriously. M7's parallel ruling already uses the right words ("a **fresh** backend instance seeded with the starter log").
*Smallest fix:* pin the replay base as a fresh instance seeded with the starter log (mirroring M7's wording), stating where the 50-action sample check runs (dev instance is fine once the scale replay is fresh); alternatively exclude acceptance-touched entities from the sample — but "fresh" is smaller.

**5. MATERIAL — IN-DELTA — plan D2 + brief §Statuses: `aborted` milestones escape the cap-charging rule, reopening the under-reporting channel that rule exists to close.**
The charging rule covers `capability-failure`'s two exhausted-axis cases (full wall cap + actual tokens flagged capped-wall; token cap instead when tokens were the exhausted axis). An `aborted` milestone exhausted neither axis, is "treated as a capability failure for proceed/completeness purposes" — but its published wall/token contribution is unstated. If it charges actuals, abandoning a hopeless milestone at 20% of cap publishes a smaller authoring wall than grinding to exhaustion — precisely the "artificially small figure" the delta's own parenthetical forbids. Secondarily, in the token-exhausted case the wall-side figure is only implicit (presumably actual wall).
*Smallest fix:* one sentence in both documents — an `aborted` milestone charges like `capability-failure` (full wall cap plus actual tokens, flagged `aborted`), and a token-exhausted milestone charges its token cap plus actual wall, flagged accordingly. (If the author prefers actuals-with-flag for environment aborts, that is also closable — but it must be stated.)

**6. MINOR — IN-DELTA — brief M1 acceptance item 4:** the "old session token no longer works against the backend (probe-able via the API in M6 waves)" assertion has no executor on reduced runs (no M6 API exists). Detail for the P1 assertion split: mark the API sub-assertion conditional on run scope in the applicability manifest. Altitude — P1 material.

**7. MINOR — IN-DELTA — plan D3.4:** "unless adjudicated a planting error" names no adjudicator for calibration disputes (author? wave panel?). Name it when the P1 calibration artifacts land.

**8. MINOR — IN-DELTA — plan D2 / brief §Statuses:** an environment-caused `aborted` (power loss, harness crash) counts toward completeness and the two-consecutive termination rule with no lane-rerun/invalidation path, so a backend can be published as incomplete for a harness fault. The orthogonal termination reason mitigates narrative harm; consider a narrow environment-abort rerun rule at P3. The author may accept this deliberately.

**9. MINOR — PRE-EXISTING — plan D2:** "the lane's authoring wall ends at M6 green or final cap" is undefined when M6 is `blocked` (it never runs and exhausts no cap); the wall presumably ends at the last runnable milestone's terminal status. Wording clarification only.

**10. MINOR — IN-DELTA — brief §Statuses:** `blocked-by-M{n}` is singular but M6 has four prerequisites; state the record convention when several failed (list, or lowest n). Record-schema nit for P1.

## AUTHOR-DECISION items

None. Every concern above is resolvable inside refinement with the stated one-to-two-sentence fixes; concern 5 contains one small design choice (cap-charge vs flagged-actuals for aborts) that the orchestrator can settle either way so long as it is stated.

---

Pre-existing text is clean across both documents, but five closure defects in the (e) delta's own mechanisms — applicability wiring that contradicts O1/O2/O5, self-contradictory cap keying, a non-total O5 band function, an unpinned replay base state, and uncharged aborts — would each mislead execution or scoring if frozen as written.

VERDICT: NOT READY


---

## Loop close-out — 2026-08-08

The loop terminated at its 3-round budget (rounds 2–4). Final
verdicts bind to **revision (e)** (plan blob d1fc24cb / brief blob
398dd288): dual NOT READY, with **pre-existing text clean in both
families in rounds 3 and 4** (delta-convergence). A later revision
**(f)** (plan blob 40cd6ad8 / brief blob 90e47f39) applies the
round-4 convergent smallest-sufficient fixes and is **UNREVIEWED**.
Disposition ledger and proposed next step: super-refine final report
in the orchestrating session, 2026-08-08. Status remains Review;
acceptance is the author's call.


---

## Round 5 — 2026-08-08 — revision (f), plan blob 40cd6ad8 / brief blob 90e47f39 — verdict: READY (pre-existing clean; residue all MINOR)

Provenance: llp-super-refine loop round 5, author-authorized extension
(1–2 rounds granted in-session); reviewer = fresh claude-fable-5
subagent, capsule-confined (capsule 0201-capsule-r5.tar sha256-16
eaebe35c999278ad; structurally excludes llp/reviews/*; out-of-capsule
abstinence self-attested); instructions = 0201-r5-instructions.md;
mutually blind to the GPT-family reviewer; runtime 6m36s. Body below
is verbatim.

# Round-5 delta review — LLP 0201 (f) + `benchmarks/briefs/social-messenger.md`

## Overall assessment

Revision (f) closes the round-4 convergent set cleanly: the per-dimension applicability rules are total over every dimension × status combination (the complete-lane enumeration is provably equivalent to the no-null condition under the pinned DAG), the O5 band function is total and unambiguous under first-match precedence, the replay/M7 base-state split resolves the exact-count verification problem, and the charging rules leave no uncharged terminal status. The residue I found is entirely wording-harmonization and input-domain edge cases at the seams of the new text — none identifies a defective decision, and every one has a one-sentence fix that naturally lands at P1/P3 freeze. Pre-existing text remains clean of MATERIAL concerns, consistent with rounds 3 and 4.

## Concerns

1. **MINOR / IN-DELTA — Plan D2 + brief "Budgets": cap-formula input domain when a pilot lane lacks a green figure.** "2× the largest tier-1 pilot lane token figure," "2× the slowest … wall figure," and the transfer term "primary pilot figure B(m)" are undefined for a pilot lane that never completed milestone m green; the P2 safety-limit fallback covers only the *no-lane*-green case, not the partial case (e.g., Convex green, Supabase failed). Smallest fix: one sentence in D2 — pilot figures read green pilot milestones; a pilot lane without a green figure for m contributes the safety limit as its figure (or is excluded), with P3's rerun-after-gap-fix path unchanged.

2. **MINOR / IN-DELTA — brief "Scoring/Applicability": observing-milestones list vs governing rules on O4.** The list attaches "(plus M1–M5 attempted)" to "O3, O4" jointly; the per-dimension rules (which the text says govern) attach it to O3 only. The divergence is vacuous — M6 green implies M1–M5 green via the blocking DAG — but the two sentences should not disagree. Smallest fix: move the parenthetical to O3 alone in the list, or drop it with a note that M6 green already implies it.

3. **MINOR / IN-DELTA — brief "Statuses and dependencies" vs Plan D2: `aborted` charging referent.** The brief's "charge the exhausted axis's full cap" has no referent for `aborted` (no axis was exhausted); the plan pins aborted to wall cap + actual tokens. The brief's "(both caps' semantics in LLP 0201 D2)" deference saves it from contradiction, but the operative document should state it. Smallest fix: brief adds "(`aborted`: wall cap plus actual tokens, per D2)".

4. **MINOR / IN-DELTA — Plan D2: the abort rationale overclaims on the token axis.** "Abandoning early never publishes a smaller figure than grinding to exhaustion" is strictly true for wall (charged at cap) but not for tokens: aborting before token exhaustion records actual tokens < token cap, smaller than a token-exhausted milestone's charge. The operative rule is fine and the gaming window is thin (any authoring-phase abort forfeits complete-lane/total eligibility). Smallest fix: scope the sentence to the wall axis or reword to "the abort never improves the capped axis."

5. **MINOR / IN-DELTA — brief "Statuses and dependencies": transitive blocking undefined.** M7's prerequisite is M6; when M6 is `blocked-by-M{n}` (not failed), "a prerequisite failed" does not literally hold for M7, yet M7 clearly cannot run. The complete-failed-prerequisite-set recording (n = lowest) implies transitive propagation but never states it. Smallest fix: one clause — a milestone whose prerequisite is blocked is itself blocked, recording the underlying transitive failed set.

6. **MINOR / IN-DELTA — Plan D3/brief "Holdout probes": probe semantics over never-built features under O3's broadened applicability.** O3 now scores when M1–M5 were merely *attempted*, so a probe can target functionality a failed milestone never built (e.g., view-once re-fetch when M5's view-once was never implemented) — a vacuous "correctly denied" would credit trust boundaries for absent features. The applicability decision is sound; the probe-level rule is missing. Smallest fix: a sentence deferring to P3 — probes whose target behavior was never built score under a preregistered rule (not-passed or excluded-with-note) frozen with the probe set and decision table.

7. **MINOR / IN-DELTA — brief "Budget caps and performance ceilings" placeholder table: stale (e)-era formula summary.** The table's preamble still reads "each milestone's cap = 2× the slowest tier-1 pilot lane's figure; wall caps shared across a comparison set" — not updated for the settled keying (largest token figure; family-keyed token caps; the transfer rule). The Budgets section above it is correct. Smallest fix: replace the preamble formula with a pointer to the Budgets section.

8. **MINOR / IN-DELTA — Plan D2/D7: the mid-tier Convex mini-pilot is required but unscheduled.** The settled keying says "the mid-tier leg calibrates the same way from its own Convex mini-pilot," but P2 names only the GPT mini-pilot; nothing schedules the mid-tier one before P5's capability-floor leg. Smallest fix: add the mid-tier Convex mini-pilot to P2 (or P3, after OQ1's model choice), mirroring the GPT clause.

9. **MINOR / PRE-EXISTING — brief O1: status enumeration incomplete.** O1's text scores `capability-failure` and `blocked-by-M{n}` checklists as not passed but omits `aborted` and `not-run`; the governing "regardless of status" phrase (and the delta's per-dimension rule) covers them, so this is enumeration hygiene only. Smallest fix: "non-green milestones score their checklists as not passed."

## AUTHOR-DECISION items

None. Nothing found exceeds refinement; all settled rulings and round-4 convergent fixes were respected and none is defective.

## VERDICT

The (f) delta is internally consistent, total where it claims totality, and consistent across both documents; every remaining concern is a MINOR wording or input-domain closure with an obvious one-sentence fix at P1/P3 freeze, and pre-existing text is clean.
VERDICT: READY


---

## Round 6 — 2026-08-08 — revision (g), plan blob 20713fbe / brief blob d6c79096 — verdict: NOT READY (1 MATERIAL IN-DELTA: safety-limit stand-in vs P2 fallback)

Provenance: llp-super-refine loop round 6, final author-authorized
round; reviewer = fresh claude-fable-5 subagent, capsule-confined
(capsule 0201-capsule-r6.tar sha256-16 078a2792d89bad4a; structurally
excludes llp/reviews/*; out-of-capsule abstinence self-attested);
instructions = 0201-r6-instructions.md; mutually blind to the
GPT-family reviewer; runtime 4m49s. Body below is verbatim.

# Round-6 review — LLP 0201 revision (g) + brief `social-messenger.md` (d6c79096)

## Overall assessment

Revision (g) cleanly closes all four round-5 MATERIALs: the cap-family enumeration matches D5's model matrix exactly and is mirrored verbatim in the brief's Budgets paragraph; the execution-completeness/usable-grading-record split is stated identically in both documents and coheres with D3.4's dual-abort outcome; the hidden actual-state sample now enumerates a check per action-schema class; and the brief's charging text mirrors the plan's three cases, with the "never improves the capped axis" rationale verified correct under both exhaustion directions. However, the new safety-limit stand-in rule for pilot figures contradicts P2's pre-existing cap rule and produces a non-monotone corner case, which is a genuine preregistration defect in the delta itself; the remainder is minor.

## Concerns

**C1 — MATERIAL, IN-DELTA — D2 (Budget caps) + brief Budgets paragraph vs plan P2.** The (g) stand-in rule ("pilot figures read green pilot milestones; a pilot lane with no green figure for m contributes the safety limit as its figure") conflicts with P2's pre-existing rule ("a milestone no pilot lane completed green takes the safety limit itself as its cap"). Under D2/brief, an all-lanes-not-green milestone gets cap = 2× safety limit (the stand-in is the slowest/largest figure, then 2× applies); under P2, cap = the safety limit itself. Worse, the two rules combined are non-monotone: a milestone where *one* pilot lane failed green gets cap = 2× SL (stand-in dominates green figures, which are ≤ SL by construction), while a milestone where *every* lane failed gets cap = SL — more pilot failure yields a smaller cap. The transfer formula amplifies this for GPT/mid-tier token caps (a stand-in numerator times a backend ratio > 1 can exceed 2× SL). This is a preregistered, claim-relevant formula giving two different values, exactly the class of ambiguity rounds 3–5 treated as MATERIAL. *Smallest sufficient fix:* pick one rule and state it in all three places (plan D2, plan P2, brief Budgets) — e.g., "wherever the governing figure is a safety-limit stand-in, the 2× multiplier is not applied on top: the cap is the safety limit itself (transfer ratios likewise clamp at the safety limit)," or alternatively make P2 read "2× the safety limit" — either direction closes it; consistency is the requirement.

**C2 — MINOR, IN-DELTA — D2 / brief Budgets, Kimi/Grok cap-advisory.** "Caps recorded, never enforced" is undefined for the token axis: token caps are keyed by (cap family, milestone) and no Kimi/Grok token cap is ever derived (no mini-pilot, no transfer), so there is no value to record advisorily; and with no enforcement, nothing bounds a runaway exploratory lane. *Smallest fix:* one clause stating what advisory lanes record (e.g., the wall cap plus the primary family's token cap as reference) and that the P2 safety limits apply to them as hard stops.

**C3 — MINOR, IN-DELTA — D2, GPT mini-pilot scope.** "Extended before any full-app GPT wave" leaves an OQ3-style N=1 GPT M1–M7 exploratory run ambiguous — GPT is an enforced cap family, so that lane needs M4–M7 token caps too. *Smallest fix:* "before any full-app GPT lane."

**C4 — MINOR, IN-DELTA — D2/P3, mid-tier mini-pilot scope.** The GPT mini-pilot's scope is pinned (M1–M3); the mid-tier mini-pilot's is not, though M1–M3 is the only scope its leg needs. *Smallest fix:* a parenthetical "(scope M1–M3, matching its leg)" at either mention.

**C5 — MINOR, IN-DELTA (altitude) — brief Holdout probes, never-built probe rule.** Given the prerequisite DAG, O3 eligibility (M6 green) implies M1–M5 green, so the "probes whose target behavior a failed milestone never built" rule has an empty domain wherever O3 actually scores; it operates only on reported-but-not-scored probe outcomes of ineligible lanes. Harmless as a fail-safe; no change required, optionally note it governs reporting, not scored O3.

**C6 — MINOR, IN-DELTA (altitude) — D4 / brief Scoring, completion rate.** With completeness re-scoped to execution completeness, whether an execution-complete lane whose grading dual-aborted counts as "complete" in the published completion rate is implied (yes) but unstated. A half-sentence, or the P1 record schema, can pin it.

## AUTHOR-DECISION items

None — C1's resolution is a refinement-level pick (either direction works if applied consistently); nothing in the delta exceeds refinement.

## VERDICT

The (g) delta closes all four round-5 MATERIALs consistently across both documents, but its new safety-limit stand-in rule contradicts P2's pre-existing cap fallback and yields a non-monotone preregistered cap formula, which must be reconciled before freeze-facing text is READY.

VERDICT: NOT READY


---

## Loop close-out (final) — 2026-08-08

The author-authorized extension (rounds 5–6) is exhausted; this
supersedes the round-4 close-out note. **Final verdicts bind revision
(g)** (plan blob 20713fbe / brief blob d6c79096): round 6 dual
NOT READY — Claude 1 MATERIAL, Codex 2 MATERIAL, all IN-DELTA and
convergent (the safety-limit stand-in contradiction; O5 named-fixture
verification). Round 5 on (f): Claude READY / Codex NOT READY.
Pre-existing text was found clean by both families in every delta
round (3–6). **Revision (h)** (plan blob e2c65704 / brief blob
da973789) applies the round-6 convergent fixes and is **UNREVIEWED**.
Status remains Review; acceptance is the author's call.
